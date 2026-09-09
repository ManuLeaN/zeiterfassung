# Zeiterfassung

Sehr einfache Single-User-Zeiterfassung als eine Docker-Anwendung:
Node.js-Server (Express) liefert API + Weboberfläche aus, Daten liegen in einer
SQLite-Datei (Node's eingebautes `node:sqlite`, keine externe DB nötig).

## Funktionen

- **Start/Stopp**-Button für die Arbeitszeit. Pro Kalendertag wird automatisch
  **einmalig 30 Minuten Pause** abgezogen (sobald an dem Tag gearbeitet wurde).
- **Überstunden**-Button: unabhängiger zweiter Timer, addiert seine Zeit 1:1
  drauf (kein Pausenabzug).
- Auswertung **Heute / Monat / Jahr** in Dezimalstunden (z. B. `7.50 h`).
- Als PWA installierbar ("Zum Home-Bildschirm hinzufügen") für App-Gefühl auf
  dem Handy.
- Kein Login – gedacht für den Betrieb ausschließlich im Heim-WLAN.

## Lokal testen

```bash
npm install
DATA_DIR=./data PORT=3000 node server.js
```

Dann `http://localhost:3000` öffnen.

## Hosting auf TrueNAS SCALE

Die App läuft als ein einziges Docker-Image. TrueNAS SCALE zieht Images aus
einer Registry (z. B. Docker Hub), baut sie nicht selbst aus einem Dockerfile.
Deshalb: einmal bauen & hochladen, danach nur noch in TrueNAS konfigurieren.

### 1. Image bauen und zu Docker Hub hochladen

Auf einem Rechner mit Docker (z. B. diesem PC mit Docker Desktop):

```bash
docker login
docker build -t DEIN_DOCKERHUB_NAME/zeiterfassung:latest .
docker push DEIN_DOCKERHUB_NAME/zeiterfassung:latest
```

(Ein kostenloser öffentlicher Docker-Hub-Account reicht; das Repo kann public
bleiben, es enthält keine Zugangsdaten.)

### 2. In TrueNAS SCALE ein Dataset für die Daten anlegen

- **Storage → Datasets** → im gewünschten Pool ein neues Dataset anlegen,
  z. B. `apps/zeiterfassung-data`. Hier liegt später die SQLite-Datei.

### 3. App in TrueNAS SCALE anlegen

- **Apps → Discover Apps → Custom App** (heißt je nach SCALE-Version auch
  "Launch Docker Image").
- **Application Name:** `zeiterfassung`
- **Image Repository:** `DEIN_DOCKERHUB_NAME/zeiterfassung`
- **Image Tag:** `latest`
- **Container Port:** `3000` → **Node Port** z. B. `3000` (frei wählbar, das
  ist der Port, den du später im Browser ansprichst)
- **Storage:** ein "Host Path" oder "Ix Volume" hinzufügen:
  - Mount Path im Container: `/data`
  - Host Path: das in Schritt 2 angelegte Dataset
- **Environment Variables** (optional, Defaults passen für Deutschland):
  - `TZ=Europe/Berlin` (ist im Image schon Default, hier nur falls du eine
    andere Zeitzone brauchst)
- Speichern / **Deploy**.

### 4. Nutzen

- Im Heimnetz (PC oder Handy im selben WLAN): `http://TRUENAS_IP:3000`
  öffnen.
- Auf dem Handy: Seite öffnen → Browser-Menü → **"Zum Startbildschirm
  hinzufügen"**. Danach startet die App wie eine normale App-Kachel.

### Updates einspielen

Wenn du am Code etwas änderst:

```bash
docker build -t DEIN_DOCKERHUB_NAME/zeiterfassung:latest .
docker push DEIN_DOCKERHUB_NAME/zeiterfassung:latest
```

Danach in TrueNAS die App anhalten und mit "Update"/"Redeploy" neu starten,
damit sie das neue `:latest`-Image zieht. Die Daten im `/data`-Dataset bleiben
dabei unberührt.

### Backup

Einfach das Dataset `apps/zeiterfassung-data` (bzw. die Datei
`zeiterfassung.db` darin) über TrueNAS' normale Snapshot-/Replication-Tasks
sichern wie jedes andere Dataset auch.

## Warum diese Technik

- **Kein natives Kompilieren im Container** (kein `better-sqlite3` o. ä.),
  weil `node:sqlite` in Node 22+ eingebaut ist – das ist auf einem NAS oft die
  größte Fehlerquelle bei Docker-Images mit SQLite.
- **Ein Container, kein Reverse Proxy, kein separates Frontend-Hosting** –
  passt zum Wunsch "so einfach wie möglich" und reicht für reinen
  Heimnetz-Betrieb.
- Für Zugriff von unterwegs (aktuell nicht benötigt) würde man später einen
  VPN-Zugang wie Tailscale zum NAS einrichten, statt den Port ins Internet zu
  öffnen.
