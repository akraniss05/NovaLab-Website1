import subprocess,time,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; PORT=4790
server=subprocess.Popen(['python','-m','http.server',str(PORT),'--bind','127.0.0.1','--directory',str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 time.sleep(1.2)
 with sync_playwright() as p:
  b=p.chromium.launch(headless=True, args=['--no-sandbox'])
  for viewport,name in [({'width':390,'height':844},'mobile'),({'width':1440,'height':900},'desktop')]:
   page=b.new_page(viewport=viewport,device_scale_factor=1,has_touch=name=='mobile',is_mobile=name=='mobile')
   problems=[]
   page.on('pageerror',lambda e:problems.append(str(e)))
   def route_handler(route):
    url=route.request.url
    endpoint=url.split('?')[0].split('/')[-1]
    method=route.request.method
    data=None
    if endpoint=='catalog':
     if 'studio' in url:
      data={'games':[{'id':'community-testgame','title':'Test Game Online','summary':'Serverbeispiel','description':'Ein online veröffentlichtes Spiel','genre':'Arcade','status':'Veröffentlicht','developer':'NovaLab Studios','cover':'','release':{'version':'1.0.0','url':'https://example.com/game.zip','sha256':'a'*64,'format':'windows','entry':'Game.exe','size':1234}}]}
     else:data={'games':[]}
    elif endpoint=='register':data={'success':True,'message':'Registriert'}
    elif endpoint=='login':data={'token':'a'*64,'account':{'username':'DemoAdmin','role':'admin','mustChangePassword':False}}
    elif endpoint=='me':data={'account':{'username':'DemoAdmin','role':'admin','mustChangePassword':False}}
    elif endpoint=='staff':data={'accounts':[{'id':'1','username':'DemoAdmin','role':'admin'},{'id':'2','username':'DemoDev','role':'user'}]}
    elif endpoint=='role':data={'success':True,'account':{'username':'DemoDev','role':'developer'}}
    elif endpoint=='list':data={'games':[]}
    elif endpoint=='save':data={'success':True,'game':{'id':'community-mein-spiel','title':'Mein neues Spiel'}}
    elif endpoint=='detail':data={'game':{'id':'community-mein-spiel','title':'Mein neues Spiel','genre':'Arcade','summary':'Tolles Testspiel','description':'Mein Testspiel mit vielen Features und Funktionen.','created_by':'1','status':'In Entwicklung','visibility':'draft'},'media':[],'versions':[]}
    elif endpoint=='logout':data={'success':True}
    elif endpoint=='change-password':data={'success':True}
    elif endpoint in ['publish','upload-build','media','media-remove']:data={'success':True}
    else:data={'success':True}
    route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
   page.route('**/functions/v1/**',route_handler)
   page.goto(f'http://127.0.0.1:{PORT}/',wait_until='networkidle')
   page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
   page.locator('button.avatar-button').click()
   page.get_by_text('Anmelden & Registrieren').wait_for()
   page.locator('[data-action="auth-mode"][data-value="register"]').click()
   page.locator('input[name=username]').fill('NeuerUser')
   page.locator('input[name=password]').fill('EinGutesPasswort1234')
   page.locator('input[name=confirm]').fill('EinGutesPasswort1234')
   page.locator('#auth-form button[type=submit]').click()
   page.get_by_text('Registrierung erfolgreich').first.wait_for()
   page.locator('input[name=username]').fill('DemoAdmin')
   page.locator('input[name=password]').fill('MockPassword-ONLY-NeverReal')
   page.locator('#auth-form button[type=submit]').click()
   page.get_by_text('Willkommen, DemoAdmin').wait_for()
   page.locator('#app-content [data-page="staff"]').first.click()
   page.get_by_text('Team & Berechtigungen').wait_for()
   page.locator('[data-staff-select="DemoDev"]').select_option('developer')
   page.on('dialog',lambda d:d.accept())
   page.locator('[data-action="assign-role"][data-id="DemoDev"]').click()
   page.wait_for_timeout(200)
   page.locator('#app-content [data-page="studio"]').first.click()
   page.get_by_text('NovaLab Developer Studio').wait_for()
   page.locator('[data-action="studio-new"]').first.click()
   page.locator('#studio-game-form [name="id"]').first.fill('community-mein-spiel')
   page.locator('#studio-game-form [name="title"]').first.fill('Mein neues Spiel')
   page.locator('#studio-game-form [name="summary"]').first.fill('Ein tolles Testspiel')
   page.locator('#studio-game-form [name="description"]').first.fill('Dieses Testspiel enthält Abenteuer, Quests und ein tolles Gameplay.')
   page.locator('#studio-game-form button[type=submit]').click()
   page.wait_for_timeout(350)
   page.get_by_text('Spielversionen & Updates').first.wait_for()
   page.screenshot(path=str(ROOT/'tests'/f'qa-{name}.png'),full_page=True)
   if problems:raise AssertionError((name,problems))
   print('PASS',name,'real browser registration/login/admin/studio/navigation')
   page.close()
  b.close()
finally:
 server.terminate();server.wait(timeout=8)
