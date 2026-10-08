const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const catalog=require('../fixtures/studio-catalog.json');
async function mount(page){
 const root=path.resolve('custom_components/display_studio/www/runtime');
 const config=JSON.parse(JSON.stringify(catalog.presets[0].layout));config.enabled=true;
 const state={version:'1.0.0',revision:1,view:'dashboard',layout:{config,values:{},timezone:'Europe/Berlin',sun:{elevation:25,azimuth:140},now:new Date().toISOString()},message:null};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://browser.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  if(name==='state'){
   await new Promise(resolve=>setTimeout(resolve,150));
   return route.fulfill(state.offline?{status:503,body:''}:{contentType:'application/json',body:JSON.stringify(state)});
  }
  return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(path.join(root,name))});
 });
 await page.setViewportSize({width:1920,height:1080});await page.goto('http://browser.test/index.html');
 return {state,errors};
}
test('standalone display renders and updates saved views, notification and local clock without LG',async({page})=>{
 const {state,errors}=await mount(page);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 const first=await page.locator('#studio-scene').screenshot();expect(first.length).toBeGreaterThan(10000);
 state.message={title:'Türklingel <script>',message:'Home Assistant',layout:'overlay'};state.revision++;
 await expect(page.locator('#studio-message .lg-message')).toContainText('Türklingel <script>');
 expect(await page.evaluate(()=>!!window.webOS)).toBe(false);
 state.view='media_view';state.message=null;state.revision++;
 await expect(page.locator('#studio-message .lg-message')).toHaveCount(0);
 await expect(page.locator('#studio-scene .lg-media')).toBeVisible();
 state.message={title:'Vollbild',message:'Meldung',layout:'fullscreen'};state.revision++;
 await expect(page.locator('#studio-scene .lg-message')).toContainText('Vollbild');
 expect(errors).toEqual([]);
});
test('standalone offline display removes private widgets and recovers',async({page})=>{
 const {state,errors}=await mount(page);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 state.offline=true;await page.waitForTimeout(350);await page.clock.install();await page.clock.fastForward(32000);
 await expect(page.locator('#studio-scene .lg-widget')).toHaveCount(0);
 await expect(page.locator('#studio-status')).toContainText('nicht erreichbar');
 state.offline=false;await page.clock.fastForward(3500);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 expect(errors).toEqual([]);
});
