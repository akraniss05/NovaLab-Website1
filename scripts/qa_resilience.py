"""Deep Website1 failure-mode tests. No requests reach the real Supabase API."""
import asyncio
import json
from urllib.parse import urlparse
from playwright.async_api import async_playwright

URL="http://127.0.0.1:4173/"
PROJECTS=[
 {"id":"alpha","title":"Alpha Projekt","summary":"Test","description":"Ein Test","category":"coding","status":"Beta","link":"#code","cover":"./assets/site-code.svg","gallery":[],"video":"","tags":[],"featured":True},
 {"id":"beta","title":"Beta Projekt","summary":"Noch ein Test","description":"Details","category":"games","status":"Planung","link":"#games","cover":"./assets/site-games.svg","gallery":[],"video":"","tags":[],"featured":False}
]

async def run():
 state={"online":False,"mediaCalls":0,"failedMedia":False,"writes":[],"revision":"a"*64,"projects":PROJECTS}
 errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
  async def api(route):
   req=route.request
   path=urlparse(req.url).path.split("/novalab-site-api")[-1]
   headers={"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,PUT,POST,OPTIONS"}
   if req.method=="OPTIONS":await route.fulfill(status=204,headers=headers,body="");return
   code=200
   if path=="/projects" and req.method=="GET":
    if state["online"]:data={"projects":state["projects"],"revision":state["revision"]}
    else:code=503;data={"error":"Offline"}
   elif path=="/projects" and req.method=="PUT":
    body=json.loads(req.post_data)
    if body.get("revision")!=state["revision"]:
     code=409;data={"error":"Katalog wurde verändert"}
    else:
     state["projects"]=body["projects"]
     state["writes"].append(body)
     state["revision"]="b"*64
     data={"count":len(state["projects"]),"revision":state["revision"],"ok":True}
   elif path=="/login":data={"token":"mock-token","username":"tester"}
   elif path=="/me":data={"username":"tester","role":"admin"}
   elif path=="/logout":data={"ok":True}
   elif path=="/media":
    state["mediaCalls"]+=1
    if state["mediaCalls"]==2 and not state["failedMedia"]:
     state["failedMedia"]=True;code=503;data={"error":"Temporärer Uploadfehler"}
    else:data={"url":"https://example.com/upload-"+str(state["mediaCalls"])+".png"}
   else:code=404;data={"error":"Unknown mock URL "+path}
   await route.fulfill(status=code,headers=headers,body=json.dumps(data))
  page=await browser.new_page(viewport={"width":1440,"height":900})
  page.on("pageerror",lambda exc:errors.append(str(exc)))
  await page.route("**/functions/v1/novalab-site-api/**",api)
  await page.goto(URL+"#projects",wait_until="domcontentloaded")
  await page.locator("#catalogNotice").wait_for(state="visible")
  await page.goto(URL+"#admin",wait_until="domcontentloaded")
  await page.locator("#loginUsername").fill("tester")
  await page.locator("#loginPassword").fill("password")
  await page.locator("#loginButton").click()
  await page.locator("#adminDashboard").wait_for(state="visible")
  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("Offline Draft")
  await page.locator("#fSummary").fill("Must not publish fallback")
  await page.locator("#publish").click()
  await page.get_by_text("Projektkatalog konnte nicht sicher geladen werden",exact=False).wait_for()
  assert len(state["writes"])==0,"Fallback data was allowed to overwrite live catalog"
  state["online"]=True
  page.once("dialog",lambda dialog:asyncio.create_task(dialog.accept()))
  await page.locator("#reload").click()
  await page.get_by_text("Öffentliche Projekte aus dem Backend neu geladen.",exact=False).wait_for()
  assert await page.locator("#catalogNotice").is_hidden()
  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("Upload Retry Test")
  await page.locator("#fSummary").fill("Two images with an interrupted upload")
  await page.locator("#fGalleryFiles").set_input_files([
   {"name":"first.png","mimeType":"image/png","buffer":b"sample1"},
   {"name":"second.png","mimeType":"image/png","buffer":b"sample2"}
  ])
  await page.locator("#publish").click()
  await page.get_by_text("Temporärer Uploadfehler",exact=False).wait_for()
  assert state["mediaCalls"]==2 and not state["writes"]
  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  assert state["mediaCalls"]==3,"First successful image was uploaded again"
  added=next(x for x in state["writes"][-1]["projects"] if x["title"]=="Upload Retry Test")
  assert len(added["gallery"])==2 and len(set(added["gallery"]))==2
  # Confirm / cancel signout with a dirty draft.
  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("Private Unpublished Project")
  await page.locator("#fSummary").fill("Should disappear on signout")
  await page.locator("#projectForm button[type='submit']").click()
  page.once("dialog",lambda dialog:asyncio.create_task(dialog.dismiss()))
  await page.locator("#signOut").click()
  assert await page.locator("#adminDashboard").is_visible()
  page.once("dialog",lambda dialog:asyncio.create_task(dialog.accept()))
  await page.locator("#signOut").click()
  await page.locator("#adminLogin").wait_for(state="visible")
  assert await page.locator("#projectGrid").get_by_text("Private Unpublished Project").count()==0
  # Check viewport breakpoints, menu, filters and JavaScript exceptions.
  for width in (320,375,390,768,1024,1090,1280,1440):
   mobile=await browser.new_page(viewport={"width":width,"height":800},is_mobile=width<800,has_touch=width<800)
   mobile.on("pageerror",lambda exc:errors.append(str(exc)))
   await mobile.route("**/functions/v1/novalab-site-api/**",api)
   await mobile.goto(URL+"#projects",wait_until="domcontentloaded")
   await mobile.locator("#projectGrid .project-card").first.wait_for()
   dimension=await mobile.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth})")
   assert dimension["page"]<=dimension["viewport"]+2,f"Horizontal overflow at {width}px: {dimension}"
   if width<=1090:
    await mobile.locator("#mobileMenu").click()
    assert await mobile.locator("#mainNav").evaluate("(e)=>e.classList.contains('open')")
    await mobile.keyboard.press("Escape")
    assert not await mobile.locator("#mainNav").evaluate("(e)=>e.classList.contains('open')")
   await mobile.close()
  assert not errors,"Browser JS errors: "+str(errors)
  await browser.close()
  print("OK: API fallback publish block, two-step upload resume, logout draft isolation, 8 viewport widths and mobile menu")

asyncio.run(run())
