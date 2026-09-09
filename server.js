'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;
const BREAK_MINUTES = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'zeiterfassung.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('work','overtime')),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT
  );
`);

function toLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

function getRunning(type) {
  const row = db.prepare(
    `SELECT id, start_time FROM sessions WHERE type = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1`
  ).get(type);
  return row || null;
}

function startSession(type, startTimeOverride) {
  if (getRunning(type)) {
    const err = new Error(`${type} session already running`);
    err.status = 409;
    throw err;
  }
  const now = startTimeOverride ? new Date(startTimeOverride) : new Date();
  if (Number.isNaN(now.getTime())) {
    const err = new Error('invalid startTime');
    err.status = 400;
    throw err;
  }
  db.prepare(`INSERT INTO sessions (type, date, start_time, end_time) VALUES (?, ?, ?, NULL)`)
    .run(type, toLocalDate(now), now.toISOString());
  return { running: true, startedAt: now.toISOString() };
}

function stopSession(type, endTimeOverride) {
  const running = getRunning(type);
  if (!running) {
    const err = new Error(`no ${type} session running`);
    err.status = 409;
    throw err;
  }
  const now = endTimeOverride ? new Date(endTimeOverride) : new Date();
  if (Number.isNaN(now.getTime())) {
    const err = new Error('invalid endTime');
    err.status = 400;
    throw err;
  }
  db.prepare(`UPDATE sessions SET end_time = ? WHERE id = ?`).run(now.toISOString(), running.id);
  return { running: false, startedAt: null };
}

function assertValidRange(startIso, endIso) {
  if (endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
    const err = new Error('end_time must not be before start_time');
    err.status = 400;
    throw err;
  }
}

function status() {
  const work = getRunning('work');
  const overtime = getRunning('overtime');
  return {
    work: { running: !!work, startedAt: work ? work.start_time : null },
    overtime: { running: !!overtime, startedAt: overtime ? overtime.start_time : null },
  };
}

// Raw (pre-break) work minutes + overtime minutes per day, completed sessions only.
function dailyBreakdown(fromDate, toDate) {
  const rows = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN type = 'work' THEN (julianday(end_time) - julianday(start_time)) * 1440 ELSE 0 END) AS rawWorkMinutes,
      SUM(CASE WHEN type = 'overtime' THEN (julianday(end_time) - julianday(start_time)) * 1440 ELSE 0 END) AS overtimeMinutes
    FROM sessions
    WHERE end_time IS NOT NULL AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(fromDate, toDate);

  return rows.map((r) => {
    const rawWorkMinutes = r.rawWorkMinutes || 0;
    const overtimeMinutes = r.overtimeMinutes || 0;
    const netWorkMinutes = rawWorkMinutes > 0 ? Math.max(0, rawWorkMinutes - BREAK_MINUTES) : 0;
    return {
      date: r.date,
      rawWorkMinutes,
      breakMinutes: rawWorkMinutes > 0 ? BREAK_MINUTES : 0,
      netWorkMinutes,
      overtimeMinutes,
      totalMinutes: netWorkMinutes + overtimeMinutes,
    };
  });
}

function daySummary(dateStr) {
  const [row] = dailyBreakdown(dateStr, dateStr);
  if (!row) {
    return {
      date: dateStr,
      rawWorkMinutes: 0,
      breakMinutes: 0,
      netWorkMinutes: 0,
      overtimeMinutes: 0,
      totalMinutes: 0,
      hours: { net: 0, overtime: 0, total: 0 },
    };
  }
  return {
    ...row,
    hours: {
      net: hours(row.netWorkMinutes),
      overtime: hours(row.overtimeMinutes),
      total: hours(row.totalMinutes),
    },
  };
}

function monthSummary(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const from = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const days = dailyBreakdown(from, to);
  const totals = days.reduce(
    (acc, d) => {
      acc.netWorkMinutes += d.netWorkMinutes;
      acc.overtimeMinutes += d.overtimeMinutes;
      acc.totalMinutes += d.totalMinutes;
      return acc;
    },
    { netWorkMinutes: 0, overtimeMinutes: 0, totalMinutes: 0 }
  );
  return {
    month: monthStr,
    days: days.map((d) => ({
      date: d.date,
      hours: { net: hours(d.netWorkMinutes), overtime: hours(d.overtimeMinutes), total: hours(d.totalMinutes) },
    })),
    totals: { net: hours(totals.netWorkMinutes), overtime: hours(totals.overtimeMinutes), total: hours(totals.totalMinutes) },
  };
}

function yearSummary(yearStr) {
  const from = `${yearStr}-01-01`;
  const to = `${yearStr}-12-31`;
  const days = dailyBreakdown(from, to);
  const byMonth = new Map();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, { netWorkMinutes: 0, overtimeMinutes: 0, totalMinutes: 0 });
    const acc = byMonth.get(m);
    acc.netWorkMinutes += d.netWorkMinutes;
    acc.overtimeMinutes += d.overtimeMinutes;
    acc.totalMinutes += d.totalMinutes;
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, acc]) => ({
      month,
      hours: { net: hours(acc.netWorkMinutes), overtime: hours(acc.overtimeMinutes), total: hours(acc.totalMinutes) },
    }));
  const totals = days.reduce(
    (acc, d) => {
      acc.netWorkMinutes += d.netWorkMinutes;
      acc.overtimeMinutes += d.overtimeMinutes;
      acc.totalMinutes += d.totalMinutes;
      return acc;
    },
    { netWorkMinutes: 0, overtimeMinutes: 0, totalMinutes: 0 }
  );
  return {
    year: yearStr,
    months,
    totals: { net: hours(totals.netWorkMinutes), overtime: hours(totals.overtimeMinutes), total: hours(totals.totalMinutes) },
  };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json(status());
});

app.post('/api/work/start', (req, res, next) => {
  try {
    startSession('work', req.body && req.body.startTime);
    res.json(status());
  } catch (err) { next(err); }
});

app.post('/api/work/stop', (req, res, next) => {
  try {
    stopSession('work', req.body && req.body.endTime);
    res.json(status());
  } catch (err) { next(err); }
});

app.post('/api/overtime/start', (req, res, next) => {
  try {
    startSession('overtime', req.body && req.body.startTime);
    res.json(status());
  } catch (err) { next(err); }
});

app.post('/api/overtime/stop', (req, res, next) => {
  try {
    stopSession('overtime', req.body && req.body.endTime);
    res.json(status());
  } catch (err) { next(err); }
});

// --- Admin: direkte Bearbeitung einzelner Einträge (Zeiten korrigieren, manuell anlegen) ---

app.get('/api/sessions', (req, res, next) => {
  try {
    const from = req.query.from || toLocalDate(new Date());
    const to = req.query.to || from;
    const rows = db.prepare(
      `SELECT id, type, date, start_time, end_time FROM sessions WHERE date BETWEEN ? AND ? ORDER BY start_time`
    ).all(from, to);
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/sessions', (req, res, next) => {
  try {
    const { type, start_time, end_time } = req.body || {};
    if (!['work', 'overtime'].includes(type)) {
      const err = new Error('type must be "work" or "overtime"');
      err.status = 400;
      throw err;
    }
    if (!start_time || Number.isNaN(new Date(start_time).getTime())) {
      const err = new Error('start_time is required and must be a valid date');
      err.status = 400;
      throw err;
    }
    if (end_time && Number.isNaN(new Date(end_time).getTime())) {
      const err = new Error('end_time must be a valid date');
      err.status = 400;
      throw err;
    }
    assertValidRange(start_time, end_time || null);
    const date = toLocalDate(new Date(start_time));
    const info = db.prepare(
      `INSERT INTO sessions (type, date, start_time, end_time) VALUES (?, ?, ?, ?)`
    ).run(type, date, start_time, end_time || null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) { next(err); }
});

app.patch('/api/sessions/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
    if (!existing) {
      const err = new Error('session not found');
      err.status = 404;
      throw err;
    }
    const body = req.body || {};
    const type = body.type !== undefined ? body.type : existing.type;
    const start_time = body.start_time !== undefined ? body.start_time : existing.start_time;
    const end_time = body.end_time !== undefined ? body.end_time : existing.end_time;
    if (!['work', 'overtime'].includes(type)) {
      const err = new Error('type must be "work" or "overtime"');
      err.status = 400;
      throw err;
    }
    if (!start_time || Number.isNaN(new Date(start_time).getTime())) {
      const err = new Error('start_time must be a valid date');
      err.status = 400;
      throw err;
    }
    if (end_time && Number.isNaN(new Date(end_time).getTime())) {
      const err = new Error('end_time must be a valid date');
      err.status = 400;
      throw err;
    }
    assertValidRange(start_time, end_time || null);
    const date = toLocalDate(new Date(start_time));
    db.prepare(`UPDATE sessions SET type = ?, date = ?, start_time = ?, end_time = ? WHERE id = ?`)
      .run(type, date, start_time, end_time || null, id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/api/sessions/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/summary/day', (req, res, next) => {
  try {
    const date = req.query.date || toLocalDate(new Date());
    res.json(daySummary(date));
  } catch (err) { next(err); }
});

app.get('/api/summary/month', (req, res, next) => {
  try {
    const month = req.query.month || toLocalDate(new Date()).slice(0, 7);
    res.json(monthSummary(month));
  } catch (err) { next(err); }
});

app.get('/api/summary/year', (req, res, next) => {
  try {
    const year = req.query.year || String(new Date().getFullYear());
    res.json(yearSummary(year));
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Zeiterfassung listening on :${PORT}, data dir: ${DATA_DIR}`);
});
