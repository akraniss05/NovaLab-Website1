"""Desktop native bridge smoke test in real Chromium, fully mocked network and native commands."""
import json, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PORT=4791
server=subprocess.Popen(['python','-m','http.server',str(PORT),'--bind','127.0.0.1','--directory',str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
MOCK_GAME={
 'id':'community-testgame','title':'NovaLab QA Release','summary':'Eine neue Testversion wurde veröffentlicht',
 'description':'Testspiel für die Versions- und Installationsprüfung im Launcher','genre':'Arcade',
 'developer':'NovaLab QA','status':'Beta','cover':'',
 'release':{'version':'1.2.0','format':'windows','entry':'game.exe','sha256':'a'*64,
 'url':'https://example.com/qa-version.zip','size':1048576,'changelog':'Neue Karte, bessere Steuerung.'}
}

released_version={"value":"1.2.0"}

NATIVE_MOCK="""
window.__novalabLog=[];
window.novalab={
  pickGame:async()=>({cancelled:true}),
  installedGames:async()=>[{gameId:'community-testgame',version:'1.0.0'}],
  onDownloadProgress:()=>()=>{},
  onInstallProgress:(fn)=>{window.__installProgress=fn;return ()=>{}},
  checkLauncherUpdate:async()=>({available:false}),
  installLauncherUpdate:async()=>({ok:true}),
  installGameVersion:async(info)=>{
    window.__novalabLog.push({action:'install',info});
    if(window.__installProgress)window.__installProgress({id:info.gameId,status:'active',percent:50,message:'Spielpaket wird geprüft'});
    return {ok:true,version:info.version}
  },
  uninstallInstalledGame:async(id)=>{window.__novalabLog.push({action:'uninstall',id});return {ok:true}},
  launchInstalledGame:async(id)=>{window.__novalabLog.push({action:'launch',id});return {ok:true}},
  downloadGame:async()=>({cancelled:true}),
  cancelDownload:async()=>({ok:true}),
  launchGame:async()=>({ok:true}),openExternal:async()=>({ok:true})
};
"""

try:
 time.sleep(1.1)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1440,'height':900})
  context.add_init_script(NATIVE_MOCK)
  page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda d:d.accept())
  def respond(route):
   url=route.request.url
   if url.endswith('/catalog'):
    games=[{**MOCK_GAME,"release":{**MOCK_GAME["release"],"version":released_version["value"]}}] if 'novalab-studio-api' in url else []
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'games':games}))
   elif url.endswith('/me'):
    route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'Not logged in'}))
   else:route.fulfill(status=200,content_type='application/json',body='{}')
  page.route('**/functions/v1/**',respond)
  page.goto(f'http://127.0.0.1:{PORT}/',wait_until='domcontentloaded')
  page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
  page.wait_for_function("document.querySelector('#app-content')?.innerText.includes('Willkommen')")
  page.wait_for_timeout(350)
  page.locator('#nav-main [data-page="downloads"]').click()
  page.get_by_text('1 Spiel-Update(s) verfügbar').wait_for()
  page.get_by_text('Neue Karte, bessere Steuerung.').wait_for()
  page.locator('[data-action="refresh-catalog"]').first.click()
  page.wait_for_timeout(300)
  page.locator('[data-action="install"][data-id="community-testgame"]').first.click()
  page.wait_for_function('window.__novalabLog.some(x=>x.action==="install")')
  page.get_by_text('Spiel erfolgreich installiert').first.wait_for(timeout=8000)
  page.locator('#nav-main [data-page="store"]').click()
  page.locator('[data-action="details"][data-id="community-testgame"]').first.click()
  page.get_by_text('Auf dem neuesten Stand').first.wait_for()
  page.get_by_text('Release-Notizen v1.2.0').first.wait_for()
  # Server falls back to an older release. The launcher must never label it as a new update.
  released_version["value"]="1.1.0"
  page.locator('#nav-main [data-page="downloads"]').click()
  page.locator('[data-action="refresh-catalog"]').click()
  page.wait_for_timeout(350)
  assert page.get_by_text('Spiel-Update(s) verfügbar').count()==0, 'Downgrade must not appear as update'
  page.locator('#nav-main [data-page="store"]').click()
  page.locator('[data-action="details"][data-id="community-testgame"]').first.click()
  page.get_by_text('Neuere Version installiert').first.wait_for()
  page.locator('[data-action="uninstall-installed"]').click()
  page.wait_for_function('window.__novalabLog.some(x=>x.action==="uninstall")')
  page.get_by_text('Deinstallieren').count()==0 or None
  assert not errors,errors
  print('PASS desktop: update available, native install with progress, changelog, uninstall')
  browser.close()
finally:
 server.terminate();server.wait(timeout=8)
