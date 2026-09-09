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

## Hosting auf TrueNAS SCALE via Portainer

Quelle: [github.com/ManuLeaN/zeiterfassung](https://github.com/ManuLeaN/zeiterfassung).
Kein Docker Hub nötig — Portainer klont das Repo direkt auf den NAS und baut
das Image dort aus dem `Dockerfile`.

### 1. Portainer installieren

- **Apps → Discover Apps** → nach "Portainer" suchen → installieren.
- Falls nicht gelistet: **Custom App** / "Launch Docker Image" mit
  - Image: `portainer/portainer-ce:latest`
  - Container Port `9443` → Node Port `9443`
  - Volume: Container-Pfad `/data` → eigenes Dataset (z. B. `apps/portainer-data`)
  - Zusätzlich Docker-Socket mounten: Host Path `/var/run/docker.sock` →
    Container-Pfad `/var/run/docker.sock` (damit Portainer den NAS-eigenen
    Docker-Daemon steuern kann)

### 2. Stack aus dem Repo deployen

- Portainer öffnen: `https://TRUENAS_IP:9443`, Admin-Zugang einrichten,
  Environment "local" wählen.
- **Stacks → Add stack**
  - Name: `zeiterfassung`
  - Build method: **Repository**
  - Repository URL: `https://github.com/ManuLeaN/zeiterfassung`
  - Repository reference: `refs/heads/main`
  - Compose path: `docker-compose.yml`
  - **Deploy the stack**

Portainer klont das Repo, baut das Image über den `build:`-Eintrag in
`docker-compose.yml` und startet den Container inkl. Port-Mapping und
persistentem Volume automatisch.

### 3. Nutzen

- Im Heimnetz (oder über dein VPN): `http://TRUENAS_IP:7676` öffnen
  (Container lauscht intern auf Port 3000, `docker-compose.yml` mappt das auf
  Host-Port `7676`, siehe `ports:` dort — bei Bedarf einfach anpassen).
- Auf dem Handy: Seite öffnen → Browser-Menü → **"Zum Startbildschirm
  hinzufügen"**. Danach startet die App wie eine normale App-Kachel.

### Updates einspielen

Code ändern → committen → `git push` zu GitHub. Danach in Portainer beim
Stack **"Pull and redeploy"** (bzw. Stack neu deployen) klicken — Portainer
holt den neuesten Stand aus dem Repo, baut neu und startet den Container neu.
Die Daten im Docker-Volume `zeiterfassung_data` bleiben dabei unberührt.

### Backup

Das benannte Docker-Volume `zeiterfassung_data` (enthält `zeiterfassung.db`)
ist in Portainer unter **Volumes** sichtbar und inspizierbar. Für ein
NAS-natives Backup kannst du es alternativ auf einen festen Host-Pfad auf
einem TrueNAS-Dataset mappen (in `docker-compose.yml` z. B.
`/mnt/POOL/apps/zeiterfassung-data:/data` statt `zeiterfassung_data:/data`)
und das Dataset über die normalen Snapshot-/Replication-Tasks sichern.

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
