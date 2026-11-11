'use strict';
/**
 * Real Electron-renderer smoke test, not a mockup.
 * Executed by xvfb on GitHub Actions; screenshots are retained as CI artifacts.
 * No account registration, backend writes, installs or releases are performed.
 */
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {_electron:electron}=require('playwright');

(async()=>{
 const output=path.resolve(__dirname,'screenshots');
 await fs.mkdir(output,{recursive:true});
 let app;
 try {
  app=await electron.launch({
   args:['.','--no-sandbox'],
   cwd:path.resolve(__dirname,'..'),
   timeout:120000,
   env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'0'}
  });
  const page=await app.firstWindow();
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#featuredGrid .project-card').first().waitFor({timeout:30000});
  assert.ok((await page.locator('#featuredGrid .project-card').count())>0,'must display real bundled catalog entries');
  assert.match(await page.locator('.hero-caption').innerText(),/JETZT VERFÜGBAR|PROJEKTSTATUS/,'featured caption must reflect actual featured product');
  assert.doesNotMatch(await page.locator('.hero-counter').innerText(),/01\s*\/\s*04/,'placeholder carousel counter must be removed');
  assert.ok((await page.locator('#libraryCount').innerText()).length>0);
  await page.screenshot({path:path.join(output,'01-home.png'),animations:'disabled',fullPage:false});

  // Ctrl+K invokes real global search, which must open Store.
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('#globalSearch').evaluate(e=>document.activeElement===e),true);
  await page.locator('#globalSearch').fill('Orbit Dash');
  await page.locator('#page-discover').waitFor({state:'visible'});
  const results=await page.locator('#discoverGrid .project-card').count();
  assert.equal(results,1,'real filter must find exactly the bundled Orbit Dash');
  await page.screenshot({path:path.join(output,'02-store-search.png'),animations:'disabled'});

  // Add non-installed item to local collection. No remote backend mutation.
  await page.locator('#discoverGrid [data-action="details"]').first().click();
  await page.locator('#detailsOverlay').waitFor({state:'visible'});
  await page.locator('#detailsOverlay [data-action="library-toggle"]').click();
  await page.locator('#detailsOverlay .details-close').click();
  await page.locator('[data-page="library"]').first().click();
  await page.locator('#page-library').waitFor({state:'visible'});
  const libraryCard=page.locator('#libraryGrid .project-card');
  assert.ok(await libraryCard.count()>=1,'user-saved app must be shown in library');
  assert.equal(await page.locator('#libraryCount').innerText(),'1','saved but not installed item is part of the library');
  await page.locator('#page-library [data-action="library-mode"][data-id="not-installed"]').click();
  assert.ok(await libraryCard.count()>=1,'user-saved non-installed game must appear in filter');
  await page.screenshot({path:path.join(output,'03-library.png'),animations:'disabled'});

  await page.locator('[data-page="downloads"]').first().click();
  await page.locator('#page-downloads').waitFor({state:'visible'});
  assert.equal(await page.locator('#topDownloadsCount').isVisible(),false);
  await page.screenshot({path:path.join(output,'04-downloads-idle.png'),animations:'disabled'});

  await page.setViewportSize({width:1024,height:768});
  await page.locator('[data-page="home"]').first().click();
  await page.screenshot({path:path.join(output,'05-compact.png'),animations:'disabled'});
  const rect=await page.locator('#globalSearch').boundingBox();
  assert.ok(rect && rect.width>80,'compact search must remain reachable');
  await page.setViewportSize({width:900,height:620});
  const compactBox=await page.locator('.window-controls').boundingBox();
  assert.ok(compactBox && compactBox.x+compactBox.width<=901,'window controls must fit minimum supported launcher width');
  const compactSearch=await page.locator('#globalSearch').boundingBox();
  assert.ok(compactSearch && compactSearch.width>70,'global search must remain usable at 900px');
  await page.screenshot({path:path.join(output,'06-minimum-window.png'),animations:'disabled'});
  await page.locator('[data-page="account"]').first().click();
  await page.locator('#page-account').waitFor({state:'visible'});
  assert.ok(await page.locator('#loginForm').isVisible(),'login form must be reachable');
  assert.ok(await page.locator('#registerForm').isVisible(),'registration must remain available');
  assert.deepEqual(errors,[],'renderer must not raise JavaScript exceptions');
  console.log('PASS: real Electron startup, 5 screenshots, search, local library, downloads, compact layout and account forms');
 } finally {if(app)await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
