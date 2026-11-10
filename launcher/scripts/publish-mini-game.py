#!/usr/bin/env python3
"""Pack and publish an in-repository HTML mini game by updating catalog.json.
Run manually or via .github/workflows/mini-game-publish.yml.
"""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,59}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
EXTENSIONS = {'.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.wasm', '.glb', '.gltf'}
MAX_BYTES = 120 * 1024 * 1024


def publish(slug: str, version: str) -> dict:
    if not SLUG.fullmatch(slug) or not VERSION.fullmatch(version):
        raise ValueError('Erwarte game-id (a-z, 0-9, -) und Version x.y.z, z.B. orbit-dash 1.0.0')
    source = ROOT / 'mini-games' / slug
    manifest_path = source / 'game.json'
    if not manifest_path.is_file():
        raise ValueError(f'Fehlende Spielbeschreibung: {manifest_path}')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('id') != slug:
        raise ValueError('Die ID in game.json muss genau dem Ordnernamen entsprechen.')
    entry = manifest.get('entry', 'index.html')
    if not isinstance(entry, str) or not re.fullmatch(r'[a-zA-Z0-9_ .()/\-]+\.html?', entry) or entry.startswith('/') or '..' in entry.split('/'):
        raise ValueError('HTML-Startdatei (entry) ungültig')
    if not (source / entry).is_file():
        raise ValueError('HTML-Startdatei fehlt im Spielordner')
    files = sorted(f for f in source.rglob('*') if f.is_file() and f.name != 'game.json')
    if not files or len(files) > 500:
        raise ValueError('Spiel enthält zu viele oder keine Dateien')
    total = 0
    for file in files:
        if file.is_symlink() or file.suffix.lower() not in EXTENSIONS:
            raise ValueError(f'Nicht erlaubtes Asset im Spiel: {file.name}')
        total += file.stat().st_size
    if total > MAX_BYTES:
        raise ValueError('Das Mini-Game ist größer als 120 MB')
    target_dir = ROOT / 'mini-games' / 'downloads' / slug
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f'{slug}-v{version}.zip'
    target = target_dir / filename
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in files:
            archive.write(file, file.relative_to(source).as_posix())
    if target.stat().st_size > MAX_BYTES:
        target.unlink()
        raise ValueError('Das ZIP ist größer als 120 MB')
    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    url = f'https://raw.githubusercontent.com/akraniss05/NovaLab-Website1/main/launcher/mini-games/downloads/{slug}/{filename}'
    record = {
        'id': slug,
        'title': str(manifest.get('title') or slug)[:90],
        'subtitle': str(manifest.get('subtitle') or '')[:130],
        'description': str(manifest.get('description') or '')[:1000],
        'type': 'game',
        'status': 'Spielbar',
        'tags': [str(x)[:28] for x in manifest.get('tags', ['Mini Game'])[:6]],
        'accent': str(manifest.get('accent') or '#987cff'),
        'website': f'https://akraniss05.github.io/NovaLab-Website1/launcher/mini-games/{slug}/index.html',
        'release': {'format': 'html', 'version': version, 'url': url, 'sha256': sha, 'entry': entry},
    }
    catalog_path = ROOT / 'catalog.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    previous = next((item for item in catalog if item.get('id') == slug and item.get('release')), None)
    if previous and tuple(map(int, version.split('.'))) <= tuple(map(int, previous['release']['version'].split('.')[:3])):
        raise ValueError('Spielversion muss höher als die bisher veröffentlichte Version sein')
    catalog = [item for item in catalog if item.get('id') != slug]
    catalog.insert(0, record)
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'VERÖFFENTLICHT: {slug} v{version}\nZIP: {target.relative_to(ROOT)}\nSHA256: {sha}\nURL: {url}')
    return record


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Benutzung: python scripts/publish-mini-game.py <game-id> <1.0.0>')
    try:
        publish(sys.argv[1], sys.argv[2])
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(f'FEHLER: {error}') from error
