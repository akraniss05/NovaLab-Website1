# NovaLab Studios – offizielle Website

Die neue NovaLab Studios Website ist als hochqualitativer, responsiver Studioauftritt gestaltet: dunkles, cinematografisches Design, violetter Stadtbanner, echtes NovaLab-Logo, die beiden Teamprofile sowie Projektkarten mit eigenen Detailseiten.

## Live Website
GitHub Pages (bereits als Hosting vorgesehen):
https://akraniss05.github.io/NovaLab-Website1/

Die Website liegt vollständig im Root des Branches `main`. Wenn GitHub Pages unter **Settings → Pages → Deploy from a branch → main → / (root)** aktiviert ist, werden Änderungen an diesem Branch veröffentlicht. Der externe Live-Status konnte hier nicht automatisch bestätigt werden.

## Navigation
- Startseite
- Projekte (Suchfunktion, Filter, Galerie, Videos und Detailansichten)
- Lernplattformen (kompakte Coding- & Beat-Maker-Seiten)
- Games (erstes Spiel in Planung)
- Launcher (Roadmap, noch kein Download)
- Team, Support und Projektverwaltung über den Footer

## Projektverwaltung
Die Administration ist über den Footer → **Projektverwaltung** erreichbar.

**Hinweis:** Das ist kein unabhängiger geschützter Web-Login. Die öffentliche GitHub-Pages-Website besitzt kein eigenes Backend.

Zum Bearbeiten werden benötigt:
1. GitHub-Konto mit Schreibzugriff auf `akraniss05/NovaLab-Website1`.
2. GitHub Fine-grained Personal Access Token für genau dieses Repository mit **Contents: Read and write**.
3. Den Token im Admin-Panel eingeben und auf **Verbinden** klicken; anschließend Projekte hinzufügen, ändern oder löschen.
4. Danach **Auf Website veröffentlichen** drücken. Erst dann werden Änderungen via GitHub API in `data/projects.json` committed.
5. Bei Bedarf Token über **Trennen** aus dem Arbeitsspeicher entfernen.

**Token niemals in Chatnachrichten, Screenshots, Repositories oder an andere Personen weitergeben.** Der Token wird nicht in `localStorage` gespeichert.

## Bilder und Videos
- Titelbild: URL oder Datei (JPG/PNG/WebP), maximal 4 MB.
- Galerie: mehrere hochgeladene Bilder oder HTTPS-Bildlinks.
- Video: YouTube/Vimeo-URL oder HTTPS-MP4/WebM; zusätzlich ist das Hochladen von kleinen Video-Dateien (maximal 12 MB) vorgesehen.
- Dateien werden beim Veröffentlichen via GitHub Contents API nach `assets/uploads/` hochgeladen; die Projektinformationen werden anschließend aktualisiert.
- Eingebettete YouTube-Videos verwenden `youtube-nocookie.com`; unerkannte Videos werden als externe Links gezeigt.
- Für größere Videodateien empfiehlt sich YouTube oder ein eigens dafür geeigneter Storage/CDN.

Wichtig: Alle hochgeladenen Dateien sind öffentlich. GitHub Pages ist kein geschützter Speicher. Für produktive Benutzeraccounts, Shop/Zahlungen oder private Downloads wird ein echtes Backend benötigt.

## Projekte
- **NovaLab Academy:** https://liverylab-academy.dev/ – Coding- und Blender-Lernplattform (Beta)
- **NovaLab Beat Maker:** Musik-Lernprojekt, in Entwicklung
- **NovaLab Game 01:** erstes eigenes Spiel in der Konzeptphase
- **NovaLab Launcher:** geplante eigenständige PC-Spieleplattform
- Discord: https://discord.gg/SZhYa6Nnmy

## Dateien
- `index.html`: Website und alle Seiten
- `styles.css`: Design und responsive Layouts
- `app.js`: Navigation, Projekte, Detailansichten und GitHub-Verwaltung
- `data/projects.json`: öffentlich sichtbarer Projektkatalog
- `assets/uploads/`: wird erst bei Medien-Uploads angelegt

© NovaLab Studios.
