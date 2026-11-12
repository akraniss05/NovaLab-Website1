# NovaLab Studios Launcher – Rust/Tauri + Web

NovaLab Studios hat **zwei Oberflächen aus derselben Codebasis**: eine installierbare Windows-App mit Rust/Tauri 2 sowie einen mobilen und Desktop-Browser-Test unter [NovaLab Launcher](https://akraniss05.github.io/NovaLab-Website1/launcher/).

Der **native Teil ist Rust**, die Oberfläche bleibt HTML/CSS/JavaScript in der Windows-WebView. Electron wird nicht verwendet. Ein kleiner Installer garantiert weder eine bestimmte Startzeit noch eine feste RAM-Einsparung.

## Tatsächliche Funktionen

- **Accounts:** Benutzername/Passwort-Registrierung und Anmeldung mit Supabase-Edge-Functions, aktuelle Sitzung, Passwortänderung; Benutzer benötigen bei einem temporären Passwort zunächst eine Änderung
- **Rollen:** User, Developer, Admin. Ein Developer darf eigene Spiele mit Beschreibung, Cover, Banner, Screenshots, Videos und Builds anlegen und bearbeiten. Nur Admins können Rechte vergeben, globale Katalogeinträge archivieren oder Projekte vollständig löschen
- **Spielkatalog:** Veröffentlichte NovaLab-Titel werden vom Backend bezogen. Fiktive Konzepte sind als Demos erkennbar; Demo-Spiele sind keine echten Windows-Downloads
- **Versionierte Spiele:** ZIP-Dateien und startbare EXE-/HTML-Einträge; HTTPS-Download, SHA-256-Validierung, begrenztes ZIP-Entpacken, installierte Versionen und In-App-Spielupdates
- **Windows:** Native Downloads, Dateidialog, Installation, Start, Deinstallation, verifizierte GitHub-Launcher-Updates per NSIS, eine einzige Launcher-Instanz
- **Lokal:** Favoriten, persönliche Spieleinträge, Designs, Arcade-Minispiel und JSON-Export/-Import

**Noch Demo oder begrenzt:** Die Freunde-/Chat-Funktionen, Cloud-Speicher, umfangreiche Shop-/Zahlungsfunktionen und ein echtes automatisches Update mit kryptografisch signiertem Tauri-Updater sind nicht fertig. Öffentliche Uploads durch normale Spieler sind **nicht erlaubt**. Aktuell gelten für Studio-ZIP-Uploads 12 MB; separate, vorhandene verifizierte Releases können deutlich größer sein.

## Was wird getestet?

- [Automatisierte Browser-QA](https://github.com/akraniss05/NovaLab-Website1/actions): mobile/desktop Navigation, Login-Testdaten, Rollen, Developer Studio, Versionsanzeige, Import beschädigter Konfigurationen und anonyme API-Berechtigungen
- Rust-Tests für ZIP-Sicherheit, SemVer, Installationswiederherstellung und Update-Auskünfte
- Windows-GitHub-Actions: NSIS-Installer bauen, installierte vorherige Version upgraden und neue EXE anhand einer anderen SHA-256-Prüfsumme bestätigen
- Live-Asset-Prüfung: SHA-256 und ZIP-Integrität der veröffentlichten Pakete, einschließlich eines großen NovaLab-Code-Releases
- [QA-Befunde und Restrisiken](QA-AUDIT-2026-11-12.md)

Ein Test mit simuliertem Login ist **kein Nachweis**, dass jedes echte Konto funktioniert. Das gilt ebenso für den Test eines Installers auf einem GitHub-Windows-Runner versus Nutzung am eigenen PC.

## Windows installieren

[Offizielle Launcher-Releases](https://github.com/akraniss05/NovaLab-Website1/releases) – wähle die neueste **NovaLab Studios Launcher**-Alpha mit Dateinamen `NovaLab.Studios.Launcher_<Version>_x64-setup.exe`.

Von Version 0.8 auf neuere Versionen kann das Programm **Einstellungen → Launcher-Updates** nutzen: aktuelle GitHub-Releases suchen, Downloadgröße und SHA-256 validieren, App schließen und den Windows-Installer starten. Den echten Ablauf testen GitHub-Actions-Jobs. Windows SmartScreen kann bei nicht codesignierten Releases warnen; diese Warnung kann nicht seriös wegprogrammiert werden.

## Entwicklung

Das Projekt liegt in `launcher/`; die öffentliche Website außerhalb dieses Verzeichnisses gehört **nicht** zum Launcher. Die Build-Dateien liegen in `launcher/desktop/`.

```bash
cd launcher/desktop
npm install
npm run build:web
npm run tauri:build
```

Rust benötigt eine Windows-kompatible Buildumgebung und die für Tauri 2 notwendigen Systemkomponenten. Für eine neue Veröffentlichung **immer eine neue Versionsnummer** verwenden und alte GitHub-Release-Dateien unverändert lassen – nachträglich überschriebene Assets machen Update-Prüfsummen und Upgrade-Tests unzuverlässig.

Made with 💗 by NovaLab Studios.
