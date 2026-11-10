# NovaLab Studios – offizielle Projektwebsite

Die NovaLab-Website stellt das gemeinsame Studio, dessen Lernplattformen, Spielideen und die eigene Spieleplattform vor. Visuelles Konzept: Dark-Violett / Neon mit Stadthintergrund und den Team-Profilbildern.

## Projekte und Status (Stand: 10. November 2026)

| Bereich | Status | Link |
| --- | --- | --- |
| NovaLab Academy / Coding-Lernplattform | Beta, Konto-Freigabe auf Anfrage | https://liverylab-academy.dev/ |
| Beat Maker Lernplattform | In Entwicklung, **kein bestätigter öffentlicher App-Link** | `#music` |
| Erstes NovaLab-Spiel | **In Planung**; keine spielbare Version vorhanden | `#games` |
| NovaLab Launcher | Konzept, noch keine Installationsdatei | `#launcher` |

Die Beat-Maker-Seite beschreibt das Lernkonzept für Rhythmus, Drums, Bass, Musikstile und Mixing. Der gezeigte 16-Step-Sequencer ist eine **grafische Vorschau**, keine funktionierende Musiksoftware.

Die Game-Seite zeigt den beabsichtigten Entwicklungsprozess (Konzept → Prototyp → Tests → Release) ohne verbindliche Termine. Keine erfundenen Gameplay-Funktionen, Screenshots oder Downloads.

## Navigation und Inhalte

- `#home`: Vorstellung von NovaLab Studios, Team, Projektkarten und Coding-Spotlight
- `#projects`: Filterbarer Projektkatalog mit Kategorien Coding, Musik, Games und Tools
- `#academy`: Coding-/Blender-Kurse, Lernpfade, Aufgaben, Quiz und Web-App-Link
- `#music`: Beat Maker-Lernkonzept und geplante Lernmodule
- `#games`: Erstes geplantes Spiel und Entwicklungsfahrplan
- `#launcher`: Vision der Spielebibliothek und Softwareverteilung
- `#team`: Discord-Profil-Links
- `#support`: Community und FAQ
- `#admin`: GitHub-basierte Pflege des JSON-Projektkatalogs

## Links
- NovaLab Code Repository: https://github.com/akraniss05/NovaLab-Code
- Coding Web-App: https://liverylab-academy.dev/
- NovaLab Community: https://discord.gg/SZhYa6Nnmy
- Website: https://akraniss05.github.io/NovaLab-Website1/

## Hosting & Admin

GitHub Pages über Branch `main` und Root-Verzeichnis. Die statische `index.html` enthält CSS, JavaScript und eingebettete Grafiken; Projektinformationen liegen in `data/projects.json`.

Der Admin-Katalog-Editor verwendet für berechtigte Repository-Mitglieder einen manuell eingegebenen GitHub Fine-Grained Token mit `Contents: read/write` ausschließlich für das Projekt-Repository. **Keinen Token in den Quellcode committen.** Es gibt noch keinen eigenständigen sicheren Login-Server für die Website. Änderungen im Editor werden erst durch einen expliziten GitHub-Commit veröffentlicht.
