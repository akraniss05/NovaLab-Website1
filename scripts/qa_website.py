#!/usr/bin/env python3
"""Dependency-free website integrity checks. Does not modify production data."""
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET
import re
import sys

ROOT=Path(__file__).resolve().parents[1]
class Inspect(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids=set()
        self.duplicates=[]
        self.local_urls=set()
        self.section_routes=set()
    def handle_starttag(self,tag,attrs):
        data=dict(attrs)
        if 'id' in data:
            if data['id'] in self.ids:self.duplicates.append(data['id'])
            self.ids.add(data['id'])
        if tag=='section' and data.get('data-page'):self.section_routes.add(data['data-page'])
        for k in ('href','src'):
            value=data.get(k,'')
            if value.startswith('./') and not value.startswith('//'):
                self.local_urls.add(value.split('#')[0].split('?')[0])
parser=Inspect()
html=(ROOT/'index.html').read_text(encoding='utf8')
parser.feed(html)
required_routes={'home','projects','learning','code','music','games','launcher','team','support','project','admin'}
assert required_routes <= parser.section_routes, f'missing page routes: {required_routes-parser.section_routes}'
required_ids={'mainNav','mobileMenu','introNovaLab','discoverNovaLab','projectGrid','projectSearch','projectForm','adminLogin','loginForm','adminDashboard','publish','fCoverFile','fGalleryFiles','fVideoFile'}
assert required_ids <= parser.ids, f'missing ID: {required_ids-parser.ids}'
assert not parser.duplicates, f'duplicate ids: {parser.duplicates}'
assert '<script defer src="./app.js?v=15"></script>' in html
assert '<link rel="stylesheet" href="./studio-v14.css?v=14">' in html
assert 'Windows-Launcher herunterladen' in html
assert 'NovaLab Code für Windows' in html
assert 'NovaLab Studios' in html
for loc in parser.local_urls:
    target=ROOT/loc[2:]
    assert target.is_file(), f'missing local resource: {loc}'
styles=(ROOT/'studio-v14.css').read_text(encoding='utf8')
assert '.nv-hero-layout' in styles and '@media(max-width:580px)' in styles
js=(ROOT/'app.js').read_text(encoding='utf8')
assert 'window.innerWidth>1090' in js
assert 'verifyOfficialProject' in js
for asset in ('site-hero.svg','site-code.svg','site-launcher.svg','site-games.svg','site-beat.svg'):
    ET.parse(ROOT/'assets'/asset)
assert './launcher/download.html' not in html
assert './launcher/mini-games/' not in html
assert 'releases/download/novalab-launcher-v0.8-alpha/' in html
print(f'OK: {len(parser.section_routes)} routes, {len(parser.ids)} unique IDs, {len(parser.local_urls)} local resources, 5 valid SVG assets and JavaScript')

assert 'id="featuredSection"' in html and 'id="featuredGrid"' in html
assert 'function renderFeatured()' in js and 'formDirty' in js
backend=(ROOT/'backend'/'novalab-site-api'/'index.ts').read_text(encoding='utf8')
assert 'if(allowRoute&&' in backend and 'assets' in backend
print('OK: featured projects, draft protection and backend URL validation present')

# Archived editions must not load modern, incompatible JavaScript.
for old in ("novalab-v8.html","novalab-v11.html","novalab-v12.html","novalab-v13.html"):
    content=(ROOT/old).read_text(encoding="utf8")
    assert 'url=./index.html' in content and 'location.replace' in content, f"stale page not redirected: {old}"
print("OK: all legacy website routes redirect to the compatible current version")
