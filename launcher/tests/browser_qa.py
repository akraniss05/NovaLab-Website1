"""Real Chromium smoke test of NovaLab's hosted launcher surface."""
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path('launcher-test-results')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    for kind, width, height in [('mobile', 390, 844), ('desktop', 1440, 900)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:4173/launcher/',wait_until='load',timeout=30000)
        page.locator('#app-content .hero').wait_for(timeout=20000)
        assert page.locator('#app-content').inner_text().find('Willkommen') >= 0
        nav = '#mobile-tabbar' if kind == 'mobile' else '#nav-main'
        page.locator(f'{nav} [data-page="store"]').click()
        assert 'Shop & Entdecken' in page.locator('#app-content').inner_text()
        page.locator('#search').fill('Neon Drift')
        assert 'Neon Drift' in page.locator('#app-content').inner_text()
        assert 'Frostborn Survival' not in page.locator('#app-content').inner_text()
        page.locator(f'{nav} [data-page="library"]').click()
        assert 'Meine Bibliothek' in page.locator('#app-content').inner_text()
        page.locator('#app-content [data-action="add-game"]').first.click()
        page.locator('#game-form input[name="name"]').fill('NovaLab Testspiel QA')
        page.locator('#game-form textarea[name="description"]').fill('Ein automatisch eingetragenes Testspiel')
        page.locator('#game-form button[type="submit"]').click()
        assert 'NovaLab Testspiel QA' in page.locator('#app-content').inner_text()
        page.reload(wait_until='load')
        page.locator('#app-content .hero').wait_for(timeout=20000)
        page.locator(f'{nav} [data-page="library"]').click()
        assert 'NovaLab Testspiel QA' in page.locator('#app-content').inner_text()
        page.locator(f'{nav} [data-page="home"]').click()
        page.locator('[data-action="launch"][data-id="novalab-arcade"]').first.click()
        page.locator('#arcade').wait_for(timeout=10000)
        page.locator('#modal-root [data-action="close-modal"]').first.click()
        page.screenshot(path=str(out / f'novalab-{kind}.png'),full_page=True)
        assert not errors, f'{kind} JavaScript errors: {errors}'
        print(f'PASS {kind}: home, search, store, library, custom game save/persist, arcade and modal')
        page.close()
    browser.close()