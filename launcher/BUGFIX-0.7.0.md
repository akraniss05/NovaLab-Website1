# NovaLab Launcher v0.7.0 — Bugfix, Spieleverwaltung, NovaLab Code

## Verifizierter Ausgangsstand
- Launcher Repo: akraniss05/NovaLab-Website1 (Electron). Vorheriger Release v0.6.0.
- Coding Repo: akraniss05/NovaLab-Code (bestehender v31-Academy-Site-Frontend-Code mit Supabase).
- Bei Auditbeginn waren Studio-Games und alte User-Uploaded Games in Supabase leer. Die sichtbaren älteren Demo-/Konzept-Einträge sind Teil des ursprünglichen `launcher/catalog.json` GitHub-Katalogs.
- Kein altes Benutzerkonto und kein vorhandener lokaler Lernstand wurde gelöscht.

## Neue Verwaltungsaktionen
**Administration → Publishing Studio → Spiele verwalten**: Datenbankspiele und ursprüngliche GitHub-Katalogeinträge werden zusammen angezeigt. Nicht herunterladbare Platzhalter aus dem Github-Katalog sind als 'KEIN DOWNLOAD' markiert.

- GitHub-Katalogeinträge können per serverseitigem `novalab_catalog_suppressions` aus dem öffentlichen Store entfernt und wieder aktiviert werden. Die ursprüngliche GitHub-Datei bleibt vorhanden und kann ohne GitHub-Credentials nicht über die Launcher-API gelöscht werden.
- Mehrfachauswahl: archivieren oder wiederherstellen (bis zu 30 IDs pro API-Aufruf). Endgültige Mehrfachlöschung ist absichtlich nicht automatisch möglich.
- Datenbankspiele: vor endgültiger Löschung erst archivieren, danach exakten Spielnamen eingeben und eine zweite Bestätigung geben.
- Endgültig gelöschte Datenbankspiele entfernen abhängige Medien- und Versionsdatensätze via FK-Cascade. Serverdateien werden nur nach Referenzprüfung bereinigt. Audit-Logeintrag bleibt erhalten; fehlgeschlagene Speicherbereinigung wird im Ergebnis angezeigt.
- Lokale Dateien, bisherige Installationen anderer Nutzer und lokale Spielstände werden nicht gelöscht.
- Archivierte GitHub-Katalogeinträge bleiben mit lokal gecachten Ausschlüssen auch nach einem Offline-Neustart verborgen, wenn zuvor eine Online-Abfrage erfolgreich war.
- Einzelne native Windows-EXE-Archive dürfen weiterhin nur von Admins veröffentlicht und vom Nutzer ausdrücklich installiert und geöffnet werden.

## NovaLab Code Desktop (1.0.0 Erstbuild, 1.0.1 Laufzeit-Bugfix)
- Separates Repository `akraniss05/NovaLab-Code/desktop/` mit Electron-App, keinem neuen Kursprototyp.
- App startet das bestehende komplette Site-Frontend von `site/` aus gebündelten Ressourcen über ein sicheres lokales `novalab-code://`-Protokoll.
- Es gibt einen Windows-Installer und eine Launcher-kompatible portable ZIP mit `NovaLab Code.exe` plus Ressourcen.
- Pakete werden von GitHub Releases ausgeliefert und mit SHA-256 vor der Installation geprüft; die Manifestdaten kommen aus dem tatsächlichen CI-Paketierungsprozess.
- Release 1.0.1 korrigiert die Bereitstellung von Lua/Python-Laufzeiten und des Supabase-Browser-SDKs; restriktive Referenzdaten aus `site/reference-data.js` werden bewusst ausgeschlossen.
- Auth, Kursinhalte, Lernfortschritt und Quizze verwenden die vorhandene Supabase-/Frontend-Logik; eine komplette manuelle Windows-End-to-End-Prüfung ist noch nötig. Offline-Lernen und SSO werden nicht behauptet.

## Store-Integration
- NovaLab Code ist als `community-novalab-code` in den neuen Studio-Tabellen mit `kind='app'` gespeichert, einschließlich Code-Desktop-Release, SHA, Banner und Cover.
- Die Store-Seite lädt die Metadaten dynamisch aus Supabase; als Community-App erscheint der Button 'Öffnen' statt nur 'Spielen'.
- Das Cover und Banner sind originale NovaLab-SVG-Designs (`launcher/assets`), keine angeblich echten Screenshots.
- Echte Account-/Kurs-/Quiz-Screenshots sind **noch nicht** hinzugefügt. Es werden keine erfundenen UI-Screenshots als real ausgegeben.

## Teststatus
- GitHub-Actions-Windows-Build: JS-Syntaxcheck, Downloader- und Updater-Unit-Tests sowie Live-Supabase-API-Smoke-Tests.
- Live-API-Smoke-Tests: öffentlicher Katalog; anonyme Aufrufe von Adminlisten, Archivierung, Bulk-Archivierung, Löschen, Bearbeiten und Veröffentlichen müssen HTTP 403 ergeben.
- Code Windows Build verifiziert ZIP-Prüfsumme und Präsenz der tatsächlichen Desktop-EXE und `site/index.html`.
- Kein interaktiver Windows-End-to-End-Test (Login, Studio-Upload, Start/Update der installierten Code App) durchgeführt. App nicht digital signiert.
- Bestehende Academy-Website-Workflow-Tests mussten an die deaktivierbare Shop-Sichtbarkeit angepasst werden; dies ist getrennt vom Code-Desktop-Release.

## Reproduzierbarer Build
`cd launcher && npm install && npm run check && npm run build:win`

Code Desktop: `cd desktop && npm install && npm run check && npm run build:win && python scripts/package-build.py 1.0.1` (in Repo NovaLab-Code). Das vollständige CI bereitet die Vendor-Laufzeitdateien **vor** dem App-Build aus dem ursprünglichen Site-Frontend vor.

## Offene Punkte
- Keine automatisierte GitHub-Dateilöschung über das Adminpanel; ursprüngliche Repo-Katalogeinträge werden serverseitig ausgeblendet.
- Große private Game-Builds benötigen weiterhin dedizierte TUS-/CDN-Upload-Infrastruktur; Studio-Direktupload ist aktuell auf 12 MB begrenzt.
- Finale Signierung, native Malwareprüfung, vollständige Windows-E2E-Tests, echte Kurs-Screenshots und Launcher-Code-Updates über neue verifizierte Desktop-Releases folgen.
