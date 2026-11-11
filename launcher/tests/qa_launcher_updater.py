"""Real Chromium test of the desktop Tauri updater UI; native functions are mocked.
The separate Windows CI job tests the installer upgrade, not this browser mock."""
import subprocess,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen(["python","-m","http.server","4798","--bind","127.0.0.1","--directory",str(ROOT)],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"],
            **({"executable_path":"/usr/bin/chromium"} if os.path.exists("/usr/bin/chromium") else {}))
        page=browser.new_page(viewport={"width":1280,"height":900})
        errors=[]
        page.on("pageerror",lambda e: errors.append(str(e)))
        page.on("dialog",lambda dialog: dialog.accept())
        page.add_init_script("""(() => {
          window.__upgradeCalls=0;
          let onProgress=()=>{};
          window.novalab={
            pickGame:async()=>({cancelled:true}),installedGames:async()=>([]),
            checkLauncherUpdate:async()=>({
              available:true,version:'0.6.0',currentVersion:'0.5.0',bytes:3800000,
              notes:'Sichere Update-Installation, Fortschrittsanzeige und bessere Fehlerbehandlung'
            }),
            onLauncherUpdateProgress:(callback)=>{onProgress=callback;return Promise.resolve(()=>{});},
            onInstallProgress:()=>Promise.resolve(()=>{}),
            onDownloadProgress:()=>Promise.resolve(()=>{}),
            installLauncherUpdate:async()=>{
              window.__upgradeCalls+=1;
              onProgress({status:'downloading',percent:50,message:'Installer wird geladen'});
              await new Promise(resolve=>setTimeout(resolve,120));
              onProgress({status:'verifying',percent:100,message:'SHA-256 wird geprüft'});
              return {ok:true,version:'0.6.0',message:'Installer gestartet'};
            }
          };
        })();""")
        page.route("**/functions/v1/**",lambda route:route.fulfill(status=200,
            content_type="application/json",body='{"games":[],"excludedIds":[]}'))
        page.goto("http://127.0.0.1:4798/",wait_until="domcontentloaded")
        page.wait_for_function("document.documentElement.dataset.appReady==='yes'")
        page.locator("#sidebar-settings").click()
        page.get_by_text("Launcher-Updates",exact=True).wait_for()
        page.locator('[data-action="launcher-check-update"]').click()
        page.get_by_text("Version 0.6.0",exact=False).first.wait_for()
        assert page.get_by_text("Sichere Update-Installation",exact=False).count()>0
        page.locator('[data-action="launcher-install-update"]').click()
        page.wait_for_function("window.__upgradeCalls === 1")
        page.get_by_text("SHA-256 wird geprüft",exact=False).first.wait_for()
        assert not errors,errors
        page.screenshot(path=str(ROOT/"tests"/"qa-updater-desktop.png"))
        print("PASS updater UI: finds newer release, shows notes, asks confirmation, tracks download and SHA-256 progress")
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=5)
    except subprocess.TimeoutExpired:server.kill()
