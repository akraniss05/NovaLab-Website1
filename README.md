# NovaLab Studios – Website und Admin-Backend

## Website
https://akraniss05.github.io/NovaLab-Website1/

NovaLab Studios ist eine mobile-optimierte Website mit Dark-Mode, violettem Branding, Projektgalerie und Detailseiten. Das aktualisierte Design orientiert sich an den **Gestaltungsprinzipien** moderner Gaming-Studio-Websites: ein klarer Hero-Bereich, starke visuelle Projektelemente, Editorial-Kacheln, reduzierte Navigation und prägnante Call-to-Actions.

Die Coding-Academy ist unter https://liverylab-academy.dev/ verlinkt. Die Beat-Maker-Lernplattform und das erste Spiel sind noch in Entwicklung beziehungsweise Planung.

## Admin-Zugang (nur freigegebene Teammitglieder)
Öffne die Website und klicke im Footer auf **Projektverwaltung**. Der Zugang ist nur für die separat angelegten Admin-Konten vorgesehen.

- Benutzername: `NyxAtheris` (Founder) oder `Jonas` (Admin)
- Keine öffentliche Registrierung.
- Die **Passwörter stehen nicht in GitHub**. Sie liegen nur als gesalzene PBKDF2-SHA256-Prüfsummen im Backend.
- Nach sechs Fehlversuchen wird das Konto für 15 Minuten gesperrt.
- Session-Tokens laufen nach sechs Stunden ab und werden nur in `sessionStorage` gehalten.
- Im Dashboard können beide Administratoren unter **Sicherheit & Passwort ändern** ihr Passwort ändern (mindestens 12 Zeichen).
- Projektänderungen und Medienuploads werden **serverseitig autorisiert**. Das Ausblenden des Admin-Panels allein ist nicht die Sicherheitsgrenze.

### Backend
Supabase-Projekt: `ekgxotvvhkmeuxvuwbei` (bestehendes LiveryLab-Projekt; Daten der Website sind isoliert).

Edge Function: `novalab-site-api`, Source: `backend/novalab-site-api/index.ts`.

Datenbanktabellen: `public.novalab_site_admins`, `public.novalab_site_projects` (RLS aktiviert; keine Lese-/Schreibrechte für anon oder authenticated). Der Edge-Funktionsserver nutzt ausschließlich dort das Supabase Service-Role-Geheimnis.

Öffentlicher Projektkatalog: `GET /projects`, Admin-Aktionen: `POST /login`, `GET /me`, `POST /logout`, `PUT /projects`, `POST /media`, `POST /change-password`. Das Frontend lädt zunächst den API-Katalog und verwendet `data/projects.json` bei Ausfällen als Fallback.

Bilder und Videos liegen im öffentlichen Storage-Bucket `novalab-site-media`. Uploads sind nur nach authentifizierter Admin-Anmeldung möglich.

### Sicherheitshinweise
- Bitte die anfänglichen, im Chat genannten Passwörter möglichst sofort in lange, einzigartige Passwörter ändern.
- Niemals `SUPABASE_SERVICE_ROLE_KEY` oder sonstige private Schlüssel im GitHub-Repository bzw. Browser-Code hinterlegen.
- Die Website nutzt GitHub Pages (`main` / Root). Ein erfolgreicher Pages-Workflow ist Voraussetzung, dass die aktuelle Version öffentlich erscheint.
- Für große Videos besser YouTube/Vimeo oder ein spezialisiertes CDN verwenden.
- Eine zusätzliche MFA-Funktion wäre eine sinnvolle spätere Sicherheitsverbesserung.

## V13 – visuelles und mobiles Update (10.11.2026)
- Die Status-Badges der Game- und Beat-Maker-Karten stehen nun im normalen Flex-Layout, nicht mehr absolut über Texten. Keine Badge-Überschneidungen auf iPhone und Tablet.
- Dezente neue Gamepad-/Musik-Line-Art und besser lesbare Coding-Grafik.
- Verbesserte mobile Typografie, einheitliche Status-Chips, Button-Abstände, Fokusrahmen und responsive Projektübersicht.
- Mobiles Menü schließt zusätzlich mit Escape, außerhalb des Menüs und beim Wechsel auf Desktop.
- Das separate Supabase-Admin-Login sowie Projektgalerie, Video-Uploads und andere bestehende Funktionen bleiben erhalten.

## NovaLab Games Launcher · Windows MVP

Der Code der eigenständigen Desktop-App liegt unter `launcher/` (Electron). Für Windows wird ein NSIS-Installer per GitHub Actions erstellt. Auf `main` entstehen Preview-Installer als Workflow-Artifacts. Release-Tags `v<version>` erzeugen GitHub Releases mit `latest.yml` für das Desktop-Auto-Update.

- Launcher-Downloadseite (zeigt nur echte verfügbare Releases): https://akraniss05.github.io/NovaLab-Website1/launcher/download.html
- Windows-Build-Workflow: `.github/workflows/launcher-windows.yml`
- Anleitung für Spielepakete, SHA-256 und Updates: `launcher/README.md`
- Vor dem ersten erfolgreichen Windows-Release ist noch keine `.exe` verfügbar. Das erste NovaLab-Spiel befindet sich weiterhin in der Entwicklung.
