"""Regression tests for NovaLab Website1 (mocked API: no real admin or project writes)."""
import asyncio
import json
from urllib.parse import urlparse
from playwright.async_api import async_playwright

URL="http://127.0.0.1:4173/"
PROJECTS=[
 {"id":"novalab-code","title":"NovaLab Code","summary":"Coding lernen","description":"Codekurse","category":"coding","status":"Beta","link":"#code","cover":"./assets/site-code.svg","gallery":[],"video":"","tags":["Python"],"featured":True},
 {"id":"novalab-launcher","title":"NovaLab Launcher","summary":"Desktop Downloads","description":"Windows Apps","category":"games","status":"Early Access","link":"https://github.com/akraniss05/NovaLab-Website1/releases/tag/novalab-launcher-v0.8-alpha","cover":"./assets/site-launcher.svg","gallery":[],"video":"","tags":["Windows"],"featured":False},
 {"id":"my-new-project","title":"NovaLab Experiment","summary":"Ein neues Projekt","description":"In Arbeit","category":"tools","status":"In Entwicklung","link":"./index.html","cover":"./assets/site-hero.svg","gallery":[],"video":"","tags":["Design"],"featured":True}
]

async def run():
 saved=[dict(x) for x in PROJECTS]
 published=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
  page=await browser.new_page(viewport={"width":1350,"height":900})
  errors=[]
  page.on("pageerror",lambda error:errors.append(str(error)))
  async def mock_api(route):
   nonlocal saved
   req=route.request
   path=urlparse(req.url).path.split("/novalab-site-api")[-1]
   headers={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,PUT,OPTIONS","content-type":"application/json"}
   if req.method=="OPTIONS":
    await route.fulfill(status=204,headers=headers,body="")
    return
   if path=="/projects" and req.method=="GET":data={"projects":saved}
   elif path=="/projects" and req.method=="PUT":
    body=json.loads(req.post_data)
    saved=body["projects"]
    published.append(saved)
    data={"ok":True,"count":len(saved)}
   elif path=="/login":data={"token":"test-only-token","username":"tester"}
   elif path=="/me":data={"username":"tester","role":"admin"}
   elif path=="/media":data={"url":"https://example.com/test-upload.png"}
   elif path=="/change-password":data={"ok":True}
   elif path=="/logout":data={"ok":True}
   else:data={"error":"Unexpected mocked route "+path}
   await route.fulfill(status=404 if "error" in data else 200,headers=headers,body=json.dumps(data))
  await page.route("**/functions/v1/novalab-site-api/**",mock_api)
  await page.goto(URL+"#projects",wait_until="domcontentloaded")
  await page.locator("#projectGrid .project-card").filter(has_text="NovaLab Experiment").wait_for()
  assert await page.locator("#projectGrid .project-card").count()==3
  await page.locator("#projectSearch").fill("Experiment")
  assert await page.locator("#projectGrid .project-card").count()==1
  await page.locator("#projectSearch").fill("")
  await page.locator("#filters [data-category='coding']").click()
  assert await page.locator("#projectGrid .project-card").count()==1
  await page.goto(URL+"#project/novalab-code",wait_until="domcontentloaded")
  await page.locator(".detail-cover img").wait_for()
  assert await page.locator(".detail-cover img").get_attribute("src")=="./assets/site-code.svg"
  await page.goto(URL+"#project/novalab-launcher",wait_until="domcontentloaded")
  await page.locator("#projectDetail a[href*='releases/tag/novalab-launcher-v0.8-alpha']").wait_for()
  await page.goto(URL+"#project/my-new-project",wait_until="domcontentloaded")
  await page.locator("#projectDetail a[href='./index.html']").wait_for()
  await page.goto(URL+"#home",wait_until="domcontentloaded")
  await page.locator("#featuredGrid .project-card").filter(has_text="NovaLab Experiment").wait_for()
  assert await page.locator("#featuredGrid .project-card").count()==2
  await page.goto(URL+"#admin",wait_until="domcontentloaded")
  await page.locator("#loginUsername").fill("tester")
  await page.locator("#loginPassword").fill("a-password")
  await page.locator("#loginButton").click()
  await page.locator("#adminDashboard").wait_for(state="visible")
  assert await page.locator("#dashboardProjects").inner_text()=="3"
  await page.locator("#adminRows .admin-row").filter(has_text="NovaLab Launcher").get_by_role("button",name="Bearbeiten").click()
  assert "releases/tag/novalab-launcher-v0.8-alpha" in await page.locator("#fLink").input_value()
  await page.locator("#fSummary").fill("Aktualisiert ohne Zwischenspeichern")
  await page.locator("#fFeatured").check()
  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  assert published
  item=next(x for x in published[-1] if x["id"]=="novalab-launcher")
  assert item["summary"]=="Aktualisiert ohne Zwischenspeichern" and item["featured"] is True
  await page.goto(URL+"#home",wait_until="domcontentloaded")
  await page.locator("#featuredGrid .project-card").filter(has_text="NovaLab Launcher").wait_for()
  assert await page.locator("#featuredGrid .project-card").count()==3
  await page.goto(URL+"#admin",wait_until="domcontentloaded")
  await page.locator("#adminRows .admin-row").filter(has_text="NovaLab Code").get_by_role("button",name="Bearbeiten").click()
  await page.locator("#fCoverFile").set_input_files({"name":"invalid.gif","mimeType":"image/gif","buffer":b"GIF89a"})
  await page.locator("#projectForm button[type='submit']").click()
  await page.get_by_text("Nur PNG/JPG/WebP",exact=False).wait_for()
  assert len(published)==1
  # New project, unsaved form and image upload through a mocked server.
  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("NovaLab QA Projekt")
  await page.locator("#fSummary").fill("Neues Projekt mit Bild")
  await page.locator("#fLink").fill("./index.html")
  await page.locator("#fCoverFile").set_input_files({"name":"test.png","mimeType":"image/png","buffer":b"test-png"})
  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  item=next(x for x in published[-1] if x["title"]=="NovaLab QA Projekt")
  assert item["cover"]=="https://example.com/test-upload.png"
  assert item["link"]=="./index.html"
  assert await page.locator("#dashboardProjects").inner_text()=="4"
  # Deleted projects stay removed after a simulated successful publication.
  page.once("dialog",lambda dialog:asyncio.create_task(dialog.accept()))
  await page.locator("#adminRows .admin-row").filter(has_text="NovaLab Experiment").get_by_role("button",name="Löschen").click()
  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  assert all(x["id"]!="my-new-project" for x in published[-1])
  assert await page.locator("#dashboardProjects").inner_text()=="3"
  await page.locator("#signOut").click()
  await page.locator("#adminLogin").wait_for(state="visible")
  # Password change clears the session and displays the login screen.
  await page.locator("#loginUsername").fill("tester")
  await page.locator("#loginPassword").fill("a-password")
  await page.locator("#loginButton").click()
  await page.locator("#adminDashboard").wait_for(state="visible")
  await page.locator(".studio-password-settings > summary").click()
  await page.locator("#currentAdminPassword").fill("old-password")
  await page.locator("#newAdminPassword").fill("new-password-long-enough")
  await page.locator("#repeatAdminPassword").fill("new-password-long-enough")
  await page.locator("#changePasswordButton").click()
  await page.locator("#adminLogin").wait_for(state="visible")
  await page.goto(URL+"#%E0%A4%A",wait_until="domcontentloaded")
  assert await page.locator("[data-page='home']").is_visible()
  assert not errors,"Website JavaScript errors: "+str(errors)
  await browser.close()
  print("OK: search, filters, project details, relative assets, featured homepage, admin publish, upload, delete, logout, password change, file validation and malformed URLs")

asyncio.run(run())
