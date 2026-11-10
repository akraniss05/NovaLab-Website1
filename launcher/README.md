# NovaLab Launcher v0.5.1 — Startreihenfolge und Dateischutz korrigiert

Die Download-Warteschlange startet erst nach dem Laden des Katalogs. Spieleupdates überschreiben keine fremden Installationsordner.

# NovaLab Desktop Launcher v0.5.0 — Phase 1 + 2

Siehe [PHASES-1-2.md](./PHASES-1-2.md) für den aktuellen Entwicklungsstand, Build-Anweisungen, echte Funktionen, Risiken und Tests.

## v0.3.0: NovaLab-Accounts, Academy und Admin Studio

- Jeder kann sich kostenlos mit Benutzername und Passwort registrieren (mindestens 10 Zeichen, keine Mailadresse notwendig).
- Login und Sessionverwaltung erfolgen auf der Supabase Edge Function `novalab-launcher-api`; keine Passwörter, Tokens oder Service-Keys im Renderer.
- Die Admin-Konten `NyxAtheris` und `Jonas` werden einmalig in der Datenbank erstellt; ihre Startpasswörter werden **nicht im Repository** gespeichert. Aus Sicherheitsgründen ist vor dem ersten Upload eine Änderung auf mindestens 12 Zeichen erforderlich.
- Ein Klick auf **NovaLab Academy** öffnet die Coding-Lernplattform in einem eigenständigen, isolierten App-Fenster. Die Academy-Anmeldung ist bis auf Weiteres separat.
- Das **Admin Studio** bietet Veröffentlichung von einzelnen HTML-Spielen (`.html`, automatisch als ZIP paketiert) oder ZIP-Projekten mit `index.html` auf oberster Ebene; die Version und Spiel-ID bilden das Release. Limit: 12 MB.
- Community-Spiele werden in einem getrennten öffentlichen Supabase Storage Bucket abgelegt; nur Admins können hochladen. Installer prüfen vor dem Start den SHA-256-Hash und ZIP-Inhalt; der Mini-Game-Prozess erhält keine Node/Electron-Rechte und hat eine restriktive CSP.
- Admins können Spiele ausblenden und wieder freigeben. Installierte Spiele bleiben auf Nutzergeräten erhalten.
- Neue Games erscheinen bei jedem Katalog-Refresh und zyklisch, **ohne einen neuen Launcher-Build**. Desktop-Updates laufen weiterhin über GitHub Releases.

**Hinweis zur Veröffentlichung:** Der erste Launcher-Installer mit den neuen Funktionen entsteht über GitHub Actions nach einem erfolgreichen Build. Die Website/Academy werden nicht durch einen öffentlichen Launcher-Account entsperrt. Das System ist als MVP gedacht: Für viele öffentliche Nutzer sind Captcha, Abuse-Protection, Monitoring und ein sicherer Recovery-Flow noch sinnvoll.

---

# NovaLab Games Launcher · Windows Desktop App

## ✦ NEU: Kleine Spiele direkt aus ChatGPT veröffentlichen (v0.2.0)

Der Launcher unterstützt jetzt neben Windows-EXE-Spielen auch **kleine HTML/CSS/JavaScript-Browsergames**, wie wir sie hier im Chat entwickeln. Das Spiel wird erst beim Klick auf **„Mini-Spiel laden“** heruntergeladen. Nach der Installation funktioniert es **offline**, öffnet ein eigenes Spielefenster und speichert seinen Highscore lokal. Andere Benutzer sehen den Eintrag automatisch im Online-Katalog, ohne dass sie ein Update des Launchers benötigen.

### So kommt ein neues Spiel rein

1. Lege `launcher/mini-games/mein-spiel/` an. In den Ordner gehören `index.html` und bei Bedarf weitere relative Assets wie `style.css`, `game.js` oder Bilder. Keine externen CDNs benutzen (Spiele haben aus Sicherheitsgründen keinen Internetzugriff).
2. Kopiere `launcher/mini-games/orbit-dash/game.json` in den neuen Ordner und passe die Felder an. `id` muss dem Ordnernamen entsprechen; `entry` ist die HTML-Startdatei.
3. Lade die Spieldateien nach GitHub in den `main`-Branch hoch.
4. Öffne **Actions → NovaLab Mini-Game veröffentlichen → Run workflow**. Trage `game_id` wie `mein-spiel` und `version` wie `1.0.0` ein. Die Action packt den Ordner als ZIP, berechnet SHA-256 und trägt die neue Version in `launcher/catalog.json` ein.
5. Launcher öffnen → **Entdecken → Mini-Games** → **Katalog neu laden**. Spieler können das Spiel bei Interesse freiwillig installieren.

Ein Spielupdate geht genauso: Quelldateien ändern, Workflow mit einer **höheren** Versionsnummer (`1.0.1`) starten, und im Launcher erscheint **Update**. Alte Versionen bleiben als ZIP im Repository, das neue Release ist im Katalog aktiv. Der Launcher selbst braucht dafür kein neues EXE-Release.

**Sicherheit & Einschränkungen:** HTML-Spiele laufen separat in einem isolierten Electron-Fenster ohne Node.js, ohne Launcher-IPC und ohne externe Netzwerkzugriffe. Die ZIP wird vor dem Entpacken per SHA-256 geprüft. Nur freigegebene Dateitypen werden angenommen, außerdem gelten Größen- und Dateianzahl-Limits. Veröffentliche nur Spiele/Assets, für die ihr Nutzungsrechte habt. Die Spiele laufen aktuell in der Windows-Version des Launchers; später wäre ein macOS/Linux-Port möglich. Veröffentlichte ZIP-Dateien liegen im GitHub-Repository – sinnvoll für kleine Spiele, nicht für riesige Assets.

**Erstes Testspiel:** `Orbit Dash` in `launcher/mini-games/orbit-dash/`. Sofort auch im Browser testbar: https://akraniss05.github.io/NovaLab-Website1/launcher/mini-games/orbit-dash/index.html


Der **NovaLab Games Launcher** ist eine eigenständige, installierbare Electron-App (nicht bloß ein Website-Shortcut). Das Interface umfasst Startseite, Projektkatalog, Spielebibliothek, Downloads, Einstellungen und NovaLab-Links. Aktuell ist der Launcher ein **MVP für Windows x64**; macOS/Linux-Installer, Accounts, Multiplayer und Cloud-Saves sind noch nicht implementiert.

## Funktionen

- Eigenes Windows-Installer-Setup (`NovaLab-Launcher-Setup-<version>.exe`) über `electron-builder`/NSIS.
- Installation, Update, Start und Deinstallation **freigegebener Windows-Spielpakete**.
- Verifikation heruntergeladener ZIP-Dateien mit SHA-256 vor Entpacken/Installieren.
- Katalog aus `launcher/catalog.json`: online von GitHub geladen, lokale Kopie als Offline-Fallback.
- Lokale Bibliothek/Settings im Electron-App-Datenverzeichnis. Keine unnötige Registrierung.
- Launcher-Auto-Update über **GitHub Releases** (`electron-updater`) inklusive Update-Download und Neustart-Button.
- Sicherheitsgrenzen: Context Isolation, Sandboxing, keine Node APIs im Renderer, strikt begrenzte IPC-Schnittstelle, HTTPS-Link-Whitelist.

**Projektstatus:** Orbit Dash ist als erstes kostenloses Mini-Game im Katalog vorhanden. Größere Desktop-Spiele sind noch in Entwicklung. Die anderen Game-Karten zeigen weiterhin **keinen fiktiven Installieren-Button**.

## Lokal starten (Windows)

Voraussetzung: Node.js 24 und npm.

```powershell
cd launcher
npm install
npm run check
npm start
```

Testinstaller lokal bauen:

```powershell
npm run build:win
```

Den Installer findest du anschließend unter `launcher/dist/`.

## Automatischer Windows-Build und Download

Die GitHub-Action `.github/workflows/launcher-windows.yml` baut bei Änderungen in `launcher/` automatisch einen Preview-Installer. Unter **GitHub → Actions → NovaLab Launcher — Windows Installer → letzter erfolgreicher Lauf → Artifacts** kannst du das ZIP mit der `.exe` herunterladen.

Für einen **öffentlichen Release-Download mit Autoupdates**:

1. Version in `launcher/package.json` erhöhen (z. B. `0.1.1`).
2. Commit der Änderung auf `main` pushen.
3. Passenden Git-Tag erstellen und pushen (`v0.1.1`; die Versionsnummer muss übereinstimmen).
4. Der Tag startet den Windows-Workflow; `electron-builder` veröffentlicht den Installer **samt `latest.yml`** bei [GitHub Releases](https://github.com/akraniss05/NovaLab-Website1/releases).
5. Die Downloadseite `https://akraniss05.github.io/NovaLab-Website1/launcher/download.html` führt zur aktuellen Version.

Beispiel (nach Änderungen auf `main`):

```bash
git tag v0.1.1
git push origin v0.1.1
```

**Hinweise:** Der erste Release (`v0.1.0`) ist erst dann downloadbar, wenn der Tag erfolgreich gebaut und die Assets hochgeladen wurden. GitHub Pages baut **keine Windows-EXE**; dafür wird der Actions-Windows-Runner verwendet. Ohne Signatur kann Windows SmartScreen bei unvertrauten Installern warnen. Ein Code-Signing-Zertifikat ist für vertrauenswürdige Distribution empfehlenswert. Keine Adminrechte für die normale Per-User-Installation erforderlich. Für Produktivbetrieb Abhängigkeiten per Lockfile fixieren und automatisierte Tests erweitern.

## Spiele im Launcher veröffentlichen

1. Spiel als ZIP paketieren. In der ZIP liegt z. B. die Datei `NovaLabGame.exe` (und alle nötigen Assets).
2. Die ZIP als Asset in einem **GitHub Release eines Repositories von `akraniss05`** veröffentlichen.
3. SHA-256 der **fertigen ZIP-Datei** berechnen, z. B. unter PowerShell:

```powershell
(Get-FileHash .\NovaLabGame-Windows.zip -Algorithm SHA256).Hash.ToLower()
```

4. In `launcher/catalog.json` beim Spiele-Eintrag ein `release`-Objekt ergänzen:

```json
"release": {
  "version": "1.0.0",
  "url": "https://github.com/akraniss05/NovaLab-Game1/releases/download/v1.0.0/NovaLabGame-Windows.zip",
  "sha256": "HIER_DEN_ECHTEN_64_STELLIGEN_SHA256_HASH_EINTRAGEN",
  "entry": "NovaLabGame.exe"
}
```

5. Die geänderte Katalogdatei auf `main` veröffentlichen. Beim nächsten Katalogladen erscheint „Installieren“, bzw. „Update“, falls eine ältere Version installiert ist. Für neue Spiele kein Launcher-Release notwendig. Der Spiele-Installer läuft derzeit nur unter Windows.

**Wichtig:** Der `sha256`-Wert muss ein echter, 64-stelliger Hex-Hash sein. Ohne gültigen Hash wird das Release bewusst nicht als Download angeboten. Der `entry`-Pfad muss relativ zur ZIP-Wurzel sein. Gib nur von euch autorisierte und vertrauenswürdige Releases frei, denn installierte Spiele werden als EXE gestartet. Das schützt vor versehentlich korrupten Downloads, ersetzt aber keine signierten Releases oder Sicherheitsprüfungen. Manifeste sollten später zusätzlich signiert werden.

## Architektur

- `src/main.cjs` — Hauptprozess, Dateisystem, Installation, IPC, Autoupdate
- `src/preload.cjs` — begrenzte Bridge in den Renderer
- `src/renderer/` — lokale HTML/CSS/JS-Oberfläche
- `catalog.json` — editierbarer Projektkatalog (über GitHub Pages synchronisiert)
- `download.html` — öffentliche Landingpage mit GitHub Release-Check

Der Quellcode liegt bewusst **separat neben der bisherigen NovaLab-Website**. Admin-Backend und vorhandene Website-Dateien werden nicht ersetzt.

## v0.4.0 – Desktop Gaming Client (10.11.2026)

Das neue Interface nutzt Steam-inspirierte **Navigationsprinzipien**, aber bewusst eigene NovaLab-Farben, Symbole und Grafiken. Die bestehende Academy-Anbindung, Anmeldung, freie Registrierung, Admin-Spieluploads und lokale Spiele sind unverändert verfügbar.

- Obere Store-/Bibliotheksnavigation, Schnellzugriff auf installierte Spiele in der Seitenleiste, neue Karten und Spieldetailfenster.
- Bibliothek zeigt auch bereits installierte Spiele an, die später im öffentlichen Katalog ausgeblendet werden.
- Neuer Update-Controller mit Einzelprüfung statt doppelter gleichzeitiger Downloads, sauberem Fehler-/Retry-Status und Fortschrittsanzeige im Download-Center und in den Einstellungen.
- **Kein automatisches Installieren beim gewöhnlichen Beenden:** Benutzer startet Installation ausdrücklich mit dem Neustart-Knopf. So vermeiden wir unerwartete Installationen beim Abmelden/Herunterfahren.
- Fallback: offizieller GitHub-Release-Download in den Einstellungen, falls die Update-Schnittstelle nicht erreichbar ist.
- Admin-Studio: Fehler bei der Sichtbarkeitsschaltung behoben.
- Neue Unit-Tests: `npm run check` prüft Syntax sowie Updatezustände inklusive paralleler Checks, Netzwerkausfällen und Download.

**Update-Hinweise:** Der Download- und Installationsprozess wird über `electron-updater`/NSIS mit `latest.yml` aus GitHub Releases gesteuert. Der Installer muss weiterhin unsigniert von Windows-Nutzern explizit bestätigt werden; es gibt noch kein verifiziertes Code-Signing-Zertifikat. Laufende Apps werden nicht ohne Bestätigung automatisch geschlossen. Bei Schwierigkeiten kann der aktuelle Installer direkt von der GitHub-Release-Seite heruntergeladen und über die vorhandene Version installiert werden.

## Release 0.5.0 (Early Access)

- Persistente Download-Warteschlange mit Pause, Fortsetzen, Abbruch und Retry.
- HTTP-Range-Resume bei unterstütztem Server; SHA-256-Paketprüfung und ZIP-Sicherheit.
- Transaktionale Spieleinstallation mit Rollback bei Installationsfehlern.
- Lokale Bibliotheksfilter, Favoriten, letzte Spielzeit und wählbarer Installationsordner.
- 11 bestandene automatisierte Unit-Tests und ein erfolgreicher Windows-Preview-Build.
- Einschränkungen: kein verifiziertes Windows-E2E, kein vollständiges Datei-Manifest/Delta-Update, Installer noch ohne Signatur.

