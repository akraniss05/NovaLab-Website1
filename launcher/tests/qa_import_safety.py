"""Real Chromium regression for backup import and active download protection."""
import json,subprocess,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PORT=4796
proc=subprocess.Popen(["python","-m","http.server",str(PORT),"--bind","127.0.0.1","--directory",str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 time.sleep(1)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=["--no-sandbox"],**({"executable_path":"/usr/bin/chromium"} if os.path.exists("/usr/bin/chromium") else {}))
  ctx=browser.new_context(viewport={"width":390,"height":844},has_touch=True,is_mobile=True)
  ctx.add_init_script("""localStorage.setItem('novalab_studios_launcher_v1',JSON.stringify({
    downloads:[{id:'install-community-auditgame',gameId:'community-auditgame',name:'QA',status:'installing',percent:10}],
    favorites:[],customGames:[],owned:[],accent:'pink'}));""")
  page=ctx.new_page()
  problems=[]
  page.on("pageerror",lambda e:problems.append(str(e)))
  page.on("dialog",lambda d:d.accept())
  page.route("**/functions/v1/**",lambda r:r.fulfill(status=200,content_type="application/json",body='{"games":[]}'))
  page.goto(f"http://127.0.0.1:{PORT}/",wait_until="domcontentloaded")
  page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
  page.locator("#mobile-tabbar [data-page='downloads']").click()
  assert page.locator('[data-action="remove-download"][data-id="install-community-auditgame"]').count()==0
  page.evaluate("""()=>{
    const b=document.createElement('button');b.dataset.action='remove-download';
    b.dataset.id='install-community-auditgame';b.id='synthetic-remove';document.body.append(b);b.click();b.remove();
  }""")
  active=page.evaluate("JSON.parse(localStorage.getItem('novalab_studios_launcher_v1')).downloads")
  assert len(active)==1 and active[0]["status"]=="installing","Active installation was removed"

  page.evaluate("document.querySelector('[data-page=manage]').click()")
  backup={"version":1,"customGames":[
    {"id":"injected","name":"Bad","description":"X"},
    {"id":"custom-safe","name":"Good","description":"Hello","artUrl":"javascript:alert(1)"},
    None],
   "favorites":[12,None,"custom-safe"],"owned":[None,"custom-safe"],
   "chat":[{"text":"hello","created":10},None],
   "accent":"invalid-color","gameScores":{}}
  with page.expect_file_chooser() as fc:page.locator('[data-action="import"]').first.click()
  fc.value.set_files({"name":"backup.json","mimeType":"application/json","buffer":json.dumps(backup).encode()})
  page.wait_for_function("JSON.parse(localStorage.getItem('novalab_studios_launcher_v1')).customGames.some(g=>g.id==='custom-safe')")
  state=page.evaluate("JSON.parse(localStorage.getItem('novalab_studios_launcher_v1'))")
  assert len(state["customGames"])==1 and state["customGames"][0]["id"]=="custom-safe"
  assert state["customGames"][0]["artUrl"]==""
  assert state["favorites"]==["custom-safe"]
  assert state["accent"]=="pink"
  assert not problems,problems
  print("PASS: active install cannot be removed; backup import rejects bad IDs, unsupported URLs, invalid preferences")
  browser.close()
finally:
 proc.terminate()
 try:proc.wait(timeout=5)
 except subprocess.TimeoutExpired:proc.kill()
