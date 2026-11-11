# NovaLab Studios Launcher – Alpha 0.4 (Rust/Tauri + Browser)

## Sofort testen

- Browser / iPhone / Android: https://akraniss05.github.io/NovaLab-Website1/launcher/
- Windows-Installer (64-bit): https://github.com/akraniss05/NovaLab-Website1/releases/tag/novalab-launcher-v0.4-alpha
- Quellcode der gehosteten Version: https://github.com/akraniss05/NovaLab-Website1/tree/main/launcher

Die mobile Datei `NovaLab-Mobile-Test.html` ist eine eigenständige Alternative; **auf dem iPhone bitte den HTTPS-Link direkt in Safari öffnen**, da TikTok-Dateivorschau und iOS-Datei-Quick-Look Skripte unterdrücken können.

## Online-Konten und Rollen

- Registrieren/Anmelden: Benutzername und Passwort. Registrierung erfolgt über `novalab-launcher-api/register` mit serverseitiger Prüfung, PBKDF2 und Ratelimit.
- `user`: Spiele entdecken und nutzen; darf keine öffentlichen Spielprojekte hochladen.
- `developer`: eigene Projekte, Beschreibung, Bilder, Videos, ZIP-Versionen, Veröffentlichung.
- `admin`: alle Projekte bearbeiten/archivieren/endgültig löschen und Nutzerrollen per Team-Panel ändern.
- Berechtigungen werden **serverseitig geprüft** und beim Ändern von Rollen werden bisherige Sessions dieses Accounts ungültig.
- NyxAtheris ist bereits im Backend als `admin` vorhanden. Sein Passwort wurde **nicht** durch dieses Build geändert. Es werden keine Passwörter/Service-Role-Keys im Repository gespeichert.

Backend: Supabase Edge Functions `novalab-launcher-api` und `novalab-studio-api`. Das Projekt verwendet die bestehenden, isolierten Tabellen `novalab_launcher_*` und `novalab_studio_*`, die RLS aktiviert haben. Die übrigen NovaLab-Apps bleiben erhalten.

## Developer Studio

1. Nach Anmeldung mit freigegebener Developer-/Admin-Rolle `Developer Studio` öffnen.
2. Ein Spiel anlegen (`community-...`-Kennung), Titel, Kurz- und Langbeschreibung, Genre, Tags und Anforderungen speichern.
3. Cover/Banner als PNG/JPG/WebP (bis 5 MB pro Bild) und optional Screenshots bzw. Video (MP4/WebM bis 8 MB) hochladen.
4. Neue `x.y.z`-Version als ZIP (aktuell max. **12 MB**) hochladen, Ziel `Windows / EXE` oder `Browser / HTML` und die relative Startdatei im ZIP angeben.
5. Nach Prüfung `Veröffentlichen` klicken. Eine neue stabile Version ersetzt im öffentlichen Katalog die bisher aktive Release-Version; ältere Versionen bleiben im Verlauf, damit Rollback möglich ist.

**Achtung:** Es gibt derzeit keine automatische Antivirus-/Signaturprüfung für hochgeladene Spiele. Öffentliche Mitarbeitendenrollen verantwortungsvoll vergeben; nur verifizierte Builds installieren. Die kleine ZIP-Grenze ist für Alpha-Mini-Games, nicht für mehrere GB große Spiele.

## Windows mit Rust / Tauri 2

`Cargo.toml` und `src-tauri/src/lib.rs` enthalten native Kommandos für EXE-Verknüpfung, HTTPS-Downloads, SHA-256-Prüfung von ZIP-Releases, sichere Pfade beim Entpacken, Installation in versionsbezogenen Verzeichnissen, Aktivierung der aktuellen Version und das Starten installierter Windows-EXEs. Das Rollback-Metadatum schützt den zuvor aktiven Stand bei einem Aktivierungsfehler.

Ein Launcher-internes Update-Menü prüft neuere offizielle GitHub Releases mit den Tags `novalab-launcher-vX.Y.Z-alpha`. Der Download erfolgt direkt in der App; vor dem Starten des Installer wird die von GitHub gelieferte SHA-256-Prüfsumme verifiziert. Neue Releases müssen für diesen Aktualisierungsweg als Windows-Installer veröffentlicht sein. Das Setup kann weiterhin den üblichen Windows-Sicherheitsdialog anzeigen.

Zum lokalen Kompilieren auf Windows: Node.js 22+, Rust 1.90+, Microsoft C++ Build Tools, WebView2. Dann `npm install` und `npm run tauri:build`. Im Repository übernimmt GitHub Actions `.github/workflows/novalab-launcher-windows.yml` den Windows-Build.

## Sicherheit und SmartScreen

Der Installer ist **noch nicht mit einem vertrauenswürdigen Code-Signing-Zertifikat signiert**. Deshalb kann Microsoft Defender SmartScreen ihn als unbekannt blockieren. Das lässt sich nicht durch eine seriöse reine Code-Änderung abschalten. Signieren mit einem verifizierten Herausgeberzertifikat und verlässlicher Release-Historie reduziert die Warnungen mit der Zeit; Microsoft-Store-Verteilung als signiertes MSIX ist eine weitere Option. Niemals Sicherheitsmechanismen aushebeln oder SmartScreen für alle Programme deaktivieren.

Microsoft: https://learn.microsoft.com/de-de/windows/apps/package-and-deploy/smartscreen-reputation

## Testumfang

- `node --check app.js` und `node scripts/test-ui.cjs`: JS-Syntax und Funktionslogik.
- GitHub Actions Browser QA mit echtem Playwright/Chromium auf 390 px (Handy) und 1440 px (Desktop); prüft Registrierung, Anmeldung, adminbasierte Rollenänderung, Developer-Studio-Spielentwurf und deren UI-Status mit *gemockten API-Responses*. Mock-Passwörter sind fiktiv und keine realen Accounts.
- GitHub Windows-Workflow kompiliert Tauri/Rust zum NSIS-Installer. **Es wurde keine reale Windows-Installation oder reale iOS-Safari-Gerätesitzung getestet.**
- Erfolge, Freunde, Chat und Cloud sind weiterhin Demo-Funktionen; die öffentlichen Daten-/Zahlungsfunktionen sind kein Steam-Klon.

Made with 💗 by NovaLab Studios.