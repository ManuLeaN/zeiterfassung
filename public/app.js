(() => {
  const workBtn = document.getElementById('workBtn');
  const overtimeBtn = document.getElementById('overtimeBtn');
  const workInfo = document.getElementById('workInfo');
  const overtimeInfo = document.getElementById('overtimeInfo');
  const clockEl = document.getElementById('clock');
  const weekTargetInput = document.getElementById('weekTargetInput');

  let status = { work: { running: false, startedAt: null }, overtime: { running: false, startedAt: null } };
  let daySummary = { rawWorkMinutes: 0, overtimeMinutes: 0, hours: { total: 0 } };
  let homeWeekSummary = { hours: { ist: 0, soll: 40, saldo: -40 } };

  let viewMonth = new Date(); // first-of-month reference for the "Monat" tab
  let viewYear = new Date().getFullYear();
  let viewWeekMonday = mondayOf(new Date()); // Monday reference for the "Woche" tab

  const BREAK_MINUTES = 30;
  const VBZ_MINUTES = 24; // Vorbereitungszeit: 0.4 h pro Arbeitstag

  function fmtHours(minutes) {
    return (Math.round((minutes / 60) * 100) / 100).toFixed(2) + ' h';
  }

  function fmtSigned(minutes, sign) {
    return sign + (Math.round((minutes / 60) * 100) / 100).toFixed(2) + ' h';
  }

  function elapsedMinutes(iso) {
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  function timeOfDay(iso) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    return new Date(value).toISOString();
  }

  function nowDatetimeLocalValue() {
    return toDatetimeLocalValue(new Date().toISOString());
  }

  function toLocalDateString(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function mondayOf(d) {
    const copy = new Date(d);
    const day = copy.getDay(); // 0=So, 1=Mo, ... 6=Sa
    const diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function fmtDateShort(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.`;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  }

  async function refreshStatus() {
    status = await api('/api/status');
  }

  async function refreshDaySummary() {
    daySummary = await api('/api/summary/day');
  }

  async function refreshHomeWeek() {
    const weekStart = toLocalDateString(mondayOf(new Date()));
    const [target, summary] = await Promise.all([
      api(`/api/week-target?week_start=${weekStart}`),
      api(`/api/summary/week?week_start=${weekStart}`),
    ]);
    homeWeekSummary = summary;
    if (document.activeElement !== weekTargetInput) {
      weekTargetInput.value = target.targetHours;
    }
  }

  async function refreshWeekView() {
    const weekStart = toLocalDateString(viewWeekMonday);
    const data = await api(`/api/summary/week?week_start=${weekStart}`);
    renderWeekView(data);
  }

  function renderWeekView(data) {
    document.getElementById('weekLabel').textContent =
      `KW ${data.weekNumber} · ${fmtDateShort(data.weekStart)}–${fmtDateShort(data.weekEnd)}${data.isoYear}`;
    document.getElementById('weekViewSoll').textContent = data.hours.soll.toFixed(2) + ' h';
    document.getElementById('weekViewIst').textContent = data.hours.ist.toFixed(2) + ' h';
    const saldoEl = document.getElementById('weekViewSaldo');
    saldoEl.textContent = (data.hours.saldo >= 0 ? '+' : '') + data.hours.saldo.toFixed(2) + ' h';
    saldoEl.style.color = data.hours.saldo >= 0 ? '#34d399' : '#f87171';
  }

  async function refreshMonthSummary() {
    const monthStr = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`;
    const data = await api(`/api/summary/month?month=${monthStr}`);
    renderMonth(data);
  }

  async function refreshYearSummary() {
    const data = await api(`/api/summary/year?year=${viewYear}`);
    renderYear(data);
  }

  function renderButtons() {
    if (status.work.running) {
      workBtn.textContent = 'Stopp';
      workBtn.className = 'big-btn work-running';
      workInfo.textContent = `Läuft seit ${timeOfDay(status.work.startedAt)}`;
    } else {
      workBtn.textContent = 'Start';
      workBtn.className = 'big-btn work-idle';
      workInfo.textContent = '';
    }
    if (status.overtime.running) {
      overtimeBtn.textContent = 'Überstunden stoppen';
      overtimeBtn.className = 'big-btn overtime-running';
      overtimeInfo.textContent = `Läuft seit ${timeOfDay(status.overtime.startedAt)}`;
    } else {
      overtimeBtn.textContent = 'Überstunden';
      overtimeBtn.className = 'big-btn overtime-idle';
      overtimeInfo.textContent = '';
    }
  }

  function renderLiveDay() {
    const rawWork = daySummary.rawWorkMinutes + (status.work.running ? elapsedMinutes(status.work.startedAt) : 0);
    const overtime = daySummary.overtimeMinutes + (status.overtime.running ? elapsedMinutes(status.overtime.startedAt) : 0);
    const breakMin = rawWork > 0 ? BREAK_MINUTES : 0;
    const vbzMin = rawWork > 0 ? VBZ_MINUTES : 0;
    const net = rawWork > 0 ? Math.max(0, rawWork - breakMin + vbzMin) : 0;
    const total = net + overtime;

    document.getElementById('dayRaw').textContent = fmtHours(rawWork);
    document.getElementById('dayBreak').textContent = fmtSigned(breakMin, '-');
    document.getElementById('dayVbz').textContent = fmtSigned(vbzMin, '+');
    document.getElementById('dayNet').textContent = fmtHours(net);
    document.getElementById('dayOvertime').textContent = fmtHours(overtime);
    document.getElementById('dayTotal').textContent = fmtHours(total);
  }

  function renderLiveWeek() {
    const rawWork = daySummary.rawWorkMinutes + (status.work.running ? elapsedMinutes(status.work.startedAt) : 0);
    const overtime = daySummary.overtimeMinutes + (status.overtime.running ? elapsedMinutes(status.overtime.startedAt) : 0);
    const breakMin = rawWork > 0 ? BREAK_MINUTES : 0;
    const vbzMin = rawWork > 0 ? VBZ_MINUTES : 0;
    const net = rawWork > 0 ? Math.max(0, rawWork - breakMin + vbzMin) : 0;
    const todayLiveTotalHours = (net + overtime) / 60;

    const weekIstLive = homeWeekSummary.hours.ist - daySummary.hours.total + todayLiveTotalHours;
    const soll = homeWeekSummary.hours.soll;
    const saldo = weekIstLive - soll;

    document.getElementById('weekIst').textContent = weekIstLive.toFixed(2) + ' h';
    const saldoEl = document.getElementById('weekSaldo');
    saldoEl.textContent = (saldo >= 0 ? '+' : '') + saldo.toFixed(2) + ' h';
    saldoEl.style.color = saldo >= 0 ? '#34d399' : '#f87171';
  }

  function renderMonth(data) {
    const [y, m] = data.month.split('-');
    document.getElementById('monthLabel').textContent = `${m}/${y}`;
    const body = document.getElementById('monthBody');
    body.innerHTML = '';
    for (const d of data.days) {
      const tr = document.createElement('tr');
      const day = d.date.slice(8, 10);
      tr.innerHTML = `<td>${day}.</td><td>${d.hours.net.toFixed(2)}</td><td>${d.hours.overtime.toFixed(2)}</td><td>${d.hours.total.toFixed(2)}</td>`;
      body.appendChild(tr);
    }
    const totals = document.getElementById('monthTotals');
    totals.innerHTML = `<th>Summe</th><th>${data.totals.net.toFixed(2)}</th><th>${data.totals.overtime.toFixed(2)}</th><th>${data.totals.total.toFixed(2)}</th>`;
  }

  function renderYear(data) {
    document.getElementById('yearLabel').textContent = data.year;
    const body = document.getElementById('yearBody');
    body.innerHTML = '';
    const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    for (const mo of data.months) {
      const tr = document.createElement('tr');
      const idx = Number(mo.month.split('-')[1]) - 1;
      tr.innerHTML = `<td>${monthNames[idx]}</td><td>${mo.hours.net.toFixed(2)}</td><td>${mo.hours.overtime.toFixed(2)}</td><td>${mo.hours.total.toFixed(2)}</td>`;
      body.appendChild(tr);
    }
    const totals = document.getElementById('yearTotals');
    totals.innerHTML = `<th>Summe</th><th>${data.totals.net.toFixed(2)}</th><th>${data.totals.overtime.toFixed(2)}</th><th>${data.totals.total.toFixed(2)}</th>`;
  }

  workBtn.addEventListener('click', async () => {
    workBtn.disabled = true;
    try {
      await api(status.work.running ? '/api/work/stop' : '/api/work/start', { method: 'POST' });
      await Promise.all([refreshStatus(), refreshDaySummary(), refreshHomeWeek()]);
      renderButtons();
      renderLiveDay();
      renderLiveWeek();
    } catch (e) {
      alert(e.message);
    } finally {
      workBtn.disabled = false;
    }
  });

  overtimeBtn.addEventListener('click', async () => {
    overtimeBtn.disabled = true;
    try {
      await api(status.overtime.running ? '/api/overtime/stop' : '/api/overtime/start', { method: 'POST' });
      await Promise.all([refreshStatus(), refreshDaySummary(), refreshHomeWeek()]);
      renderButtons();
      renderLiveDay();
      renderLiveWeek();
    } catch (e) {
      alert(e.message);
    } finally {
      overtimeBtn.disabled = false;
    }
  });

  weekTargetInput.addEventListener('change', async () => {
    const value = Number(weekTargetInput.value);
    if (!Number.isFinite(value) || value < 0) return;
    try {
      await api('/api/week-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: toLocalDateString(mondayOf(new Date())), target_hours: value }),
      });
      await refreshHomeWeek();
      renderLiveWeek();
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById('weekPrev').addEventListener('click', () => {
    viewWeekMonday.setDate(viewWeekMonday.getDate() - 7);
    refreshWeekView();
  });
  document.getElementById('weekNext').addEventListener('click', () => {
    viewWeekMonday.setDate(viewWeekMonday.getDate() + 7);
    refreshWeekView();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'week') refreshWeekView();
      if (btn.dataset.tab === 'month') refreshMonthSummary();
      if (btn.dataset.tab === 'year') refreshYearSummary();
      if (btn.dataset.tab === 'admin') refreshAdminSessions();
    });
  });

  // --- Admin: Einträge bearbeiten/anlegen/löschen, Debug-Start ---

  const adminDateInput = document.getElementById('adminDate');
  const adminBody = document.getElementById('adminBody');
  adminDateInput.value = toLocalDateString(new Date());

  async function refreshAll() {
    await Promise.all([refreshStatus(), refreshDaySummary(), refreshHomeWeek()]);
    renderButtons();
    renderLiveDay();
    renderLiveWeek();
  }

  function typeLabel(type) {
    return type === 'work' ? 'Arbeit' : 'Überstunden';
  }

  function renderAdminRow(session) {
    const tr = document.createElement('tr');

    const typeCell = document.createElement('td');
    const typeSelect = document.createElement('select');
    typeSelect.innerHTML = `<option value="work">Arbeit</option><option value="overtime">Überstunden</option>`;
    typeSelect.value = session.type;
    typeCell.appendChild(typeSelect);

    const startCell = document.createElement('td');
    const startInput = document.createElement('input');
    startInput.type = 'datetime-local';
    startInput.value = toDatetimeLocalValue(session.start_time);
    startCell.appendChild(startInput);

    const endCell = document.createElement('td');
    const endInput = document.createElement('input');
    endInput.type = 'datetime-local';
    endInput.value = toDatetimeLocalValue(session.end_time);
    endCell.appendChild(endInput);

    const durationCell = document.createElement('td');
    function updateDuration() {
      if (!startInput.value || !endInput.value) {
        durationCell.textContent = session.end_time ? '' : 'läuft';
        return;
      }
      const mins = (new Date(endInput.value) - new Date(startInput.value)) / 60000;
      durationCell.textContent = mins >= 0 ? fmtHours(mins) : '⚠';
    }
    startInput.addEventListener('input', updateDuration);
    endInput.addEventListener('input', updateDuration);
    updateDuration();

    const actionsCell = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Speichern';
    saveBtn.className = 'save-btn';
    saveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: typeSelect.value,
            start_time: fromDatetimeLocalValue(startInput.value),
            end_time: fromDatetimeLocalValue(endInput.value),
          }),
        });
        await refreshAdminSessions();
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Löschen';
    deleteBtn.className = 'delete-btn';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Diesen Eintrag wirklich löschen?')) return;
      try {
        await api(`/api/sessions/${session.id}`, { method: 'DELETE' });
        await refreshAdminSessions();
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    });

    actionsCell.appendChild(saveBtn);
    actionsCell.appendChild(deleteBtn);

    tr.appendChild(typeCell);
    tr.appendChild(startCell);
    tr.appendChild(endCell);
    tr.appendChild(durationCell);
    tr.appendChild(actionsCell);
    return tr;
  }

  function renderNewAdminRow() {
    const tr = document.createElement('tr');
    const defaultTime = `${adminDateInput.value}T09:00`;

    const typeCell = document.createElement('td');
    const typeSelect = document.createElement('select');
    typeSelect.innerHTML = `<option value="work">Arbeit</option><option value="overtime">Überstunden</option>`;
    typeCell.appendChild(typeSelect);

    const startCell = document.createElement('td');
    const startInput = document.createElement('input');
    startInput.type = 'datetime-local';
    startInput.value = defaultTime;
    startCell.appendChild(startInput);

    const endCell = document.createElement('td');
    const endInput = document.createElement('input');
    endInput.type = 'datetime-local';
    endInput.value = defaultTime;
    endCell.appendChild(endInput);

    const durationCell = document.createElement('td');

    const actionsCell = document.createElement('td');
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Anlegen';
    addBtn.className = 'save-btn';
    addBtn.addEventListener('click', async () => {
      try {
        await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: typeSelect.value,
            start_time: fromDatetimeLocalValue(startInput.value),
            end_time: fromDatetimeLocalValue(endInput.value),
          }),
        });
        await refreshAdminSessions();
        await refreshAll();
      } catch (e) {
        alert(e.message);
      }
    });
    actionsCell.appendChild(addBtn);

    tr.appendChild(typeCell);
    tr.appendChild(startCell);
    tr.appendChild(endCell);
    tr.appendChild(durationCell);
    tr.appendChild(actionsCell);
    return tr;
  }

  async function refreshAdminSessions() {
    const date = adminDateInput.value;
    const sessions = await api(`/api/sessions?from=${date}&to=${date}`);
    adminBody.innerHTML = '';
    for (const s of sessions) {
      adminBody.appendChild(renderAdminRow(s));
    }
  }

  adminDateInput.addEventListener('change', refreshAdminSessions);
  document.getElementById('adminAddRow').addEventListener('click', () => {
    adminBody.appendChild(renderNewAdminRow());
  });

  const debugStartTime = document.getElementById('debugStartTime');
  debugStartTime.value = nowDatetimeLocalValue();
  document.getElementById('debugStartBtn').addEventListener('click', async () => {
    const type = document.getElementById('debugType').value;
    const startTime = fromDatetimeLocalValue(debugStartTime.value);
    try {
      await api(`/api/${type}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTime }),
      });
      await refreshAdminSessions();
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById('monthPrev').addEventListener('click', () => {
    viewMonth.setMonth(viewMonth.getMonth() - 1);
    refreshMonthSummary();
  });
  document.getElementById('monthNext').addEventListener('click', () => {
    viewMonth.setMonth(viewMonth.getMonth() + 1);
    refreshMonthSummary();
  });
  document.getElementById('yearPrev').addEventListener('click', () => {
    viewYear -= 1;
    refreshYearSummary();
  });
  document.getElementById('yearNext').addEventListener('click', () => {
    viewYear += 1;
    refreshYearSummary();
  });

  function tickClock() {
    clockEl.textContent = new Date().toLocaleString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  async function init() {
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(renderLiveDay, 1000);
    setInterval(renderLiveWeek, 1000);
    setInterval(() => { refreshStatus().then(renderButtons); }, 15000);
    setInterval(refreshDaySummary, 15000);
    setInterval(refreshHomeWeek, 15000);

    await Promise.all([refreshStatus(), refreshDaySummary(), refreshHomeWeek()]);
    renderButtons();
    renderLiveDay();
    renderLiveWeek();
  }

  init();
})();
