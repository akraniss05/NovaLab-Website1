"""NovaLab backup: importing crafted JSON must not poison browser state."""
import subprocess,time,os,json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen(["python","-m","http.server","4879","--bind","127.0.0.1","--directory",str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 time.sleep(1)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=["--no-sandbox"],**({"executable_path":"/usr/bin/chromium"} if os.path.exists("/usr/bin/chromium") else {}))
  page=browser.new_page(viewport={"width":1280,"height":850})
  errors=[]
  page.on("pageerror",lambda e:errors.append(str(e)))
  page.on("dialog",lambda dialog:dialog.accept())
  page.route("**/functions/v1/**",lambda route:route.fulfill(status=200,content_type="application/json",body='{"games":[],"excludedIds":[]}'))
  page.goto("http://127.0.0.1:4879/",wait_until="domcontentloaded")
  page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
  # Activate local management. No real backend or account needed.
  page.locator('#nav-other [data-page="manage"]').click()
  page.locator('[data-action="import"]').first.wait_for()
  crafted={
    "version":1,"customGames":[
      {"id":"custom-safe","name":"Test Import","description":"Legitimer lokaler Eintrag","genre":"Indie"},
      {"id":"../escape","name":"Ungültig","description":"Soll gefiltert werden"},
      {"id":"custom-evil\" onmouseover=alert(1)","name":"XSS","description":"Nicht speichern"},
      {"id":"custom-broken","name":2,"description":None}
    ],
    "favorites":[None,12,"custom-safe"],"owned":[[],{},"custom-safe"],
    "chat":[None,{"text":"Hi"},{"text":"<img onerror=alert(1)>"}],
    "accent":"nonexistent","view":"invalid","sort":"invalid",
    "downloads":[{"id":"download-stale","gameId":"custom-safe","status":"active"}]
  }
  with page.expect_file_chooser() as chooser:
   page.locator('[data-action="import"]').first.click()
  chooser.value.set_files({"name":"novalab-backup.json","mimeType":"application/json","buffer":json.dumps(crafted).encode()})
  page.wait_for_function("""() => {
    const s=JSON.parse(localStorage.getItem('novalab_studios_launcher_v1')||'{}');
    return s.customGames?.length===1 && s.customGames[0].id==='custom-safe';
  }""",timeout=6000)
  state=page.evaluate("JSON.parse(localStorage.getItem('novalab_studios_launcher_v1'))")
  assert state["accent"]=="pink" and state["view"]=="grid" and state["sort"]=="featured"
  assert state["downloads"]==[]
  assert len(state["customGames"])==1
  assert state["favorites"]==["custom-safe"]
  assert not errors,errors
  print("PASS: corrupt backup normalized, dangerous IDs removed, no JS errors")
  # A too-large JSON file must be rejected without clobbering current data.
  page.locator('[data-page="manage"]').first.click()
  with page.expect_file_chooser() as chooser:
   page.locator('[data-action="import"]').first.click()
  chooser.value.set_files({"name":"huge.json","mimeType":"application/json","buffer":b" "*2_000_010})
  page.wait_for_timeout(350)
  state2=page.evaluate("JSON.parse(localStorage.getItem('novalab_studios_launcher_v1'))")
  assert state2["customGames"]==state["customGames"],"Oversized backup unexpectedly reset user data"
  assert not errors,errors
  print("PASS: oversized backup rejected without overwriting existing data")
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=5)
 except:server.kill()
