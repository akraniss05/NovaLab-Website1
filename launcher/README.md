# NovaLab Studios Launcher – Rust Edition (Alpha 0.2)

**Zwei echte Projekte aus einer Codebasis:** ein Windows-Desktop-Launcher mit Rust/Tauri 2 und eine responsive HTML/CSS/JavaScript-App für Browser auf Handy und PC. Das Design ist dunkel mit Pink-/Violett-Akzenten. Keine Electron-Laufzeit und kein großes JavaScript-Framework.

## Wichtiger Unterschied zwischen Demo und fertigem Spiele-Store

Dies ist eine **funktionierende Launcher-Alpha**, kein fertiger Steam-Konkurrent. Der Katalog enthält ausdrücklich **fiktive Konzeptspiele**; sie sind nicht als echte Downloads verfügbar. Funktionieren tun Seitenwechsel, Suche, Genre-Filter, Favoriten, lokale Spieleverwaltung, Design-Einstellungen, JSON-Export/-Import und das spielbare Minigame **NovaLab Arcade**. Freunde, Chat-Nachrichten, Cloud und Shop-Zahlungen sind **Demo-Vorschau ohne Server**. Es existieren **keine echten Abos oder Zahlungen**.

### In der Windows-App (Rust/Tauri)

- Bereits installierte Windows-Spiele über einen nativen Dateidialog auswählen und **als verknüpfte EXE starten**. Der Rust-Teil akzeptiert nur explizit verknüpfte Pfade.
- Einem eigenen Spieleintrag **HTTPS-Downloadlink** hinterlegen, Downloadziel wählen, **reale Bytes herunterladen**, Fortschritt anzeigen und abbrechen. Die Datei wird **nicht automatisch ausgeführt oder installiert**. HTTP-Weiterleitungen werden abgelehnt.
- Alle Daten lokal im Webview gespeichert (nicht in der Cloud); die Liste autorisierter EXE-Dateien speichert der Rust-Teil im App-Datenordner.

### Im mobilen Browser

- Responsive Ansicht mit Suchfeld, Startseite, Shop, Bibliothek, Favoriten, Downloads, Spieleverwaltung, Einstellungen und Arcade-Minispiel.
- Bei HTTPS-Hosting ist die App durch ein Web App Manifest und einen Service Worker **PWA-fähig** (Zum Home-Bildschirm hinzufügen, Offline-Cache der wesentlichen Assets).
- Native EXE-Starts und Rust-Downloads sind auf Handys technisch **nicht möglich**; ein hinterlegter HTTPS-Link wird im Browser geöffnet.
- **iPhone-Dateivorschau** (beispielsweise TikTok/Dateien): Solche Viewer können JavaScript deaktivieren. Deshalb erscheint in der neuen `NovaLab-Mobile-Test.html` eine **statische Startseiten-Vorschau statt eines leeren Bildschirms**. Für klickbare Menüs die **online gehostete Seite direkt in Safari** öffnen.

## Windows-Setup erstellen

Der Windows-Installer benötigt eine Windows-Buildumgebung (lokal oder GitHub Actions) mit aktuellem Rust 1.90+, Node.js 22+ und WebView2 (unter Windows 11 in der Regel bereits enthalten). Für signierte öffentliche Releases ist ein Codesigning-Zertifikat nötig.

**GitHub Actions ohne eigenen Windows-PC:**

1. Erstelle ein **neues separates Repository**, etwa `NovaLab-Studios-Launcher`, und lade **den gesamten Inhalt dieses ZIPs** hoch, inklusive `.github` und `src-tauri`.
2. Im GitHub-Repository: **Actions → Build NovaLab Windows (Rust + Tauri) → Run workflow**.
3. Bei erfolgreichem Build das Artefakt `NovaLab-Studios-Rust-Windows-Setup` herunterladen. Darin liegt der Windows-Installer (`.exe`).

Alternativ auf Windows mit Node.js + Rust:

```powershell
npm install
npm run tauri:build
```

Das Setup entsteht unter `src-tauri/target/release/bundle/nsis/`.

## Handy-Test online bereitstellen (empfohlen)

- Im **separaten Launcher-Repository** in GitHub unter **Settings → Pages → Build and deployment → GitHub Actions** auswählen.
- **Actions → NovaLab Mobile Browser Preview → Run workflow** ausführen.
- Nach erfolgreichem Deployment findest du den Browser-Link direkt in der GitHub Pages Deployment-Umgebung oder unter `https://DEIN-NUTZERNAME.github.io/DEIN-LAUNCHER-REPO/`.
- Den Link auf dem iPhone **in Safari** öffnen (nicht in der TikTok-Datei-Vorschau). Du kannst ihn anschließend zum Home-Bildschirm hinzufügen.

**Es wurde noch nichts automatisch auf GitHub veröffentlicht**, damit die bestehende NovaLab-Website unangetastet bleibt.

## Lokale Web-Tests am Computer

```bash
npm run dev
```

Danach `http://127.0.0.1:4177` im Browser öffnen. Oder `npm run build:web` ausführen und `dist-web/` mit einem beliebigen statischen HTTPS-Host veröffentlichen.

## Speicher- und Sicherheitsdesign

- Rust und Tauri ersetzen Electron und benutzen die Windows-System-WebView. Das kann den Paketumfang und den RAM-Verbrauch gegenüber einer Electron-App reduzieren, garantiert aber keine bestimmte RAM-Zahl. Die **Webansicht selbst ist weiterhin HTML/CSS/JavaScript**, nicht Rust; deshalb enthält das Projekt **keine schweren Frontend-Abhängigkeiten**.
- Bilder sind optimiert, und es gibt keine laufenden Netzwerk-Polling-Schleifen. Das Arcade-Minispiel animiert nur während des aktiven Spielens.
- Externe Spieler-URLs müssen HTTPS verwenden. Kein automatischer Installer-Start. Browser-/Desktop-Speicher ist lokal und nicht mit einem zentralen Admin-System verknüpft.
- Neue EXE-Spiele immer selbst auf Sicherheit prüfen. Die App nimmt dir diese Verantwortung nicht ab.

## Projektstruktur

`index.html`, `styles.css`, `app.js`: gemeinsames Frontend. `native-bridge.js`: sehr kleine Schnittstelle zu Rust. `src-tauri/`: native Windows-App mit Rust-Kommandos. `scripts/`: Build-/Testskripte. `assets/`: Cover-Bilder, Icon und Logo. `NovaLab-Mobile-Test.html`: eigenständige Offline-Testdatei mit allen Bildern/Skripten. `dist-web/`: von `npm run build:web` erzeugte Webversion. `.github/workflows/`: Windows-Builder und mobile GitHub Pages Vorschau.

## Verifikation dieser Alpha

- `node --check app.js` und `node scripts/test-static.cjs`: bestanden.
- `node scripts/test-ui.cjs`: Navigation, Such-/Filterlogik, Einstellungs-Speicherung und Seiten-Rendering über DOM-Test-Doubles geprüft.
- `node scripts/build-web.cjs` und `python build_mobile.py`: bestanden.
- **Nicht durchgeführt:** Kompilierung des Rust-Projekts und echte Windows-/iOS-Gerätetests, da die entsprechenden Toolchains/Browser hier nicht verfügbar sind. Der Windows-GitHub-Workflow führt den Build nach dem Hochladen aus.

Made with 💗 by NovaLab Studios.


## Alpha 0.5 – Katalog & Installationen
- SemVer-Vergleich: kein versehentliches Downgrade statt Update.
- Katalog wird alle drei Minuten und beim Zurückkehren in die App aktualisiert.
- Installationsfortschritt mit Prüfen, Entpacken und Aktivieren.
- Installierte Games lassen sich innerhalb des Launchers deinstallieren; manuell verknüpfte Programme bleiben unberührt.
- Release-Notizen und aktuelle/überholte Versionsstände in der Detailansicht.
