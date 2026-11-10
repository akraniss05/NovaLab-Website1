# NovaLab Launcher 0.5.0 — Phasen 1 und 2

## Architekturentscheidung

Die bestehende **Electron + Vanilla-JavaScript + Node.js**-Architektur bleibt erhalten, um die bereits vorhandene Bibliothek, Mini-Game-Sandbox, Supabase-Anbindung und NSIS-Distribution nicht unnötig zu ersetzen. Eine Umstellung auf Tauri + React wäre ein separates Migrationsprojekt, keine notwendige Voraussetzung für einen stabilen Installationsmanager.

Module:
- `src/main.cjs`: geprüfte Katalogmetadaten, isolierte Spiel-Fenster, IPC-Whitelisting, sichere Installationspfade, Spiele-Start, Statistik
- `src/download-manager.cjs`: persistente **FIFO-Warteschlange**, HTTP-Range-Resume, Pause, Fortsetzen, Abbrechen, Größenbegrenzung, Hashverifikation, Progress/Speed/ETA
- `src/update-controller.cjs`: **Single-Flight Launcher-Update**, manuelle Bestätigung vor Installation; GitHub Releases/NSIS
- `src/renderer/`: Store, Bibliothek, Spiel-Details, Aufgabenliste, Einstellungen, Accounts und Admin Studio
- `backend/novalab-launcher-api/index.ts`: bestehendes Supabase-Backend; für diese Phase unverändert

## Download- und Installationsablauf

1. Der Nutzer klickt **Installieren** oder **Update** für ein veröffentlichtes, zulässiges Katalog-Release.
2. Die Download-Aufgabe wird in den App-Daten unter `download-cache/downloads.json` gespeichert. Es gibt maximal **einen gleichzeitig aktiven Download**; andere warten in der Queue.
3. Es wird in eine `*.part`-Datei im privaten Downloadcache geladen. Bei vorhandener Teil-Datei fragt der Downloader mit `Range: bytes=N-` nach dem Rest. Antwortet der Server mit HTTP 200 statt 206, wird die alte Teil-Datei **überschrieben**, nicht fehlerhaft angehängt.
4. Der **SHA-256**-Digest der vollständig heruntergeladenen ZIP-Datei muss zum veröffentlichten Wert passen. Fehler führen zu einer sichtbaren Fehlermeldung.
5. Vor der Installation werden ZIP-Pfade auf traversal (`..`), absolute Pfade, symbolische Links, Datenmengen und Dateitypen geprüft. HTML-Mini-Games erhalten ein separates Sandbox-BrowserWindow ohne Node.js-Zugriff; native Windows-EXE-Spiele werden nur aus freigegebenen Releases akzeptiert und starten ausschließlich lokal auf dem Nutzer-PC.
6. Der Inhalt wird in einen temporären Ordner im ausgewählten Installationslaufwerk extrahiert. Eine vorhandene Spielversion wird für das Update als Backup umbenannt. Nur nach erfolgreicher Prüfung der Startdatei wird die neue Version aktiviert. Bei Fehlern wird die vorherige Version zurückgestellt.
7. Spielinstallationen werden in `games.json` gespeichert; Spielzeit und zuletzt gespielt in `game-stats.json`. Das Verzeichnis bleibt beim Launcher-Update erhalten.

## Windows-Build (reproduzierbares Build-Verfahren)

Auf GitHub: **Actions → NovaLab Launcher — Windows Installer → Run workflow**. Der Workflow installiert Node.js 24, installiert die im Projekt festgelegten npm-Abhängigkeitsversionen, führt Syntax- und Unit-Tests aus und baut anschließend unter `windows-latest` einen NSIS-x64-Installer.

Lokal auf Windows:

```powershell
cd launcher
npm install --no-audit --no-fund
npm run check
npm run build:win
```

Preview-Installer: `launcher/dist/NovaLab-Launcher-Setup-0.5.0.exe`. Erst ein **erfolgreich veröffentlichter GitHub-Release mit `latest.yml`** kann vom Autoupdater installiert werden. Dieser Quellstand ist keine Bestätigung, dass ein Release-Build erfolgreich auf einem Windows-PC installiert und durchgetestet wurde.

Hinweis zur Build-Reproduzierbarkeit: Momentan gibt es **noch kein `package-lock.json`**; deshalb sind die direkten Abhängigkeitsversionen fixiert, aber transitive npm-Abhängigkeiten nicht vollständig eingefroren. Für bitgenau wiederholbare Builds muss ein verifizierter Lockfile erzeugt und im CI `npm ci` verwendet werden.

## Aktuell vorhandene Funktionen

- Katalog via freigegebene GitHub-URL plus Community-API
- Windows-/HTML5-ZIPs installieren, starten, deinstallieren
- Warteschlange und fortsetzbare Downloads (sofern Range unterstützt)
- Downloadprogress, Speed, ETA und Retry; Fehler mit Meldung
- Integritätsprüfung des Downloads, ZIP-Sicherheitsprüfung und Rollback beim Aktivieren
- Wählbarer Installationspfad für neue Spiele; bestehende Installationen behalten ihren bisherigen Ort
- Lokale Favoriten, zuletzt gespielt, Spielzeit und Bibliotheksfilter
- Bestehendes Login und Admin Studio mit serverseitig geprüften Rollen; NovaLab Academy als separates Fenster
- GitHub-/NSIS-Updater, Statusanzeige, Neustart nach Nutzerbestätigung

## Noch nicht umgesetzt / Einschränkungen

- **Keine vollständige Cloud-Bibliothek und kein Steam-ähnliches Cloud-Save**: Bibliothek/Favoriten/Spielzeit sind auf diesem PC lokal. Login wird nicht mit der Academy geteilt.
- **Keine E-Mail-Verifizierung, Passwort-Reset, Freunde, Chats, Erfolge, Neuigkeiten-Redaktion oder öffentliche API für Achievements** in dieser Version.
- **Keine Delta-Updates**: neue Spielversionen laden aktuell das vollständige ZIP-Release, aber dank Resume nicht zwingend erneut von Byte 0 bei Netzwerkabbrüchen.
- **Kein vollständiger Dateimanifest-Check jeder installierten Asset-Datei**: „Dateien prüfen“ kontrolliert Startdatei und Installationsmarker, nicht den kompletten Ordnerhash.
- **Nur ein aktiver Download gleichzeitig**, mehrere wartende Aufgaben. Kein Bandbreitenlimit oder Download-Parallelität in Phase 2.
- Native Windows-ZIP-Dateien können ausführbaren Code enthalten; Source-Whitelisting, Hashes und ZIP-Prüfung ersetzen keine Malware-Analyse. Veröffentlichungen brauchen zusätzliche Sicherheitskontrollen.
- **Unsigned Windows-Installer**: Kein Authenticode-Signing eingerichtet. Die eigene Launcher-Update-Authentizität ist ohne Herausgeber-Zertifikat unzureichend für einen professionellen öffentlichen Launch. Es wird kein Signieren behauptet.
- Windows-Installations- und Updateabläufe, Speicherplatz-Edge-Cases und Antiviren-Kompatibilität müssen auf echtem Windows getestet werden.

## Tests

```bash
cd launcher
npm run check
```

- Unit: `test/download-manager.test.cjs` prüft HTTP-Range-Resume, fehlerhafte Prüfsumme, Wiederherstellung nach Neustart, Range-Ignore-Fallback und Abbruch.
- Unit: `test/update-controller.test.cjs` prüft Update-Single-Flight, Fehlerbehandlung, expliziten Restart und Entwicklungsmodus.
- Browser-Smoketest: Renderer mit simuliertem Desktop-API in Chromium; Spiel-Details, Bibliotheksnavigation, Favoriten, Downloads und Einstellungen ohne JS-Exceptions.
- **Nicht End-to-End:** Wegen der Testumgebung sind der echte Windows-EXE-Start, Supabase-Kontoerstellung, tatsächliche Spiele-Uploads und der öffentliche Update-Installationsprozess nicht mit Windows-E2E-Tests verifiziert.

## Nächste Phasen

1. Windows-E2E inklusive künstlichem Netzwerkabbruch und vollständig durchinstalliertem HTML5-Spiel.
2. Auth-Migration zu Supabase Auth (E-Mail-Bestätigung, Reset, sicherer Rollenabgleich), mit Migrationsplan für bisherige Accounts.
3. Signierte Windows-Release-Pipeline und unveränderliche Game-Manifeste für vollständige Dateireparatur.
4. Cloud-Bibliothek, Profile/Freunde, News und Achievements mit RLS und separaten Release-Tests.

Referenzen: Electron Security https://www.electronjs.org/docs/latest/tutorial/security/ , electron-builder Auto Update https://www.electron.build/docs/features/auto-update/ , Microsoft Code Signing https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options .
