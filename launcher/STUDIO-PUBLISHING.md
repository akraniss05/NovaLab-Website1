# NovaLab Publishing Studio – Version 0.6.0

Status: Reale Implementierung mit Supabase-Backend; Windows-Build und API-Smoke-Tests werden in GitHub Actions ausgeführt. Ein vollständiger interaktiver Windows-E2E-Test steht noch aus.

## Bestehende Technik
- Electron Desktop-App und bisheriger Download-/Installationsmanager bleiben bestehen.
- Die neue Administration läuft in einem separaten sandboxed BrowserWindow mit eingeschränkter Preload-Schnittstelle.
- Backend: Supabase Edge Function novalab-studio-api (backend/novalab-studio-api/index.ts).
- Bestehende Launcher-Konten und Legacy-Spielkataloge bleiben erhalten.
- Additive Migration: backend/migrations/20261110_novalab_studio.sql.
- Neue Tabellen: novalab_studio_games, novalab_studio_media, novalab_studio_versions, novalab_studio_audit.

## Admin-Anleitung
1. Im Launcher mit einem bestehenden Admin-Konto anmelden und, falls erforderlich, das Initialpasswort ändern.
2. Admin Studio öffnen, dort Publishing Studio öffnen.
3. Neues Spiel anlegen, ID mit Prefix community- wählen, Titel und Kurzbeschreibung ausfüllen und als Entwurf speichern.
4. Cover und Hauptbanner als eigene PNG/JPG/WEBP hochladen; Screenshots und kleine MP4/WEBM-Trailer optional ergänzen.
5. Bei Versionen HTML5 (ZIP mit index.html oder Einzel-HTML) oder Windows (ZIP mit .exe) wählen; Version, Startdatei, Stable/Beta-Channel und Changelog eintragen.
6. Vor Veröffentlichung die Store-Vorschau prüfen.
7. Veröffentlichen; der Launcher lädt das Spiel beim nächsten Katalog-Refresh. Ohne gültigen Stable-Build erscheint kein Installieren-Button.
8. Spiel später bearbeiten oder auf Entwurf/nicht gelistet/archiviert stellen.

## Sicherheit
- Der Service-Role-Key ist nur in der Edge-Function-Umgebung, nie im Desktop-Client.
- Die Launcher-Sessions sind zufällige 256-Bit-Token; der Server verifiziert zu jeder schreibenden Aktion Session, Ablaufzeit und die Rolle admin.
- Die bestehenden Launcher-Konten arbeiten derzeit noch mit eigenem Benutzername-Passwort-Auth, nicht mit Supabase Auth/E-Mail-Verifizierung.
- Neue Datenbanktabellen haben RLS und keine direkten anon/authenticated Grants; Zugriff nur über die serverseitig autorisierte API.
- Medien werden anhand MIME und tatsächlicher Dateisignatur geprüft; Dateiendung alleine genügt nicht.
- Spiel-ZIP-Dateien werden auf Pfad-Traversal, unzulässige Endungen, ZIP-Verschlüsselung, Zip-Bomb-Grenzwerte und Startdatei geprüft.
- Veröffentlicht wird ausschließlich mit Cover, Banner und Langbeschreibung. Spielbare Status erfordern einen geprüften Stable-Build.
- HTML-Texte werden im Renderer escaped. Videos starten nicht automatisch mit Ton. Mini-Games laufen ohne Node-Integration in isolierter Umgebung.
- Native EXE-Pakete werden vom Server nicht ausgeführt. Ihre Sicherheit erfordert zusätzliche Prüfung, Malware-Scanning und signierte Builds.

## Aktuelle Limits
- Cover, Banner und Screenshots bis 5 MB pro Datei; MP4/WEBM bis 8 MB.
- HTML-Dateien bis 3 MB; ZIP-Spielpakete bis 12 MB.
- Der Supabase-Free-Speicher eignet sich nicht als langfristige Verteilplattform für mehrere große Windows-Spiele. Für große Pakete sind TUS-Uploads und ein separater Objektspeicher/CDN nötig.
- Medien-Bucket ist öffentlich; eine geheime Beta benötigt einen privaten Bucket mit zeitlich begrenzten URLs.
- Große Videos, externer Trailer-Embed, Medienreihenfolge, Hintergrund-Jobs, Delta-Spielupdates, News, Freunde, SSO und differenzierte Rollen sind spätere Ausbaustufen.

## Reproduzierbarer Windows-Build
1. Windows-PC mit Node.js 24 und npm.
2. Im Repo ins Verzeichnis launcher wechseln.
3. npm install
4. npm run check
5. npm run build:win
6. Den NSIS-Installer unter launcher/dist installieren.
7. GitHub Actions Workflow: .github/workflows/launcher-windows.yml. Er führt JS-Syntaxchecks, bestehende Downloader-/Updatertests und Live-API-Zugriffsschutz-Smoke-Tests aus.

## Tests & Freigabe
- Die Tests für Live-API-Katalog und verweigerte anonyme Adminaktionen befinden sich in launcher/test/studio-api.test.cjs.
- Für lokale Ausführung der Live-Smoke-Tests: NOVALAB_RUN_LIVE_TESTS=1 setzen und node --test test/studio-api.test.cjs ausführen.
- Vor Produktionsfreigabe fehlt noch der echte Windows-End-to-End-Test: Admin einloggen, neues HTML/Windows-Spiel veröffentlichen, öffentlich laden, installieren, starten, zweite Version hochladen und Update/Rollback prüfen.
- Installer derzeit nicht digital signiert. Windows SmartScreen kann warnen.

## Datenverträglichkeit
Alle neuen Datenbankänderungen sind additiv. Bestehende Accounts, Spiele, Speicherstände und Launcher-Daten bleiben erhalten; der alte Community-Katalog ist weiterhin erreichbar.

Release-Kanal: v0.6.0 Early Access. Die Windows-Version wird über GitHub Actions automatisiert gebaut und veröffentlicht.
