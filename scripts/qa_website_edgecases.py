"""Website v16 edge cases: long IDs, repeated gallery staging, category limits and UUID catalog revisions.

Uses only mocked API responses; never logs into production.
"""
import asyncio
import json
from urllib.parse import urlparse
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:4173/"
LONG_ID = "a" * 70
REVISION_1 = "11111111-1111-4111-8111-111111111111"
REVISION_2 = "22222222-2222-4222-8222-222222222222"
PROJECT = {
 "id": LONG_ID, "title": "Lang-ID Projekt", "summary": "Projekt mit siebzig Zeichen",
 "description": "Prüft die vollständige ID", "category": "tools", "status": "Beta",
 "link": "#projects", "cover": "./assets/site-launcher.svg", "gallery": [],
 "video": "", "tags": [], "featured": True
}

async def run():
 state = {"projects": [PROJECT], "revision": REVISION_1, "uploads": [], "writes": []}
 async with async_playwright() as playwright:
  browser = await playwright.chromium.launch(headless=True, args=["--no-sandbox","--disable-dev-shm-usage"])
  page = await browser.new_page(viewport={"width": 1280,"height": 900})
  errors = []
  page.on("pageerror", lambda error: errors.append(str(error)))
  async def mock(route):
   request = route.request
   path = urlparse(request.url).path.split("/novalab-site-api")[-1]
   headers = {"access-control-allow-origin":"*", "access-control-allow-headers":"authorization,content-type",
              "access-control-allow-methods":"GET,POST,PUT,OPTIONS", "content-type":"application/json"}
   if request.method == "OPTIONS":
    await route.fulfill(status=204, headers=headers, body="")
    return
   status = 200
   if path == "/projects" and request.method == "GET":
    data = {"projects": state["projects"], "revision": state["revision"]}
   elif path == "/projects" and request.method == "PUT":
    payload = json.loads(request.post_data)
    if payload.get("revision") != state["revision"]:
     status = 409
     data = {"error": "Version conflict"}
    else:
     state["projects"] = payload["projects"]
     state["writes"].append(payload)
     state["revision"] = REVISION_2
     data = {"count": len(state["projects"]), "ok": True, "revision": REVISION_2}
   elif path == "/login":
    data = {"username": "tester", "token": "mock-qa-token"}
   elif path == "/me":
    data = {"username": "tester", "role": "admin"}
   elif path == "/media":
    new_url = "https://example.com/qa-upload-" + str(len(state["uploads"])+1) + ".png"
    state["uploads"].append(new_url)
    data = {"url": new_url}
   elif path == "/logout":
    data = {"ok": True}
   else:
    status = 404
    data = {"error": "Unexpected endpoint: "+path}
   await route.fulfill(status=status, headers=headers, body=json.dumps(data))

  await page.route("**/functions/v1/novalab-site-api/**", mock)
  await page.goto(URL + "#project/" + LONG_ID, wait_until="domcontentloaded")
  await page.locator("#projectDetail h1").filter(has_text="Lang-ID Projekt").wait_for()
  assert await page.locator("#projectDetail h1").inner_text() == "Lang-ID Projekt"
  await page.goto(URL + "#admin", wait_until="domcontentloaded")
  await page.locator("#loginUsername").fill("tester")
  await page.locator("#loginPassword").fill("test-password")
  await page.locator("#loginButton").click()
  await page.locator("#adminDashboard").wait_for(state="visible")

  await page.locator("#adminRows .admin-row").filter(has_text="Lang-ID Projekt").get_by_role("button",name="Bearbeiten").click()
  assert await page.locator("#fId").input_value() == LONG_ID, "70-character backend ID was truncated"
  await page.locator("#fSummary").fill("Neuer Projekttitel in UUID-Version")
  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  assert state["projects"][0]["id"] == LONG_ID
  assert len(state["projects"]) == 1

  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("Galerie mit zwei Schritten")
  await page.locator("#fSummary").fill("Beide Uploads bleiben erhalten")
  for name, expected in (("first.png", "1 Datei"), ("second.png", "2 Datei")):
   await page.locator("#fGalleryFiles").set_input_files({"name":name,"mimeType":"image/png","buffer":b"FAKE-MOCKED-PNG"})
   await page.locator("#projectForm button[type='submit']").click()
   assert expected in await page.locator("#queuedUploadsInfo").inner_text(), "Staged gallery was lost"

  await page.locator("#publish").click()
  await page.get_by_text("Erfolgreich veröffentlicht",exact=False).wait_for()
  new_project = next(p for p in state["projects"] if p["title"] == "Galerie mit zwei Schritten")
  assert len(new_project["gallery"]) == 2, new_project
  assert len(state["uploads"]) == 2, "Images were uploaded more than once"

  await page.locator("#newProject").click()
  await page.locator("#fTitle").fill("Zu viele Bilder")
  await page.locator("#fSummary").fill("Darf nicht hochgeladen werden")
  await page.locator("#fGalleryFiles").set_input_files([
    {"name":f"image-{i}.png","mimeType":"image/png","buffer":b"FAKE-MOCKED-PNG"} for i in range(16)
  ])
  await page.locator("#projectForm button[type='submit']").click()
  await page.get_by_text("Maximal 15 Galeriebilder", exact=False).wait_for()
  assert len(state["uploads"]) == 2
  assert not errors, "JavaScript errors: " + str(errors)
  await browser.close()
  print("OK: 70-character IDs, UUID revision, two-stage gallery, 15-image limit and no browser errors")

asyncio.run(run())
