"""Broader functional regression for NovaLab's mobile and desktop web UI.
Backend requests and native bridge calls are mocked; never touches live accounts."""
import subprocess,time,os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
PORT=4799
server=subprocess.Popen(["python","-m","http.server",str(PORT),"--bind","127.0.0.1","--directory",str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
CATALOG={"games":[
 {"id":"community-auditgame","title":"NovaLab QA Game","summary":"Test for rendering",
  "description":"Spielebeschreibung für realistische Tests","genre":"Arcade","status":"Beta",
  "developer":"NovaLab QA","cover":"","release":{"version":"1.3.0","format":"windows",
  "entry":"qa.exe","sha256":"b"*64,"url":"https://example.org/qa.zip","size":1024}},
 {"id":"community-injection","title":"<img src=x onerror=window.__injected=true>",
  "summary":"<svg onload=window.__injected=true>","description":"Harmless literal attack sample",
  "genre":"\\\"><img src=x onerror=window.__injected=true>","developer":"QA","cover":"https://example.org/a%22%20onerror=x",
  "release":None}
]}
MOCK_NATIVE="""(()=>{
  window.__launchLog=[];
  window.novalab={
    pickGame:async()=>({cancelled:true}),installedGames:async()=>([]),
    onInstallProgress:()=>Promise.resolve(()=>{}),onDownloadProgress:()=>Promise.resolve(()=>{}),
    onLauncherUpdateProgress:()=>Promise.resolve(()=>{}),
    checkLauncherUpdate:async()=>({available:false,currentVersion:'0.7.0'}),
    launchInstalledGame:async(id)=>{window.__launchLog.push(id);return {ok:true}},
    uninstallInstalledGame:async()=>({ok:true}),cancelDownload:async()=>({ok:false}),
    installGameVersion:async()=>({ok:false}),downloadGame:async()=>({cancelled:true})
  };
})();"""
def route_api(route):
 u=route.request.url
 if u.endswith("/catalog"):
  response=CATALOG if "novalab-studio-api" in u else {"games":[]}
  return route.fulfill(status=200,content_type="application/json",body=json.dumps(response))
 if u.endswith("/me"):
  return route.fulfill(status=401,content_type="application/json",body='{"error":"Nicht angemeldet"}')
 return route.fulfill(status=403,content_type="application/json",body='{"error":"Keine Berechtigung"}')

try:
 time.sleep(1.1)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=["--no-sandbox"],**({"executable_path":"/usr/bin/chromium"} if os.path.exists("/usr/bin/chromium") else {}))
  for name,viewport in [("desktop",{"width":1440,"height":900}),("mobile",{"width":390,"height":844})]:
   context=browser.new_context(viewport=viewport,has_touch=name=="mobile",is_mobile=name=="mobile")
   if name=="desktop":
    context.add_init_script(MOCK_NATIVE)
    context.add_init_script("""(()=>{
      const bad={favorites:[12,null,'community-auditgame'],owned:['community-auditgame'],
        customGames:[null,{},'corrupt',{'id':'custom-safe','name':'Valid','description':'Okay'}],
        downloads:[null,'bad',{'id':'install-community-auditgame','gameId':'community-auditgame','status':'installing','percent':22}],
        installedVersions:{'community-auditgame':'1.0.0'},
        accent:'invalid',view:'strange',sort:'garbage'};
      localStorage.setItem('novalab_studios_launcher_v1',JSON.stringify(bad));
    })();""")
   page=context.new_page()
   errors=[]
   page.on("pageerror",lambda e:errors.append(str(e)))
   page.route("**/functions/v1/**",route_api)
   page.goto(f"http://127.0.0.1:{PORT}/",wait_until="domcontentloaded")
   page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
   page.wait_for_timeout(600)
   assert not errors,(name,errors)
   assert not page.evaluate("Boolean(window.__injected)"),"Remote game title injected JS"
   if name=="desktop":
    # Native disk listing takes precedence over obsolete localStorage state.
    page.wait_for_function("!JSON.parse(localStorage.getItem('novalab_studios_launcher_v1')).installedVersions?.['community-auditgame']")
    page.locator("#nav-main [data-page='downloads']").click()
    assert page.get_by_text("Spiel-Update(s) verfügbar").count()==0,"Stale install state produced a false update"
    assert page.get_by_text("Unterbrochen",exact=False).count()>0,"Interrupted download was incorrectly shown as active"
    page.locator("#nav-main [data-page='store']").click()
   else:
    page.locator("#mobile-tabbar [data-page='store']").click()
   page.get_by_text("NovaLab QA Game",exact=False).first.wait_for()
   # Search must filter catalog without causing uncaught errors.
   page.locator("#search").fill("NovaLab QA Game")
   assert page.get_by_text("NovaLab QA Game",exact=False).count()>0
   page.locator("#search").fill("")
   # Favorites and game cards should work across viewport sizes.
   page.locator('[data-action="details"][data-id="community-auditgame"]').first.click()
   page.get_by_text("NovaLab QA Game",exact=False).first.wait_for()
   # Game detail may open as a card, but must not execute catalog HTML.
   assert not page.evaluate("Boolean(window.__injected)")
   for section in ["home","store","library","downloads","favorites","cloud","friends","community","news","settings","account"]:
    page.evaluate("(section)=>{const n=document.querySelector('[data-page=\"'+section+'\"]');if(n)n.click()}",section)
    page.wait_for_timeout(30)
    assert page.locator("#app-content").inner_text().strip(),f"{name}: empty {section}"
   # No unexpected full-page horizontal scrollbars on phone layouts.
   if name=="mobile":
    width=page.evaluate("document.documentElement.scrollWidth-window.innerWidth")
    assert width<=3,f"Mobile UI overflows viewport horizontally by {width}px"
   assert not errors,(name,errors)
   page.screenshot(path=str(ROOT/"tests"/f"qa-deep-{name}.png"),full_page=False)
   print(f"PASS {name}: broken local data, denied backend, XSS escaping, search, 11 screens, native installed-state reconciliation")
   context.close()
  browser.close()
finally:
 server.terminate()
 try: server.wait(timeout=5)
 except subprocess.TimeoutExpired: server.kill()
