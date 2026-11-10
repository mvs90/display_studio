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
  if(name==='telemetry'){
   const report=route.request().postDataJSON();expect(['economy','balanced','quality']).toContain(report.profile);
   return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  }
  if(name==='state'){
   await new Promise(resolve=>setTimeout(resolve,150));
   return route.fulfill(state.offline?{status:503,body:''}:{contentType:'application/json',body:JSON.stringify(state)});
  }
  return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.ttf')?'font/ttf':'text/html',body:fs.readFileSync(name.endsWith('.ttf')?path.join(root,'../../fonts',name):path.join(root,name))});
 });
 await page.setViewportSize({width:1920,height:1080});await page.goto('http://browser.test/index.html');
 return {state,errors};
}
test('standalone display renders and updates saved views, notification and local clock without LG',async({page})=>{
 const {state,errors}=await mount(page);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.displayStudioRenderReady)).toBe(true);
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
test('standalone offline display retains its local clock, removes other widgets and recovers',async({page})=>{
 const {state,errors}=await mount(page);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 state.offline=true;await page.waitForTimeout(350);await page.clock.install();await page.clock.fastForward(32000);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 await expect(page.locator('#studio-scene .lg-widget:not(.lg-clock)')).toHaveCount(0);
 const text=await page.locator('#studio-scene .lg-clock .lg-value').textContent();
 await page.clock.fastForward(61000);await expect(page.locator('#studio-scene .lg-clock .lg-value')).not.toHaveText(text);
 await expect(page.locator('#studio-status')).toContainText('nicht erreichbar');
 state.offline=false;await page.clock.fastForward(3500);
 await expect(page.locator('#studio-scene .lg-clock')).toBeVisible();
 expect(errors).toEqual([]);
});

test('ESP camera output uses a real snapshot without starting HLS or changing the saved view',async({page})=>{
 const {state,errors}=await mount(page);
 const camera=JSON.parse(JSON.stringify(catalog.presets.find(p=>p.id==='camera').layout.scenes.dashboard));
 camera.elements[0].entity_id='camera.studio_guition_7_camera';
 let images=0,streams=0;
 await page.route('**/camera.jpg?**',route=>{images++;return route.fulfill({contentType:'image/png',body:fs.readFileSync('tests/fixtures/media-cover.png')});});
 await page.route('**/camera.json?**',route=>{streams++;return route.fulfill({contentType:'application/json',body:'{"stream":"/api/hls/blocked/master.m3u8"}'});});
 state.layout.config.scenes.dashboard=camera;state.camera_snapshots=true;state.revision++;
 await expect(page.locator('.lg-camera-picture img')).toBeVisible();
 expect(await page.locator('.lg-camera-picture img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 expect(images).toBeGreaterThan(0);expect(streams).toBe(0);
 await expect(page.locator('video')).toHaveCount(0);
 expect(camera.elements[0].camera_mode).toBe('auto');expect(errors).toEqual([]);
});

test('HTTP kiosk touch sends only configured widget, revision and replay sequence',async({page})=>{
 const {state,errors}=await mount(page);const requests=[];
 await page.route('**/action',async route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:'{"duplicate":false}'});});
 const base=JSON.parse(JSON.stringify(state.layout.config.scenes.dashboard.elements[0]));
 state.layout.config.scenes.dashboard.elements=[{...base,id:'touch_switch',kind:'switch',entity_id:'input_boolean.test',x:10,y:10,width:80,height:80,tap_action:{action:'toggle',entity_id:'input_boolean.test',view:''}}];
 state.layout.values={'input_boolean.test':{state:'off',name:'Testschalter'}};state.touch_revision=++state.revision;
 await expect(page.locator('.lg-switch')).toContainText('Aus');await page.locator('.lg-switch').click();
 await expect.poll(()=>requests.length).toBe(1);
 expect(Object.keys(requests[0]).sort()).toEqual(['element','revision','scene','sequence','session']);
 expect(requests[0]).toMatchObject({element:'touch_switch',scene:'dashboard',revision:state.touch_revision,sequence:1});
 expect(requests[0].session).toMatch(/^[a-f0-9]{32}$/);
 state.layout.values['input_boolean.test'].state='unavailable';state.touch_revision=++state.revision;
 await expect(page.locator('.lg-switch')).toContainText('Nicht verfügbar',{timeout:7000});await page.locator('.lg-switch').click();await page.waitForTimeout(250);expect(requests.length).toBe(1);
 expect(errors).toEqual([]);
});


test('local board camera stays on the ESP and starts no browser camera transport',async({page})=>{
 const {state,errors}=await mount(page);let fetches=0;
 await page.route('**/camera.*?**',route=>{fetches++;return route.fulfill({status:500,body:''});});
 const camera=JSON.parse(JSON.stringify(catalog.presets.find(p=>p.id==='camera').layout.scenes.dashboard));
 camera.elements[0].camera_source='local';camera.elements[0].entity_id='';
 state.layout.config.scenes.dashboard=camera;state.revision++;
 await expect(page.locator('.lg-camera')).toContainText('Bordkamera auf dem ESP');
 await expect(page.locator('.lg-camera-picture img,.lg-camera-picture video')).toHaveCount(0);
 expect(fetches).toBe(0);expect(errors).toEqual([]);
});

test('LG display camera uses the HA MJPEG proxy in the kiosk without HLS',async({page})=>{
 const {state,errors}=await mount(page);
 await page.route('**/camera.json?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({stream:'/api/camera_proxy_stream/camera.other_lg?token=camera_only'})}));
 await page.route('**/api/camera_proxy_stream/camera.other_lg?**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync('tests/fixtures/media-cover.png')}));
 const scene=JSON.parse(JSON.stringify(catalog.presets.find(p=>p.id==='camera').layout.scenes.dashboard));
 scene.elements[0].camera_source='entity';scene.elements[0].entity_id='camera.other_lg';scene.elements[0].camera_mode='stream';
 state.layout.config.scenes.dashboard=scene;state.revision++;
 await expect(page.locator('.lg-camera-picture img')).toBeVisible();
 await expect.poll(()=>page.locator('.lg-camera-picture img').evaluate(i=>i.naturalWidth)).toBeGreaterThan(1);
 await expect(page.locator('.lg-camera-age')).toHaveText('Live');
 await expect(page.locator('.lg-camera-picture video')).toHaveCount(0);expect(errors).toEqual([]);
});

test('partial font failure never duplicates loaded faces and only retries the missing face',async({page})=>{
 await page.addInitScript(()=>{
  const Original=window.FontFace;window.fontConstructions=[];
  window.FontFace=function(family,source,descriptors){fontConstructions.push(family+'|'+descriptors.weight);return new Original(family,source,descriptors);};
 });
 const {errors}=await mount(page);
 let failing=true;
 await page.route('**/StudioMono.ttf',route=>failing?route.fulfill({status:503,body:''}):route.fulfill({contentType:'font/ttf',body:fs.readFileSync('custom_components/display_studio/fonts/StudioMono.ttf')}));
 await page.reload();
 await page.evaluate(()=>LGLoadNativeFonts().catch(()=>{}));
 const before=await page.evaluate(()=>({faces:document.fonts.size,attempts:fontConstructions.length}));
 expect(before.attempts).toBe(10);
 await page.evaluate(async()=>{for(let i=0;i<100;i++)await LGLoadNativeFonts().catch(()=>{});});
 expect(await page.evaluate(()=>document.fonts.size)).toBe(before.faces);
 expect(await page.evaluate(()=>fontConstructions.length)).toBe(10);
 failing=false;
 await page.evaluate(async()=>{const now=Date.now;Date.now=()=>now()+31000;try{await Promise.all(Array.from({length:20},()=>LGLoadNativeFonts()));}finally{Date.now=now;}});
 expect(await page.evaluate(()=>fontConstructions.length)).toBe(11);
 expect(await page.evaluate(()=>document.fonts.size)).toBe(before.faces+1);
 expect(await page.evaluate(()=>document.fonts.check('400 32px StudioMono'))).toBe(true);
 expect(errors).toEqual([]);
});
