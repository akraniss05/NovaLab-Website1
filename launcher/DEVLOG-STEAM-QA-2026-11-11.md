# NovaLab Launcher – Iteratives Entwicklungsprotokoll
**Arbeitsbranch:** `feat/launcher-steam-qa-20261111`  
**Ausgangscommit:** `c40351bea4076d746479909709c6743cc58e38cb` (Stand von `main` am 11.11.2026)  
**Scope:** ausschließlich `launcher/**` und der branchgebundene QA-Workflow. **Kein Website-Redesign**, keine Supabase-Migration, kein Merge, keine produktive Veröffentlichung.

## Reale Fehler, Ursache und Korrekturen

| Priorität | Befund | Ursache | Umsetzung |
|---|---|---|---|
| Kritisch | Aktualisierung konnte eine alte Spielinstallation ohne Eigentumsmarkierung überschreiben | Marker-Prüfung bisher nur für Installationen mit explizit gespeichertem `installRoot` | Neue `assertManagedInstall`-Prüfung für jedes Update, jede Deinstallation und die Dateistrukturprüfung; fremde oder veraltete unmarkierte Ordner werden **nicht** automatisch angefasst. |
| Hoch | Download mit gleicher Version konnte veränderte SHA-256-Prüfsumme übergehen | `enqueue` prüfte beim Fortsetzen nur ID + Version | SHA, URL, Startdatei und Format werden mitverglichen; neuer Release verwirft alten Cache. |
| Hoch | Launcher-Schließen konnte laufende Downloads als Fehler markieren oder neu starten | Abbruch und Worker-Neustart ohne `closing`-Sperre | `close` stoppt die Warteschlange, bewahrt Teildatei und markiert wiederaufnehmbare Tasks als `queued`. |
| Mittel | Bereits vollständig geladenes ZIP wurde nach Neustart neu geladen | HTTP 416 bei Range-Ende führte immer zum Cache-Löschen | Vollständiges Paket per SHA-256 prüfen und ohne neuen Download weiterverarbeiten. |
| Hoch, Windows | `EPERM` beim Umbenennen von `downloads.json.tmp` | Dateisperren durch Windows, Dateiscanner oder Test-Teardown | Einzigartige temporäre Namen, begrenzte Wiederholungen bei EPERM/EACCES/EBUSY, bestehende Datei vor Erfolg niemals löschen; Tests schließen Worker vor Temp-Cleanup. |
| Mittel | Native EXE wurde erfolgreich gestartet gemeldet, obwohl `spawn` noch fehlschlagen konnte | Rückgabe direkt nach `spawn()`-Aufruf | Erst auf tatsächliches `spawn`-Ereignis warten; Fehler propagieren und anzeigen. |
| Mittel | HTML5-Spiele meldeten Erfolg vor Abschluss des Seitenladens | `loadURL` nicht abgewartet | `loadURL` wird abgewartet, Fehler schließen das Spielfenster. |
| Mittel | Der Katalog blockierte initiale Darstellung bis zu langsamen API-Aufrufen | Keine frühe lokale Katalogmeldung | Bundled, gefilterten echten Katalog sofort an Renderer senden; Remote-Updates folgen. |
| UX | Download-Warteschlange hatte keine Reihenfolge-Steuerung | Die persistente Queue unterstützte nur Hinzufügen/Pausieren/Abbrechen | Wartende Downloads können per ↑/↓ sortiert werden. Reihenfolge wird persistiert; laufende, pausierte und installierende Tasks werden nicht bewegt. |
| UX | Globales Suchen und Nicht-installiert-Filter fehlten | Nur Store-Suche und installiert-only Bibliotheksansicht | Globale Suche mit Ctrl+K, lokale Merkliste, Library-Filter, Download-Badge und 80er Pagination. |
| UX | Startseite zeigte NovaLab-Code-Artwork aber Orbit-Dash-Beschriftung / statischen Fake-Zähler | Nicht an `featured` gebundene Caption und Counter | Caption, Kicker und Anzahl der installierbaren Produkte dynamisch aus tatsächlichen Katalogdaten. |
| UX | Bibliothek-Zähler ignorierte gespeicherte, nicht installierte Spiele | Zählte nur `installed` | Zählt alle lokalen Bibliothekseinträge, aktualisiert bei Änderungen. |
| QA | Electron-Test benutzte mehrdeutigen „Schließen“-Selektor | Zwei gültige Schließen-Buttons | Unverwechselbare Selektoren verwendet. |
| QA | Shutdown-Test auf schnellen Runnern instabil | Lokale 0,5MB-Datei war schon fertig, bevor `close()` aufgerufen wurde | Deterministischer abgebrochener Request mit vorhandener Teildatei + realer HTTP-Range-Neustart; Assertions bleiben aktiv. |

## Was implementiert wurde

- **Dateisicherheit:** `launcher/src/install-safety.cjs` und `launcher/test/install-safety.test.cjs`
- **Downloads:** `launcher/src/download-manager.cjs` und `launcher/test/download-manager.test.cjs`
- **Launcher / Spiele-Start:** `launcher/src/main.cjs`
- **Steam-inspiriertes Design:** `launcher/src/renderer/index.html`, `app.js`, `style.css`
- **Echte Electron-Oberflächenprüfungen:** `launcher/qa/electron-smoke.cjs` (1440x900, 1024x768 und 900x620)
- **Separater Windows-/Linux-Branch-QA-Workflow:** `.github/workflows/launcher-branch-qa.yml`

Die Steam-Referenz dient als Orientierung für dichte, gut zugängliche Navigation und Bibliotheken, **ohne Originaldateien, Markenlogos oder geschützte Grafiken zu kopieren**. Echte, vorhandene Spiele aus dem NovaLab-Katalog werden angezeigt, keine künstlich erzeugten Spiele oder statistischen Zahlen.

## Verifikation

- **Erster grüner End-to-End-CI-Durchlauf (Branch):** [GitHub Actions #42927515623](https://github.com/akraniss05/NovaLab-Website1/actions/runs/42927515623). **Linux:** 21 lokale Tests bestanden, 0 fehlgeschlagen, 11 optionale Live-API-Tests *übersprungen*, echter Electron-Start + Playwright-Interaktionen erfolgreich. **Windows:** 21 lokale Tests bestanden, 0 fehlgeschlagen, 11 optionale Live-API-Tests *übersprungen*; Windows-Installer per `electron-builder` erfolgreich erzeugt.
- **Echte Screenshots im Workflow-Artefakt:** `NovaLab-Launcher-Real-Electron-UI-QA` – Home, Store-Suche, Merkliste/Bibliothek, Downloads ohne Tasks, 1024px-Layout, und im Folgelauf zusätzlich minimale 900px-Fenstergröße.
- Der neueste Commit / letzte CI-Durchlauf muss vor PR-Freigabe erneut vollständig geprüft werden; ein erfolgreicher Build allein ist nicht mit einem kompletten Funktionstest gleichzusetzen.
- Der Windows-Build liegt **nur als Actions-Preview-Artefakt**, **nicht** als neues öffentliches GitHub Release vor.
- Die öffentliche Website wurde nicht verändert. Der Branchenvergleich mit `main` darf ausschließlich `launcher/**` und den neuen QA-Workflow enthalten.

## Noch offen / ungetestet

1. **Windows-Installation wirklich per GUI testen** (der Runner baut Installer, installiert ihn aber noch nicht mit sichtbaren Windows-Fenstern).
2. Echten `NovaLab Code`-Download aus der Windows-App inklusive SHA-256, Installation, lokalem Start, Login, Kursen und Quiz-Weiterführung testen.
3. **Rollback mit Windows-Dateisperren, Spielständen und beschädigten großen ZIPs** auf einem Windows-Testgerät prüfen.
4. Live-Test der Admin-Supabase-API mit Testkonten und test-only Uploads (ohne produktive Datenänderungen).
5. Signieren und prüfen der Windows-Builds sowie absichern des Updateprozesses über verifizierte Release-Metadaten.
6. Persönliche Merkliste ist vorerst **lokal gespeichert**; es gibt noch keine serverseitige geräteübergreifende Cloud-Bibliothek.
7. Installationen mit **fehlendem, altem Marker** werden aus Datenschutz- und Sicherheitsgründen gesperrt; statt ungeprüfter Löschung braucht es einen expliziten, abgesicherten Migrations-/Reparaturworkflow.
8. Steam-artige Community, News, Delta-Updates und Shop-Funktionen sind nicht Teil dieses geprüften Bugfix-Sprints.

## Reproduktion

```bash
cd launcher
npm install --no-audit --no-fund
npm run check
# Linux mit Xvfb und Playwright (siehe CI):
xvfb-run -a node qa/electron-smoke.cjs
# Windows:
npm run build:win
```

**Hinweis:** Das GitHub-Actions-CI lädt Playwright für die QA separat. Lokal muss für `qa/electron-smoke.cjs` ebenfalls `playwright` installiert sein. Die Kern-App selbst braucht diese QA-Abhängigkeit nicht.

## Freigabeentscheidung

Dieser Stand ist **ein Review-/Preview-Branch**. Die Änderungen werden **nicht gemergt oder öffentlich veröffentlicht**, bevor die fehlenden Windows-E2E-Prüfungen und die finale Freigabe erfolgt sind. Bestehende Nutzerdaten wurden nicht gelöscht. Entwicklung und Tests laufen nur während der aktiven Chat-/Tool-Ausführung, nicht still im Hintergrund.
