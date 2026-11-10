"""Real Chromium route and responsive screenshot smoke tests for NovaLab v14."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'/'previews'
URL='http://127.0.0.1:4173/'
async def run():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  desktop=await browser.new_page(viewport={'width':1440,'height':920},device_scale_factor=1)
  errors=[]
  desktop.on('pageerror',lambda error:errors.append(str(error)))
  await desktop.goto(URL,wait_until='domcontentloaded',timeout=20000)
  await desktop.locator('.nv-hero h1').wait_for()
  await desktop.locator('.nv-product-grid .nv-product-card').first.wait_for()
  assert await desktop.locator('.nv-product-card').count()==4
  assert await desktop.locator('#adminLogin').count()==1
  await desktop.screenshot(path=str(OUT/'website-home-desktop.png'),full_page=True,animations='disabled')
  await desktop.goto(URL+'#projects',wait_until='domcontentloaded')
  assert await desktop.locator('[data-page="projects"]').is_visible()
  await desktop.screenshot(path=str(OUT/'website-projects-desktop.png'),full_page=True,animations='disabled')
  await desktop.goto(URL+'#code',wait_until='domcontentloaded')
  assert await desktop.locator('[data-page="code"]').is_visible()
  assert await desktop.locator('a[href*="NovaLab-Code-Setup-1.0.1.exe"]').count()>=1
  await desktop.screenshot(path=str(OUT/'website-code-desktop.png'),full_page=True,animations='disabled')
  await desktop.goto(URL+'#launcher',wait_until='domcontentloaded')
  assert await desktop.locator('[data-page="launcher"]').is_visible()
  assert await desktop.locator('a[href="./launcher/download.html"]').count()>0
  await desktop.goto(URL+'#admin',wait_until='domcontentloaded')
  assert await desktop.locator('#loginForm').is_visible()
  assert await desktop.locator('#loginPassword').get_attribute('type')=='password'
  assert not errors, 'JavaScript page errors: '+str(errors)
  mobile=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  mobile_errors=[]
  mobile.on('pageerror',lambda error:mobile_errors.append(str(error)))
  await mobile.goto(URL,wait_until='domcontentloaded',timeout=20000)
  await mobile.locator('.nv-hero').wait_for()
  await mobile.screenshot(path=str(OUT/'website-home-mobile.png'),full_page=True,animations='disabled')
  dimensions=await mobile.evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})')
  assert dimensions['width'] <= dimensions['viewport']+2,f'horizontal overflow: {dimensions}'
  await mobile.locator('#mobileMenu').click()
  assert 'open' in (await mobile.locator('#mainNav').get_attribute('class') or '')
  await mobile.locator('#mainNav [data-go="launcher"]').click()
  assert await mobile.locator('[data-page="launcher"]').is_visible()
  assert not mobile_errors,'Mobile JavaScript page errors: '+str(mobile_errors)
  await browser.close()
  print('OK: desktop/mobile navigation, image layout, download links, admin login, no JS errors, 4 screenshots')
asyncio.run(run())
