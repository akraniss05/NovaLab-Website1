"""QA: temporary HTTP failures must not destroy a valid login session."""
import subprocess,time,os,json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PORT=4877
server=subprocess.Popen(["python","-m","http.server",str(PORT),"--bind","127.0.0.1","--directory",str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
TOKEN="a"*64
try:
 time.sleep(1)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=["--no-sandbox"],**({"executable_path":"/usr/bin/chromium"} if os.path.exists("/usr/bin/chromium") else {}))
  for mode in ["offline","revoked"]:
   context=browser.new_context(viewport={"width":390,"height":844})
   context.add_init_script(f"sessionStorage.setItem('novalab_launcher_session_v4','{TOKEN}')")
   page=context.new_page()
   errors=[]
   page.on("pageerror",lambda e:errors.append(str(e)))
   network={"online":False}
   def respond(route):
    url=route.request.url
    if url.endswith("/me"):
     if mode=="revoked":
      return route.fulfill(status=401,content_type="application/json",body='{"error":"Nicht angemeldet."}')
     if not network["online"]:return route.abort("failed")
     return route.fulfill(status=200,content_type="application/json",
       body=json.dumps({"account":{"username":"SessionTester","role":"user","mustChangePassword":False}}))
    if url.endswith("/catalog"):
     return route.fulfill(status=200,content_type="application/json",body='{"games":[]}')
    return route.fulfill(status=403,content_type="application/json",body='{"error":"Keine Berechtigung"}')
   page.route("**/functions/v1/**",respond)
   page.goto(f"http://127.0.0.1:{PORT}/",wait_until="domcontentloaded")
   page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
   page.wait_for_timeout(700)
   if mode=="offline":
    assert page.evaluate("sessionStorage.getItem('novalab_launcher_session_v4')")==TOKEN,"Transient offline wiped user session"
    network["online"]=True
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.locator("#mobile-tabbar [data-page='account']").click()
    page.get_by_text("Willkommen, SessionTester",exact=False).first.wait_for(timeout=6000)
    assert page.evaluate("sessionStorage.getItem('novalab_launcher_session_v4')")==TOKEN
   else:
    assert page.evaluate("sessionStorage.getItem('novalab_launcher_session_v4')")==None,"Revoked session not cleared"
   assert not errors,(mode,errors)
   print(f"PASS auth recovery: {mode}")
   context.close()
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=4)
 except:server.kill()
