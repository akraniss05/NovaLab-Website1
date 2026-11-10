# NovaLab Mini Games

Jedes kleine HTML/Canvas/JavaScript-Spiel hat seinen eigenen Ordner und eine `game.json`.

Beispiel: `orbit-dash/` mit `game.json`, `index.html`, eventuell `style.css`, `game.js` und lokalen Assets.

**Veröffentlichen:** Über `.github/workflows/mini-game-publish.yml` mit `game_id` und `version`. Das Python-Skript packt das Spiel, erzeugt SHA-256 und aktualisiert `launcher/catalog.json`. Der Launcher lädt den Katalog beim Start neu, sodass **ein neues Spiel keine neue Launcher-Version benötigt**.

**Spielregeln:** Keinen externen CDN-Code verwenden. Die heruntergeladenen Spiele laufen aus Sicherheitsgründen offline in einer isolierten eigenen Browser-Session. Für eigene Assets nur relative Pfade verwenden. Keine Steam/Epic-Spiele oder fremden urheberrechtlich geschützten Inhalte kopieren.
