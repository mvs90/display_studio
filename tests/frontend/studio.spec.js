const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
fs.mkdirSync('test-results/test-logs',{recursive:true});
const catalog=JSON.parse(fs.readFileSync('tests/fixtures/studio-catalog.json','utf8'));

test('design library entry points precede add display and themes open centrally',async({page})=>{
 await mount(page,1500,{devicesHome:true});
 const widgets=page.locator('[data-open-widgets]'),themes=page.locator('[data-open-themes]'),add=page.locator('[data-add-display]');
 expect((await widgets.boundingBox()).x).toBeLessThan((await themes.boundingBox()).x);
 expect((await themes.boundingBox()).x).toBeLessThan((await add.boundingBox()).x);
 await themes.click();await expect(page.getByRole('heading',{name:'Themeseditor',exact:true})).toBeVisible();
 await expect(page.locator('.design-card')).not.toHaveCount(0);
 await page.locator('[data-design-edit]').first().click();
 await expect(page.locator('#editor-name-label')).toHaveText('Name des Themes');
 await page.locator('[data-action=cancel-edit]').click();
 await expect(page.getByRole('heading',{name:'Themeseditor',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_library/')))).toEqual([]);
});

test('design library creates reusable widget without changing a display layout',async({page})=>{
 await mount(page,1500,{devicesHome:true});await page.locator('[data-open-widgets]').click();
 await page.locator('[data-design-new]').click();await page.locator('[data-element-kind=clock]').click();
 await expect(page.locator('#editor-name-label')).toHaveText('Name der Widgetvorlage');
 await page.locator('#view-name').fill('Meine große Uhr');await page.locator('#view-name').dispatchEvent('change');
 await page.locator('.properties [data-prop=clock_gap]').fill('8');await page.locator('.properties [data-prop=clock_gap]').dispatchEvent('change');
 await page.locator('[data-action=finish-edit]').click();
 await expect(page.getByRole('heading',{name:'Widgeteditor',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Meine große Uhr',exact:true})).toBeVisible();
 const result=await page.evaluate(()=>({library:widgetLibrary,saves:calls.filter(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_library/'))}));
 expect(result.saves).toEqual([]);expect(result.library.widgets).toHaveLength(1);expect(result.library.widgets[0].item.clock_gap).toBe(8);
 await page.locator('[data-design-back]').click();await page.locator('.display-actions [data-open-display]').first().click();
 await page.locator('.view-card').filter({has:page.getByRole('heading',{name:'Dashboard',exact:true})}).getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await page.locator('[data-action=add]').click();await page.locator('[data-element-template]').click();await page.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>studio.item.widget_template)).toBe(result.library.widgets[0].id);
 expect(await page.evaluate(()=>studio.item.clock_gap)).toBe(8);
});

test('instance setup pencil edits existing bindings and cancel keeps content untouched',async({page})=>{
 await mount(page);await page.evaluate(()=>studio.openView('dashboard'));
 const before=await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='weather');studio.editWidget(item.id);return JSON.parse(JSON.stringify(item));});
 await expect(page.getByRole('dialog',{name:'Element einrichten',exact:true})).toBeVisible();
 await expect(page.locator('.widget-dialog')).toHaveCount(0);
 await page.locator('[data-draft=label]').fill('Mein Wetter');await page.locator('[data-cancel-element]').first().click();
 expect(await page.evaluate(id=>studio.scene.elements.find(i=>i.id===id),before.id)).toEqual(before);
 await page.evaluate(id=>studio.editWidget(id),before.id);
 await page.locator('[data-draft=label]').fill('Mein Wetter');await page.locator('[data-add-element]').click();
 await expect(page.locator('.element-picker')).toHaveCount(0);
 const after=await page.evaluate(id=>studio.scene.elements.filter(i=>i.id===id),before.id);
 expect(after).toHaveLength(1);expect(after[0].label).toBe('Mein Wetter');expect(after[0].parts).toEqual(before.parts);
 expect(after[0].x).toBe(before.x);expect(after[0].y).toBe(before.y);
});

test('design library new widget cancellation never saves a draft or sends live scenes',async({page})=>{
 await mount(page,390,{devicesHome:true});await page.locator('[data-open-widgets]').click();await page.locator('[data-design-new]').click();await page.locator('[data-element-kind=clock]').click();
 await page.locator('.properties [data-widget-edit]').click();await expect(page.locator('.widget-dialog')).toBeVisible();
 await page.locator('.widget-dialog [data-cancel]').click();await expect(page.getByRole('heading',{name:'Widgeteditor',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'))).toEqual([]);
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});
function regularGrid(columns,rows,gap=2,margin=2,ratio=16/9){
 const gx=gap*Math.min(1,1/ratio),gy=gap*Math.min(1,ratio),mx=margin*Math.min(1,1/ratio),my=margin*Math.min(1,ratio);
 const width=(100-2*mx-(columns-1)*gx)/columns,height=(100-2*my-(rows-1)*gy)/rows;
 return {cells:Array.from({length:columns*rows},(_,i)=>Object.fromEntries(Object.entries({x:mx+i%columns*(width+gx),y:my+Math.floor(i/columns)*(height+gy),width,height}).map(([k,v])=>[k,Number(v.toFixed(8))])))};
}
function expectUniformSpacing(cells,width,height,gap=2,margin=gap){
 const pixels=cells.map(c=>({x:c.x*width/100,y:c.y*height/100,width:c.width*width/100,height:c.height*height/100})),unit=Math.min(width,height)/100;
 for(const c of pixels)for(const [axis,size,other,otherSize,extent] of [['x','width','y','height',width],['y','height','x','width',height]]){
  const neighbours=pixels.filter(n=>n!==c&&Math.min(c[other]+c[otherSize],n[other]+n[otherSize])-Math.max(c[other],n[other])>.001);
  const before=neighbours.filter(n=>n[axis]+n[size]<=c[axis]+.001),after=neighbours.filter(n=>n[axis]>=c[axis]+c[size]-.001);
  expect(c[axis]-(before.length?Math.max(...before.map(n=>n[axis]+n[size])):0)).toBeCloseTo((before.length?gap:margin)*unit,2);
  expect((after.length?Math.min(...after.map(n=>n[axis])):extent)-c[axis]-c[size]).toBeCloseTo((after.length?gap:margin)*unit,2);
 }
}

// Playwright's WebKit fill still treats alpha-capable colors as legacy RGB.
// Drive the same input/change events with the browser-normalized color value.
async function setColor(input,value){await input.evaluate((el,value)=>el.value=value,value);await input.dispatchEvent('input');await input.dispatchEvent('change');}
async function mount(page,width=1500,{warmLegacyRuntime=false,devicesHome=false}={}) {
  page.on('pageerror',error=>console.log('BROWSER_ERROR',error.message));
  await page.setViewportSize({width,height:1100});
  const root=path.resolve('custom_components/display_studio/www');
  await page.route('http://studio.test/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const mapping={'Roboto.ttf':'../fonts/Roboto.ttf','Roboto-Semibold.ttf':'../fonts/Roboto-Semibold.ttf','camera-runtime.js':'runtime/camera.js','camera_direct.js':'camera_direct.js','camera_preview.js':'camera_preview.js','photo_upload.js':'photo_upload.js','studio.js':'studio.js','devices.js':'devices.js','design_library.js':'design_library.js','element_picker.js':'element_picker.js','picker_controls.js':'picker_controls.js','native_controls.js':'native_controls.js','studio.css':'studio.css','weather.js':'runtime/weather.js','cards.js':'runtime/cards.js','layout-runtime.js':'runtime/layout.js','layout.css':'runtime/layout.css','grain.png':'runtime/grain.png'};
    if(file.endsWith('.ttf'))mapping[file]='../fonts/'+file;
    if(new URL(route.request().url()).pathname.includes('/device-images/'))mapping[file]='device-images/'+file;
    if(new URL(route.request().url()).pathname.includes('/symbols/'))mapping[file]='symbols/'+file;
    return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.ttf')?'font/ttf':'text/html',body:mapping[file]?fs.readFileSync(path.join(root,mapping[file])):'<body style="margin:0"></body>'});
  });
  await page.goto('http://studio.test/');
  if(warmLegacyRuntime)await page.evaluate(async()=>{
    // Model a module already loaded by the previous editor before an HA update.
    // Importing its URL again does not execute it, even with HTTP caching off.
    await import('/display_studio/layout-runtime.js?v=1.4.0-av-controls3');
    delete window.LGSplitStartupElements;
  });
  await page.addScriptTag({url:'http://studio.test/display_studio/studio.js?v=fixture-build',type:'module'});
  await page.evaluate(catalog=>{
    window.saved=JSON.parse(JSON.stringify(catalog.presets[0].layout));window.revision=0;window.calls=[];
    const state=(id,value,attrs)=>({entity_id:id,state:value,attributes:attrs});
    window.hass={config:{time_zone:'Europe/Berlin'},states:{
      'sensor.temperature':state('sensor.temperature','22.5',{friendly_name:'Wohnzimmer',unit_of_measurement:'°C'}),
      'weather.home':state('weather.home','sunny',{friendly_name:'Wetter Zuhause',temperature:23,temperature_unit:'°C',humidity:48}),
      'calendar.family':state('calendar.family','off',{friendly_name:'Familie',message:'Abendessen',start_time:'2026-10-04T18:00:00+02:00'})
    },callApi:async(method,url,data)=>{
      window.calls.push([method,url,data]);
      if(url==='display_studio/layouts')return window.studio?.catalog || catalog;
      if(url==='display_studio/widget_library'){window.widgetLibrary||={widgets:[],revision:0,usage:{}};if(method==='POST'){if(data.revision!==window.widgetLibrary.revision)throw {status_code:409};window.widgetLibrary.widgets=window.widgetLibrary.widgets.filter(w=>w.id!==data.widget.id).concat(JSON.parse(JSON.stringify(data.widget)));window.widgetLibrary.revision++;}return JSON.parse(JSON.stringify(window.widgetLibrary));}
      if(url==='display_studio/devices')return window.deviceInventory || {entries:catalog.entries.map(e=>({...e,available:true,provider:e.provider||'lg',model:'LG Professional Display',image:'lg.jpg',status:e.connected?'online':'offline'})),targets:[],types:[{id:'esphome',name:'ESPHome Display',image:'guition-7.webp',integration:'esphome_display'},{id:'lg',name:'LG Professional Display',image:'lg.jpg',integration:'lg_rs232_ip'},{id:'browser',name:'Browser / Kiosk',image:'browser.jpg'}]};
      if(url.startsWith('display_studio/layout_live/')){if(window.failLive)throw {status_code:window.failLive};if(window.holdLive)await new Promise(resolve=>window.releaseLive=resolve);return {live:method==='POST',lease:45};}
      if(url==='states/media_player.display')return {attributes:{hdmi_source:window.currentHdmi}};
      if(url.startsWith('display_studio/layout_suggestions/'))return {areas:[{area_id:'living',name:'Wohnzimmer'}],area_id:'living',suggestions:[{entity_id:'media_player.sonos',kind:'media',name:'Sonos Wohnzimmer',state:'idle'},{entity_id:'sensor.temperature',kind:'status',name:'Raumtemperatur',state:'22.5',unit:'°C'}]};
      if(method==='POST'){
        if(window.failSave)throw {status_code:409};
        if(url==='display_studio/layout_validate')return {config:data.config};
        window.saved=JSON.parse(JSON.stringify(data.config));window.revision++;
        if(saved.views)hass.states['media_player.display']={entity_id:'media_player.display',state:'on',attributes:{view_sources:Object.fromEntries(saved.views.filter(v=>!['hdmi_full','startup','overlay','pip','fullscreen'].includes(v.id)).map(v=>[v.id,v.name]))}};
      }
      return {config:window.saved,revision:window.revision,values:{},timezone:'Europe/Berlin',startup_design:window.startupStatus};
    },callWS:async()=>[{config_entry_id:'one',entity_id:'media_player.display'}],callService:async(...args)=>window.calls.push(args)};
    window.studio=document.createElement('display-studio');studio.hass=hass;document.body.append(studio);
  },catalog);
  await expect(page.getByRole('heading',{name:'Display Studio',exact:true})).toBeVisible();
  await expect(page.locator('.devices-home')).toBeVisible();
  // Content geometry tests mount the existing editor independently of navigation.
  // The design-library tests use the real entry points instead.
  await page.evaluate(()=>{studio.editContentsForTest=id=>{const workspace=studio.designWorkspace;studio.designWorkspace={type:'widgets'};try{studio.editWidget(id);}finally{studio.designWorkspace=workspace;studio.renderLayers();studio.renderSelection();studio.renderProperties();}};});
  if(!devicesHome){await page.locator('.display-actions [data-open-display]').first().click();await expect(page.locator('.overview')).toBeVisible();}
}

async function addElement(page,kind){
 await page.locator('[data-action=add]').click();await page.locator('[data-element-kind="'+kind+'"]').click();await page.locator('[data-add-element]').click();
}
async function chooseSymbol(page,root,key,query=key){
 await root.locator('[data-open-symbol]').click();const dialog=page.getByRole('dialog',{name:'Symbol auswählen',exact:true});
 await dialog.locator('[data-symbol-query]').fill(query);await dialog.locator('[data-symbol="'+key+'"]').click();
}

async function showView(page,name) {
  if(await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).isVisible())await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.locator('.view-card').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Anzeigen',exact:true}).click();
}

async function enableStyling(page) {
  const toggle=page.locator('#own-styling');
  if(await toggle.isVisible())await toggle.check();
}

async function ownWidgetStyle(page) {
  const dialog=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await (await dialog.count()?dialog.locator('[data-widget-styling]'):page.locator('.properties [data-element-styling]')).check();
}

async function openView(page,name) {
  await expect.poll(()=>page.locator('.devices-home,.overview').count()).toBeGreaterThan(0);
  if(await page.locator('.devices-home').count())await page.locator('.display-actions [data-open-display]').first().click();
  if(await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).isVisible())await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:name+' bearbeiten',exact:true}).click();
}

async function boardPreview(page,{snapshotOnly=false,hold=false,fail=false,clock=false,offline=false}={}) {
  await mount(page);
  if(clock)await page.clock.install();
  await page.route('**/vendor/hls-1.7.3.light.min.mjs',route=>route.fulfill({contentType:'application/javascript',body:`
    export default class Hls {
      static Events={ERROR:'error'};static isSupported(){return true;}
      static ErrorTypes={MEDIA_ERROR:'mediaError',NETWORK_ERROR:'networkError'};
      constructor(){window.decoders ||= [];window.decoders.push(this);}
      on(event,handler){this.error=handler;}loadSource(url){this.url=url;}
      attachMedia(video){video.dispatchEvent(new Event('playing'));}
      recoverMediaError(){this.recoveries=(this.recoveries||0)+1;}startLoad(){this.reloads=(this.reloads||0)+1;}
      destroy(){this.destroyed=true;}
    }`}));
  await page.evaluate(({snapshotOnly,hold,fail,offline})=>{
    // A positive native-HLS claim alone must not bypass the reliable MSE path.
    HTMLMediaElement.prototype.canPlayType=()=>'probably';
    HTMLMediaElement.prototype.play=()=>Promise.resolve();
    window.cameraRequests=[];window.snapshots=0;window.failCamera=fail;
    const original=hass.callWS;
    hass.callWS=async request=>{
      if(request.type!=='camera/stream')return original(request);
      cameraRequests.push(request);
      if(hold)await new Promise(resolve=>window.releaseCamera=resolve);
      if(window.failCamera)throw Error('offline');
      return {url:'/api/hls/preview/master_playlist.m3u8'};
    };
    hass.fetchWithAuth=async(path,options)=>{
      window.snapshots++;window.snapshotPath=path;window.snapshotSignal=options.signal;
      return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
    };
    studio.catalog.entries[0].provider='esphome';
    studio.catalog.entries[0].capabilities={hdmi:false,video:false,pip:true,startup:true,native_lvgl:true};
    studio.catalog.entries[0].rendering={width:1024,height:600};
    if(offline)studio.startupStatus=window.startupStatus={connected:false,stored:false};
    studio.cameraDescriptor={stream_entity_id:snapshotOnly?null:'camera.selected_board_h264',snapshot_entity_id:'camera.selected_board'};
    studio.config=studio.withViews(studio.config);studio.saved=JSON.parse(JSON.stringify(studio.config));studio.mount();
  },{snapshotOnly,hold,fail,offline});
  await openView(page,'Dashboard PiP');
}

test('onboard live preview preserves its decoder while PiP geometry and crop change, with one active editor',async({page})=>{
  await boardPreview(page);
  const camera=page.locator('.scene .lg-camera'),video=camera.locator('video');
  await expect(video).toHaveCount(1);
  await expect(camera.locator('.lg-camera-age')).toHaveText('Live');
  await expect.poll(()=>page.evaluate(()=>window.decoders?.filter(d=>!d.destroyed).length)).toBe(1);
  const before=await page.evaluate(()=>{window.originalPreview=studio.shadowRoot.querySelector('.scene video');return JSON.stringify(studio.config);});
  await page.evaluate(()=>{studio.select(studio.scene.elements.find(i=>i.kind==='camera').id);});
  await page.getByRole('combobox',{name:'Bildformat',exact:true}).selectOption('cover');
  await page.getByLabel('Links (%)',{exact:true}).fill('12');await page.getByLabel('Links (%)',{exact:true}).press('Tab');
  await page.getByLabel('Breite (%)',{exact:true}).fill('40');await page.getByLabel('Breite (%)',{exact:true}).press('Tab');
  await expect(video).toHaveCSS('object-fit','cover');
  expect(await camera.evaluate(el=>[el.style.left,el.style.width])).toEqual(['12%','40%']);
  expect(await page.evaluate(()=>originalPreview===studio.shadowRoot.querySelector('.scene video'))).toBe(true);
  expect(await page.evaluate(()=>cameraRequests)).toEqual([{type:'camera/stream',entity_id:'camera.selected_board_h264',format:'hls'}]);
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'))).toEqual([]);
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='camera').camera_source)).toBe('local');
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  await expect(page.locator('.widget-dialog video')).toHaveCount(1);
  await expect(page.locator('.widget-dialog .lg-camera-age')).toHaveText('Live');
  await expect(page.locator('.scene video')).toHaveCount(0);
  expect(await page.evaluate(()=>decoders.filter(d=>!d.destroyed).length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(video).toHaveCount(1);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>decoders.filter(d=>!d.destroyed).length)).toBe(0);
  expect(await page.evaluate(()=>JSON.stringify(studio.saved))).toBe(before);
});

test('onboard preview stops hidden pictures, resumes a visible tab and ignores stale stream responses',async({page})=>{
  await boardPreview(page,{hold:true});
  await expect.poll(()=>page.evaluate(()=>cameraRequests.length)).toBe(1);
  await page.evaluate(()=>{studio.scene.elements.find(i=>i.kind==='camera').parts={picture:{visible:false}};studio.paint();releaseCamera();});
  await expect(page.locator('video')).toHaveCount(0);
  await page.evaluate(()=>{delete studio.scene.elements.find(i=>i.kind==='camera').parts;studio.paint();});
  await expect.poll(()=>page.evaluate(()=>cameraRequests.length)).toBe(2);
  await page.evaluate(()=>releaseCamera());
  await expect(page.locator('.scene video')).toHaveCount(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('video')).toHaveCount(0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>cameraRequests.length)).toBe(3);
  await page.evaluate(()=>{studio.cameraDescriptor={stream_entity_id:'camera.renamed_board_h264',snapshot_entity_id:'camera.selected_board'};studio.paint();});
  await expect.poll(()=>page.evaluate(()=>cameraRequests.length)).toBe(4);
  expect(await page.evaluate(()=>cameraRequests.at(-1).entity_id)).toBe('camera.renamed_board_h264');
  await page.evaluate(()=>studio.remove());
  await page.evaluate(()=>releaseCamera());
  await expect(page.locator('video')).toHaveCount(0);
});

test('unavailable H264 falls back to authenticated stills and resumes streaming after a bounded retry',async({page})=>{
  await boardPreview(page,{fail:true,clock:true});
  await expect(page.locator('.scene .lg-camera-picture img')).toBeVisible();
  expect(await page.evaluate(()=>snapshotPath)).toBe('/api/camera_proxy/camera.selected_board');
  expect(await page.evaluate(()=>snapshotSignal instanceof AbortSignal)).toBe(true);
  await page.evaluate(()=>{window.failCamera=false;});
  await page.clock.fastForward(7000);
  await expect(page.locator('.scene video')).toHaveCount(1);
  await expect(page.locator('.scene .lg-camera-picture img')).toHaveCount(0);
  expect(await page.evaluate(()=>cameraRequests.length)).toBe(2);
  await page.evaluate(()=>{studio.scene.elements.find(i=>i.kind==='camera').camera_source='entity';studio.paint();});
  await expect(page.locator('video')).toHaveCount(0);
});

test('boards without H264 use stills with the same crop and stop polling on leaving the view',async({page})=>{
  await boardPreview(page,{snapshotOnly:true});
  await expect(page.locator('.scene .lg-camera-picture img')).toBeVisible();
  expect(await page.evaluate(()=>cameraRequests.length)).toBe(0);
  await page.evaluate(()=>{studio.scene.elements.find(i=>i.kind==='camera').camera_fit='cover';studio.paint();});
  await expect(page.locator('.scene .lg-camera-picture img')).toHaveCSS('object-fit','cover');
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  const count=await page.evaluate(()=>snapshots);
  await page.clock.install();await page.clock.fastForward(15000);
  expect(await page.evaluate(()=>snapshots)).toBe(count);
});

test('transient HLS media errors recover in place, persistent errors use the still fallback',async({page})=>{
  await boardPreview(page);
  await expect.poll(()=>page.evaluate(()=>window.decoders?.length)).toBe(1);
  await page.evaluate(()=>{window.originalPreview=studio.shadowRoot.querySelector('.scene video');decoders[0].error(null,{fatal:true,type:'mediaError',details:'bufferSeekOverHole'});});
  expect(await page.evaluate(()=>decoders[0].recoveries)).toBe(1);
  expect(await page.evaluate(()=>originalPreview===studio.shadowRoot.querySelector('.scene video'))).toBe(true);
  await page.evaluate(()=>{for(let i=0;i<2;i++)decoders[0].error(null,{fatal:true,type:'mediaError',details:'bufferSeekOverHole'});});
  await expect(page.locator('.scene .lg-camera-picture img')).toBeVisible();
  await expect(page.locator('.scene video')).toHaveCount(0);
  expect(await page.evaluate(()=>decoders[0].destroyed)).toBe(true);
});

test('direct camera descriptor uses one live decoder and falls back to HLS on transport failure',async({page})=>{
  await boardPreview(page);
  await page.route('**/camera_direct.js?*',route=>route.fulfill({contentType:'application/javascript',body:`
    export class DirectCamera {
      constructor(video,hass,path){this.video=video;this.path=path;(window.directs ||= []).push(this);}
      async run(){this.video.dispatchEvent(new Event('playing'));await new Promise((_,reject)=>window.failDirect=reject);}
      close(){this.closed=true;}
    }`}));
  await page.evaluate(()=>{studio.cameraDescriptor.live_stream_path='/api/esphome_display/camera/board/preview.mp4';studio.paint();});
  await expect.poll(()=>page.evaluate(()=>window.directs?.length)).toBe(1);
  expect(await page.evaluate(()=>cameraRequests.length)).toBe(1);
  await page.evaluate(()=>{window.directVideo=studio.shadowRoot.querySelector('.scene video');const camera=studio.scene.elements.find(i=>i.kind==='camera');camera.camera_zoom=200;camera.camera_pan_x=40;studio.paint();});
  expect(await page.evaluate(()=>directVideo===studio.shadowRoot.querySelector('.scene video'))).toBe(true);
  expect(await page.evaluate(()=>directs[0].path)).toBe('/api/esphome_display/camera/board/preview.mp4');
  await page.evaluate(()=>failDirect(Error('stream ended')));
  await expect.poll(()=>page.evaluate(()=>cameraRequests.length)).toBe(2);
  await expect(page.locator('.scene .lg-camera-picture')).toHaveAttribute('data-preview-transport','hls');
  expect(await page.evaluate(()=>directs[0].closed)).toBe(true);
  await page.evaluate(()=>studio.paint());expect(await page.evaluate(()=>directs.length)).toBe(1);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
});

test('direct camera parses fragmented MP4 safely and derives codec from the actual init segment',async({page})=>{
  await mount(page);
  const result=await page.evaluate(async()=>{
    const {mp4Boxes,mp4Codec}=await import('/display_studio/camera_direct.js');
    const box=(name,data=new Uint8Array())=>{const b=new Uint8Array(8+data.length);new DataView(b.buffer).setUint32(0,b.length);b.set([...name].map(c=>c.charCodeAt(0)),4);b.set(data,8);return b;};
    const codec=box('moov',box('avcC',new Uint8Array([1,100,0,31])));
    const stream=new ReadableStream({start(controller){for(const byte of codec)controller.enqueue(new Uint8Array([byte]));controller.close();}});
    const output=[];for await(const b of mp4Boxes(stream.getReader()))output.push(b);
    let rejected=0;
    for(const bytes of [new Uint8Array([0,0,0,0,109,111,111,118]),new Uint8Array([0,32,0,1,109,111,111,118]),codec.slice(0,9)]){
      const reader=new ReadableStream({start(c){c.enqueue(bytes);c.close();}}).getReader();
      try{for await(const b of mp4Boxes(reader)){void b;}}catch(_){rejected++;}
    }
    try{mp4Codec(box('moov',box('bad!')));}catch(_){rejected++;}
    return {count:output.length,codec:mp4Codec(output[0]),rejected};
  });
  expect(result).toEqual({count:1,codec:'avc1.64001f',rejected:4});
});

test('ESPHome output exposes scoped firmware substitutions through the shared editor', async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    studio.catalog.entries[0].provider='esphome';
    studio.catalog.entries[0].capabilities={hdmi:false,pip:false,overlay:true,startup:false,screenshot:true};
    const original=hass.callApi;
    hass.callApi=async(method,url,data)=>url.startsWith('display_studio/browser_link/')?{substitutions:{studio_device_url:'http://ha.test:8123/api/esphome_display/device/esp/scoped',studio_width:'1024',studio_height:'600'}}:original(method,url,data);
    studio.mount();
  });
  await page.getByRole('button',{name:'ESPHome-Konfiguration',exact:true}).click();
  await expect(page.locator('.gallery-flash pre')).toContainText('studio_width: "1024"');
  await expect(page.locator('.gallery-flash pre')).toContainText('studio_device_url: "http://ha.test:8123/api/esphome_display/device/esp/scoped"');
  await expect(page.locator('.gallery-flash a')).toHaveCount(0);
});

test('camera preset creates an ESP source with the onboard HA camera and snapshot controls',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{studio.catalog.entries[0].provider='esphome';studio.catalog.entries[0].capabilities={hdmi:false,video:false};studio.mount();});
  await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await page.locator('[data-creator-mode=content]').click();
  await page.getByLabel('Vorlage',{exact:true}).selectOption('camera');
  await page.getByLabel('Name',{exact:true}).fill('Bordkamera');
  await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
  await page.locator('.layer .name').filter({hasText:'Kamera'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('camera.studio_guition_7_camera');
  await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await expect(page.getByLabel('Kameraquelle',{exact:true}).locator('option')).toHaveCount(3);
  await expect(page.getByLabel('Wiedergabe',{exact:true}).locator('option')).toHaveCount(3);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.find(v=>v.name==='Bordkamera').scene.elements[0].entity_id)).toBe('camera.studio_guition_7_camera');
});

test('templates, entities, geometry and styling save a complete layout without losing edits',async({page})=>{
  await mount(page);
  await openView(page,'Dashboard');
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:/Aurora/}).click();
  await page.locator('.layer .name').filter({hasText:'Dein Wetter'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('weather.home');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await expect(page.locator('.scene .lg-weather')).toContainText('23 °C');
  await page.getByLabel('Links (%)',{exact:true}).fill('40');await page.getByLabel('Links (%)',{exact:true}).press('Tab');
  await expect(page.locator('.selection.selected')).toHaveCSS('left',/[0-9.]+px/);

  await page.getByRole('button',{name:'Speichern'}).click();
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='weather').x)).toBe(40);
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='weather').entity_id)).toBe('weather.home');
  expect(await page.evaluate(()=>saved.enabled)).toBe(true);
  expect(await page.evaluate(()=>saved.scenes.overlay.elements.filter(i=>i.kind==='message').length)).toBe(1);
});

test('selected widget remains editable after successive saves without reopening it',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.locator('.layer .name').filter({hasText:'Text'}).click();
  const text=page.getByLabel('Text',{exact:true});
  for(const value of ['Erster Entwurf','Weiter bearbeitet']){
    await text.fill(value);await text.press('Tab');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await expect(page.locator('.status')).toHaveText('Gespeichert');
    expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='text').text)).toBe(value);
  }
  await expect(page.getByLabel('Widget-Typ')).toHaveCount(0);
  await page.getByLabel('Breite (%)',{exact:true}).fill('25');await page.getByLabel('Breite (%)',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.id===studio.selected).width)).toBe(25);
});

test('pointer move and resize are bounded; keyboard and undo restore exact geometry',async({page})=>{
  await mount(page);
  await openView(page,'Dashboard PiP');
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:/Aurora/}).click();
  await page.locator('.layer .name').filter({hasText:'HDMI / PiP'}).click();
  const selected=page.locator('.selection.selected');let box=await selected.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-40,box.y+box.height/2+20);await page.mouse.up();
  const moved=await page.evaluate(()=>studio.item.x);expect(moved).toBeLessThan(35);
  box=await selected.locator('.resize').boundingBox();await page.mouse.move(box.x+6,box.y+6);await page.mouse.down();await page.mouse.move(box.x+90,box.y+60);await page.mouse.up();
  expect(await page.evaluate(()=>studio.item.width)).toBeGreaterThan(61);
  expect(await page.evaluate(()=>studio.item.x+studio.item.width)).toBeLessThanOrEqual(100.01);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='hdmi').width)).toBe(61);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='hdmi').x)).toBe(35);
});

test('HA updates preserve text editing; error keeps draft and prevents silent overwrite',async({page})=>{
  await mount(page);
  await openView(page,'Dashboard');
  await page.locator('.layer .name').filter({hasText:'Text'}).click();
  const input=page.getByLabel('Text',{exact:true});await input.fill('<img src=x onerror="window.hacked=true">');
  await page.evaluate(()=>{studio.hass={...hass};});await page.waitForTimeout(400);
  await expect(input).toHaveValue('<img src=x onerror="window.hacked=true">');
  await input.press('Tab');await expect(page.locator('.scene .lg-text')).toContainText('<img');
  expect(await page.evaluate(()=>window.hacked)).toBeUndefined();
  await page.evaluate(()=>{window.failSave=true;});await page.getByRole('button',{name:'Speichern'}).click();
  await expect(page.locator('.flash')).toContainText('andere Sitzung');await expect(page.locator('.status')).toHaveText('Ungespeichert');
});

test('notification scene is editable, every widget can be deleted and restored',async({page})=>{
  await mount(page);
  await openView(page,'Mitteilung');
  await page.locator('.layer .name').filter({hasText:'Meldungsfenster'}).click();
  await expect(page.getByRole('button',{name:'Element entfernen'})).toBeEnabled();
  await page.getByRole('button',{name:'Element entfernen'}).click();
  await expect(page.locator('.scene .lg-message')).toHaveCount(0);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await page.locator('.layer .name').filter({hasText:'Meldungsfenster'}).click();
  await page.getByLabel('Breite (%)',{exact:true}).fill('25');await page.getByLabel('Breite (%)',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Speichern'}).click();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await page.getByRole('button',{name:'10 Sekunden anzeigen'}).click();
  const call=await page.evaluate(()=>calls.find(c=>c[0]==='display_studio'));
  expect(call[1]).toBe('show_notification');expect(call[2].config_entry_id).toBe('one');expect(call[2].duration).toBe(10);
});

test('editor fits mobile and supports adding, ordering and deleting a selected entity',async({page})=>{
  await mount(page,390);
  await openView(page,'Dashboard PiP');
  await addElement(page,'entity');
  await page.getByLabel('Home-Assistant-Entität').fill('sensor.temperature');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await expect(page.locator('.scene .lg-entity').filter({hasText:'22.5 °C'})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByRole('button',{name:'Element entfernen'}).click();await expect(page.locator('.scene .lg-entity').filter({hasText:'22.5 °C'})).toHaveCount(0);
});

test('placed widgets keep their type, remain editable and can be removed; Dashboard is a source',async({page})=>{
  await mount(page);
  await openView(page,'Dashboard');
  await page.locator('.layer .name').filter({hasText:'Dein Wetter'}).click();
  await expect(page.getByLabel('Widget-Typ')).toHaveCount(0);
  await page.getByLabel('Wetteransicht').selectOption('hourly');
  await page.getByLabel('Aktuelles Wettersymbol animieren').uncheck();

  await page.getByRole('button',{name:'Speichern'}).click();
  await showView(page,'Dashboard');
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='display_studio'&&c[1]==='show_view'&&c[2].view==='dashboard'))).toBe(true);
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='weather').animate)).toBe(false);
  await openView(page,'Dashboard');await page.locator('.layer .name').filter({hasText:'Dein Wetter'}).click();
  await page.getByRole('button',{name:'Element entfernen'}).click();
  await expect(page.locator('.scene .lg-weather')).toHaveCount(0);
});

test('own background uploads preview locally, survive save and undo, and cleanup preserves used images',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    const id='a'.repeat(64), unused='b'.repeat(64), api=hass.callApi;
    studio.backgrounds=[unused];studio.imageUrls[id]=null;
    hass.fetchWithAuth=async(url,options)=>{
      calls.push([options?.method || 'GET',url]);
      if(options?.method==='POST')return new Response(JSON.stringify({image_id:id}));
      return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
    };
    hass.callApi=async(method,url,data)=>method==='DELETE' ? (calls.push([method,url]),{ok:true}):api(method,url,data);
  });
  await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await page.locator('[data-action=theme-use]').click();
  await page.getByRole('combobox',{name:'Hintergrund',exact:true}).selectOption('image');
  await page.locator('#bg-upload').setInputFiles({name:'morning.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])});
  await expect(page.locator('.flash')).toContainText('Bild vorbereitet');
  await expect.poll(()=>page.locator('.scene').evaluate(node=>node.style.background)).toContain('blob:');
  await page.getByRole('button',{name:'Speichern'}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.image_id)).toBe('a'.repeat(64));
  await page.locator('[data-action=clean-backgrounds]').click();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='DELETE').map(c=>c[1]))).toEqual(['display_studio/layout_background/one/'+ 'b'.repeat(64)]);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.config.scenes.dashboard.image_id)).toBe('');
  await page.getByTitle('Wiederholen',{exact:true}).click();
  expect(await page.evaluate(()=>studio.config.scenes.dashboard.image_id)).toBe('a'.repeat(64));
});


test('room suggestions add styled media/status cards once, support editing and removal, and never auto-save',async({page})=>{
  await mount(page);
  await openView(page,'Dashboard');
  await expect(page.getByLabel('Raum für Kartenvorschläge')).toHaveValue('living');
  await page.getByRole('button',{name:/Medienplayer Sonos Wohnzimmer/}).click();
  await expect(page.locator('.scene .lg-media')).toHaveCount(1);
  await expect(page.getByLabel('Home-Assistant-Entität')).toHaveValue('media_player.sonos');
  await ownWidgetStyle(page);
  await page.getByLabel('Mediengestaltung').selectOption('poster');
  await expect(page.locator('.scene .lg-media')).toHaveAttribute('data-media-style','poster');
  await expect(page.getByRole('button',{name:/Medienplayer Sonos Wohnzimmer/})).toBeDisabled();
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='POST'))).toBe(false);
  await page.getByRole('button',{name:/Statuskarte Raumtemperatur/}).click();
  await expect(page.locator('.scene .lg-status')).toContainText('22.5 °C');
  await page.getByRole('button',{name:'Raumtemperatur entfernen',exact:true}).click();
  await expect(page.locator('.scene .lg-status')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Statuskarte Raumtemperatur/})).toBeEnabled();
  await page.getByRole('button',{name:'Sonos Wohnzimmer entfernen',exact:true}).click();
  await expect(page.locator('.scene .lg-media')).toHaveCount(0);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.locator('.scene .lg-media')).toHaveCount(1);
  await page.getByRole('button',{name:'Speichern'}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.some(i=>i.kind==='media'&&i.media_style==='poster'))).toBe(true);
});

test('overview creates, renames, duplicates and deletes independent source views with undo',async({page})=>{
  await mount(page);
  await expect(page.locator('.view-card')).toHaveCount(8);
  await expect(page.getByText('Wann wird welche Ansicht angezeigt?',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Mein Sonnenplatz');
  await page.locator('[data-creator-mode=content]').click();
  await page.getByLabel('Vorlage',{exact:true}).selectOption('morning');
  await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
  await expect(page.locator('#own-styling')).not.toBeChecked();
  await expect(page.locator('#background')).toHaveValue('midnight');
  await page.getByLabel('Name der Ansicht').fill('Mein Tageslicht');await page.getByLabel('Name der Ansicht').press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const id=await page.evaluate(()=>studio.viewId);
  expect(await page.evaluate(id=>saved.scenes[id].background,id)).toBe('midnight');
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Tageslicht duplizieren',exact:true}).click();
  await expect(page.locator('.view-card')).toHaveCount(10);
  await openView(page,'Mein Tageslicht · Kopie');
  await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.background)).toBe('midnight');
  expect(await page.evaluate(id=>saved.scenes[id].background,id)).toBe('midnight');
  expect(await page.evaluate(()=>saved.views.find(v=>v.name==='Mein Tageslicht · Kopie').scene.background)).toBe('sand');
  await page.getByRole('button',{name:'Mein Tageslicht löschen',exact:true}).click();
  await expect(page.locator('.view-card')).toHaveCount(9);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.locator('.view-card')).toHaveCount(10);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();
  await expect(page.locator('.view-card')).toHaveCount(10);
  await expect(page.locator('.overview')).toBeVisible();
});

test('solar view follows live HA updates without reload and preserves edited fields',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:/Sonnenstand/}).click();
  await page.evaluate(()=>{hass.states['sun.sun']={entity_id:'sun.sun',state:'above_horizon',attributes:{elevation:35,azimuth:130,rising:true}};studio.hass={...hass};});
  const day=await page.locator('.scene').evaluate(n=>n.style.background);
  await page.locator('.layer .name').filter({hasText:'Text'}).click();
  await page.getByLabel('Text',{exact:true}).fill('Noch im Entwurf');
  await page.evaluate(()=>{hass.states['sun.sun']={entity_id:'sun.sun',state:'below_horizon',attributes:{elevation:-18,azimuth:320,rising:false}};studio.hass={...hass};});
  await expect.poll(()=>page.locator('.scene').evaluate(n=>n.style.background)).not.toBe(day);
  await expect(page.getByLabel('Text',{exact:true})).toHaveValue('Noch im Entwurf');
  await expect(page.locator('.workspace')).toBeVisible();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST').length)).toBe(0);
});

test('system views stay protected while former defaults are editable custom views',async({page})=>{
  await mount(page,390);
  for(const name of ['Nur HDMI','Startanzeige','Mitteilung','Mitteilung PiP','Mitteilung Vollbild']){
    await expect(page.getByRole('button',{name:name+' löschen',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:name+' Standard wiederherstellen',exact:true})).toHaveCount(1);
  }
  for(const name of ['Dashboard','Dashboard PiP','Mediaplayer']){
    await expect(page.getByRole('button',{name:name+' löschen',exact:true})).toHaveCount(1);
    await expect(page.getByRole('button',{name:name+' Standard wiederherstellen',exact:true})).toHaveCount(0);
  }
  const before=await page.evaluate(()=>structuredClone(studio.config.views));
  await openView(page,'Dashboard');
  await expect(page.getByLabel('Name der Ansicht')).toBeEnabled();
  await page.getByLabel('Name der Ansicht').fill('Mein Dashboard');await page.getByLabel('Name der Ansicht').press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views)).toEqual(before.map(v=>v.id==='dashboard'?{...v,name:'Mein Dashboard'}:v));
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Dashboard löschen',exact:true}).click();
  await expect(page.locator('.view-card')).toHaveCount(7);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Mein Dashboard löschen',exact:true})).toHaveCount(1);
  expect(await page.evaluate(()=>studio.dirty)).toBe(false);
});

for(const native of [false,true])test('deleted source templates stay absent and themes and grid templates work without Dashboard '+native,async({page})=>{
  await mount(page);
  if(native)await page.evaluate(()=>{Object.assign(studio.catalog.entries[0],{provider:'esphome',capabilities:{native_lvgl:true,hdmi:false,startup:true}});studio.config=studio.withViews(studio.config);studio.mount();});
  for(const id of ['dashboard','pip_view','media_view'])await page.evaluate(id=>studio.deleteView(id),id);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.accept({config:saved,revision});studio.mount();});
  expect(await page.evaluate(()=>studio.config.views.some(v=>['dashboard','pip_view','media_view'].includes(v.id)))).toBe(false);
  await page.evaluate(()=>studio.createTheme());
  await expect(page.locator('.workspace')).toBeVisible();
  await page.evaluate(()=>studio.toggleLive());
  const preview=await page.evaluate(()=>calls.findLast(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_live/'))[2]);
  expect(preview.view).toBe('dashboard');expect(preview.config.views.find(v=>v.id==='dashboard').scene.elements.length).toBeGreaterThan(0);
  expect(await page.evaluate(()=>studio.config.views.some(v=>v.id==='dashboard'))).toBe(false);
  await page.evaluate(async()=>{await studio.stopLive();studio.page='overview';studio.showPage();studio.showCreator();});
  await expect(page.locator('[data-grid-template=overview]')).toBeVisible();
  await expect(page.locator('[data-grid-template=sidebar]')).toBeVisible();
  await expect(page.locator('[data-grid-template=main_header]')).toBeVisible();
  await page.locator('[data-grid-template=overview]').click();
  await page.locator('#new-view-name').fill('Meine Übersicht');
  await page.locator('[data-create-view]').click();
  expect(await page.evaluate(()=>studio.view)).toMatchObject({name:'Meine Übersicht',grid:{cells:expect.any(Array)}});
  expect(await page.evaluate(()=>studio.view.id)).toMatch(/^view_/);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.accept({config:saved,revision});studio.mount();});
  expect(await page.evaluate(()=>studio.config.views.some(v=>['dashboard','pip_view','media_view'].includes(v.id)))).toBe(false);
});

test('themes change colours only, custom palette is editable and overview navigation preserves drafts without source changes',async({page})=>{
  await mount(page);await openView(page,'Dashboard PiP');
  await page.locator('.layer .name').filter({hasText:'Draußen'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('weather.home');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await page.getByLabel('Links (%)',{exact:true}).fill('5');await page.getByLabel('Links (%)',{exact:true}).press('Tab');
  const before=await page.evaluate(()=>JSON.parse(JSON.stringify(studio.scene.elements)));
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  const after=await page.evaluate(()=>studio.scene.elements);
  const content=items=>items.map(({color,background,accent_color,...rest})=>rest);
  expect(content(after)).toEqual(content(before));expect(after[0].color).not.toBe(before[0].color);
  await expect(page.locator('.appearance-controls .room-suggestions')).toHaveCount(0);
  await enableStyling(page);
  await expect(page.getByLabel('Kartenfarbe',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await setColor(page.getByLabel('Kartenfarbe',{exact:true}),'#234567');await page.getByLabel('Kartenfarbe',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Für diese Ansicht verwenden',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind!=='hdmi').every(i=>i.background==='#234567'))).toBe(true);
  await openView(page,'Dashboard');
  await expect(page.getByLabel('Name der Ansicht')).toHaveValue('Dashboard');
  await openView(page,'Mitteilung');
  await expect(page.locator('.scene .lg-message')).toBeVisible();
  await openView(page,'Nur HDMI');
  await expect(page.getByLabel('Name der Ansicht')).toBeDisabled();
  await expect(page.locator('.selection')).toHaveCount(1);
  await expect(page.locator('.appearance-controls')).toBeHidden();
  await expect(page.locator('[data-action=reset-view]')).toBeVisible();
  expect(await page.locator('.lg-hdmi-placeholder').evaluate(n=>n.style.width)).toBe('100%');
  await openView(page,'Dashboard PiP');
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='weather').entity_id)).toBe('weather.home');
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='weather').x)).toBe(5);
  expect(await page.evaluate(()=>calls.some(c=>['POST','media_player'].includes(c[0])))).toBe(false);
  await page.screenshot({path:'test-results/studio-themes-'+test.info().project.name+'.png',fullPage:true});
  await page.getByRole('button',{name:'Speichern',exact:true}).click();

  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await showView(page,'Dashboard PiP');
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='display_studio'&&c[2].view==='pip_view'))).toBe(true);
});

test('a background player is independent of cards, previews live, survives save, themes, undo and duplicate',async({page})=>{
  await mount(page);
  const png=fs.readFileSync('tests/fixtures/media-cover.png').toString('base64');
  await page.evaluate(png=>{
    hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{friendly_name:'Sonos Wohnzimmer',entity_picture:'/private-art',media_title:'First'}};
    window.coverRequests=0;
    hass.fetchWithAuth=async()=>{window.coverRequests++;return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});};
  },png);
  await openView(page,'Dashboard');
  const before=await page.evaluate(()=>JSON.stringify(studio.scene.elements));
  await enableStyling(page);
  await page.getByLabel('Hintergrund-Medienplayer',{exact:true}).selectOption('media_player.sonos');
  await enableStyling(page);
  await page.getByLabel('Bei Wiedergabe anzeigen').check();
  await expect(page.locator('.scene .lg-cover-background')).toHaveClass(/loaded/);
  await expect(page.getByLabel('Farben für den Hintergrund')).toHaveValue('edges');
  await enableStyling(page);
  await page.getByLabel('Farben für den Hintergrund').selectOption('cover');
  await enableStyling(page);
  await page.getByLabel('Cover darstellen').selectOption('stretch');
  await expect(page.locator('.scene .lg-cover-background img')).toHaveCSS('object-fit','fill');
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:/Aurora/}).click();
  expect(await page.evaluate(()=>studio.scene.media_background_entity)).toBe('media_player.sonos');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  expect(await page.evaluate(()=>saved.scenes.dashboard.media_background_fit)).toBe('stretch');
  expect(await page.evaluate(()=>saved.scenes.dashboard.media_background_color_source)).toBe('cover');
  expect(await page.evaluate(()=>studio.scene.elements.map(i=>i.entity_id))).toEqual(JSON.parse(before).map(i=>i.entity_id));
  await page.evaluate(()=>{hass.states['media_player.sonos'].state='paused';studio.hass={...hass};});
  await expect(page.locator('.scene .lg-cover-background')).toHaveCount(0);
  await page.evaluate(()=>{hass.states['media_player.sonos'].state='playing';hass.states['media_player.sonos'].attributes.media_title='Second';studio.hass={...hass};});
  await expect(page.locator('.scene .lg-cover-background')).toHaveClass(/loaded/);
  await enableStyling(page);
  await page.getByLabel('Bei Wiedergabe anzeigen').uncheck();
  await expect(page.locator('.scene .lg-cover-background')).toHaveCount(0);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).toBeChecked();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Dashboard duplizieren',exact:true}).click();
  await openView(page,'Dashboard · Kopie');
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.sonos');
  await expect(page.getByLabel('Cover darstellen')).toHaveValue('stretch');
  await expect(page.getByLabel('Farben für den Hintergrund')).toHaveValue('cover');
  await enableStyling(page);
  await page.getByLabel('Farben für den Hintergrund').selectOption('edges');
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.getByLabel('Farben für den Hintergrund')).toHaveValue('cover');
  expect(await page.evaluate(()=>window.coverRequests)).toBeLessThanOrEqual(4);
});

test('cover player preselection stays read-only until configured and respects manual bindings',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    for(const name of ['sonos','other'])hass.states['media_player.'+name]={entity_id:'media_player.'+name,state:'idle',attributes:{friendly_name:name}};
  });
  await openView(page,'Dashboard');await enableStyling(page);
  await expect(page.locator('.cover-background-settings')).toBeHidden();
  await page.getByLabel('Hintergrund-Medienplayer',{exact:true}).selectOption('media_player.other');
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).not.toBeChecked();
  await expect(page.getByLabel('Cover darstellen')).toBeVisible();
  await page.getByLabel('Hintergrund-Medienplayer',{exact:true}).selectOption('');
  await expect(page.locator('.cover-background-settings')).toBeHidden();

  await openView(page,'Mediaplayer');
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('media_player.sonos');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await enableStyling(page);
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.sonos');
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).not.toBeChecked();
  expect(await page.evaluate(()=>studio.scene.media_background_entity)).toBe('');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const savedBefore=await page.evaluate(()=>JSON.stringify(saved));
  await openView(page,'Dashboard');await openView(page,'Mediaplayer');
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.sonos');
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(savedBefore);

  await page.getByLabel('Bei Wiedergabe anzeigen').check();
  expect(await page.evaluate(()=>studio.scene.media_background_entity)).toBe('media_player.sonos');
  await page.getByLabel('Hintergrund-Medienplayer',{exact:true}).selectOption('media_player.other');
  await page.getByLabel('Bei Wiedergabe anzeigen').uncheck();
  await openView(page,'Dashboard');await openView(page,'Mediaplayer');
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.other');
  await expect(page.getByLabel('Cover darstellen')).toBeVisible();
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).not.toBeChecked();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.media_view.media_background_entity)).toBe('media_player.other');
  expect(await page.evaluate(()=>saved.scenes.media_view.media_background_enabled)).toBe(false);
});

for(const width of [1500,390])test(`removing a background player persists and supports undo and reselection at ${width}px`,async({page})=>{
  await mount(page,width);
  await page.evaluate(()=>{hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'idle',attributes:{friendly_name:'Sonos Wohnzimmer'}};});
  await openView(page,'Mediaplayer');
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('media_player.sonos');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  const player=page.getByLabel('Hintergrund-Medienplayer',{exact:true});
  await expect(player).toHaveValue('media_player.sonos');
  // Even a read-only automatic suggestion can be explicitly removed.
  const clear=page.getByRole('button',{name:'Hintergrund-Medienplayer entfernen',exact:true});
  const fieldBox=await player.boundingBox(),clearBox=await clear.boundingBox();
  expect(clearBox.x).toBeGreaterThanOrEqual(fieldBox.x+fieldBox.width);
  expect(Math.abs(clearBox.y-fieldBox.y)).toBeLessThan(2);
  await clear.click();
  await expect(clear).toBeDisabled();
  await expect(player.locator('option:checked')).toHaveText('Mediaplayer wählen');
  await expect(player).toHaveValue('');
  await expect(page.locator('.cover-background-settings')).toBeHidden();
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(player).toHaveValue('media_player.sonos');
  await expect(clear).toBeEnabled();
  await page.getByLabel('Bei Wiedergabe anzeigen').check();
  await clear.click();
  await expect(page.locator('#own-styling')).not.toBeChecked();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.remove();window.studio=document.createElement('display-studio');studio.hass=hass;document.body.append(studio);});
  await openView(page,'Mediaplayer');
  await expect(player).toHaveValue('');
  await expect(page.locator('.cover-background-settings')).toBeHidden();
  await expect(page.locator('.scene .lg-cover-background')).toHaveCount(0);
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await expect(page.getByLabel('Home-Assistant-Entität')).toHaveValue('media_player.sonos');
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mediaplayer duplizieren',exact:true}).click();
  await openView(page,'Mediaplayer · Kopie');
  await expect(player).toHaveValue('');
  await player.selectOption('media_player.sonos');
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).not.toBeChecked();
  await page.getByLabel('Bei Wiedergabe anzeigen').check();
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).toBeChecked();
});

test('Mediaplayer context configures full-screen view, saves and selects its own source',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await openView(page,'Mediaplayer');
  await expect(page.getByLabel('Name der Ansicht')).toHaveValue('Mediaplayer');
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('media_player.sonos');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await expect(page.locator('.scene .lg-media')).toHaveAttribute('data-media-style','stage');

  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.media_view.elements.find(i=>i.kind==='media').entity_id)).toBe('media_player.sonos');
  await showView(page,'Mediaplayer');
  await openView(page,'Mediaplayer');await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='display_studio'&&c[1]==='show_view'&&c[2].view==='media_view'))).toBe(true);
  await page.getByRole('button',{name:'Element entfernen',exact:true}).click();
  await expect(page.locator('.scene .lg-media')).toHaveCount(0);
});


test('gallery displays assigned music view without replacing Dashboard',async({page})=>{
  await mount(page);
  await page.locator('.view-card').filter({has:page.getByRole('heading',{name:'Mediaplayer',exact:true})}).getByRole('button',{name:'Anzeigen',exact:true}).click();
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='display_studio'&&c[1]==='show_view'&&c[2].view==='media_view'))).toBe(true);
  expect(await page.evaluate(()=>studio.config.assignments)).toBeUndefined();
});


test('Live projects drafts, coalesces rapid edits and stops without saving',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  const savedBefore=await page.evaluate(()=>JSON.stringify(saved));
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.getByRole('button',{name:'Live',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{calls.length=0;for(let n=0;n<12;n++){studio.scene.gradient_angle=n;studio.changed();}});
  await expect.poll(()=>page.evaluate(()=>calls.filter(c=>c[0]==='POST'&&c[1].includes('/layout_live/')).length)).toBe(1);
  expect(await page.evaluate(()=>calls.find(c=>c[1].includes('/layout_live/'))[2].config.views.find(v=>v.id==='media_view').scene.gradient_angle)).toBe(11);
  expect(await page.evaluate(()=>JSON.stringify(saved))).toBe(savedBefore);
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.getByRole('button',{name:'Live',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='DELETE'&&c[1].includes('/layout_live/')))).toBe(true);
  await expect(page.locator('.status')).toHaveText('Ungespeichert');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.media_view.gradient_angle)).toBe(11);
  expect(await page.evaluate(()=>saved.enabled)).toBe(true);
});

test('Live serializes slow requests, sends the latest draft and stops before navigating',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await page.evaluate(()=>{window.holdLive=true;calls.length=0;studio.scene.gradient_angle=20;studio.changed();});
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseLive)).toBe('function');
  await page.evaluate(()=>{studio.scene.gradient_angle=35;studio.changed();});
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST').length)).toBe(1);
  await page.evaluate(()=>{window.holdLive=false;window.releaseLive();});
  await expect.poll(()=>page.evaluate(()=>calls.filter(c=>c[0]==='POST').length)).toBe(2);
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST').at(-1)[2].config.views.find(v=>v.id==='dashboard').scene.gradient_angle)).toBe(35);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await openView(page,'Mediaplayer');
  await expect(page.getByRole('button',{name:'Live',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='DELETE').length)).toBe(1);
});

test('Live conflicts keep drafts and footer transfer tools stay below the editor',async({page})=>{
  await mount(page,390);await openView(page,'Dashboard');
  await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  await page.evaluate(()=>window.failLive=409);
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.locator('.live-status')).toContainText('andere Sitzung');
  await expect(page.getByRole('button',{name:'Live',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('sand');
  await expect(page.locator('.status')).toHaveText('Ungespeichert');
  const footer=await page.locator('.transfer-tools').boundingBox(),workspace=await page.locator('.workspace').boundingBox();
  expect(footer.y).toBeGreaterThanOrEqual(workspace.y+workspace.height);
  expect(await page.locator('.transfer-tools').getByRole('button',{name:'Exportieren'}).count()).toBe(1);
});

test('source selection failure and unassigned defaults do not alter the library',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{calls.length=0;});
  await page.evaluate(()=>{hass.callService=async()=>{throw Error('offline');};});
  await showView(page,'Dashboard');
  await expect(page.locator('.gallery-flash')).toContainText('Quelle nicht erreichbar');
  expect(await page.evaluate(()=>studio.config.views[0].id)).toBe('hdmi_full');
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST').length)).toBe(0);
});

test('custom gallery shows its source and editor previews it without replacing fixed views',async({page})=>{
  await mount(page);await page.getByRole('button',{name:'Mediaplayer duplizieren',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const card=page.locator('.view-card').filter({has:page.getByRole('heading',{name:'Mediaplayer · Kopie',exact:true})});
  await card.getByRole('button',{name:'Anzeigen',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='display_studio').at(-1)[2].view)).toBe(await page.evaluate(()=>saved.views.find(v=>v.name==='Mediaplayer · Kopie').id));
  await openView(page,'Mediaplayer · Kopie');
  await page.getByRole('button',{name:'Live',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='display_studio').at(-1)[2].view)).toBe(await page.evaluate(()=>saved.views.find(v=>v.name==='Mediaplayer · Kopie').id));
  expect(await page.evaluate(()=>saved.views[0].id)).toBe('hdmi_full');
  expect(await page.evaluate(()=>saved.assignments)).toBeUndefined();
});

test('music view saves colour-only background and optional timeline state without changing other views',async({page})=>{
  await mount(page);
  await page.evaluate(png=>{
    hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{friendly_name:'Sonos Wohnzimmer',entity_picture:'/private-art',media_title:'First'}};
    hass.fetchWithAuth=async()=>new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
  },fs.readFileSync('tests/fixtures/media-cover.png').toString('base64'));
  await openView(page,'Mediaplayer');
  await expect(page.getByLabel('Cover darstellen')).toHaveValue('colors');
  await enableStyling(page);
  await page.getByLabel('Hintergrund-Medienplayer',{exact:true}).selectOption('media_player.sonos');
  await enableStyling(page);
  await page.getByLabel('Bei Wiedergabe anzeigen').check();
  await expect(page.locator('.scene .lg-cover-background')).toHaveClass(/loaded/);
  await expect(page.locator('.scene .lg-cover-background img')).toBeHidden();
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await expect(page.getByLabel('Play-/Pause-Symbol anzeigen')).toBeChecked();
  await page.getByLabel('Play-/Pause-Symbol anzeigen').uncheck();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.media_view.elements[0].show_playback_icon)).toBe(false);
  expect(await page.evaluate(()=>saved.scenes.media_view.media_background_fit)).toBe('colors');
  expect(await page.evaluate(()=>saved.assignments)).toBeUndefined();
  await page.getByLabel('Play-/Pause-Symbol anzeigen').check();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.media_view.elements[0].show_playback_icon)).toBe(true);
});


test('system views follow notifications and HDMI stays editable and resettable',async({page})=>{
  await mount(page);
  await expect(page.locator('.primary-gallery .view-card h3')).toHaveText(['Dashboard','Dashboard PiP','Mediaplayer']);
  await expect(page.locator('.system-gallery .view-card h3')).toHaveText(['Startanzeige','Nur HDMI']);
  expect(await page.locator('.system-views').evaluate(el=>el.previousElementSibling.className)).toBe('notification-views');
  await expect(page.locator('.notification-gallery .view-card h3')).toHaveText(['Mitteilung','Mitteilung PiP','Mitteilung Vollbild']);
  await page.getByRole('button',{name:'Mitteilung duplizieren',exact:true}).click();
  await expect(page.locator('.primary-gallery .view-card h3').last()).toHaveText('Mitteilung · Kopie');
  const main=await page.locator('.primary-views').boundingBox(),notices=await page.locator('.notification-views').boundingBox();
  expect(notices.y).toBeGreaterThanOrEqual(main.y+main.height);
  await openView(page,'Nur HDMI');
  await page.locator('.layer .name').filter({hasText:'HDMI / PiP'}).click();
  await page.getByLabel('Breite (%)',{exact:true}).fill('75');await page.getByLabel('Breite (%)',{exact:true}).press('Tab');
  await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.hdmi_full.elements[0].width)).toBe(75);
  const others=await page.evaluate(()=>JSON.stringify(saved.views.slice(1)));
  await page.getByRole('button',{name:'Standard wiederherstellen',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements[0].width)).toBe(100);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements[0].width)).toBe(75);
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  await page.getByRole('button',{name:'Standard wiederherstellen',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.hdmi_full.elements[0].width)).toBe(100);
  expect(await page.evaluate(()=>JSON.stringify(saved.views.slice(1)))).toBe(others);
});


test('Nur HDMI live preview delegates input selection and preserves unsaved designs',async({page})=>{
  await mount(page);await openView(page,'Nur HDMI');
  await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>c[1].includes('/layout_live/')).at(-1)[2].view)).toBe('hdmi_full');
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='media_player'))).toBe(false);
  await expect(page.locator('.status')).toHaveText('Ungespeichert');
  expect(await page.evaluate(()=>saved.scenes.hdmi_full.background)).toBe('midnight');
});

test('Nur HDMI never guesses an input when the backend has no current HDMI',async({page})=>{
  await mount(page);await openView(page,'Nur HDMI');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{calls.length=0;hass.callService=async()=>{throw Error('No HDMI known by adapter');};});
  await showView(page,'Nur HDMI');
  await expect(page.locator('.gallery-flash')).toContainText('Quelle nicht erreichbar');
  expect(await page.evaluate(()=>calls.some(c=>c[0]==='media_player'||c[0]==='POST'))).toBe(false);
});

test('Anzeigen dropdown sends one animated saved-view action and keeps editor drafts',async({page})=>{
  await mount(page);await openView(page,'Nur HDMI');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByLabel('Übergang für Dashboard PiP',{exact:true}).selectOption('smooth');
  await page.evaluate(()=>calls.length=0);
  await page.locator('.view-card').filter({has:page.getByRole('heading',{name:'Dashboard PiP',exact:true})}).getByRole('button',{name:'Anzeigen',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='display_studio'))).toEqual([['display_studio','show_view',{config_entry_id:'one',view:'pip_view',transition:'smooth'}]]);
  await openView(page,'Nur HDMI');
  await expect(page.getByRole('button',{name:'Live',exact:true})).toBeVisible();
  await expect(page.getByLabel('Übergang beim Anzeigen')).toHaveCount(0);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await expect(page.getByLabel('Übergang für Nur HDMI')).toHaveValue('smooth');
});

test('camera widget can be configured, bounded to one and removed in snapshot mode',async({page})=>{
  await mount(page);await openView(page,'Nur HDMI');
  await page.evaluate(()=>studio.insertCard('camera'));
  await expect(page.getByLabel('Kameraquelle',{exact:true})).toBeVisible();
  await page.getByLabel('Kameraquelle',{exact:true}).selectOption('entity');
  await page.getByLabel('Home-Assistant-Entität').fill('camera.door');
  await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await page.getByLabel('Wiedergabe',{exact:true}).selectOption('snapshot');
  await page.getByLabel('Standbild-Abstand (s)').fill('3');
  await page.getByLabel('Standbild-Abstand (s)').press('Tab');
  await page.evaluate(()=>studio.insertCard('camera'));
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').length)).toBe(1);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.hdmi_full.elements.find(i=>i.kind==='camera').camera_interval)).toBe(3);
  expect(await page.locator('.scene video').count()).toBe(0);
  await page.getByRole('button',{name:'Element entfernen',exact:true}).click();
  await expect(page.locator('.scene .lg-camera')).toHaveCount(0);
});

test('multicast widget exposes its address, preserves it on save and blocks HDMI overlap',async({page})=>{
  await mount(page);await openView(page,'Nur HDMI');
  await page.evaluate(()=>studio.insertCard('camera'));
  await page.getByLabel('Kameraquelle',{exact:true}).selectOption('multicast');
  await page.getByLabel('Multicast-Adresse').fill('udp://239.255.20.35:15000');
  await page.getByLabel('Multicast-Adresse').press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.flash')).toContainText('überlappen');
  await page.evaluate(()=>{studio.scene.elements=studio.scene.elements.filter(e=>e.kind!=='hdmi');studio.changed(true);});
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  expect(await page.evaluate(()=>saved.scenes.hdmi_full.elements.find(e=>e.kind==='camera').multicast_url)).toBe('udp://239.255.20.35:15000');
  await expect(page.locator('.scene video')).toHaveCount(0);
});

test('fixed startup view exposes only offline content, persists edits, resets and cannot be deleted',async({page})=>{
  await mount(page);
  const card=page.locator('.view-card').filter({has:page.getByRole('heading',{name:'Startanzeige',exact:true})});
  await expect(card.getByRole('button',{name:'Löschen',exact:true})).toHaveCount(0);
  await expect(card.getByRole('button',{name:'Anzeigen',exact:true})).toHaveCount(0);
  await openView(page,'Startanzeige');
  await expect(page.getByLabel('Name der Ansicht')).toBeDisabled();
  expect(await page.evaluate(()=>Object.keys(studio.availableKinds))).toEqual(['logo','animation','clock','text']);
  await expect(page.locator('.cover-background-tools')).toBeHidden();
  await expect(page.locator('.room-suggestions')).toBeHidden();
  await expect(page.locator('#sun-entity')).toBeHidden();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  await page.locator('.layer .name').first().click();
  await expect(page.getByLabel('Widget-Typ')).toHaveCount(0);
  await page.getByLabel('Text',{exact:true}).fill('Willkommen zuhause');await page.getByLabel('Text',{exact:true}).press('Tab');
  await enableStyling(page);
  await page.locator('.appearance-controls').getByRole('button',{name:'Sonnenstand',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('dawn');
  await addElement(page,'clock');
  await expect(page.locator('.scene .lg-clock')).toBeVisible();
  const before=await page.evaluate(()=>JSON.stringify(studio.scene));
  await page.evaluate(()=>studio.insertCard('weather','weather.home'));
  expect(await page.evaluate(()=>JSON.stringify(studio.scene))).toBe(before);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.startup.elements.some(i=>i.text==='Willkommen zuhause'))).toBe(true);
  expect(await page.evaluate(()=>saved.scenes.startup.elements.every(i=>['text','clock'].includes(i.kind)))).toBe(true);
  await page.getByRole('button',{name:'Element entfernen',exact:true}).click();
  await expect(page.locator('.scene .lg-clock')).toHaveCount(0);
  await page.getByRole('button',{name:'Standard wiederherstellen',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.some(i=>i.text==='Willkommen zuhause'))).toBe(false);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.some(i=>i.text==='Willkommen zuhause'))).toBe(true);
  await page.evaluate(()=>studio.deleteView('startup'));
  expect(await page.evaluate(()=>studio.config.views.some(v=>v.id==='startup'))).toBe(true);
  await expect(page.locator('.scene .lg-value').filter({hasText:'Willkommen zuhause'})).toBeVisible();
  await expect(page.locator('.scene')).toHaveCSS('background-image',/gradient/);
  const stage=await page.locator('.stage').boundingBox(),preview=await page.locator('.scene').boundingBox();
  expect(preview.height).toBeGreaterThan(300);expect(Math.abs(preview.height-stage.height)).toBeLessThan(2);
  await page.screenshot({path:test.info().outputPath('startup-editor.png'),fullPage:true});
});


test('startup editor distinguishes unsaved, pending and display-confirmed offline designs',async({page})=>{
  await mount(page);await openView(page,'Startanzeige');
  await expect(page.locator('.startup-cache-status')).toContainText('nicht verbunden');
  await page.evaluate(async()=>{window.startupStatus={connected:true,stored:false};await studio.refreshValues();});
  await expect(page.locator('.startup-cache-status')).toContainText('ausstehend');
  await page.evaluate(async()=>{window.startupStatus={connected:true,stored:true};await studio.refreshValues();});
  await expect(page.locator('.startup-cache-status')).toContainText('Auf dem Display gespeichert');
  await page.evaluate(()=>{studio.scene.color='#123456';studio.changed();});
  await expect(page.locator('.startup-cache-status')).toContainText('Entwurf noch nicht gespeichert');
  await page.evaluate(async()=>{window.revision++;await studio.refreshValues();});
  await expect(page.locator('.startup-cache-status')).toContainText('anderen Sitzung');
  await openView(page,'Dashboard');
  await expect(page.locator('.startup-cache-status')).toBeHidden();
});

test('Studio buffers covers during authenticated fetches and exposes confirmed failures',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  await page.evaluate(png=>{
    window.fetches=[];window.replies=[];
    const player={entity_id:'media_player.sonos',state:'playing',attributes:{entity_picture:'/art',media_title:'One'}};hass.states[player.entity_id]=player;
    studio.scene.elements[0].entity_id=player.entity_id;
    Object.assign(studio.scene,{media_background_enabled:true,media_background_entity:player.entity_id,media_background_fit:'colors'});
    hass.fetchWithAuth=(url,options)=>new Promise((resolve,reject)=>{
      fetches.push({title:player.attributes.media_title,url,signal:options.signal});
      options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
      replies.push(ok=>resolve(ok?new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}):new Response('',{status:500})));
    });
    studio.paint();
  },fs.readFileSync('tests/fixtures/media-cover.png').toString('base64'));
  await expect.poll(()=>page.evaluate(()=>fetches.length)).toBeGreaterThan(0);
  await expect(page.locator('.scene .lg-media-placeholder')).toBeHidden();
  await page.evaluate(()=>{replies.splice(0).forEach(reply=>reply(true));});
  await expect(page.locator('.scene .lg-media-art')).toHaveClass(/loaded/);
  await expect(page.locator('.scene .lg-cover-background')).toHaveClass(/loaded/);
  const previous=await page.locator('.scene .lg-media-art img').getAttribute('src');
  const background=await page.locator('.scene .lg-cover-background').evaluate(n=>n.style.background);
  await page.evaluate(()=>{hass.states['media_player.sonos'].attributes.media_title='Two';studio.paint();});
  await expect.poll(()=>page.evaluate(()=>fetches.some(f=>f.title==='Two'))).toBe(true);
  await expect(page.locator('.scene .lg-media-art img')).toHaveAttribute('src',previous);
  expect(await page.locator('.scene .lg-cover-background').evaluate(n=>n.style.background)).toBe(background);
  await expect(page.locator('.scene .lg-media-placeholder')).toBeHidden();
  await page.evaluate(()=>{hass.states['media_player.sonos'].attributes.media_title='Three';studio.paint();});
  await expect.poll(()=>page.evaluate(()=>fetches.filter(f=>f.title==='Two').every(f=>f.signal.aborted))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>fetches.some(f=>f.title==='Three'))).toBe(true);
  // Releasing old rejected requests must not clear the latest pending fetch.
  await page.evaluate(()=>{replies.splice(0).forEach(reply=>reply(true));});
  await expect(page.locator('.scene .lg-media-art img')).not.toHaveAttribute('src',previous);
  await expect(page.locator('.scene .lg-media-placeholder')).toBeHidden();
  await page.evaluate(()=>{hass.states['media_player.sonos'].attributes.media_title='Bad';studio.paint();});
  await expect.poll(()=>page.evaluate(()=>fetches.some(f=>f.title==='Bad'))).toBe(true);
  await page.evaluate(()=>{replies.splice(0).forEach(reply=>reply(false));});
  await expect(page.locator('.scene .lg-media-placeholder')).toBeVisible();
  await expect(page.locator('.scene .lg-cover-background')).not.toHaveClass(/loaded/);
  const failed=await page.evaluate(()=>fetches.length);
  await page.evaluate(()=>studio.paint());await page.waitForTimeout(1100);
  expect(await page.evaluate(()=>fetches.length)).toBe(failed);
});

test('Studio cancels pending cover fetches when disconnected',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  await page.evaluate(()=>{
    hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{entity_picture:'/art',media_title:'Pending'}};
    Object.assign(studio.scene,{media_background_enabled:true,media_background_entity:'media_player.sonos'});
    window.signals=[];hass.fetchWithAuth=(url,options)=>new Promise((resolve,reject)=>{signals.push(options.signal);options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});studio.paint();
  });
  await expect.poll(()=>page.evaluate(()=>signals.length)).toBeGreaterThan(0);
  await page.evaluate(()=>studio.remove());
  expect(await page.evaluate(()=>signals.every(signal=>signal.aborted))).toBe(true);
});

const viewContent=page=>page.evaluate(()=>studio.config.views.map(v=>({id:v.id,elements:v.scene.elements.map(({color,background,accent_color,...item})=>item)})));

test('global themes preserve layout and content, manual appearance overrides can return to inheritance',async({page})=>{
  await mount(page);
  const before=await viewContent(page);
  await expect(page.getByRole('heading',{name:'Themes & Hintergründe'})).toBeVisible();
  await expect(page.locator('.template-options .builtin-theme')).toHaveCount(4);
  await page.getByRole('button',{name:'Aurora als Standard-Theme',exact:true}).click();
  expect(await viewContent(page)).toEqual(before);
  expect(await page.evaluate(()=>studio.config.views.every(v=>v.scene.background==='aurora'&&!v.theme_override))).toBe(true);
  await openView(page,'Dashboard');
  await page.locator('.layer .name').filter({hasText:'Text'}).click();
  await page.getByLabel('Text',{exact:true}).fill('Bleibt erhalten');await page.getByLabel('Text',{exact:true}).press('Tab');
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(false);
  await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(true);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Sonnenstand als Standard-Theme',exact:true}).click();
  expect(await page.evaluate(()=>studio.config.scenes.dashboard.background)).toBe('sand');
  expect(await page.evaluate(()=>studio.config.scenes.pip_view.background)).toBe('solar');
  expect(await page.evaluate(()=>studio.config.scenes.startup.background)).toBe('dawn');
  await openView(page,'Dashboard');
  await page.locator('[data-action=theme-follow]').click();
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(false);
  expect(await page.evaluate(()=>studio.scene.background)).toBe('solar');
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='text').text)).toBe('Bleibt erhalten');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();
  await expect(page.locator('.theme-manager-status')).toContainText('Standard: Sonnenstand');
  expect(await page.evaluate(()=>saved.active_theme)).toBe('morning');
});

test('view cover settings stay independent of shared themes, inheritance and undo on mobile',async({page})=>{
  await mount(page,390);
  await page.evaluate(()=>{hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'idle',attributes:{friendly_name:'Sonos Wohnzimmer'}};studio.hass={...hass};});
  await openView(page,'Mediaplayer');
  await expect(page.locator('#own-styling')).not.toBeChecked();
  await expect(page.locator('.appearance-controls')).toBeHidden();
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toBeVisible();
  const rooms=await page.locator('.room-suggestions').boundingBox(),cover=await page.locator('.cover-background-tools').boundingBox(),styling=await page.locator('.view-styling').boundingBox();
  expect(cover.y).toBeGreaterThanOrEqual(rooms.y+rooms.height);
  expect(styling.y).toBeGreaterThanOrEqual(cover.y+cover.height);
  await page.locator('#media-background-entity').selectOption('media_player.sonos');
  await page.locator('#media-background-enabled').check();
  await page.locator('#media-background-fit').selectOption('colors');
  await page.locator('#media-background-color-source').selectOption('cover');
  await expect(page.locator('#own-styling')).not.toBeChecked();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await expect(page.locator('.cover-background-tools')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByLabel('Name des Themes').fill('Wohnzimmer');await page.getByLabel('Name des Themes').press('Tab');
  await page.locator('#background').selectOption('solar');
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await setColor(page.locator('#theme-ink'),'#fedcba');
  await page.locator('[data-action=theme-use]').click();
  const id=await page.locator('#theme-id').inputValue();
  const settings=await page.evaluate(()=>({theme:studio.theme,views:studio.config.views}));
  expect(settings.theme.style.media_background_entity).toBe('');
  for(const v of settings.views){
    expect(v.scene.media_background_enabled).toBe(v.id==='media_view');
    expect(v.scene.media_background_color_source).toBe(v.id==='media_view'?'cover':'edges');
    expect(v.scene.media_background_entity).toBe(v.id==='media_view'?'media_player.sonos':'');
    for(const item of v.scene.elements)if(item.kind!=='hdmi')expect(item.color).toBe('#fedcba');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Wohnzimmer Theme löschen',exact:true}).click();
  expect(await page.evaluate(()=>studio.config.active_theme)).toBe('cinema');
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.config.active_theme)).toBe(id);
  await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Neue Quelle');
  await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.media_background_entity)).toBe('');
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(false);
  await openView(page,'Mediaplayer');
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.sonos');
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).toBeChecked();
  await page.locator('#own-styling').check();
  await page.locator('#own-styling').uncheck();
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).toBeChecked();
  await expect(page.getByLabel('Farben für den Hintergrund')).toHaveValue('cover');
  await expect(page.locator('[data-action=reset-view]')).toBeHidden();
  await page.locator('#clear-background-player').click();
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('');
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(page.getByLabel('Hintergrund-Medienplayer',{exact:true})).toHaveValue('media_player.sonos');
  await expect(page.getByLabel('Bei Wiedergabe anzeigen')).toBeChecked();
});

test('theme palette remains editable without any dashboard widgets and undo restores theme draft',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{studio.config.views.find(v=>v.id==='dashboard').scene.elements=[];studio.compileViews();studio.renderOverview();});
  await expect(page.getByRole('button',{name:'Cinema Theme bearbeiten',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await setColor(page.locator('#theme-ink'),'#112233');
  expect(await page.evaluate(()=>studio.theme.style.ink)).toBe('#112233');
  await page.getByTitle('Rückgängig',{exact:true}).click();
  expect(await page.evaluate(()=>studio.theme.style.ink)).not.toBe('#112233');
  await page.getByTitle('Wiederholen',{exact:true}).click();
  expect(await page.locator('#theme-ink').evaluate(el=>{const expected=el.cloneNode();expected.value='#112233';return el.value===expected.value;})).toBe(true);
  await page.locator('[data-action=theme-use]').click();
  expect(await page.evaluate(()=>studio.config.scenes.overlay.elements.find(i=>i.kind!=='hdmi').color)).toBe('#112233');
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Theme Theme löschen',exact:true}).click();
  expect(await page.evaluate(()=>studio.config.themes[0].style.ink)).not.toBe('#112233');
  expect(await page.evaluate(()=>studio.config.scenes.dashboard.elements)).toEqual([]);
});

for(const width of [1500,390])test(`fixed colour tiles and plus create an editable reusable theme at ${width}px`,async({page})=>{
  await mount(page,width);
  const defaults=await page.evaluate(()=>JSON.stringify(studio.config.themes));
  await expect(page.locator('.template-options .builtin-theme')).toHaveCount(4);
  await expect(page.locator('.template-options [data-edit-theme]')).toHaveCount(0);
  await expect(page.locator('[data-reset-theme]')).toHaveCount(0);
  await page.evaluate(()=>studio.openTheme('cinema'));
  await expect(page.locator('.overview')).toBeVisible();
  await openView(page,'Dashboard');await enableStyling(page);
  await expect(page.locator('.presets [data-theme]')).toHaveCount(4);
  await expect(page.locator('.presets [data-new-theme]')).toBeVisible();
  await expect(page.locator('.presets [data-edit-theme]')).toHaveCount(0);
  await expect(page.locator('.theme-palette')).toBeHidden();
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  const widgets=await page.evaluate(()=>studio.scene.elements.map(({color,background,accent_color,...rest})=>rest));
  await page.locator('.presets').getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await expect(page.getByLabel('Name des Themes')).toHaveValue('Mein Theme');
  await page.getByLabel('Name des Themes').fill('Mein Abend');await page.getByLabel('Name des Themes').press('Tab');
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await setColor(page.getByLabel('Textfarbe',{exact:true}),'#abcdef');
  await page.getByRole('tab',{name:'Hintergrund',exact:true}).click();
  await page.getByRole('combobox',{name:'Hintergrund',exact:true}).selectOption('ocean');
  await page.getByRole('button',{name:'Für diese Ansicht verwenden',exact:true}).click();
  await expect(page.getByLabel('Name der Ansicht')).toHaveValue('Dashboard');
  await expect(page.locator('.presets [data-theme]')).toHaveCount(5);
  await expect(page.locator('.presets').getByRole('button',{name:'Mein Abend Theme bearbeiten',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>studio.scene.elements.filter(e=>e.kind!=='hdmi').every(e=>e.color==='#abcdef'))).toBe(true);
  expect(await page.evaluate(()=>studio.scene.background)).toBe('ocean');
  await expect(page.locator('#theme-panel-background')).toBeHidden();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  const live=await page.evaluate(()=>calls.filter(c=>c[0]==='POST' && c[1].startsWith('display_studio/layout_live/')).at(-1)[2].config.views.find(v=>v.id==='dashboard').scene);
  expect(live.background).toBe('ocean');
  expect(live.elements.filter(e=>e.kind!=='hdmi').every(e=>e.color==='#abcdef')).toBe(true);
  await page.getByRole('button',{name:'Live',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.map(({color,background,accent_color,...rest})=>rest))).toEqual(widgets);
  expect(await page.evaluate(()=>JSON.stringify(studio.config.themes.slice(0,4)))).toBe(defaults);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();
  await openView(page,'Dashboard PiP');await enableStyling(page);
  await page.locator('.presets').getByRole('button',{name:'Mein Abend',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('ocean');
  await expect(page.locator('.theme-palette')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

for(const width of [1500,390])test(`theme tabs show only relevant settings and preserve drafts across background modes at ${width}px`,async({page})=>{
  await mount(page,width);
  await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  const tabs=page.getByRole('tablist',{name:'Theme-Einstellungen',exact:true});
  const background=page.getByRole('tab',{name:'Hintergrund',exact:true});
  await expect(tabs).toBeVisible();
  await expect(background).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel',{name:'Hintergrund',exact:true})).toBeVisible();
  await expect(page.getByLabel('Textfarbe',{exact:true})).toBeHidden();
  await expect(page.locator('.presets')).toBeHidden();
  const before=await page.evaluate(()=>JSON.stringify(studio.config));
  await background.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Text & Karten',exact:true})).toBeFocused();
  await expect(page.getByLabel('Textfarbe',{exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).press('Home');
  await expect(background).toBeFocused();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab',{name:'Vorlage',exact:true})).toHaveCount(0);
  await expect(page.locator('.presets')).toBeHidden();
  await background.press('End');
  await expect(page.getByRole('tab',{name:'Text & Karten',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
  await background.click();
  const mode=page.getByRole('combobox',{name:'Hintergrund',exact:true});
  for(const value of ['solid','sand','aurora','dawn','ocean','midnight','gradient','solar','image']){
    await mode.selectOption(value);
    await expect(page.getByLabel('Grundfarbe',{exact:true})).toBeVisible({visible:value!=='solar'});
    await expect(page.getByLabel('Akzent',{exact:true})).toBeVisible({visible:['aurora','dawn','ocean','midnight','gradient'].includes(value)});
    await expect(page.getByLabel('Verlaufswinkel',{exact:true})).toBeVisible({visible:value==='gradient'});
    await expect(page.getByLabel('Sonnenstand-Entität',{exact:true})).toBeVisible({visible:value==='solar'});
    await expect(page.getByRole('button',{name:'Bild hochladen',exact:true})).toBeVisible({visible:value==='image'});
  }
  await expect(page.getByRole('combobox',{name:'Bild einpassen',exact:true})).toBeHidden();
  await page.evaluate(()=>{studio.backgrounds=['a'.repeat(64)];studio.imageUrls['a'.repeat(64)]=null;studio.renderBackgrounds();});
  await page.getByRole('combobox',{name:'Eigenes Hintergrundbild',exact:true}).selectOption('a'.repeat(64));
  await page.getByRole('combobox',{name:'Bild einpassen',exact:true}).selectOption('contain');
  await expect(page.getByLabel('Bild abdunkeln',{exact:true})).toBeVisible();
  await mode.selectOption('gradient');
  await page.getByLabel('Verlaufswinkel',{exact:true}).press('ArrowRight');
  const angle=await page.locator('#gradient-angle').inputValue();
  await mode.selectOption('image');
  await expect(page.getByRole('combobox',{name:'Bild einpassen',exact:true})).toHaveValue('contain');
  await expect(page.getByLabel('Verlaufswinkel',{exact:true})).toBeHidden();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await setColor(page.getByLabel('Textfarbe',{exact:true}),'#123456');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const id=await page.evaluate(()=>studio.themeId);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Theme Theme bearbeiten',exact:true}).click();
  await expect(background).toHaveAttribute('aria-selected','true');
  await expect(mode).toHaveValue('image');
  await expect(page.getByRole('combobox',{name:'Bild einpassen',exact:true})).toHaveValue('contain');
  await expect(page.getByLabel('Verlaufswinkel',{exact:true})).toBeHidden();
  await mode.selectOption('gradient');
  await expect(page.locator('#gradient-angle')).toHaveValue(angle);
  expect(await page.evaluate(id=>saved.themes.find(t=>t.id===id).style.ink,id)).toBe('#123456');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

async function widgetEditor(page,label) {
  await page.evaluate(label=>{const button=[...studio.shadowRoot.querySelectorAll('[data-edit-widget]')].find(b=>b.getAttribute('aria-label')===label+' Einstellungen öffnen');studio.editContentsForTest(button.dataset.editWidget);},label);
  return page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
}

test('clock pencil opens independent date/time composition with content, fonts, geometry and reset',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  const original=await page.evaluate(()=>JSON.parse(JSON.stringify(studio.scene.elements.find(i=>i.kind==='clock'))));
  const editor=await widgetEditor(page,'Uhr & Datum');
  await ownWidgetStyle(page);
  await editor.locator('[data-widget-size]').selectOption('custom');
  await expect(editor.getByLabel('Inhaltselement',{exact:true}).locator('option')).toHaveText(['Uhrzeit','Datum']);
  await editor.getByLabel('Uhr-Anzeige').selectOption('date');
  await expect(editor.locator('.lg-value')).toBeHidden();await expect(editor.locator('.lg-detail')).toBeVisible();
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('date');
  await editor.getByLabel('Inhalt links (%)').fill('15');await editor.getByLabel('Inhalt links (%)').press('Tab');
  await editor.getByLabel('Inhalt Schriftgröße (%)').fill('18');await editor.getByLabel('Inhalt Schriftgröße (%)').press('Tab');
  await editor.getByLabel('Inhalt Schrift',{exact:true}).selectOption('serif');
  await editor.getByLabel('Datumsformat').selectOption('iso');
  await expect(editor.locator('.lg-detail')).toHaveText(/\d{4}-\d{2}-\d{2}/);
  await expect(editor.locator('.lg-detail')).toHaveCSS('font-family',/StudioSerif/);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const savedClock=await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='clock'));
  expect(savedClock.parts.time.visible).toBe(false);expect(savedClock.parts.date.font_size).toBe(18);expect(savedClock.x).toBe(original.x);expect(savedClock.width).toBe(original.width);
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(false);
  await widgetEditor(page,'Uhr & Datum');
  await editor.getByRole('button',{name:'Inhalt-Layout zurücksetzen'}).click();
  await expect(editor.locator('.lg-value')).toBeVisible();
  expect(await page.evaluate(()=>studio.item.parts)).toEqual(await page.evaluate(()=>studio.catalog.widget_defaults.clock.parts));
  expect(await page.evaluate(()=>studio.item.show_label)).toBe(false);
  await editor.getByTitle('Widget-Änderung rückgängig').click();
  await expect(editor.getByLabel('Uhr-Anzeige')).toHaveValue('date');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,'Dashboard');await widgetEditor(page,'Uhr & Datum');
  await expect(editor.getByLabel('Uhr-Anzeige')).toHaveValue('date');
});

test('media widget parts drag and resize independently, can be removed and restored without losing entity or cover',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  await page.locator('.layer .name').filter({hasText:'JETZT LÄUFT'}).click();
  await page.getByLabel('Home-Assistant-Entität').fill('media_player.sonos');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  const editor=await widgetEditor(page,'JETZT LÄUFT');
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('title');
  await expect(editor.locator('.part-outline')).toBeVisible();
  const before=await editor.locator('.lg-media-art').boundingBox();
  let box=await editor.locator('.part-outline').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-20,box.y+box.height/2+12);await page.mouse.up();
  expect(await page.evaluate(()=>studio.item.parts.title.x)).toBeLessThan(53);
  const after=await editor.locator('.lg-media-art').boundingBox();for(const key of ['x','y','width','height'])expect(after[key]).toBeCloseTo(before[key],1);
  box=await editor.locator('.part-resize').boundingBox();await page.mouse.move(box.x+6,box.y+6);await page.mouse.down();await page.mouse.move(box.x-30,box.y+15);await page.mouse.up();
  const changed=await page.evaluate(()=>studio.item.parts.title);
  expect(changed.width+changed.x).toBeLessThanOrEqual(100.01);
  await editor.getByLabel('Textquelle').selectOption('custom');
  await editor.getByLabel('Eigener Inhalt').fill('<img src=x onerror=window.hacked=true>');await editor.getByLabel('Eigener Inhalt').press('Tab');
  await expect(editor.locator('.lg-value')).toHaveText('<img src=x onerror=window.hacked=true>');
  expect(await page.evaluate(()=>window.hacked)).toBeUndefined();
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('cover');
  const coverBefore=await editor.locator('.lg-media-art').boundingBox();let coverHandle=await editor.locator('.part-resize').boundingBox();
  await page.mouse.move(coverHandle.x+6,coverHandle.y+6);await page.mouse.down();await page.mouse.move(coverHandle.x-25,coverHandle.y+6);await page.mouse.up();
  const coverLocked=await editor.locator('.lg-media-art').boundingBox();expect(coverLocked.width/coverLocked.height).toBeCloseTo(coverBefore.width/coverBefore.height,2);
  await editor.getByLabel('Seitenverhältnis beibehalten',{exact:true}).uncheck();coverHandle=await editor.locator('.part-resize').boundingBox();
  await page.mouse.move(coverHandle.x+6,coverHandle.y+6);await page.mouse.down();await page.mouse.move(coverHandle.x-25,coverHandle.y+6);await page.mouse.up();
  const coverFree=await editor.locator('.lg-media-art').boundingBox();expect(coverFree.height).toBeCloseTo(coverLocked.height,1);expect(coverFree.width).toBeLessThan(coverLocked.width);
  await editor.getByRole('button',{name:'Inhalt entfernen',exact:true}).click();await expect(editor.locator('.lg-media-art')).toBeHidden();
  await editor.getByLabel('Element anzeigen').check();await expect(editor.locator('.lg-media-art')).toBeVisible();
  await editor.getByRole('button',{name:'Inhalt-Layout zurücksetzen'}).click();
  expect(await page.evaluate(()=>studio.item.entity_id)).toBe('media_player.sonos');expect(await page.evaluate(()=>studio.item.media_style)).toBe('stage');
  // Reset layout preserves intentionally entered content.
  await expect(editor.locator('.lg-value')).toHaveText('<img src=x onerror=window.hacked=true>');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>['media_player','display_studio'].includes(c[0])))).toEqual([]);
});

for(const mode of ['daily','hourly','current'])test('weather label resizing keeps every other weather element in place: '+mode,async({page},testInfo)=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(mode=>{
    const item=studio.scene.elements.find(i=>i.kind==='weather');
    Object.assign(item,{entity_id:'weather.home',width:65,height:65,font_size:6,manual_size:true,style_override:true,forecast_type:mode,forecast_count:3,parts:{}});
    studio.scene.glass=true;
    Object.assign(hass.states['weather.home'].attributes,{wind_speed:14,wind_speed_unit:'km/h',uv_index:3.5});
    studio.backendValues={'weather.home':{forecasts:{[mode]:[1,2,3].map(day=>({datetime:`2026-10-${27+day}T12:00:00Z`,condition:'rainy',temperature:18,templow:9,precipitation_probability:40}))}}};
    studio.select(item.id);studio.paint();
  },mode);
  const editor=await widgetEditor(page,'Dein Wetter');
  await editor.locator('[data-part]').selectOption('label');
  const capture=()=>editor.evaluate(root=>{
    const selectors=['.lg-weather > .lg-value','.lg-weather > .lg-detail','.lg-weather > .lg-weather-icon','.lg-forecast-period','.lg-period-time','.lg-forecast-period .lg-weather-icon','.lg-period-temp','.lg-period-low','.lg-period-rain','.lg-weather-metric'];
    const origin=root.querySelector('.lg-weather').getBoundingClientRect();
    return selectors.flatMap(selector=>[...root.querySelectorAll(selector)].map((el,i)=>{const r=el.getBoundingClientRect();return {id:selector+'/'+i,x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height,font:getComputedStyle(el).fontSize};})).filter(r=>r.width&&r.height);
  });
  const before=await capture(),label=await editor.locator('.lg-label').boundingBox();
  const unchanged=async()=>{const after=await capture();expect(after.map(p=>p.id)).toEqual(before.map(p=>p.id));for(let i=0;i<before.length;i++){expect(after[i].font,before[i].id+' font').toBe(before[i].font);for(const key of ['x','y','width','height'])expect(Math.abs(after[i][key]-before[i][key]),before[i].id+' '+key).toBeLessThan(1.5);}};
  const handle=await editor.locator('.part-resize').boundingBox();
  await page.keyboard.down('Alt');await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+45,handle.y+handle.height/2+15,{steps:6});await page.mouse.up();await page.keyboard.up('Alt');
  expect((await editor.locator('.lg-label').boundingBox()).height).toBeGreaterThan(label.height);
  await unchanged();
  const state=()=>page.evaluate(()=>({view:'dashboard',layout:{config:{scenes:{dashboard:studio.scene}},values:studio.values(),now:'2026-10-27T12:00:00+00:00',timezone:'Europe/Berlin'}}));
  const resized=await state(),siblings=await page.evaluate(()=>Object.fromEntries(Object.entries(studio.item.parts).filter(([key])=>key!=='label')));
  const font=editor.locator('[data-field=font_size]');await font.fill(String(Number(await font.inputValue())*.7));await font.press('Tab');
  await unchanged();
  const left=editor.locator('[data-field=x]');await left.fill('10');await left.press('Tab');await unchanged();
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(studio.item.parts).filter(([key])=>key!=='label')))).toEqual(siblings);
  expect(await page.evaluate(()=>LGWidgetParts.valid(studio.item))).toBe(true);
  const edited=await state();
  fs.writeFileSync(path.resolve('test-results/test-logs/weather-label-layout-'+mode+'-'+testInfo.project.name+'.json'),JSON.stringify({resized,edited}));
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await widgetEditor(page,'Dein Wetter');await unchanged();
  expect(await page.evaluate(()=>studio.item.parts)).toEqual(edited.layout.config.scenes.dashboard.elements.find(i=>i.kind==='weather').parts);
});

test('widget editor remains usable on a phone, updates live and exposes all weather and calendar parts',async({page})=>{
  await mount(page,390);await openView(page,'Dashboard');
  await page.locator('.layer .name').filter({hasText:'Dein Wetter'}).click();await page.getByLabel('Home-Assistant-Entität').fill('weather.home');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  const editor=await widgetEditor(page,'Dein Wetter');
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('temperature');
  await expect(editor.locator('.lg-value')).toHaveText('23 °C');
  await page.evaluate(()=>{hass.states['weather.home'].attributes.temperature=24;studio.hass={...hass};});
  await expect(editor.locator('.lg-value')).toHaveText('24 °C');
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('forecast_4_rain');
  await editor.getByRole('button',{name:'Inhalt entfernen',exact:true}).click();
  expect(await page.evaluate(()=>studio.item.parts.forecast_4_rain.visible)).toBe(false);
  expect(await editor.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await widgetEditor(page,'DEIN TAG');
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('row_6_value');
  await editor.getByLabel('Textquelle').selectOption('custom');await editor.getByLabel('Eigener Inhalt').fill('Kalendertext');await editor.getByLabel('Eigener Inhalt').press('Tab');
  expect(await page.evaluate(()=>studio.item.parts.row_6_value.text)).toBe('Kalendertext');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await expect(page.locator('.status')).toHaveText('Gespeichert');
});

test('browser display hides HDMI and hardware PiP and exposes its own display link',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{studio.catalog.entries[0].provider='browser';studio.catalog.entries[0].capabilities={hdmi:false,pip:false,startup:false};studio.viewId='dashboard';studio.mount();});
  await expect(page.getByRole('heading',{name:'Nur HDMI',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Dashboard PiP',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Anzeigelink',exact:true})).toBeVisible();
  await openView(page,'Dashboard');
  await expect(page.getByRole('button',{name:'Nur HDMI anzeigen',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'Dashboard PiP anzeigen',exact:true})).toBeHidden();
  expect(await page.evaluate(()=>Object.values(studio.availableKinds))).not.toContain('HDMI / PiP');
});

for(const width of [1500,390])test(`own styling follows the theme, preserves content and restores overrides with undo at ${width}px`,async({page})=>{
  await mount(page,width);
  await page.getByRole('button',{name:'Aurora als Standard-Theme',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await openView(page,'Dashboard');
  const toggle=page.locator('#own-styling');
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.appearance-controls')).toBeHidden();
  const rooms=await page.locator('.room-suggestions').boundingBox(),styling=await page.locator('.view-styling').boundingBox();
  expect(styling.y).toBeGreaterThanOrEqual(rooms.y+rooms.height);
  const widgets=await page.evaluate(()=>JSON.stringify(studio.scene.elements));
  await toggle.check();
  await expect(page.locator('.appearance-controls')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(studio.scene.elements))).toBe(widgets);
  await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await openView(page,'Nur HDMI');await openView(page,'Dashboard');
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('sand');
  await toggle.uncheck();
  await expect(page.locator('.appearance-controls')).toBeHidden();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('aurora');
  expect(await page.evaluate(()=>JSON.stringify(studio.scene.elements))).toBe(widgets);
  await page.getByTitle('Rückgängig',{exact:true}).click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.appearance-controls')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
  expect(await page.evaluate(()=>studio.scene.background)).toBe('sand');
  await expect(page.locator('[data-action=reset-view]')).toBeHidden();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.appearance-controls')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

for(const width of [1500,390])test(`image backgrounds keep edge fill and locked or independent percent sizes through save and undo at ${width}px`,async({page})=>{
  await mount(page,width);await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await page.getByRole('combobox',{name:'Hintergrund',exact:true}).selectOption('image');
  await page.evaluate(()=>{studio.backgrounds=['b'.repeat(64)];studio.imageUrls['b'.repeat(64)]=null;studio.renderBackgrounds();});
  await page.getByRole('combobox',{name:'Eigenes Hintergrundbild',exact:true}).selectOption('b'.repeat(64));
  const lock=page.getByLabel('Seitenverhältnis sperren',{exact:true}),x=page.getByLabel('Bildbreite (%)',{exact:true}),y=page.getByLabel('Bildhöhe (%)',{exact:true});
  await expect(lock).toBeChecked();
  await x.fill('70');await x.press('Tab');await expect(y).toHaveValue('70');
  await y.fill('60');await y.press('Tab');await expect(x).toHaveValue('60');
  await lock.uncheck();await y.fill('40');await y.press('Tab');await expect(x).toHaveValue('60');
  await page.getByRole('combobox',{name:'Fläche um das Bild',exact:true}).selectOption('edges');
  await expect(page.getByLabel('Grundfarbe',{exact:true})).toBeHidden();
  await expect(page.getByLabel('Akzent',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Theme Theme bearbeiten',exact:true}).click();
  await expect(x).toHaveValue('60');await expect(y).toHaveValue('40');await expect(lock).not.toBeChecked();
  await expect(page.getByRole('combobox',{name:'Fläche um das Bild',exact:true})).toHaveValue('edges');
  await lock.check();await expect(y).toHaveValue('60');
  await page.getByRole('button',{name:'↶',exact:true}).click();await expect(y).toHaveValue('40');await expect(lock).not.toBeChecked();
  await x.fill('0');await x.press('Tab');await expect(x).toHaveValue('60');
  await page.getByRole('combobox',{name:'Fläche um das Bild',exact:true}).selectOption('color');
  await expect(page.getByLabel('Grundfarbe',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('shared background renderer samples black-bordered images once and keeps sizing consistent at 4K, portrait and stretched',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,320,180);ctx.fillStyle='rgb(220,40,80)';ctx.fillRect(20,20,280,140);
    window.imageSource=canvas.toDataURL();window.samples=0;
    const read=CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData=function(...args){window.samples++;return read.apply(this,args);};
    window.testRoot=document.createElement('div');testRoot.style.cssText='position:absolute;width:3840px;height:2160px';document.body.append(testRoot);
    window.imageScene={background:'image',color:'#123456',accent:'#ffffff',image_id:'a',image_fit:'contain',image_dim:0,image_background:'edges',image_scale_x:70,image_scale_y:70,image_lock_ratio:true,elements:[]};
    window.imageRenderer=new LGLayoutRenderer(testRoot,document.createElement('div'),false);imageRenderer.render(imageScene,{}, {imageUrl:()=>imageSource});
  });
  await expect.poll(()=>page.evaluate(()=>testRoot.style.backgroundImage)).toContain('radial-gradient');
  const edge=await page.evaluate(()=>testRoot.style.backgroundImage.match(/radial-gradient\([^,]+, rgb\((\d+), (\d+), (\d+)\)/).slice(1).map(Number));
  // Resampling can blend the first content row with the black border.
  expect(edge[0]).toBeGreaterThan(160);expect(edge[1]/edge[0]).toBeCloseTo(40/220,1);expect(edge[2]/edge[0]).toBeCloseTo(80/220,1);
  expect(await page.evaluate(()=>testRoot.style.backgroundSize.split(',')[1].trim())).toBe('70% 70%');
  expect(await page.evaluate(()=>samples)).toBe(1);
  await page.evaluate(()=>{
    for(let i=0;i<5;i++)imageRenderer.render(imageScene,{}, {imageUrl:()=>imageSource});
    Object.assign(imageScene,{image_scale_y:40,image_lock_ratio:false});imageRenderer.render(imageScene,{}, {imageUrl:()=>imageSource});
  });
  expect(await page.evaluate(()=>samples)).toBe(1);
  expect(await page.evaluate(()=>testRoot.style.backgroundSize.split(',')[1].trim())).toBe('70% 40%');
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=320;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#2050f0';ctx.fillRect(0,0,160,320);window.portrait=canvas.toDataURL();
    Object.assign(imageScene,{image_scale_x:100,image_scale_y:100,image_lock_ratio:true});imageRenderer.render(imageScene,{}, {imageUrl:()=>portrait});
  });
  await expect.poll(()=>page.evaluate(()=>testRoot.style.backgroundSize.split(',')[1].trim())).toBe('28.125% 100%');
  await page.evaluate(()=>{imageScene.image_fit='cover';imageRenderer.render(imageScene,{}, {imageUrl:()=>portrait});});
  const size=await page.evaluate(()=>testRoot.style.backgroundSize.split(',')[1].trim().split(' ').map(parseFloat));
  expect(size[0]).toBe(100);expect(size[1]).toBeCloseTo(355.556,2);
  await page.evaluate(()=>{imageScene.image_background='color';imageRenderer.render(imageScene,{}, {imageUrl:()=>portrait});});
  expect(await page.evaluate(()=>testRoot.style.backgroundColor)).toBe('rgb(18, 52, 86)');
  expect(await page.evaluate(()=>testRoot.style.backgroundImage)).not.toContain('radial-gradient');
});

test('late or failed background image loads cannot restore a cleared or replaced scene',async({page})=>{
  await mount(page);let release;
  await page.route('http://studio.test/delayed.png',async route=>{await new Promise(resolve=>release=resolve);await route.fulfill({contentType:'image/png',body:fs.readFileSync('tests/fixtures/media-cover.png')});});
  await page.evaluate(()=>{
    window.testRoot=document.createElement('div');testRoot.style.cssText='width:1920px;height:1080px';document.body.append(testRoot);
    window.imageScene={background:'image',color:'#123456',accent:'#ffffff',image_id:'a',image_fit:'contain',image_dim:0,image_background:'edges',image_scale_x:50,image_scale_y:50,image_lock_ratio:true,elements:[]};
    window.imageRenderer=new LGLayoutRenderer(testRoot,document.createElement('div'),false);
    imageRenderer.render(imageScene,{}, {imageUrl:()=>'http://studio.test/delayed.png'});
  });
  await expect.poll(()=>!!release).toBe(true);
  await page.evaluate(()=>imageRenderer.clear());release();
  await expect.poll(()=>page.evaluate(()=>testRoot._lgBackgroundWaiter)).toBeNull();
  expect(await page.evaluate(()=>testRoot.style.background)).toBe('');
  await page.route('http://studio.test/missing.png',route=>route.fulfill({status:404,body:''}));
  await page.evaluate(()=>imageRenderer.render(imageScene,{}, {imageUrl:()=>'http://studio.test/missing.png'}));
  await expect.poll(()=>page.evaluate(()=>testRoot._lgBackgroundWaiter)).toBeNull();
  expect(await page.evaluate(()=>testRoot.style.backgroundColor)).toBe('rgb(18, 52, 86)');
  await page.evaluate(()=>imageRenderer.render({...imageScene,background:'solid',color:'#abcdef'},{}));
  expect(await page.evaluate(()=>testRoot.style.backgroundColor)).toBe('rgb(171, 205, 239)');
});

test('offline startup renders cached image geometry and edge colours without a server',async({page})=>{
  await mount(page);
  await page.evaluate(scene=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#2864a0';ctx.fillRect(0,0,320,180);
    Object.assign(scene,{background:'image',image_id:'a'.repeat(64),image_background:'edges',image_scale_x:65,image_scale_y:35,image_lock_ratio:false,text_font:'serif',text_weight:'700',text_italic:true,text_opacity:.5,surface_opacity:.3});
    localStorage.setItem('lg-display-startup-v1:/',JSON.stringify({schema:1,version:'b'.repeat(64),timezone:'Europe/Berlin',scene,image:canvas.toDataURL('image/jpeg')}));
  },catalog.presets[0].layout.scenes.startup);
  await page.addScriptTag({content:fs.readFileSync('custom_components/display_studio/www/runtime/startup-design.js','utf8')});
  await page.evaluate(()=>{
    window.offlineRoot=document.createElement('div');offlineRoot.style.cssText='width:1920px;height:1080px';document.body.append(offlineRoot);LGStartupDesign.render(offlineRoot);
  });
  await expect.poll(()=>page.evaluate(()=>offlineRoot.style.backgroundImage)).toContain('radial-gradient');
  expect(await page.evaluate(()=>offlineRoot.style.backgroundSize.split(',')[1].trim())).toBe('65% 35%');
  expect(await page.evaluate(()=>LGStartupDesign.status().image_cached)).toBe(true);
  expect(await page.evaluate(()=>getComputedStyle(offlineRoot.querySelector('.lg-value')).fontWeight)).toBe('700');
  expect(await page.evaluate(()=>getComputedStyle(offlineRoot.querySelector('.lg-value')).fontStyle)).toBe('italic');
  expect(await page.evaluate(()=>getComputedStyle(offlineRoot.querySelector('.lg-widget')).color)).toContain('0.5');
  await page.evaluate(()=>LGStartupDesign.stop());
});

for(const width of [1500,390])test(`theme typography and independent transparency persist without fading artwork at ${width}px`,async({page})=>{
  await mount(page,width);await page.getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await page.getByRole('combobox',{name:'Schriftart',exact:true}).selectOption('serif');
  await page.getByRole('combobox',{name:'Schriftstärke',exact:true}).selectOption('700');
  await page.getByLabel('Kursiv',{exact:true}).check();await page.getByLabel('Unterstrichen',{exact:true}).check();
  for(const [name,value] of [['Textgröße (%)','125'],['Texttransparenz (%)','35'],['Kartentransparenz (%)','60'],['Akzenttransparenz (%)','80']]){
    await page.getByLabel(name,{exact:true}).fill(value);await page.getByLabel(name,{exact:true}).press('Tab');
  }
  await expect(page.locator('.scene .lg-clock .lg-value')).toHaveCSS('font-weight','700');
  await expect(page.locator('.scene .lg-clock .lg-value')).toHaveCSS('font-style','italic');
  await expect(page.locator('.scene .lg-clock .lg-value')).toHaveCSS('text-decoration-line','underline');
  expect(await page.locator('.scene .lg-clock').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('StudioSerif');
  expect(await page.locator('.scene .lg-clock').evaluate(el=>getComputedStyle(el).color)).toContain('0.65');
  const id=await page.evaluate(()=>studio.themeId);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'Mein Theme Theme bearbeiten',exact:true}).click();
  await page.getByRole('tab',{name:'Text & Karten',exact:true}).click();
  await expect(page.getByLabel('Texttransparenz (%)',{exact:true})).toHaveValue('35');
  await expect(page.getByRole('combobox',{name:'Schriftstärke',exact:true})).toHaveValue('700');
  await page.getByRole('combobox',{name:'Schriftstärke',exact:true}).selectOption('auto');
  await expect(page.locator('.scene .lg-clock .lg-value')).toHaveCSS('font-weight','500');
  await page.getByRole('button',{name:'↶',exact:true}).click();
  await expect(page.locator('.scene .lg-clock .lg-value')).toHaveCSS('font-weight','700');
  const style=await page.evaluate(id=>saved.themes.find(t=>t.id===id).style,id);
  expect(style).toMatchObject({text_scale:125,text_opacity:.65,surface_opacity:.4,card_accent_opacity:.2,text_italic:true,text_underline:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('theme transparency separates text, card backgrounds and accents and respects explicit widget-part typography',async({page})=>{
  await mount(page);await openView(page,'Mediaplayer');
  await page.evaluate(()=>{
    const item=studio.scene.elements.find(e=>e.kind==='media');item.opacity=.8;item.show_cover=true;item.entity_id='media_player.test';item.accent_color='#6ee7d5';
    item.parts={title:{font:'mono',font_weight:400,font_size:12,color:'#ff0000'}};
    studio.hass.states[item.entity_id]={entity_id:item.entity_id,state:'playing',attributes:{friendly_name:'Music',media_title:'Titel',media_duration:240,media_position:20}};
    Object.assign(studio.scene,{text_font:'serif',text_weight:'700',text_italic:true,text_underline:true,text_scale:130,text_opacity:.5,surface_opacity:.25,card_accent_opacity:.4});studio.paint();
  });
  const media=page.locator('.scene .lg-media'),title=media.locator('.lg-value');
  await expect(title).toHaveCSS('font-family','StudioMono, sans-serif');await expect(title).toHaveCSS('font-weight','400');
  await expect(title).toHaveCSS('color','rgba(255, 0, 0, 0.5)');
  expect(await media.evaluate(el=>getComputedStyle(el).backgroundColor)).toContain('0.2');
  expect(await media.locator('.lg-media-fill').evaluate(el=>getComputedStyle(el).backgroundColor)).toContain('0.4');
  await expect(media).toHaveCSS('opacity','1');await expect(media.locator('.lg-media-art')).toHaveCSS('opacity','1');
  const size=await title.evaluate(el=>getComputedStyle(el).fontSize);
  await page.evaluate(()=>{studio.scene.text_scale=180;studio.scene.text_opacity=0;studio.scene.surface_opacity=0;studio.scene.card_accent_opacity=0;studio.paint();});
  await expect(title).toHaveCSS('font-size',size);await expect(title).toHaveCSS('color','rgba(255, 0, 0, 0)');
  await expect(media).toHaveCSS('background-color','rgba(18, 35, 51, 0)');
  await expect(media.locator('.lg-media-fill')).toHaveCSS('background-color','rgba(110, 231, 213, 0)');
  await expect(media.locator('.lg-media-art')).toHaveCSS('opacity','1');
  await page.evaluate(()=>{studio.scene.elements.find(e=>e.kind==='media').parts={};studio.scene.text_weight='auto';studio.scene.text_italic=false;studio.scene.text_underline=false;studio.paint();});
  await expect(title).toHaveCSS('font-weight','500');await expect(title).toHaveCSS('font-style','normal');await expect(title).toHaveCSS('text-decoration-line','none');
});

test('transparent theme weather surfaces, status accents and camera labels preserve their media and HDMI planes',async({page})=>{
  await mount(page);await openView(page,'Dashboard PiP');
  await page.evaluate(()=>{
    const weather=studio.scene.elements.find(e=>e.kind==='weather');weather.weather_style='sky';
    Object.assign(studio.scene,{surface_opacity:0,card_accent_opacity:0,text_opacity:0,text_scale:180});studio.paint();
  });
  const bg=await page.locator('.scene .lg-weather').evaluate(el=>getComputedStyle(el).backgroundImage);
  expect(bg).toContain('rgba');expect(bg).not.toMatch(/(?<!a)rgb\(/);
  await expect(page.locator('.scene .lg-weather .lg-weather-icon').first()).toHaveCSS('opacity','1');
  await expect(page.locator('.scene .lg-hdmi-placeholder')).toHaveCSS('opacity','1');
  await page.evaluate(()=>{
    const status=studio.scene.elements.find(e=>e.kind==='entity');status.kind='status';status.entity_id='switch.test';
    studio.hass.states['switch.test']={entity_id:'switch.test',state:'on',attributes:{friendly_name:'Test'}};studio.paint();
  });
  const accent=await page.locator('.scene .lg-status-icon').evaluate(el=>getComputedStyle(el).color);
  expect(accent).toMatch(/rgba\([\d, ]+, 0\)/);
  await page.evaluate(()=>{
    const item=studio.scene.elements.find(e=>e.kind==='status');item.kind='camera';item.camera_source='test';item.show_label=true;item.label='Camera';studio.paint();
  });
  await expect(page.locator('.scene .lg-camera .lg-label')).toHaveCSS('text-shadow','rgba(0, 0, 0, 0) 0px 1px 4px');
  await expect(page.locator('.scene .lg-camera-picture')).toHaveCSS('opacity','1');
});

for(const width of [1500,390])test(`views only choose complete themes while background editing remains in custom themes at ${width}px`,async({page})=>{
  await mount(page,width);
  for(const name of ['Nur HDMI','Dashboard','Dashboard PiP','Mediaplayer','Startanzeige','Mitteilung','Mitteilung PiP','Mitteilung Vollbild']){
    await openView(page,name);await enableStyling(page);
    await expect(page.locator('.presets')).toBeVisible();
    await expect(page.locator('#theme-panel-background')).toBeHidden();
    await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeHidden();
    await expect(page.getByRole('button',{name:'Bild hochladen',exact:true})).toBeHidden();
    await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
    expect(await page.evaluate(()=>studio.scene.background)).toBe('sand');
    const preview=await page.locator('.scene').evaluate(n=>n.style.background);
    expect(preview).toContain('gradient');
    await expect(page.locator('#theme-panel-background')).toBeHidden();
  }
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Eigene Ansicht');
  await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
  await enableStyling(page);
  await expect(page.locator('#theme-panel-background')).toBeHidden();
  await page.locator('.presets').getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Hintergrund',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Hintergrund anpassen',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('native ESP offers touch on every widget and a local camera in all views',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{studio.catalog.entries[0].provider='esphome';studio.catalog.entries[0].capabilities={hdmi:false,video:false,native_lvgl:true,touch_actions:true};studio.mount();});
  await openView(page,'Dashboard');
  await addElement(page,'switch');
  await expect(page.getByLabel('Bei Berührung')).toHaveValue('toggle');
  await page.getByLabel('Home-Assistant-Entität').fill('input_boolean.test');await page.getByLabel('Home-Assistant-Entität').press('Tab');
  await page.getByLabel('Zielentität').fill('input_boolean.test');await page.getByLabel('Zielentität').press('Tab');
  await addElement(page,'text');
  await page.getByLabel('Bei Berührung').selectOption('press');
  await page.getByLabel('Zielentität').fill('input_button.test');await page.getByLabel('Zielentität').press('Tab');
  await addElement(page,'camera');
  await expect(page.getByLabel('Kameraquelle',{exact:true})).toHaveValue('local');
  await expect(page.getByLabel('Kameraquelle',{exact:true}).locator('option')).toHaveCount(4);
  await expect(page.getByLabel('Bei Berührung')).toBeVisible();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const widgets=await page.evaluate(()=>saved.views.find(v=>v.id==='dashboard').scene.elements);
  expect(widgets.find(i=>i.kind==='switch').tap_action).toEqual({action:'toggle',entity_id:'input_boolean.test',view:''});
  expect(widgets.find(i=>i.kind==='text'&&i.tap_action?.action==='press').tap_action).toEqual({action:'press',entity_id:'input_button.test',view:''});
  expect(widgets.find(i=>i.kind==='camera').camera_source).toBe('local');
  expect(await page.evaluate(()=>studio.supportsView('pip')&&studio.supportsView('startup')&&studio.supportsView('media_view'))).toBe(true);
});

test('native ESP has camera PiP and the same editable animated boot view without HDMI',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    Object.assign(studio.catalog.entries[0],{provider:'esphome',rendering:{width:1024,height:600},capabilities:{native_lvgl:true,hdmi:false,pip:true,startup:true,video:false}});
    studio.config=studio.withViews(studio.config);studio.saved=JSON.parse(JSON.stringify(studio.config));studio.mount();
  });
  await expect(page.getByRole('heading',{name:'Nur HDMI',exact:true})).toHaveCount(0);
  await openView(page,'Dashboard PiP');
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').map(i=>i.camera_source))).toEqual(['local']);
  expect(await page.evaluate(()=>studio.availableKinds.hdmi)).toBeUndefined();
  await page.getByRole('button',{name:'Live',exact:true}).click();
  await expect(page.locator('.live-status')).toContainText('Live aktiv');
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'&&c[1].includes('layout_live')).at(-1)[2].view)).toBe('pip_view');
  await openView(page,'Bootscreen');
  await expect(page.locator('.scene .lg-startup-logo svg')).toBeVisible();
  const preview=await page.locator('.stage').boundingBox();expect(preview.width/preview.height).toBeCloseTo(1024/600,2);
  await expect(page.locator('.scene .lg-startup-progress')).toBeVisible();
  await expect(page.locator('.scene .lg-startup-spinner')).toBeHidden();
  await expect(page.locator('.scene .lg-text .lg-value')).toHaveText('Display wird gestartet …');
  await expect(page.locator('#background option[value="image"]')).toHaveCount(0);
  expect(await page.evaluate(()=>studio.scene.elements.map(i=>i.kind))).toEqual(['logo','progress','text']);
  expect(await page.evaluate(()=>Object.keys(studio.availableKinds))).not.toEqual(expect.arrayContaining(['boot','startup']));
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='text').id));
  await page.getByLabel('Text',{exact:true}).fill('Mein ESP startet …');await page.getByLabel('Text',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.find(v=>v.id==='startup').scene.elements.find(i=>i.kind==='text').text)).toBe('Mein ESP startet …');
  await openView(page,'Verbindungsaufbau');
  await expect(page.locator('.scene .lg-startup-spinner')).toBeVisible();
  await expect(page.locator('.scene .lg-startup-progress')).toBeHidden();
  await expect(page.locator('.scene .lg-startup-ring')).toHaveCSS('animation-duration','1s');
  await expect(page.locator('.scene .lg-startup-ring')).toHaveCSS('animation-timing-function','linear');
  await expect(page.locator('.scene .lg-text .lg-value')).toHaveText('Verbindung wird aufgebaut …');
  const rotation=await page.locator('.scene .lg-startup-ring').evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(250);
  expect(await page.locator('.scene .lg-startup-ring').evaluate(el=>getComputedStyle(el).transform)).not.toBe(rotation);
  await page.getByRole('button',{name:'Live',exact:true}).click();
  expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'&&c[1].includes('layout_live')).at(-1)[2].view)).toBe('connecting');

  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await page.locator('[data-creator-mode=content]').click();
  await page.getByLabel('Aufbau',{exact:true}).selectOption('pip_view');
  await page.getByLabel('Name',{exact:true}).fill('ESP Kamera PiP');
  await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='hdmi').length)).toBe(0);
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').map(i=>i.camera_source))).toEqual(['local']);
});


test('camera crop matches native vectors and supports drag, wheel, undo and saved reload',async({page})=>{
  await boardPreview(page);
  const vectors=JSON.parse(fs.readFileSync('tests/fixtures/camera-crop.json','utf8'));
  const boxes=await page.evaluate(async vectors=>{
    const {cameraGeometry}=await import('/display_studio/camera_preview.js');
    return vectors.map(v=>{const g=cameraGeometry(...v.source,...v.viewport,{camera_fit:v.fit,camera_zoom:v.zoom,camera_pan_x:v.pan[0],camera_pan_y:v.pan[1]});return [g.x,g.y,g.width,g.height];});
  },vectors);
  boxes.forEach((box,i)=>box.forEach((v,j)=>expect(v).toBeCloseTo(vectors[i].box[j],3)));
  await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='camera');studio.select(item.id);window.originalPreview=studio.shadowRoot.querySelector('.scene video');Object.defineProperties(originalPreview,{videoWidth:{value:1280},videoHeight:{value:720}});});
  const zoom=page.getByLabel('Kamera-Zoom (%)',{exact:true});await zoom.fill('200');await zoom.press('Tab');
  await page.getByRole('button',{name:'Bildausschnitt bearbeiten',exact:true}).click();
  const handle=page.getByRole('button',{name:'Bildausschnitt ziehen und zoomen',exact:true});
  await handle.scrollIntoViewIfNeeded();await expect(handle).toBeInViewport();
  const rect=await handle.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const geometry=await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='camera');return [i.x,i.y,i.width,i.height];});
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+20,{steps:5});await page.mouse.up();
  const pan=await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='camera');return [i.camera_pan_x,i.camera_pan_y];});
  expect(pan[0]).toBeGreaterThan(0);expect(pan[1]).toBeGreaterThan(0);
  await handle.hover();
  await page.mouse.wheel(0,-80);
  await expect.poll(()=>page.evaluate(()=>studio.item.camera_zoom)).toBeGreaterThan(200);
  expect(await page.evaluate(()=>originalPreview===studio.shadowRoot.querySelector('.scene video'))).toBe(true);
  expect(await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='camera');return [i.x,i.y,i.width,i.height];})).toEqual(geometry);
  await page.evaluate(()=>studio.action('undo'));
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.kind==='camera').camera_zoom)).toBe(200);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const savedCrop=await page.evaluate(()=>{const i=saved.views.find(v=>v.id==='pip_view').scene.elements.find(i=>i.kind==='camera');return [i.camera_zoom,i.camera_pan_x,i.camera_pan_y];});
  expect(savedCrop).toEqual([200,...pan]);
  await page.evaluate(async()=>{await studio.switchDisplay('one');await studio.openView('pip_view');studio.select(studio.scene.elements.find(i=>i.kind==='camera').id);});
  expect(await zoom.inputValue()).toBe('200');
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  await page.getByLabel('Inhaltselement',{exact:true}).selectOption('picture');
  await expect(page.locator('.widget-dialog [data-crop-edit]')).toBeVisible();
});

test('ESP power settings live only on the ESPHome device; old policy survives migration',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{studio.catalog.entries[0].capabilities={native_lvgl:true};studio.config.power={mode:'screensaver',idle_seconds:120};studio.renderOverview();});
  await expect(page.getByRole('heading',{name:'Standby & Helligkeit'})).toHaveCount(0);
  await expect(page.locator('[data-power]')).toHaveCount(0);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.power)).toEqual({mode:'screensaver',idle_seconds:120});
});

test('moon uses UTC illumination, updates in place and mirrors waning phases',async({page})=>{
  await mount(page);
  const result=await page.evaluate(()=>{
    const dates=['2026-10-10T15:50:00Z','2026-10-18T16:12:00Z','2026-10-26T04:12:00Z','2026-11-01T20:28:00Z'];
    const node=document.createElement('div');document.body.append(node);
    return dates.map(date=>{LGWeather.icon(node,'clear-night',false,false,date);return {phase:LGWeather.moon(date),fraction:Number(node.dataset.moonIllumination),path:node.innerHTML};});
  });
  expect(result[0].fraction).toBeLessThan(.01);
  expect(result[1].fraction).toBeCloseTo(.5,2);
  expect(result[2].fraction).toBeGreaterThan(.99);
  expect(result[3].fraction).toBeCloseTo(.5,2);
  expect(result[1].path).not.toContain('scale(-1 1)');
  expect(result[3].path).toContain('scale(-1 1)');
  expect(result[0].path).not.toBe(result[2].path);
});

test('AV media keeps routed server metadata and refreshes on linked source changes',async({page})=>{
  await mount(page);
  await openView(page,'Mediaplayer');
  await page.evaluate(()=>{
    const item=studio.scene.elements.find(i=>i.kind==='media');
    item.entity_id='media_player.av';item.media_av_auto=true;item.show_volume=true;
    item.tap_action={action:'av_play_pause',entity_id:'media_player.av',view:''};
    hass.states['media_player.av']={entity_id:'media_player.av',state:'on',attributes:{friendly_name:'AV System'}};
    hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{source:'Music'}};
    studio.backendValues={'media_player.av':{av_routed:true,av_dependencies:['media_player.sonos'],av_available_actions:['av_play_pause'],state:'playing',name:'Sonos · Musik',media_title:'Live Song'}};
    studio.paint();studio.select(item.id);
  });
  await expect(page.getByLabel('AV automatisch · Sonos / Apple TV')).toBeChecked();
  await expect(page.getByLabel('Bei Berührung',{exact:true})).toHaveValue('av_play_pause');
  await expect(page.locator('.scene .lg-media .lg-value')).toContainText('Live Song');
  await page.evaluate(()=>{
    const original=hass.callApi;
    hass.callApi=async(method,url,data)=>url.startsWith('display_studio/layout/') ? {revision:studio.revision,values:{'media_player.av':{av_routed:true,av_dependencies:['media_player.sonos'],state:'playing',name:'Apple TV · TV-Ton',media_title:'Live Movie'}}} : original(method,url,data);
    studio.hass={...hass,states:{...hass.states,'media_player.sonos':{...hass.states['media_player.sonos'],attributes:{source:'TV'}}}};
  });
  await expect(page.locator('.scene .lg-media .lg-value')).toContainText('Live Movie');
  await page.evaluate(()=>{Object.assign(studio.backendValues['media_player.av'],{state:'off',media_title:'Apple TV im Standby',volume_level:.27});studio.paint();});
  await expect(page.locator('.scene .lg-media .lg-value')).toContainText('Apple TV im Standby');
  await expect(page.locator('.scene .lg-media-volume')).toContainText('27 %');
  await page.getByLabel('Bei Berührung',{exact:true}).selectOption('av_remote_select');
  expect(await page.evaluate(()=>studio.item.tap_action.action)).toBe('av_remote_select');
});


test('modern AV controls render vectors, preserve dragging and send values',async({page})=>{
  await page.clock.install();await mount(page);await openView(page,'Mediaplayer');
  await page.evaluate(()=>{
    // This exercises renderer callbacks directly; an editor resize repaint
    // would replace those test callbacks with its non-interactive preview options.
    studio._resize.disconnect();cancelAnimationFrame(studio._resizeFrame);
    const base=JSON.parse(JSON.stringify(studio.scene.elements.find(e=>e.kind==='media')));
    studio.scene.elements=[['slider','av_volume_set'],['source','av_select_source'],['icon','av_play_pause']].map(([type,action],i)=>({...base,id:type,kind:'control',control_type:type,control_icon:'play',label:type,x:5,y:5+i*28,width:90,height:22,entity_id:'media_player.av',tap_action:{action,entity_id:'media_player.av',view:''}}));
    studio.backendValues={'media_player.av':{av_routed:true,state:'playing',volume_level:.37,av_sources:[{value:'av:HDMI 1',label:'TV · HDMI 1'},{value:'sonos:Jazz',label:'Sonos · Jazz'}],av_selected_source:'av:HDMI 1',av_available_actions:['av_volume_set','av_select_source','av_play_pause']}};
    studio.paint();window.valueCalls=[];window.buttonCalls=[];
    studio.renderer.options.onValue=(item,value)=>valueCalls.push([item.id,value]);studio.renderer.options.onTap=item=>buttonCalls.push(item.id);
    studio.renderer.render(studio.scene,studio.values(),studio.renderer.options);
  });
  const range=page.locator('.scene input[type="range"]'),select=page.locator('.scene select');
  await expect(range).toHaveValue('37');await expect(select).toHaveValue('av:HDMI 1');
  await range.fill('63');
  await select.selectOption('sonos:Jazz');
  expect(await page.evaluate(()=>valueCalls)).toEqual([['slider',63],['source','sonos:Jazz']]);
  expect(await page.evaluate(()=>buttonCalls)).toEqual([]);
  const paths=await page.locator('.scene .lg-control svg').innerHTML();
  await page.evaluate(()=>studio.renderer.nodes.icon.click());
  expect(await page.locator('.scene .lg-control svg').innerHTML()).not.toBe(paths);
  expect(await page.evaluate(()=>buttonCalls)).toEqual(['icon']);
  await page.evaluate(()=>studio.renderer.render(studio.scene,studio.values(),studio.renderer.options));
  expect(await page.locator('.scene .lg-control svg').innerHTML()).not.toBe(paths);
  await page.evaluate(()=>{studio.backendValues['media_player.av'].state='paused';studio.renderer.render(studio.scene,studio.values(),studio.renderer.options);});
  expect(await page.locator('.scene .lg-control svg').innerHTML()).not.toBe(paths);
  await expect(range).toHaveValue('63');await expect(select).toHaveValue('sonos:Jazz');
  await page.clock.fastForward(4500);await expect(range).toHaveValue('63');
  await page.clock.fastForward(501);await expect(range).toHaveValue('37');await expect(select).toHaveValue('av:HDMI 1');
  await page.evaluate(()=>{const node=studio.renderer.nodes.slider;node._dragging=true;node._control.value='81';studio.backendValues['media_player.av'].volume_level=.22;studio.renderer.render(studio.scene,studio.values(),studio.renderer.options);});
  await expect(range).toHaveValue('81');
  await page.evaluate(()=>{studio.renderer.nodes.slider._dragging=false;studio.renderer.render(studio.scene,studio.values(),studio.renderer.options);});
  await expect(range).toHaveValue('22');
  await page.evaluate(()=>{studio.backendValues['media_player.av'].av_selected_source='sonos:Unlisted';studio.renderer.render(studio.scene,studio.values(),studio.renderer.options);});
  await expect(select).toHaveValue('');
});

test('individual logo and animations are reusable and accepted by the offline start cache',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await addElement(page,'logo');
  for(const variant of ['spinner','progress','dots','pulse','bars']){
    await addElement(page,'animation');
    const editor=page.locator('.properties');
    await editor.locator('[data-animation=animation_type]').selectOption(variant);
    await editor.locator('[data-animation=animation_duration]').fill('2000');await editor.locator('[data-animation=animation_duration]').press('Tab');
    if(variant==='progress'){
      await expect(editor.getByLabel('Fortschrittsquelle',{exact:true})).toHaveValue('fixed');
      await editor.locator('[data-animation=progress_value]').fill('37');await editor.locator('[data-animation=progress_value]').press('Tab');
    }
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
  }
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='animation').map(i=>[i.animation_type,i.animation_duration]))).toEqual(['spinner','progress','dots','pulse','bars'].map(type=>[type,2000]));
  expect(await page.evaluate(()=>studio.scene.elements.find(i=>i.animation_type==='progress').progress_value)).toBe(37);
  await page.evaluate(()=>{
    const scene=JSON.parse(JSON.stringify(studio.scene));scene.elements=scene.elements.filter(i=>['logo','animation'].includes(i.kind));
    Object.assign(scene,{background:'solid',media_background_enabled:false,media_background_entity:''});
    localStorage.setItem('lg-display-startup-v1:/',JSON.stringify({schema:1,version:'c'.repeat(64),timezone:'Europe/Berlin',scene,image:null}));
  });
  await page.addScriptTag({content:fs.readFileSync('custom_components/display_studio/www/runtime/startup-design.js','utf8')});
  expect(await page.evaluate(()=>LGStartupDesign.status().cached)).toBe(true);
});

test('offline ESP views load after an editor update with a cached older runtime',async({page})=>{
  await mount(page,1500,{warmLegacyRuntime:true});
  await page.evaluate(async()=>{
    studio.catalog.entries.push({...studio.catalog.entries[0],entry_id:'offline-esp',name:'Offline ESP',provider:'esphome',connected:false,resident_enabled:true,capabilities:{hdmi:false,video:false,pip:true,startup:true,native_lvgl:true},rendering:{width:1024,height:600}});
    window.startupStatus={connected:false,stored:false};
    await studio.switchDisplay('offline-esp');
  });
  await expect(page.getByText('Display konnte nicht geladen werden.',{exact:true})).toHaveCount(0);
  await expect(page.locator('.notice')).toContainText('Display offline');
  const dependencies=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name)).filter(u=>['weather.js','cards.js','layout-runtime.js','camera_preview.js','studio.css','layout.css'].includes(u.pathname.split('/').pop()) && u.searchParams.get('v')!=='1.4.0-av-controls3').map(u=>u.searchParams.get('v')));
  expect(dependencies.length).toBeGreaterThanOrEqual(6);
  expect(new Set(dependencies)).toEqual(new Set(['fixture-build']));
  await openView(page,'Bootscreen');
  expect(await page.evaluate(()=>studio.scene.elements.map(i=>i.kind))).toEqual(['logo','progress','text']);
  await openView(page,'Verbindungsaufbau');
  await expect(page.locator('.scene .lg-startup-ring')).toBeVisible();
  await page.evaluate(()=>{
    studio.checkpoint();studio.scene.elements.find(i=>i.kind==='text').text='Offline bearbeitet';studio.changed();
  });
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  await expect(page.locator('.flash')).toContainText('In Home Assistant gespeichert');
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));
  await openView(page,'Verbindungsaufbau');
  await expect(page.locator('.scene')).toContainText('Offline bearbeitet');
  expect(await page.evaluate(()=>calls.some(c=>c[1].startsWith('display_studio/layout_live/')))).toBe(false);
});

test('offline board preview stays editable and reconnects without losing the draft',async({page})=>{
  await boardPreview(page,{offline:true,clock:true});
  const camera=page.locator('.scene .lg-camera');
  await expect(page.locator('.notice')).toContainText('Display offline');
  await expect(camera).toContainText('Kamera offline');
  await page.evaluate(()=>{
    studio.checkpoint();const item=studio.scene.elements.find(i=>i.kind==='camera');
    Object.assign(item,{camera_zoom:175,camera_pan_x:25,x:11,width:43});studio.changed();
  });
  await page.clock.fastForward(60000);
  expect(await page.evaluate(()=>[cameraRequests.length,snapshots])).toEqual([0,0]);
  const draft=await page.evaluate(()=>JSON.stringify(studio.config));
  await page.evaluate(async()=>{window.startupStatus={connected:true,stored:false};await studio.refreshValues();});
  await expect(camera.locator('video')).toHaveCount(1);
  await expect(page.locator('.notice')).toBeHidden();
  expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(draft);
  expect(await page.evaluate(()=>studio.dirty)).toBe(true);
  await page.evaluate(async()=>{window.startupStatus={connected:false,stored:false};await studio.refreshValues();});
  await expect(camera).toContainText('Kamera offline');
  await expect(camera.locator('video,img')).toHaveCount(0);
  expect(await page.evaluate(()=>decoders.every(d=>d.destroyed))).toBe(true);
  const counts=await page.evaluate(()=>[cameraRequests.length,snapshots]);
  await page.clock.fastForward(60000);
  expect(await page.evaluate(()=>[cameraRequests.length,snapshots])).toEqual(counts);
  expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(draft);
});

test('widget styling, standard/manual sizes and scrollable Home survive save/reload',async({page})=>{
  const home=JSON.parse(fs.readFileSync('tests/fixtures/home-theme.json','utf8')).state.layout.config;
  catalog.presets.push({id:'homekit',name:'Home',layout:home});
  try {
    await mount(page);
    await page.getByRole('button',{name:'Home-Kachelvorlage anlegen',exact:true}).click();
    await page.locator('#new-view-name').fill('Home Scroll');
    await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
    await expect(page.locator('#view-scroll')).toHaveValue('200');
    await expect(page.locator('#new-theme')).toHaveCount(0);await expect(page.locator('#new-size')).toHaveCount(0);
    await addElement(page,'status');
    await page.locator('[data-element-styling]').check();await page.locator('[data-prop=card_style]').selectOption('homekit');await page.locator('[data-home-size]').selectOption('large');
    const created=await page.evaluate(()=>({id:studio.selected,...studio.item}));
    expect(created.style_override).toBe(true);expect(created.card_style).toBe('homekit');expect(created.home_variant).toBe('large');
    expect(created.width).toBeCloseTo(154/1024*100,2);expect(created.height).toBe(21);
    await page.locator('[data-home-size]').selectOption('custom');
    await page.locator('[data-prop=width]').fill('18.7');await page.locator('[data-prop=width]').dispatchEvent('change');
    await expect(page.locator('[data-home-size]')).toHaveValue('custom');
    await page.locator('[data-prop=card_style]').selectOption('standard');
    expect(await page.evaluate(()=>studio.item.card_style)).toBe('standard');
    expect(await page.evaluate(()=>studio.item.width)).toBe(18.7);
    await page.locator('[data-element-styling]').check();await page.locator('[data-prop=card_style]').selectOption('homekit');
    await page.locator('[data-prop=y]').fill('165');await page.locator('[data-prop=y]').dispatchEvent('change');
    await page.getByRole('button',{name:'Bedienvorschau',exact:true}).click();
    const scroll=page.locator('.stage .lg-scroll-viewport');
    await scroll.evaluate(e=>e.scrollTop=10000);
    const before=await scroll.evaluate(e=>e.scrollTop);expect(before).toBeGreaterThan(100);
    await page.evaluate(()=>studio.paint());expect(await scroll.evaluate(e=>e.scrollTop)).toBe(before);
    const tile=page.locator(`.stage [data-layout-id="${created.id}"]`);
    await tile.click({position:{x:75,y:45}});
    const viewport=await page.locator('.stage').boundingBox(),popup=await page.locator('.lg-home-modal').boundingBox();
    expect(popup.y).toBeCloseTo(viewport.y,0);expect(popup.height).toBeCloseTo(viewport.height,0);
    await page.locator('.lg-home-close').click();
    await page.locator('[data-action=save]').click();
    await page.evaluate(async()=>{const id=studio.viewId;const doc=await hass.callApi('GET','display_studio/layout_library/one');studio.accept(doc);await studio.openView(id);});
    const stored=await page.evaluate(id=>({height:studio.scene.scroll_height,item:studio.scene.elements.find(i=>i.id===id)}),created.id);
    expect(stored.height).toBe(200);expect(stored.item.width).toBe(18.7);expect(stored.item.y).toBe(165);expect(stored.item.style_override).toBe(true);expect(stored.item.card_style).toBe('homekit');
    // Reducing the extent must never silently clip/delete saved elements.
    await page.locator('#view-scroll').selectOption('100');await expect(page.locator('#view-scroll')).toHaveValue('200');
    await expect(page.locator('.flash')).toContainText('Verschiebe zuerst');
  } finally {catalog.presets.pop();}
});


test('onboard overview uses configurable stills with honest age and local fullscreen live',async({page})=>{
  await boardPreview(page,{clock:true});
  await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='camera');item.camera_mode='snapshot';item.camera_interval=5;item.tap_action={action:'camera_fullscreen',entity_id:'',view:''};studio.interactionPreview=true;studio.paint();});
  const tile=page.locator('.scene .lg-camera').first();
  await expect(tile.locator('img')).toBeVisible();await expect(tile.locator('.lg-camera-age')).toHaveText('0 s');
  const count=await page.evaluate(()=>snapshots);
  await page.clock.fastForward(3000);await expect(tile.locator('.lg-camera-age')).toHaveText('3 s');
  await page.evaluate(()=>studio.paint());expect(await page.evaluate(()=>snapshots)).toBe(count);
  await page.clock.fastForward(2100);await expect.poll(()=>page.evaluate(()=>snapshots)).toBe(count+1);
  await expect(tile.locator('.lg-camera-age')).toHaveText('0 s');
  // Failed fetch retains the last accepted picture and keeps aging it.
  await page.evaluate(()=>{window.fetchSnapshot=hass.fetchWithAuth;hass.fetchWithAuth=async()=>{throw Error('offline');};});
  await page.clock.fastForward(6000);await expect(tile.locator('img')).toBeVisible();await expect(tile.locator('.lg-camera-age')).not.toHaveText('0 s');
  await page.evaluate(()=>hass.fetchWithAuth=window.fetchSnapshot);
  const config=await page.evaluate(()=>JSON.stringify(studio.config));
  // Dragging the camera must never open a modal.
  await tile.dispatchEvent('pointerdown',{clientX:10,clientY:10});await tile.dispatchEvent('pointermove',{clientX:10,clientY:100});await tile.dispatchEvent('click');await expect(page.locator('.lg-camera-fullscreen')).toHaveCount(0);
  await tile.dispatchEvent('pointerdown',{clientX:10,clientY:10});await tile.dispatchEvent('click');
  await expect(page.locator('.lg-camera-fullscreen video')).toHaveCount(1);
  await expect(page.locator('.lg-camera-fullscreen .lg-camera-age')).toHaveText('Live');
  expect(await page.evaluate(()=>decoders.filter(d=>!d.destroyed).length)).toBe(1);
  await page.clock.fastForward(3000);expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(config);
  await page.getByRole('button',{name:'Kamera schließen'}).click();
  await expect(page.locator('.lg-camera-fullscreen')).toHaveCount(0);await expect(tile.locator('img')).toBeVisible();
  await expect(tile.locator('.lg-camera-age')).toHaveText('0 s');
  expect(await page.evaluate(()=>decoders.filter(d=>!d.destroyed).length)).toBe(0);
  await page.evaluate(()=>{studio.scene.elements.find(i=>i.kind==='camera').camera_interval=9;studio.paint();});
  await expect(tile.locator('img')).toBeVisible();const later=await page.evaluate(()=>snapshots);
  await page.clock.fastForward(8000);expect(await page.evaluate(()=>snapshots)).toBe(later);
  await page.clock.fastForward(1100);await expect.poll(()=>page.evaluate(()=>snapshots)).toBe(later+1);
});

test('text frames start at the top and font size and outer resize stay coupled after save',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    const item=studio.scene.elements.find(i=>i.kind==='text');
    Object.assign(item,{x:5,y:5,width:20,height:12,font_size:3,text:'Abg 123',label:'Textprobe',show_label:false,parts:{}});
    studio.scene.elements=[item];
    studio.select(item.id);studio.paint();studio.renderProperties();
  });
  const read=()=>page.evaluate(()=>{
    const i=studio.item,n=studio.renderer.nodes[i.id],v=n._value,b=n.getBoundingClientRect(),r=v.getBoundingClientRect(),css=getComputedStyle(v);
    return {item:JSON.parse(JSON.stringify(i)),font:parseFloat(css.fontSize),top:r.top-b.top,padding:getComputedStyle(n).paddingTop,valid:LGWidgetParts.valid(i)};
  });
  const before=await read();expect(before.top).toBeCloseTo(0,1);expect(before.padding).toBe('0px');
  await ownWidgetStyle(page);
  const size=page.getByLabel('Schriftgröße (%)',{exact:true});
  await size.fill('4.5');await size.press('Tab');
  const larger=await read();expect(larger.item.width).toBeCloseTo(30,3);expect(larger.item.height).toBeCloseTo(18,3);expect(larger.font/before.font).toBeCloseTo(1.5,2);expect(larger.top).toBeCloseTo(0,1);expect(larger.valid).toBe(true);
  await size.fill('3');await size.press('Tab');
  const smaller=await read();expect(smaller.item.width).toBeCloseTo(20,3);expect(smaller.font).toBeCloseTo(before.font,1);
  await page.locator('.selection.selected .resize').scrollIntoViewIfNeeded();
  const handle=await page.locator('.selection.selected .resize').boundingBox(),tile=await page.locator('.selection.selected').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+tile.width*.25,handle.y+handle.height/2+tile.height*.25,{steps:5});await page.mouse.up();
  await page.locator('.stage').screenshot({path:test.info().outputPath('text-frame.png')});
  const dragged=await read();expect(dragged.font/smaller.font).toBeCloseTo(1.25,1);expect(dragged.valid).toBe(true);expect(dragged.top).toBeCloseTo(0,1);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.label==='Textprobe'))).toEqual(dragged.item);
  await page.locator('[data-action=undo]').click();
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.label==='Textprobe').id));
  expect((await read()).font).toBeCloseTo(smaller.font,1);
});

for(const part of ['time','date'])test('text frame coupling for clock '+part+' uses its own parent and preserves siblings',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(part=>{
    const i=studio.scene.elements.find(i=>i.kind==='clock');i.parts={};
    i.parts[part]={x:5,y:5,width:35,height:15,font_size:8};
    studio.select(i.id);studio.paint();
  },part);
  const editor=await widgetEditor(page,'Uhr & Datum');
  await ownWidgetStyle(page);
  await editor.locator('[data-widget-size]').selectOption('custom');
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);
  const size=editor.getByLabel('Inhalt Schriftgröße (%)');await size.fill('12');await size.press('Tab');
  let conf=await page.evaluate(()=>studio.widgetEditor.config);
  expect(conf.width).toBe(100);expect(conf.height).toBe(100);expect(conf.font_size).toBe(12);expect(conf.anchor_x).toBeGreaterThan(0);expect(conf.anchor_y).toBeGreaterThan(0);
  const css=await page.evaluate(()=>{const e=studio.widgetEditor.element(),s=getComputedStyle(e);return {padding:s.paddingTop,margin:s.marginTop,display:s.display};});
  expect(css).toEqual({padding:'0px',margin:'0px',display:'block'});
  const inkWidth=await page.evaluate(()=>studio.widgetEditor.inkBox().width);
  await editor.getByLabel('Inhalt Breite (%)').fill(String(inkWidth/1.5));await editor.getByLabel('Inhalt Breite (%)').press('Tab');
  conf=await page.evaluate(()=>studio.widgetEditor.config);expect(conf.height).toBe(100);expect(conf.font_size).toBeCloseTo(8,3);
  const handle=await editor.locator('.part-resize').boundingBox(),box=await editor.locator('.part-outline').boundingBox();
  const sibling=await page.evaluate(()=>{const w=studio.widgetEditor,p=w.entries.find(p=>p.id===(w.partId==='time'?'date':'time'));return w.box(p);});
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+box.width*.2,handle.y+handle.height/2,{steps:5});await page.mouse.up();
  conf=await page.evaluate(()=>studio.widgetEditor.config);expect(conf.font_size).toBeCloseTo(8*(1+.2*box.width**2/(box.width**2+box.height**2)),1);expect(conf.height).toBe(100);
  expect(await page.evaluate(()=>{const w=studio.widgetEditor,p=w.entries.find(p=>p.id===(w.partId==='time'?'date':'time'));return w.box(p);})).toEqual(sibling);
  expect(await page.evaluate(()=>LGWidgetParts.valid(studio.item))).toBe(true);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(part=>saved.scenes.dashboard.elements.find(i=>i.kind==='clock').parts[part],part)).toEqual(conf);
});

test('whole clock resizing scales time and date together, including explicit nested typography',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    const i=studio.scene.elements.find(i=>i.kind==='clock');
    Object.assign(i,{x:0,y:0,width:45,height:25,font_size:5,show_label:false,parts:{date:{x:0,y:60,width:90,height:25,font_size:12}}});
    studio.select(i.id);studio.paint();studio.renderProperties();
  });
  const fonts=()=>page.evaluate(()=>{const n=studio.renderer.nodes[studio.item.id];return [n._value,n._detail].map(e=>parseFloat(getComputedStyle(e).fontSize));});
  // Enough width for the complete date envelope: this checks proportional sizing, not fit-to-width.
  const before=await fonts();await page.getByLabel('Höhe (%)',{exact:true}).fill('37.5');await page.getByLabel('Höhe (%)',{exact:true}).press('Tab');
  const after=await fonts();after.forEach((f,i)=>expect(f/before[i]).toBeCloseTo(1.5,2));
  expect(await page.evaluate(()=>LGWidgetParts.valid(studio.item))).toBe(true);
});

test('nested forecast font resize scales the text frame relative to its forecast column only',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    const i=studio.scene.elements.find(i=>i.kind==='weather');
    i.entity_id='weather.home';i.parts={forecast:{x:0,y:50,width:100,height:50},forecast_1:{x:0,y:0,width:25,height:100},forecast_1_high:{x:5,y:50,width:40,height:15,font_size:8}};
    studio.backendValues={'weather.home':{state:'sunny',temperature:22,forecasts:{daily:[{datetime:'2026-10-16',temperature:23,condition:'sunny'}]}}};
    studio.editContentsForTest(i.id);
  });
  await ownWidgetStyle(page);const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await editor.getByLabel('Inhaltselement',{exact:true}).selectOption('forecast_1_high');
  await editor.getByLabel('Inhalt Schriftgröße (%)').fill('12');await editor.getByLabel('Inhalt Schriftgröße (%)').press('Tab');
  const r=await page.evaluate(()=>{const w=studio.widgetEditor;return {conf:w.config,parent:w.item.parts.forecast_1,valid:LGWidgetParts.valid(w.item)};});
  expect(r.conf.width).toBeCloseTo(60,3);expect(r.conf.height).toBeCloseTo(22.5,3);expect(r.conf.font_size).toBe(12);expect(r.parent).toEqual({x:0,y:0,width:25,height:100});expect(r.valid).toBe(true);
});

// Compare the handle with the pixels actually painted by the browser, rather
// than calculating the expected rectangle with the editor's own measurement.
async function expectInkFrame(page,selector,reserved=false){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await page.evaluate(()=>{
    const style=document.createElement('style');style.dataset.inkTest='';style.textContent='.widget-part-selection{visibility:hidden!important}.widget-frame{outline:none!important;border-radius:0!important}.widget-workbench{background:#000!important}.widget-preview .lg-clock{border-radius:0!important;background:#000!important}';studio.shadowRoot.append(style);
    const w=studio.widgetEditor,el=w.element();el.style.color='#ffffff';el.style.background='#000000';el.style.opacity='1';el.style.textShadow='none';
    if(w.clockPart()){w.node.style.background='#000';for(const child of w.node.children)if(child!==el)child.style.visibility='hidden';}
    w.selection();const rect=(w.clockPart()?w.node:el).getBoundingClientRect(),outline=w.root.querySelector('.part-outline').getBoundingClientRect();
    w.root.querySelector('.part-outline').style.visibility='hidden';
    return {x:outline.left-rect.left,y:outline.top-rect.top,width:outline.width,height:outline.height};
  });
  const clock=await page.evaluate(()=>studio.widgetEditor.clockPart());
  const png=await page.locator(clock?'.widget-preview .lg-clock':selector).screenshot();
  const pixels=await page.evaluate(async base64=>{
    const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);const data=c.getImageData(0,0,img.width,img.height).data;
    let left=img.width,top=img.height,right=0,bottom=0;
    for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const i=(y*img.width+x)*4;if(data[i]>60&&data[i+1]>60&&data[i+2]>60){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}}
    return {x:left,y:top,width:right-left,height:bottom-top};
  },png.toString('base64'));
  const pad=await page.evaluate(()=>studio.widgetEditor.clockPart()?2*(studio.widgetEditor.node._nativeScale||1):0);
  if(reserved){
    expect(pixels.x).toBeGreaterThanOrEqual(before.x+pad-2.5);expect(pixels.y).toBeGreaterThanOrEqual(before.y+pad-2.5);
    expect(pixels.x+pixels.width).toBeLessThanOrEqual(before.x+before.width-pad+2.5);expect(pixels.y+pixels.height).toBeLessThanOrEqual(before.y+before.height-pad+2.5);
  }else for(const key of ['x','y','width','height'])expect(Math.abs(before[key]-(pixels[key]+(['x','y'].includes(key)?-pad:2*pad))),key+' '+JSON.stringify({before,pixels,pad})).toBeLessThanOrEqual(2.5);
  await page.evaluate(()=>{studio.shadowRoot.querySelector('[data-ink-test]').remove();studio.widgetEditor.root.querySelector('.part-outline').style.visibility='';});
}

for(const font of ['sans','serif','mono'])test('tight ink frames match painted multiline glyphs with accents and descenders '+font,async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(font=>{
    const i=studio.scene.elements.find(i=>i.kind==='text');Object.assign(i,{font,text:'ÄÖÜ gj\nCafé 123',show_label:false,width:50,height:30,font_size:5,align:'center',parts:{}});studio.editContentsForTest(i.id);
  },font);
  await expectInkFrame(page,'.widget-preview .lg-text .lg-value');
});
for(const part of ['time','date'])test('clock ink frames reserve time and date without saving a new layout: '+part,async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='clock');Object.assign(i,{width:55,height:30,font_size:6,show_label:false,parts:{}});studio.editContentsForTest(i.id);});
  await page.getByLabel('Inhaltselement',{exact:true}).selectOption(part);
  await expectInkFrame(page,'.widget-preview .lg-clock '+(part==='time'?'.lg-value':'.lg-detail'),true);
  const config=await page.evaluate(()=>JSON.stringify(studio.config));
  const widths=[];
  await page.evaluate(()=>clearInterval(studio._clock));
  for(const date of part==='time'?['2026-05-01T09:11:00Z','2026-05-01T18:08:00Z']:['2026-05-01T09:11:00Z','2026-09-30T18:08:00Z']){
    widths.push(await page.evaluate(date=>{const w=studio.widgetEditor;w.tick(new Date(date));return w.root.querySelector('.part-outline').getBoundingClientRect().width;},date));
    await expectInkFrame(page,'.widget-preview .lg-clock '+(part==='time'?'.lg-value':'.lg-detail'),true);
  }
  expect(widths[1]).toBe(widths[0]);expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(config);
});

test('widget base surface can resize independently of typography, save and undo',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='clock');Object.assign(i,{x:0,y:0,width:35,height:25,font_size:5,show_label:false,parts:{date:{x:0,y:60,width:90,height:25,font_size:12}}});studio.editContentsForTest(i.id);});
  const fonts=()=>page.evaluate(()=>{const n=studio.renderer.nodes[studio.widgetEditor.id];return [n._value,n._detail].map(el=>parseFloat(getComputedStyle(el).fontSize));});
  const before=await fonts(),editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const height=editor.getByLabel('Grundfläche Höhe (%)');await height.fill('40');await height.press('Tab');
  const width=editor.getByLabel('Grundfläche Breite (%)');await width.fill('50');await width.press('Tab');
  const after=await fonts();after.forEach((f,i)=>expect(f).toBeCloseTo(before[i],1));
  expect(await page.evaluate(()=>({width:studio.widgetEditor.item.width,height:studio.widgetEditor.item.height,valid:LGWidgetParts.valid(studio.widgetEditor.item)}))).toEqual({width:50,height:40,valid:true});
  await editor.locator('[data-undo]').click();expect(await page.evaluate(()=>studio.widgetEditor.item.width)).toBe(35);
  await editor.locator('[data-redo]').click();expect(await page.evaluate(()=>studio.widgetEditor.item.width)).toBe(50);
  const item=await page.evaluate(()=>structuredClone(studio.widgetEditor.item));
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.kind==='clock'))).toEqual(item);
});

for(const target of ['widget','time','date'])test('held resize stays continuous outside the frame and returns to its origin: '+target,async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(target=>{
    const i=studio.scene.elements.find(i=>i.kind===(target==='widget'?'text':'clock'));
    Object.assign(i,{x:5,y:5,width:35,height:25,font_size:4,text:'Größe Äg',show_label:false,parts:{}});
    studio.select(i.id);studio.paint();if(target!=='widget')studio.editContentsForTest(i.id);
  },target);
  if(target!=='widget')await page.getByLabel('Inhaltselement',{exact:true}).selectOption(target);
  const handle=page.locator(target==='widget'?'.selection.selected .resize':'.part-resize');
  const b=await handle.boundingBox(),start={x:b.x+b.width/2,y:b.y+b.height/2};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  const read=()=>page.evaluate(target=>target==='widget'?{width:studio.item.width,height:studio.item.height,font:studio.item.parts.text.font_size}: {font:studio.widgetEditor.config.font_size},target);
  await page.mouse.move(start.x+20,start.y+1);const near=await read();
  await page.mouse.move(start.x+20,start.y+2);const next=await read();
  expect(Math.abs(next.font-near.font)).toBeLessThan(1);
  await page.mouse.move(start.x+350,start.y+200,{steps:10});
  await page.mouse.move(start.x+20,start.y+1,{steps:10});expect(await read()).toEqual(near);
  await page.mouse.move(start.x,start.y,{steps:10});const restored=await read();
  await page.mouse.up();
  expect(await page.evaluate(()=>LGWidgetParts.valid(studio.item))).toBe(true);
  if(target==='widget'){expect(restored.width).toBe(35);expect(restored.height).toBe(25);}
  await page.mouse.move(start.x+150,start.y+150);expect(await read()).toEqual(restored);
});

test('clock anchors reach all edges, seconds and separators update without moving the frame or saving',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{clearInterval(studio._clock);const i=studio.scene.elements.find(i=>i.kind==='clock');Object.assign(i,{width:60,height:40,manual_size:true,style_override:true,show_label:false,parts:{}});delete i.clock_gap;delete i.clock_base_height;delete i.clock_size;studio.editContentsForTest(i.id);});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await editor.getByLabel('Sekunden anzeigen',{exact:true}).check();await editor.getByLabel('Trennpunkte im Sekundentakt blinken',{exact:true}).check();
  await page.evaluate(()=>document.fonts.ready);
  for(const part of ['time','date']){
    await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);
    for(const edge of [0,99]){
      for(const label of ['Inhalt links (%)','Inhalt oben (%)']){await editor.getByLabel(label,{exact:true}).fill(String(edge));await editor.getByLabel(label,{exact:true}).press('Tab');}
      for(const date of ['2026-05-01T09:11:00Z','2026-09-30T21:59:59Z','2026-09-30T22:00:00Z']){
        const r=await page.evaluate(date=>{const w=studio.widgetEditor;w.tick(new Date(date));const f=w.element()._clockFrame,p=w.node.getBoundingClientRect();return {f,width:p.width,height:p.height};},date);
        expect(r.f.x).toBeGreaterThanOrEqual(-.1);expect(r.f.y).toBeGreaterThanOrEqual(-.1);expect(r.f.x+r.f.width).toBeLessThanOrEqual(r.width+.1);expect(r.f.y+r.f.height).toBeLessThanOrEqual(r.height+.1);
        expect(edge?r.width-r.f.x-r.f.width:r.f.x).toBeCloseTo(0,1);expect(edge?r.height-r.f.y-r.f.height:r.f.y).toBeCloseTo(0,1);
      }
    }
  }
  const config=await page.evaluate(()=>JSON.stringify(studio.config));
  const frames=[];
  for(const date of ['2026-10-16T10:22:20Z','2026-10-16T10:22:21Z'])frames.push(await page.evaluate(date=>{const w=studio.widgetEditor;w.tick(new Date(date));return {text:w.node._value.textContent,frame:w.node._value._clockFrame,colon:getComputedStyle(w.node._value.querySelector('.lg-clock-colon')).visibility};},date));
  expect(frames.map(f=>f.text)).toEqual(['12:22:20','12:22:21']);expect(frames.map(f=>f.colon)).toEqual(['visible','hidden']);
  expect(frames[0].frame).toEqual(frames[1].frame);
  // Both numerals and hidden colons keep the same reserved geometry.
  await page.evaluate(()=>{studio.widgetEditor.item.clock_seconds=false;studio.widgetEditor.paint();});
  const stable=[];for(const sec of [20,21])stable.push(await page.evaluate(sec=>{const w=studio.widgetEditor;w.tick(new Date('2026-10-16T10:22:'+sec+'Z'));return w.node._value._clockFrame;},sec));expect(stable[0]).toEqual(stable[1]);
  await page.evaluate(()=>{studio.widgetEditor.item.clock_seconds=true;});expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(config);
});

for(const native of [false,true])for(const format of ['24h','12h'])test(`clock maximum frame is reused across all digit changes and only resized by configuration: ${native} ${format}`,async({page})=>{
  if(native)await boardPreview(page);else await mount(page);await openView(page,'Dashboard');
  await page.evaluate(format=>{clearInterval(studio._clock);const i=studio.scene.elements.find(i=>i.kind==='clock');Object.assign(i,{width:65,height:40,style_override:true,show_label:false,clock_seconds:true,clock_blink:true,clock_time_format:format,parts:{time:{font_size:25,anchor_x:100,anchor_y:100},date:{visible:false}}});studio.editContentsForTest(i.id);},format);
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
    const w=studio.widgetEditor;w.tick(new Date(2026,9,17,0,0,0));
    const el=w.node._value,first=el._clockFrame,style=()=>[el.style.left,el.style.top,el.style.width,el.style.height,el.style.fontSize].join('/'),initialStyle=style();
    for(let hour=0;hour<24;hour++)for(const minute of [0,1,8,11,23,58,59])for(const second of [0,1,8,11,23,58,59]){
      w.tick(new Date(2026,9,17,hour,minute,second));
      if(el._clockFrame!==first || style()!==initialStyle)return {stable:false,hour,minute,second};
    }
    const firstSize=el._clockFrame.width;w.item.parts.time.font_size=18;w.paint();w.tick(new Date(2026,9,17,11,11,11));
    const smaller=el._clockFrame.width;w.item.clock_seconds=false;w.paint();w.tick(new Date(2026,9,17,11,11,11));
    return {stable:true,firstSize,smaller,shorter:el._clockFrame.width};
  });
  expect(result.stable).toBe(true);expect(result.smaller).toBeLessThan(result.firstSize);expect(result.shorter).toBeLessThan(result.smaller);
});

for(const native of [false,true])for(const format of ['long','short','weekday','iso'])test(`date reserves every weekday/month and stays fixed through leap days: ${native} ${format}`,async({page})=>{
  if(native)await boardPreview(page);else await mount(page);await openView(page,'Dashboard');
  await page.evaluate(format=>{clearInterval(studio._clock);const i=studio.scene.elements.find(i=>i.kind==='clock');Object.assign(i,{width:65,height:40,style_override:true,show_label:false,clock_date_format:format,parts:{date:{font_size:15,anchor_x:100,anchor_y:100},time:{visible:false}}});studio.editContentsForTest(i.id);},format);
  await page.getByLabel('Inhaltselement',{exact:true}).selectOption('date');await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
    const w=studio.widgetEditor;w.tick(new Date(2026,0,1,12));const el=w.node._detail,first=el._clockFrame;
    const geometry=()=>[el.style.left,el.style.top,el.style.width,el.style.height,el.style.fontSize].join('/'),initial=geometry();
    for(let year=2026;year<2034;year++)for(let month=0;month<12;month++)for(let day=1;day<=31;day++){
      const value=new Date(year,month,day,12);if(value.getMonth()!==month)continue;w.tick(value);
      if(el._clockFrame!==first||geometry()!==initial)return {stable:false,year,month,day};
    }
    const width=first.width;w.item.parts.date.font_size=10;w.paint();return {stable:true,width,smaller:el._clockFrame.width};
  });
  expect(result.stable).toBe(true);expect(result.smaller).toBeLessThan(result.width);
  for(const date of ['2026-10-16T12:00:00Z','2027-09-30T12:00:00Z','2028-02-29T12:00:00Z']){
    await page.evaluate(date=>studio.widgetEditor.tick(new Date(date)),date);await expectInkFrame(page,'.widget-preview .lg-clock .lg-detail',true);
  }
});

test('new clock uses saved Dashboard standard, no label, independent copy and fixed text sources',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  const old=await page.evaluate(()=>JSON.stringify(studio.scene.elements));
  await page.evaluate(()=>{studio.insertCard('clock');studio.editContentsForTest(studio.selected);});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const created=await page.evaluate(()=>structuredClone(studio.widgetEditor.item));
  for(const [key,value] of Object.entries(catalog.widget_defaults.clock))if(!['element_theme','color','background','accent_color','font','align','card_style','opacity','radius'].includes(key))expect(created[key],key).toEqual(value);
  expect(created.style_override).toBe(false);
  await expect(editor.getByLabel('Inhaltselement',{exact:true}).locator('option')).toHaveText(['Uhrzeit','Datum']);
  for(const part of ['time','date']){
    await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);
    await expect(editor.getByLabel('Textquelle',{exact:true})).toHaveCount(0);await expect(editor.getByLabel('Eigener Inhalt',{exact:true})).toHaveCount(0);
    await expect(editor.getByLabel('Inhalt Schriftgröße (%)',{exact:true})).toBeHidden();
  }
  await page.evaluate(()=>{studio.widgetEditor.item.parts.time.font_size=40;});
  await editor.getByRole('button',{name:'Inhalt-Layout zurücksetzen',exact:true}).click();
  expect(await page.evaluate(()=>studio.widgetEditor.item.parts)).toEqual(catalog.widget_defaults.clock.parts);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>JSON.stringify(studio.scene.elements.slice(0,-1)))).toEqual(old);
  await page.evaluate(()=>studio.insertCard('clock'));const second=await page.evaluate(()=>structuredClone(studio.item));
  expect(second.parts).toEqual(catalog.widget_defaults.clock.parts);expect(second.id).not.toBe(created.id);
});

test('resize keeps widget proportions by default, can unlock and persists the preference',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{const i=studio.scene.elements.find(i=>i.kind==='weather');Object.assign(i,{x:4,y:4,width:30,height:25});studio.select(i.id);studio.paint();});
  await expect(page.locator('.properties').getByLabel('Seitenverhältnis beibehalten',{exact:true})).toBeChecked();
  const read=()=>page.evaluate(()=>({width:studio.item.width,height:studio.item.height,lock_ratio:studio.item.lock_ratio}));
  const drag=async()=>{const h=await page.locator('.selection.selected .resize').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+65,h.y+5,{steps:6});await page.mouse.up();};
  const before=await read();await drag();const locked=await read();expect(locked.width/locked.height).toBeCloseTo(before.width/before.height,2);expect(locked.width).toBeGreaterThan(before.width);
  await page.locator('.properties').getByLabel('Seitenverhältnis beibehalten',{exact:true}).uncheck();await drag();const free=await read();expect(Math.abs(free.width/free.height-locked.width/locked.height)).toBeGreaterThan(.05);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,'Dashboard');await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='weather').id));
  await expect(page.locator('.properties').getByLabel('Seitenverhältnis beibehalten',{exact:true})).not.toBeChecked();
});

for(const part of ['time','date'])test('clock '+part+' accepts an exact 100 percent frame and restores the default widget surface',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('clock');Object.assign(studio.item,{width:38,height:28});studio.editContentsForTest(studio.selected);});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);
  const width=editor.getByLabel('Inhalt Breite (%)',{exact:true});await width.fill('100');await width.press('Tab');await expect(width).toHaveValue('100');
  const r=await page.evaluate(()=>{const w=studio.widgetEditor;return {box:w.inkBox(),conf:structuredClone(w.config),valid:LGWidgetParts.valid(w.item)};});expect(r.conf.frame_width).toBe(100);expect(r.box.x).toBeCloseTo(0,3);expect(r.box.width).toBeCloseTo(100,3);expect(r.valid).toBe(true);
  await page.evaluate(()=>studio.widgetEditor.tick(new Date(2032,8,30,23,59,59)));await expect(width).toHaveValue('100');
  await editor.getByLabel('Seitenverhältnis beibehalten',{exact:true}).uncheck();const font=await page.evaluate(()=>studio.widgetEditor.config.font_size);await editor.getByLabel('Inhalt Höhe (%)',{exact:true}).fill('60');await editor.getByLabel('Inhalt Höhe (%)',{exact:true}).press('Tab');expect(await page.evaluate(()=>studio.widgetEditor.config.font_size)).toBe(font);await expect(width).toHaveValue('100');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.editContentsForTest(studio.selected));await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);await expect(width).toHaveValue('100');
  await editor.getByRole('button',{name:'Inhalt-Layout zurücksetzen',exact:true}).click();await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.item.lock_ratio])).toEqual([25,20,true]);
  expect(await page.evaluate(()=>studio.widgetEditor.item.parts)).toEqual(catalog.widget_defaults.clock.parts);
  await editor.getByTitle('Widget-Änderung rückgängig').click();await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveValue('38');await expect(editor.getByLabel('Grundfläche Höhe (%)',{exact:true})).toHaveValue('28');
});

test('clock has only its own small medium large extra large sizes and manual sizing',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.newElementSize='chip';studio.insertCard('clock');});
  const size=page.locator('[data-home-size]');
  await expect(size.locator('option')).toHaveText(['Manuell · freie Größe','Klein','Mittel','Groß','Extra groß']);await expect(size).toHaveValue('clock_medium');
  expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([25,20]);
  expect(await page.evaluate(()=>['time','date'].map(p=>studio.item.parts[p].frame_width))).toEqual([100,100]);
  await size.selectOption('clock_small');expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([20,16]);
  const before=await page.evaluate(()=>parseFloat(getComputedStyle(studio.renderer.nodes[studio.item.id]._value).fontSize));
  await size.selectOption('clock_large');expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([40,32]);
  const after=await page.evaluate(()=>parseFloat(getComputedStyle(studio.renderer.nodes[studio.item.id]._value).fontSize));expect(after/before).toBeCloseTo(2,1);
  await size.selectOption('clock_extra_large');expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([80,60]);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>[saved.scenes.dashboard.elements.at(-1).width,saved.scenes.dashboard.elements.at(-1).height])).toEqual([80,60]);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await expect(editor.locator('[data-widget-size]')).toHaveValue('clock_extra_large');
  await expect(editor.locator('[data-widget-size]').locator('option')).toHaveText(['Manuell · freie Größe','Klein','Mittel','Groß','Extra groß']);
  await page.evaluate(()=>{studio.item.parts.time.frame_width=60;delete studio.item.parts.date.frame_width;});
  await editor.locator('[data-widget-size]').selectOption('clock_medium');await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>studio.item.width)).toBe(25);
  expect(await page.evaluate(()=>['time','date'].map(p=>studio.item.parts[p].frame_width))).toEqual([100,100]);
  await editor.locator('[data-widget-size]').selectOption('custom');
  await editor.getByLabel('Grundfläche Breite (%)',{exact:true}).fill('33');await editor.getByLabel('Grundfläche Breite (%)',{exact:true}).press('Tab');await expect(editor.locator('[data-widget-size]')).toHaveValue('custom');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).width)).toBe(33);
});

async function alignmentScene(page, peers=[],scrollHeight=100) {
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(({peers,scrollHeight})=>{
    const base=structuredClone(studio.scene.elements[0]);
    studio.scene.elements=[{id:'moving',x:8,y:8,width:20,height:16},...peers].map(p=>({...base,kind:'status',show_label:true,label:p.id,parts:{},...p}));
    studio.scene.scroll_height=scrollHeight;studio.selected='moving';studio.changed(true);
  },{peers,scrollHeight});
  await page.locator('.stage').scrollIntoViewIfNeeded();
}
async function startAlignmentDrag(page) {
  const r=await page.locator('.selection[data-id="moving"]').boundingBox();
  const start={x:r.x+r.width/2,y:r.y+r.height/2};await page.mouse.move(start.x,start.y);await page.mouse.down();return start;
}

test('alignment guides snap to both view centers, allow Alt override, clean up and save only geometry',async({page})=>{
  await alignmentScene(page);
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentDrag(page);
  await page.mouse.move(start.x+area.width*.32+3,start.y+area.height*.34+3,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y])).toEqual([40,42]);
  await expect(page.locator('.alignment-guide[data-axis=x]')).toHaveCount(1);await expect(page.locator('.alignment-guide[data-axis=y]')).toHaveCount(1);
  const lines=await page.locator('.alignment-guide').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {axis:e.dataset.axis,x:r.x,y:r.y};}));
  expect(lines.find(l=>l.axis==='x').x).toBeCloseTo(area.x+area.width/2,0);expect(lines.find(l=>l.axis==='y').y).toBeCloseTo(area.y+area.height/2,0);
  await page.keyboard.down('Alt');await page.mouse.move(start.x+area.width*.32+4,start.y+area.height*.34+4);
  await expect(page.locator('.alignment-guide')).toHaveCount(0);expect((await page.evaluate(()=>studio.item.x))-40).toBeGreaterThan(.2);
  await page.keyboard.up('Alt');await page.mouse.move(start.x+area.width*.32+3,start.y+area.height*.34+3);await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();const stored=await page.evaluate(()=>saved.scenes.dashboard.elements[0]);expect([stored.x,stored.y,stored.width,stored.height]).toEqual([40,42,20,16]);expect(JSON.stringify(stored)).not.toContain('guide');
  await page.evaluate(()=>studio.action('undo'));expect(await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.id==='moving');return [item.x,item.y];})).toEqual([8,8]);
});

test('alignment guides balance equal gaps between neighbours and align their edges',async({page})=>{
  await alignmentScene(page,[{id:'before',x:6,y:30,width:14,height:12},{id:'after',x:78,y:30,width:12,height:12}]);
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentDrag(page);
  await page.mouse.move(start.x+area.width*.31+2,start.y+area.height*.22+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y])).toEqual([39,30]);
  await expect(page.locator('.alignment-guide[data-kind=gap]')).toHaveCount(2);await expect(page.locator('.alignment-guide[data-kind=align][data-axis=y]')).toHaveCount(1);
  const distances=await page.evaluate(()=>{const [m,a,b]=studio.scene.elements;return [m.x-a.x-a.width,b.x-m.x-m.width];});expect(distances).toEqual([19,19]);
  await page.mouse.move(start.x+area.width*.70+2,start.y+area.height*.22+2,{steps:3});expect(await page.evaluate(()=>studio.item.x)).toBe(78);await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
});

test('alignment guides use scroll content coordinates and disappear on pointer cancellation',async({page})=>{
  await alignmentScene(page,[{id:'reference',x:55,y:150,width:20,height:18}],200);
  await page.evaluate(()=>{studio.item.y=110;studio.changed();studio.renderer.content.scrollTop=studio.shadowRoot.querySelector('.stage').clientHeight*.8;});
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentDrag(page);
  await page.evaluate(()=>studio.renderer.content.scrollTop+=20);
  await page.mouse.move(start.x+area.width*.47+2,start.y+area.height*.40-20+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y])).toEqual([55,150]);
  const line=await page.locator('.alignment-guide[data-axis=y]').boundingBox(),ref=await page.locator('.selection[data-id="reference"]').boundingBox();expect(line.y).toBeCloseTo(ref.y,0);
  await page.locator('.selection[data-id="moving"]').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
});

test('alignment guides also center clock content and preserve its fixed frame while dragging',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('clock');Object.assign(studio.item,{width:80,height:60,manual_size:true,parts:{time:{font_size:20,frame_width:60,frame_height:30,anchor_x:0,anchor_y:0},date:{visible:false}}});studio.editContentsForTest(studio.selected);});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true}),frame=await editor.locator('.widget-frame').boundingBox(),part=await editor.locator('.part-outline').boundingBox();
  await page.mouse.move(part.x+part.width/2,part.y+part.height/2);await page.mouse.down();
  await page.mouse.move(frame.x+frame.width/2+2,frame.y+frame.height/2+2,{steps:5});
  const aligned=await page.evaluate(()=>({ink:studio.widgetEditor.inkBox(),conf:structuredClone(studio.widgetEditor.config)}));expect(aligned.ink.x).toBeCloseTo(20,1);expect(aligned.ink.y).toBeCloseTo(35,1);expect(aligned.conf.frame_width).toBe(60);expect(aligned.conf.frame_height).toBe(30);
  await expect(editor.locator('.alignment-guide[data-axis=x]')).toHaveCount(1);await expect(editor.locator('.alignment-guide[data-axis=y]')).toHaveCount(1);
  await page.mouse.up();await expect(editor.locator('.alignment-guides')).toHaveCount(0);
});

async function startAlignmentResize(page) {
  const r=await page.locator('.selection.selected .resize').boundingBox();
  const start={x:r.x+r.width/2,y:r.y+r.height/2};await page.mouse.move(start.x,start.y);await page.mouse.down();return start;
}

test('resize guides snap both free edges and support Alt without moving the fixed corner',async({page})=>{
  await alignmentScene(page,[{id:'reference',x:55,y:50,width:20,height:18}]);
  await page.locator('.properties').getByLabel('Seitenverhältnis beibehalten',{exact:true}).uncheck();
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentResize(page);
  await page.mouse.move(start.x+area.width*.27+2,start.y+area.height*.26+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual([8,8,47,42]);
  await expect(page.locator('.alignment-guide[data-axis=x]')).toHaveCount(1);await expect(page.locator('.alignment-guide[data-axis=y]')).toHaveCount(1);
  await page.keyboard.down('Alt');await page.mouse.move(start.x+area.width*.27+4,start.y+area.height*.26+4);await expect(page.locator('.alignment-guide')).toHaveCount(0);expect(await page.evaluate(()=>studio.item.width)).toBeGreaterThan(47.1);
  await page.keyboard.up('Alt');await page.mouse.move(start.x+area.width*.27+2,start.y+area.height*.26+2);await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>[saved.scenes.dashboard.elements[0].width,saved.scenes.dashboard.elements[0].height])).toEqual([47,42]);
});

test('resize guides preserve a locked ratio when nearby axes cannot both snap',async({page})=>{
  await alignmentScene(page,[{id:'right',x:38,y:58,width:9,height:12},{id:'bottom',x:70,y:33,width:12,height:15}]);
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentResize(page);
  await page.mouse.move(start.x+area.width*.10+2,start.y+area.height*.08+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual([8,8,30,24]);
  await expect(page.locator('.alignment-guide[data-axis=x]')).toHaveCount(1);await expect(page.locator('.alignment-guide[data-axis=y]')).toHaveCount(0);
  await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
});

test('resize guides match another elements width and height even without aligned edges',async({page})=>{
  await alignmentScene(page,[{id:'reference',x:65,y:65,width:32,height:23}]);
  await page.locator('.properties').getByLabel('Seitenverhältnis beibehalten',{exact:true}).uncheck();
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentResize(page);
  await page.mouse.move(start.x+area.width*.12+2,start.y+area.height*.07+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([32,23]);
  await expect(page.locator('.alignment-guide[data-kind=size]')).toHaveCount(4);await page.mouse.up();
});

test('resize guides account for scrolling during a drag and clear on cancellation',async({page})=>{
  await alignmentScene(page,[{id:'reference',x:55,y:151,width:20,height:18}],200);
  await page.evaluate(()=>{studio.item.y=110;studio.item.lock_ratio=false;studio.changed();studio.renderer.content.scrollTop=studio.shadowRoot.querySelector('.stage').clientHeight*.8;});
  const area=await page.locator('.stage').boundingBox(),start=await startAlignmentResize(page);
  await page.evaluate(()=>studio.renderer.content.scrollTop+=20);
  await page.mouse.move(start.x+area.width*.27+2,start.y+area.height*.25-20+2,{steps:5});
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual([8,110,47,41]);
  const line=await page.locator('.alignment-guide[data-axis=y]').boundingBox(),ref=await page.locator('.selection[data-id="reference"]').boundingBox();expect(line.y).toBeCloseTo(ref.y,0);
  await page.locator('.selection.selected').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await expect(page.locator('.alignment-guides')).toHaveCount(0);
});

for(const locked of [false,true])test('resize guides align clock contents with siblings and retain the top left: '+locked,async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(locked=>{studio.insertCard('clock');Object.assign(studio.item,{width:80,height:60,manual_size:true,lock_ratio:locked,parts:{time:{font_size:20,frame_width:40,frame_height:25,anchor_x:0,anchor_y:0},date:{font_size:8,frame_width:60,frame_height:20,anchor_x:0,anchor_y:100}}});studio.editContentsForTest(studio.selected);},locked);
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true}),frame=await editor.locator('.widget-frame').boundingBox(),handle=await editor.locator('.part-resize').boundingBox(),start={x:handle.x+handle.width/2,y:handle.y+handle.height/2};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+frame.width*.20+2,start.y+frame.height*(locked?.125:-.05)+2,{steps:5});
  const current=await page.evaluate(()=>studio.widgetEditor.inkBox());expect(current.x).toBeCloseTo(0,1);expect(current.y).toBeCloseTo(0,1);expect(current.width).toBeCloseTo(60,1);expect(current.height).toBeCloseTo(locked?37.5:20,1);
  await expect(editor.locator('.alignment-guide[data-axis=x][data-kind=align]')).toHaveCount(1);await page.mouse.up();await expect(editor.locator('.alignment-guides')).toHaveCount(0);
});

test('preset size changes preserve the center in both inspectors and clamp only at view edges',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await expect(page.locator('#new-theme')).toHaveCount(0);await expect(page.locator('#new-size')).toHaveCount(0);
  await page.evaluate(()=>{studio.insertCard('clock');Object.assign(studio.item,{x:37.5,y:40,width:25,height:20});studio.changed(true);});
  const read=()=>page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height]);
  await page.locator('[data-home-size]').selectOption('clock_extra_large');expect(await read()).toEqual([10,20,80,60]);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});await editor.locator('[data-widget-size]').selectOption('clock_small');expect(await read()).toEqual([40,42,20,16]);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.evaluate(()=>{studio.item.x=0;studio.item.y=0;studio.changed();});await page.locator('[data-home-size]').selectOption('clock_extra_large');expect(await read()).toEqual([0,0,80,60]);
  await page.evaluate(()=>{studio.scene.scroll_height=200;Object.assign(studio.item,{x:37.5,y:150,width:25,height:20});studio.changed(true);});await page.locator('[data-home-size]').selectOption('clock_large');expect(await read()).toEqual([30,144,40,32]);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>{const i=saved.scenes.dashboard.elements.at(-1);return [i.x+i.width/2,i.y+i.height/2];})).toEqual([50,160]);
  await page.evaluate(()=>{studio.insertCard('status');Object.assign(studio.item,{x:40,y:40,width:20,height:16});studio.changed(true);});await page.locator('[data-home-size]').selectOption('large');const [x,y,w,h]=await read();expect(x+w/2).toBeCloseTo(50,4);expect(y+h/2).toBeCloseTo(48,4);
});

test('manual size explicitly reveals dimensions and ratio lock without changing or losing a preset sized surface',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
  const properties=page.locator('.properties');await expect(properties.getByLabel('Breite (%)',{exact:true})).toHaveCount(0);await expect(properties.getByLabel('Seitenverhältnis beibehalten',{exact:true})).toHaveCount(0);
  const original=await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height]);
  await properties.locator('[data-home-size]').selectOption('custom');await expect(properties.getByLabel('Breite (%)',{exact:true})).toHaveValue('25');await expect(properties.getByLabel('Seitenverhältnis beibehalten',{exact:true})).toBeChecked();expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual(original);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).manual_size)).toBe(true);
  await page.evaluate(async()=>{const doc=await hass.callApi('GET','display_studio/layout_library/one');studio.accept(doc);await studio.openView('dashboard');studio.select(studio.scene.elements.at(-1).id);});
  await expect(properties.locator('[data-home-size]')).toHaveValue('custom');await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveValue('25');
  await editor.locator('[data-widget-size]').selectOption('clock_large');await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveCount(0);await expect(editor.getByLabel('Grundfläche Höhe (%)',{exact:true})).toHaveCount(0);await expect(editor.getByLabel('Seitenverhältnis beibehalten',{exact:true})).toHaveCount(0);
  await editor.locator('[data-widget-size]').selectOption('custom');await expect(editor.getByLabel('Grundfläche Breite (%)',{exact:true})).toHaveValue('40');await expect(editor.getByLabel('Grundfläche Höhe (%)',{exact:true})).toHaveValue('32');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await properties.locator('[data-home-size]').selectOption('clock_medium');expect(await page.evaluate(()=>studio.item.manual_size)).toBeUndefined();await expect(properties.getByLabel('Breite (%)',{exact:true})).toHaveCount(0);
});

test('clock alignment defaults to center and each text field can override or inherit it without changing the reserved frame',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>{studio.insertCard('clock');studio.editContentsForTest(studio.selected);});
  expect(await page.evaluate(()=>studio.item.align)).toBe('center');await ownWidgetStyle(page);const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  for(const part of ['time','date']){
    await editor.getByLabel('Inhaltselement',{exact:true}).selectOption(part);const positions=[];
    for(const align of ['left','center','right']){
      await editor.getByLabel('Textausrichtung',{exact:true}).selectOption(align);
      positions.push(await page.evaluate(()=>{const w=studio.widgetEditor;w.tick(new Date(2026,9,16,11,11,11));return {left:parseFloat(w.element().style.left)+parseFloat(w.element().style.textIndent || 0),frame:w.element()._clockFrame};}));
    }
    expect(positions[1].left).toBeGreaterThan(positions[0].left);expect(positions[2].left).toBeGreaterThan(positions[1].left);expect(positions[1].frame).toEqual(positions[0].frame);expect(positions[2].frame).toEqual(positions[0].frame);
    await editor.getByLabel('Textausrichtung',{exact:true}).selectOption('');await page.evaluate(()=>studio.widgetEditor.tick(new Date(2026,9,16,11,11,11)));expect(await page.evaluate(()=>parseFloat(studio.widgetEditor.element().style.left)+parseFloat(studio.widgetEditor.element().style.textIndent || 0))).toBeCloseTo(positions[1].left,2);
  }
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.locator('[data-prop=align]').selectOption('right');
  const old=await page.evaluate(()=>{studio.renderer.tick(new Date(2026,9,16,11,11,11));return parseFloat(studio.renderer.nodes[studio.item.id]._detail.style.left)+parseFloat(studio.renderer.nodes[studio.item.id]._detail.style.textIndent || 0);});await page.locator('[data-prop=align]').selectOption('left');await page.evaluate(()=>studio.renderer.tick(new Date(2026,9,16,11,11,11)));expect(await page.evaluate(()=>parseFloat(studio.renderer.nodes[studio.item.id]._detail.style.left)+parseFloat(studio.renderer.nodes[studio.item.id]._detail.style.textIndent || 0))).toBeLessThan(old);
});

test('alpha colors survive Safari serialization, opacity sliders update live and save without reducing color alpha',async({page,browserName})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>{studio.insertCard('clock');studio.elementStyling(studio.item,true);studio.changed(true);});
  const props=page.locator('.properties'),color=props.locator('[data-prop=background]'),opacity=props.getByRole('slider',{name:'Deckkraft der Fläche',exact:true});
  await expect(color).toHaveAttribute('alpha','');await expect(color).toHaveAttribute('colorspace','limited-srgb');
  if(browserName==='webkit')for(const [value,expected] of [['#12345680','#12345680'],['color(srgb 1 0 0 / 0.25)','#ff000040'],['transparent','#00000000'],['#abcdef','#abcdef']]){
    await color.evaluate((el,value)=>el.value=value,value);await color.dispatchEvent('change');expect(await page.evaluate(()=>studio.item.background)).toBe(expected);
  }
  await page.evaluate(()=>{studio.item.background='#12345680';studio.changed(true);});
  const history=await page.evaluate(()=>studio.history.length);
  for(const value of ['0.25','0.4','0.5']){await opacity.evaluate((el,value)=>el.value=value,value);await opacity.dispatchEvent('input');}
  expect(await page.evaluate(()=>studio.history.length)).toBe(history+1);expect(await page.evaluate(()=>studio.item.opacity)).toBe(.5);
  await expect(props.locator('.opacity-control').filter({has:page.locator('[data-prop=opacity]')}).locator('output')).toHaveText('50 %');expect(await page.evaluate(()=>parseFloat(getComputedStyle(studio.renderer.nodes[studio.item.id]).backgroundColor.split(',').at(-1)))).toBeCloseTo(.251,2);
  await opacity.dispatchEvent('change');await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const textColor=editor.locator('[data-color]');if(browserName==='webkit'){await textColor.evaluate(el=>el.value='#ff660080');await textColor.dispatchEvent('change');}else await page.evaluate(()=>studio.widgetEditor.update('color','#ff660080'));
  const partOpacity=editor.getByRole('slider',{name:'Inhalt Deckkraft',exact:true});await partOpacity.evaluate(el=>el.value='0');await partOpacity.dispatchEvent('input');expect(await page.evaluate(()=>studio.widgetEditor.config.opacity)).toBe(0);await partOpacity.dispatchEvent('change');
  expect(await page.evaluate(()=>LGWidgetParts.valid(studio.item))).toBe(true);
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const item=await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1));expect(item.background).toBe('#12345680');expect(item.opacity).toBe(.5);expect(item.parts.time.color).toBe('#ff660080');expect(item.parts.time.opacity).toBe(0);
});

test('standard sizes lock resizing and hide manual content geometry; clock surface follows visible rows',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
  await expect(page.locator('.selection.selected .resize')).toHaveCount(0);
  await expect(page.locator('.properties [data-prop=font_size]')).toHaveCount(0);
  const before=await page.evaluate(()=>[studio.item.width,studio.item.height]);
  await expect(page.locator('.selection.selected')).toHaveCSS('cursor','move');const beforeX=await page.evaluate(()=>studio.item.x);
  await page.locator('.selection.selected').press('ArrowRight');expect(await page.evaluate(()=>studio.item.x)).toBe(beforeX+1);expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual(before);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));await ownWidgetStyle(page);const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const hidden=async()=>{for(const key of ['x','y','width','height','font_size','radius'])await expect(editor.locator(`[data-field=${key}]`)).toHaveCount(0);await expect(editor.locator('.part-resize')).toHaveCount(0);await expect(editor.locator('.part-outline')).toHaveCSS('cursor','default');await expect(editor.locator('.part-outline')).not.toHaveAttribute('aria-label',/verschieben/);};await hidden();
  const read=()=>page.evaluate(()=>{const i=studio.item,n=studio.renderer.nodes[i.id];return {width:i.width,height:i.height,size:studio.currentSize(i),valid:LGWidgetParts.valid(i),fonts:[n._value,n._detail].map(el=>parseFloat(getComputedStyle(el).fontSize))};});
  const both=await read();
  for(let cycle=0;cycle<2;cycle++){
    await editor.locator('[data-clock-view]').selectOption('time');const time=await read();expect(time.height).toBeLessThan(both.height);expect(time.fonts[0]).toBeCloseTo(both.fonts[0],1);expect(time.size).toBe('clock_medium');expect(time.valid).toBe(true);
    await editor.locator('[data-clock-view]').selectOption('date');const date=await read();expect(date.height).toBeLessThan(time.height);expect(date.fonts[1]).toBeCloseTo(both.fonts[1],1);expect(date.valid).toBe(true);await hidden();
    await editor.locator('[data-clock-view]').selectOption('both');expect((await read()).height).toBe(20);expect((await read()).fonts).toEqual(both.fonts);
  }
  await editor.locator('[data-clock-view]').selectOption('date');const compact=await read();
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(async()=>{studio.accept(await hass.callApi('GET','display_studio/layout_library/one'));await studio.openView('dashboard');studio.select(studio.scene.elements.at(-1).id);studio.editContentsForTest(studio.selected);});expect((await read()).height).toBeCloseTo(compact.height,3);
  await editor.locator('[data-clock-view]').selectOption('both');expect((await read()).height).toBe(20);
  await editor.locator('[data-widget-size]').selectOption('custom');for(const key of ['x','y','width','height','font_size','radius'])await expect(editor.locator(`[data-field=${key}]`)).toBeVisible();await expect(editor.locator('.part-resize')).toHaveCount(1);await expect(editor.locator('.part-outline')).toHaveCSS('cursor','move');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await expect(page.locator('.selection.selected .resize')).toHaveCount(1);await expect(page.locator('.selection.selected')).toHaveCSS('cursor','move');
  await page.evaluate(()=>studio.insertCard('status'));await page.locator('[data-home-size]').selectOption('compact');await expect(page.locator('.selection.selected .resize')).toHaveCount(0);
});

test('all five bundled fonts render distinctly on HTTP and native previews and survive selection and saving',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>{studio.insertCard('text');studio.elementStyling(studio.item,true);studio.item.text='Welt Äg 0123456789';studio.item.parts={};studio.changed(true);});
  const select=page.locator('.properties [data-prop=font]');await expect(select.locator('option')).toHaveCount(5);
  const images=[];
  for(const [key,family] of [['sans','StudioNative'],['serif','StudioSerif'],['mono','StudioMono'],['condensed','StudioCondensed'],['rounded','StudioRounded']]){
    await select.selectOption(key);await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(family=>document.fonts.check('400 32px '+family)&&document.fonts.check('600 32px '+family),family)).toBe(true);
    const text=page.locator('.scene .lg-text .lg-value').last();await expect(text).toHaveCSS('font-family',family+', sans-serif');images.push((await text.screenshot()).toString('base64'));
  }
  expect(new Set(images).size).toBe(5);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).font)).toBe('rounded');
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));await page.getByLabel('Inhalt Schrift',{exact:true}).selectOption('serif');await expect(page.locator('.widget-preview .lg-text .lg-value')).toHaveCSS('font-family','StudioSerif, sans-serif');
});

for(const width of [390,1200,1500,1800])test('appearance controls stay inside the inspector at width '+width,async({page})=>{
  await mount(page,width);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
  const assertFits=async selector=>{
    const overflow=await page.locator(selector).evaluate(root=>[...root.querySelectorAll('input,select,output')].filter(el=>el.getBoundingClientRect().width).flatMap(el=>{const r=el.getBoundingClientRect(),p=el.closest('label').getBoundingClientRect(),b=root.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1||r.right>b.right+1?[{label:el.closest('label').textContent.trim(),left:r.left,right:r.right,parent:p.right,root:b.right}]:[];}));expect(overflow).toEqual([]);
  };
  await assertFits('.properties');await page.evaluate(()=>studio.editContentsForTest(studio.selected));await assertFits('.widget-inspector');
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});await editor.locator('[data-widget-size]').selectOption('custom');await assertFits('.widget-inspector');
});

for(const inspector of ['properties','editor'])test('manual clock geometry returns to canonical preset in '+inspector,async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(inspector=>{
    clearInterval(studio._clock);studio.insertCard('clock');Object.assign(studio.item,{x:30,y:25,style_override:true,manual_size:true,width:52,height:38,font_size:2,font:'serif',color:'#ffeecc',clock_seconds:true,clock_blink:false,clock_date_format:'iso'});
    Object.assign(studio.item.parts.time,{x:24,y:20,width:20,height:10,font_size:3,frame_width:20,frame_height:10,anchor_x:90,anchor_y:90,radius:20,color:'#abcdef',font:'mono'});
    Object.assign(studio.item.parts.date,{x:65,y:60,width:30,height:10,font_size:4,frame_width:20,frame_height:10,anchor_x:80,anchor_y:10});studio.changed(true);window.manualClock=structuredClone(studio.item);
    if(inspector==='editor')studio.editContentsForTest(studio.selected);
  },inspector);
  const size=page.locator(inspector==='editor'?'[data-widget-size]':'[data-home-size]');
  await size.selectOption('clock_medium');
  const restored=await page.evaluate(()=>structuredClone(studio.item));
  expect([restored.width,restored.height]).toEqual([25,20]);expect([restored.x+restored.width/2,restored.y+restored.height/2]).toEqual([56,44]);
  expect(restored.font).toBe('serif');expect(restored.clock_seconds).toBe(true);expect(restored.clock_blink).toBe(false);expect(restored.clock_date_format).toBe('iso');
  expect(restored.parts.time.color).toBe('#abcdef');expect(restored.parts.time.font).toBe('mono');
  for(const id of ['time','date'])for(const key of ['x','y','width','height','font_size','frame_width','frame_height','anchor_x','anchor_y','radius'])expect(restored.parts[id][key],id+'/'+key).toEqual(catalog.widget_defaults.clock.parts[id][key]);
  if(inspector==='editor')await page.locator('[data-undo]').last().click();else await page.locator('[data-action=undo]').click();
  await page.evaluate(()=>studio.select(manualClock.id));expect(await page.evaluate(()=>studio.item)).toEqual(await page.evaluate(()=>manualClock));
  await size.selectOption('clock_medium');
  if(inspector==='editor')await page.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1))).toEqual(restored);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  for(const mode of ['both','time','date','both']){
    await page.locator('[data-clock-view]').selectOption(mode);
    const geometry=await page.evaluate(()=>{
      const item=studio.item,stage=studio.renderer.nodes[item.id],editor=studio.widgetEditor.node;
      const read=node=>{const b=node.getBoundingClientRect();return [node._value,node._detail].map(el=>({visible:getComputedStyle(el).display!=='none',size:parseFloat(getComputedStyle(el).fontSize)/b.width,frame:el._clockFrame?Object.fromEntries(Object.entries(el._clockFrame).map(([k,v])=>[k,v/b.width*1024*item.width/100])):null}));};
      return [read(stage),read(editor)];
    });
    geometry[0].forEach((part,index)=>{if(!part.visible)return;expect(geometry[1][index].size).toBeCloseTo(part.size,2);for(const key of ['x','y','width','height'])expect(Math.abs(geometry[1][index].frame[key]-part.frame[key]),mode+'/'+key).toBeLessThan(2);});
  }
});

test('standard tile sizes discard manual nested geometry while retaining content and styling',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  for(const kind of ['status','media','weather']){
    await page.evaluate(kind=>{
      studio.insertCard(kind,'sensor.temperature','Eigener Name');Object.assign(studio.item,{style_override:true,manual_size:true,font_size:17,width:45,height:30});
      studio.item.parts={label:{x:50,y:50,width:10,height:10,font_size:1,color:'#abcdef',font:'rounded',text:'Mein Text'},detail:{visible:false},[kind==='weather'?'forecast_1_high':'title']:{x:20,y:80,width:20,height:10,font_size:90,opacity:.7}};studio.changed(true);
    },kind);
    await page.locator('[data-home-size]').selectOption('large');
    const item=await page.evaluate(()=>structuredClone(studio.item));expect(item.entity_id).toBe('sensor.temperature');expect(item.label).toBe('Eigener Name');
    expect(item.parts.label).toEqual({color:'#abcdef',font:'rounded',text:'Mein Text'});expect(item.parts.detail.visible).toBe(false);expect(item.parts[kind==='weather'?'forecast_1_high':'title']).toEqual({opacity:.7});expect(item.font_size).toBe(kind==='status'?4:3.5);
    await page.evaluate(()=>studio.editContentsForTest(studio.selected));await page.locator('[data-widget-size]').selectOption('compact');expect(await page.evaluate(()=>studio.item.parts)).toEqual(item.parts);await page.getByRole('button',{name:'Fertig',exact:true}).click();
  }
});

for(const native of [false,true])test('single clock rows retain text size and fill a centered compact surface: '+native,async({page})=>{
  if(native)await boardPreview(page);else await mount(page);
  await openView(page,'Dashboard');await page.evaluate(()=>{clearInterval(studio._clock);studio.insertCard('clock');studio.editContentsForTest(studio.selected);});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const geometry=()=>page.evaluate(()=>{
    const item=studio.item;
    const read=node=>{const bounds=node.getBoundingClientRect();return [node._value,node._detail].map(el=>{const f=el._clockFrame;return {size:parseFloat(getComputedStyle(el).fontSize)/bounds.width,height:bounds.height,width:bounds.width,visible:getComputedStyle(el).display!=='none',frame:f?{...f}:null};});};
    return {height:item.height,width:item.width,rows:[read(studio.renderer.nodes[item.id]),read(studio.widgetEditor.node)]};
  });
  const both=await geometry();
  for(let cycle=0;cycle<2;cycle++)for(const mode of ['time','date','both']){
    await editor.locator('[data-clock-view]').selectOption(mode);const current=await geometry();expect(current.width).toBe(both.width);
    if(mode==='both'){expect(current.height).toBe(both.height);continue;}
    expect(current.height).toBeLessThan(both.height);const index=mode==='time'?0:1;
    await expect(editor.locator('[data-part]')).toHaveValue(mode);await expect(editor.locator('.part-outline')).toBeVisible();await expect(editor.locator('.part-outline')).toHaveCSS('cursor','default');
    if(native&&cycle===0&&mode==='date')await editor.screenshot({path:test.info().outputPath('compact-date-editor.png')});
    current.rows.forEach((rows,renderer)=>{const row=rows[index];expect(row.size).toBeCloseTo(both.rows[renderer][index].size,2);expect(row.frame.height/row.height).toBeGreaterThan(.8);expect(Math.abs(row.frame.y-(row.height-row.frame.height)/2)).toBeLessThan(1);expect(row.frame.width/row.width).toBeCloseTo(1,2);});
  }
  await editor.locator('[data-clock-view]').selectOption('date');const compact=await geometry();
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).height)).toBeCloseTo(compact.height,4);
  await page.evaluate(()=>{studio.editContentsForTest(studio.selected);studio.widgetEditor.tick(new Date('2030-09-26T22:59:59Z'));});const later=await geometry();expect(later.height).toBeCloseTo(compact.height,4);await expect(editor.locator('[data-part]')).toHaveValue('date');
});

test('widget cancel discards its complete edit without losing the surrounding draft or undo history',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>{studio.insertCard('clock');studio.item.color='#aabbcc';studio.changed();window.beforeEdit=structuredClone(studio.config);window.beforeHistory=structuredClone(studio.history);window.beforeRevision=revision;studio.editContentsForTest(studio.selected);});
  await ownWidgetStyle(page);const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await editor.locator('[data-widget-size]').selectOption('clock_large');await editor.locator('[data-clock-view]').selectOption('date');await editor.getByLabel('Inhalt Schrift',{exact:true}).selectOption('serif');
  await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>studio.config)).toEqual(await page.evaluate(()=>beforeEdit));expect(await page.evaluate(()=>studio.history)).toEqual(await page.evaluate(()=>beforeHistory));expect(await page.evaluate(()=>revision)).toBe(await page.evaluate(()=>beforeRevision));
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));await editor.locator('[data-clock-view]').selectOption('time');await editor.press('Escape');await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>studio.config)).toEqual(await page.evaluate(()=>beforeEdit));
});

test('Fertig saves the widget and keeps the dialog and draft on failure',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>{studio.insertCard('clock');studio.editContentsForTest(studio.selected);window.failSave=true;});
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});await editor.locator('[data-clock-view]').selectOption('date');
  await editor.getByRole('button',{name:'Fertig',exact:true}).click();await expect(editor).toBeVisible();await expect(editor.locator('.widget-feedback')).toContainText('andere Sitzung');expect(await page.evaluate(()=>studio.item.parts.time.visible)).toBe(false);
  await page.evaluate(()=>window.failSave=false);await editor.getByRole('button',{name:'Fertig',exact:true}).click();await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1))).toEqual(await page.evaluate(()=>studio.item));expect(await page.evaluate(()=>studio.dirty)).toBe(false);
});

test('view cancel restores persisted nested edits and preserves a pre-existing unsaved draft',async({page})=>{
  await boardPreview(page);await page.evaluate(()=>{studio.config.views.find(v=>v.id==='dashboard').name='Mein Dashboard';studio.changed();window.outerDraft=structuredClone(studio.config);window.outerSaved=structuredClone(studio.saved);});
  await openView(page,'Mein Dashboard');await page.evaluate(()=>{studio.insertCard('clock');studio.editContentsForTest(studio.selected);});const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await editor.locator('[data-clock-view]').selectOption('date');await editor.getByRole('button',{name:'Fertig',exact:true}).click();await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(saved)!==JSON.stringify(outerSaved))).toBe(true);
  await page.evaluate(()=>window.failSave=true);await page.locator('[data-action=cancel-edit]').click();await expect(page.locator('.workspace')).toBeVisible();await expect(page.locator('.flash')).toContainText('zwischenzeitlich');expect(await page.evaluate(()=>JSON.stringify(saved)!==JSON.stringify(outerSaved))).toBe(true);
  await page.evaluate(()=>window.failSave=false);await page.locator('[data-action=cancel-edit]').click();await expect(page.locator('.overview')).toBeVisible();
  expect(await page.evaluate(()=>saved)).toEqual(await page.evaluate(()=>outerSaved));expect(await page.evaluate(()=>studio.config)).toEqual(await page.evaluate(()=>outerDraft));expect(await page.evaluate(()=>studio.dirty)).toBe(true);
});

test('view and theme editors support cancel and saved completion including newly created themes',async({page})=>{
  await boardPreview(page);await page.evaluate(()=>studio.duplicateView('dashboard'));await openView(page,'Dashboard · Kopie');await page.evaluate(()=>{window.originalName=studio.view.name;});
  await page.locator('#view-name').fill('Verwerfen');await page.locator('#view-name').press('Tab');await page.locator('[data-action=cancel-edit]').click();await expect(page.locator('.overview')).toBeVisible();expect(await page.evaluate(()=>studio.config.views.find(v=>v.name==='Dashboard · Kopie').name)).toBe('Dashboard · Kopie');
  await openView(page,'Dashboard · Kopie');await page.locator('#view-name').fill('Gespeicherter Name');await page.locator('#view-name').press('Tab');await page.locator('[data-action=finish-edit]').click();await expect(page.locator('.overview')).toBeVisible();expect(await page.evaluate(()=>saved.views.at(-1).name)).toBe('Gespeicherter Name');
  const count=await page.evaluate(()=>studio.config.themes.length);await page.evaluate(()=>studio.createTheme());await page.locator('[data-action=cancel-edit]').click();expect(await page.evaluate(()=>studio.config.themes.length)).toBe(count);
  await page.evaluate(()=>studio.createTheme());await page.locator('#view-name').fill('Mein gespeichertes Theme');await page.locator('#view-name').press('Tab');await page.locator('[data-action=finish-edit]').click();await expect(page.locator('.overview')).toBeVisible();expect(await page.evaluate(()=>saved.themes.at(-1).name)).toBe('Mein gespeichertes Theme');
  const views=await page.evaluate(()=>studio.config.views.length);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();await expect(page.locator('.workspace')).toBeVisible();await page.locator('[data-action=cancel-edit]').click();await expect(page.locator('.overview')).toBeVisible();expect(await page.evaluate(()=>studio.config.views.length)).toBe(views);
});

test('Animationen groups local variants in direct widget settings and preserves legacy settings',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  expect(await page.evaluate(()=>studio.availableKinds.animation)).toBe('Animationen');
  expect(await page.evaluate(()=>Object.keys(studio.availableKinds))).not.toEqual(expect.arrayContaining(['spinner','progress']));
  await addElement(page,'animation');
  await expect(page.locator('.properties [data-prop=label],.properties [data-prop=show_label]')).toHaveCount(0);
  await expect(page.locator('.layer.active .name')).toHaveText('Animation · Spinner');
  const editor=page.locator('.properties');
  await expect(editor.locator('[data-prop=font_size],[data-prop=font],[data-prop=align]')).toHaveCount(0);
  await expect(editor.locator('[data-animation=animation_type] option')).toHaveCount(5);
  for(const type of ['dots','pulse','bars','spinner','progress']){
    await editor.locator('[data-animation=animation_type]').selectOption(type);
    expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual(await page.evaluate(type=>LGAnimations[type].size,type));
    const visual=page.locator('.scene .lg-startup-animation .lg-startup-'+type);await expect(visual).toBeVisible();
    expect(await visual.evaluate(el=>el.getAnimations({subtree:true}).length)).toBeGreaterThan(0);
    const before=await visual.evaluate(el=>Array.from(el.querySelectorAll('*')).map(n=>[getComputedStyle(n).opacity,getComputedStyle(n).transform,getComputedStyle(n).left]));
    await page.waitForTimeout(160);
    expect(await visual.evaluate(el=>Array.from(el.querySelectorAll('*')).map(n=>[getComputedStyle(n).opacity,getComputedStyle(n).transform,getComputedStyle(n).left]))).not.toEqual(before);
  }
  await editor.locator('[data-animation=animation_duration]').fill('1800');await editor.locator('[data-animation=animation_duration]').press('Tab');
  await editor.locator('[data-animation=progress_value]').fill('37');await editor.locator('[data-animation=progress_value]').press('Tab');
  await expect(page.locator('.scene .lg-animation-shine')).toHaveCSS('animation-duration','1.8s');
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  await expect(page.getByRole('dialog',{name:'Widget bearbeiten',exact:true})).toHaveCount(0);
  await expect(page.locator('.layer.active .widget-edit,.selection.selected .widget-edit,.properties [data-widget-edit]')).toHaveCount(3);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.find(v=>v.id==='dashboard').scene.elements.at(-1))).toMatchObject({kind:'animation',animation_type:'progress',animation_duration:1800,progress_value:37,progress_source:'fixed',label:'Animation · Fortschrittsbalken',show_label:false});
  await expect(page.locator('.layer.active .name')).toHaveText('Animation · Fortschrittsbalken');
  await expect(page.locator('.properties [data-prop=label],.properties [data-prop=show_label]')).toHaveCount(0);
  await openView(page,'Verbindungsaufbau');
  expect(await page.evaluate(()=>studio.availableKinds.animation)).toBe('Animationen');
  await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='spinner');item.spinner_duration=2250;item.parts={spinner:{opacity:.6}};studio.select(item.id);});
  await expect(editor.locator('[data-animation=animation_type]')).toHaveValue('spinner');
  await expect(editor.locator('[data-animation=animation_duration]')).toHaveValue('2250');
  await expect(editor.locator('[data-animation-opacity]')).toHaveValue('0.6');
  await expect(page.locator('.layer.active .widget-edit,.selection.selected .widget-edit,.properties [data-widget-edit]')).toHaveCount(3);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));await expect(page.getByRole('dialog',{name:'Widget bearbeiten',exact:true})).toHaveCount(0);
  await editor.locator('[data-animation=animation_type]').selectOption('pulse');
  expect(await page.evaluate(()=>studio.item)).toMatchObject({kind:'animation',animation_type:'pulse',animation_duration:2250,parts:{animation:{opacity:.6}}});
  await page.locator('[data-action=undo]').click();
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='spinner').id));
  expect(await page.evaluate(()=>studio.item)).toMatchObject({kind:'spinner',spinner_duration:2250,parts:{spinner:{opacity:.6}}});
  await page.evaluate(()=>studio.insertCard('text'));
  await ownWidgetStyle(page);
  for(const key of ['font_size','align','font'])await expect(editor.locator(`[data-prop=${key}]`)).toBeVisible();
  await expect(page.locator('.layer.active .widget-edit,.selection.selected .widget-edit,.properties [data-widget-edit]')).toHaveCount(3);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));await expect(page.getByRole('dialog',{name:'Widget bearbeiten',exact:true})).toBeVisible();
});

test('each animation has only its own three standard sizes and manual; presets preserve center and reset manual geometry',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('animation');studio.item.x=44;studio.item.y=44;studio.changed(true);});
  const editor=page.locator('.properties');
  const sizes=editor.locator('[data-home-size]');
  await expect(sizes).toHaveValue('animation_medium');
  expect(await sizes.locator('option').allTextContents()).toEqual(['Manuell · freie Größe','Klein','Mittel','Groß']);
  for(const variant of ['spinner','progress','dots','pulse','bars']){
    await editor.locator('[data-animation=animation_type]').selectOption(variant);
    for(const size of ['small','medium','large']){
      await sizes.selectOption('animation_'+size);
      const data=await page.evaluate(()=>({box:[studio.item.width,studio.item.height],center:[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2],kind:studio.currentSize(studio.item)}));
      expect(data.box).toEqual(await page.evaluate(([variant,size])=>LGAnimations[variant].sizes[size],[variant,size]));
      expect(data.center).toEqual([50,50]);expect(data.kind).toBe('animation_'+size);
      await expect(editor.locator('[data-prop=width], [data-prop=height], [data-prop=lock_ratio]')).toHaveCount(0);
    }
  }
  await sizes.selectOption('custom');await expect(editor.locator('[data-prop=width]')).toBeVisible();
  await editor.locator('[data-prop=width]').fill('23');await editor.locator('[data-prop=width]').press('Tab');
  // Simulate a previously saved/imported manual inner layout.
  await page.evaluate(()=>{studio.item.parts={animation:{x:5,y:5,width:75,height:85,opacity:.7}};studio.changed(true);});
  const before=await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2]);
  await editor.locator('[data-animation=animation_type]').selectOption('progress');
  await expect(sizes).toHaveValue('custom');expect(await page.evaluate(()=>studio.item.width)).toBe(23);
  await sizes.selectOption('animation_medium');
  expect(await page.evaluate(()=>[studio.item.width,studio.item.height])).toEqual([50,4]);
  expect(await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2])).toEqual(before);
  expect(await page.evaluate(()=>studio.item.parts?.animation?.width)).toBeUndefined();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.selection.selected .resize')).toHaveCount(0);
  expect(await page.locator('[data-home-size] option').allTextContents()).toEqual(['Manuell · freie Größe','Klein','Mittel','Groß']);
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='animation').id));
  await expect(page.locator('[data-home-size]')).toHaveValue('animation_medium');
});


test('animation settings preserve legacy appearance and have stable tight frames with a move cursor',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('animation');studio.item.x=35;studio.item.y=35;studio.changed(true);});
  const settings=page.locator('.properties'),selection=page.locator('.selection.selected');
  for(const variant of ['spinner','progress','dots','pulse','bars']){
    await settings.locator('[data-animation=animation_type]').selectOption(variant);
    for(const preset of ['animation_small','animation_medium','animation_large']){
      await settings.locator('[data-home-size]').selectOption(preset);
      await expect(selection).toHaveCSS('cursor','move');
      await expect(selection.locator('.resize')).toHaveCount(0);await expect(selection.locator('.widget-edit')).toHaveCount(1);
      const result=await page.evaluate(()=>{
        const node=studio.renderer.nodes[studio.selected],visual=node._animationVisual,frame=studio.selectionRect(studio.item),rect=visual.getBoundingClientRect(),type=studio.item.animation_type;
        let width=rect.width,height=rect.height;
        if(type==='spinner'){width=parseFloat(getComputedStyle(visual.firstChild).width);height=width;}
        if(['dots','pulse','bars'].includes(type)){const side=Math.min(rect.width,rect.height);width=side*.84;height=side*({dots:.24,pulse:.84,bars:.70}[type]);}
        return {insets:[(frame.width-width)/2,(frame.height-height)/2],center:[frame.x+frame.width/2-(rect.x+rect.width/2),frame.y+frame.height/2-(rect.y+rect.height/2)],box:[frame.x,frame.y,frame.width,frame.height]};
      });
      for(const inset of result.insets)expect(inset).toBeCloseTo(3,1);
      for(const center of result.center)expect(center).toBeCloseTo(0,1);
      await page.waitForTimeout(80);
      expect(await page.evaluate(()=>{studio.paint();const r=studio.selectionRect(studio.item);return [r.x,r.y,r.width,r.height];})).toEqual(result.box);
    }
  }
  const original=await page.evaluate(()=>[studio.item.x,studio.item.y]);const box=await selection.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:4});await page.mouse.up();
  expect(await page.evaluate(()=>[studio.item.x,studio.item.y])).not.toEqual(original);
  await ownWidgetStyle(page);
  await page.evaluate(()=>{studio.item.parts={animation:{x:5,y:5,width:75,height:85,color:'#123456',opacity:.6,visible:false}};studio.changed(true);});
  expect(await settings.locator('[data-prop=color]').evaluate(el=>el.value)).toMatch(/#123456|color\(srgb/);
  await settings.locator('[data-animation-visible]').check();
  await settings.locator('[data-animation-opacity]').fill('0.4');await settings.locator('[data-animation-opacity]').dispatchEvent('change');
  await setColor(settings.locator('[data-prop=color]'),'#ff3300');
  await settings.locator('[data-animation-reset]').click();
  expect(await page.evaluate(()=>studio.item.parts.animation)).toEqual({opacity:.4,visible:true});
  expect(await page.evaluate(()=>studio.item.color)).toBe('#ff3300');
  await expect(page.locator('.scene .lg-startup-animation')).toHaveCSS('opacity','0.4');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.find(v=>v.id==='dashboard').scene.elements.at(-1).parts.animation)).toEqual({opacity:.4,visible:true});
});

test('progress animation follows a numeric HA entity live with bounds, unavailable state and saved source',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('animation'));
  const settings=page.locator('.properties');await settings.locator('[data-animation=animation_type]').selectOption('progress');
  await settings.locator('[data-animation=progress_source]').selectOption('entity');
  await settings.locator('[data-animation=entity_id]').fill('sensor.temperature');await settings.locator('[data-animation=entity_id]').press('Tab');
  await settings.locator('[data-animation=progress_max]').fill('40');await settings.locator('[data-animation=progress_max]').press('Tab');
  await settings.locator('[data-animation=progress_min]').fill('20');await settings.locator('[data-animation=progress_min]').press('Tab');
  const bar=page.locator('.scene .lg-startup-animation .lg-startup-progress');
  await expect(bar).toHaveAttribute('aria-valuenow','13');
  await page.evaluate(()=>window.originalAnimation=studio.renderer.nodes[studio.selected]._animationVisual);
  for(const [state,expected] of [['30','50'],['100','100'],['-5','0'],['unavailable',null],['unknown',null],['',null],['25','25']]){
    await page.evaluate(state=>{hass.states['sensor.temperature']={...hass.states['sensor.temperature'],state};studio.hass={...hass};},state);
    if(expected===null){await expect(bar).not.toHaveAttribute('aria-valuenow');await expect(bar).toHaveAttribute('aria-valuetext','Nicht verfügbar');}
    else await expect(bar).toHaveAttribute('aria-valuenow',expected);
  }
  expect(await page.evaluate(()=>originalAnimation===studio.renderer.nodes[studio.selected]._animationVisual)).toBe(true);
  await settings.locator('[data-animation=progress_max]').fill('20');await settings.locator('[data-animation=progress_max]').press('Tab');await expect(settings.locator('[data-animation=progress_max]')).toHaveValue('40');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.find(v=>v.id==='dashboard').scene.elements.at(-1))).toMatchObject({entity_id:'sensor.temperature',progress_source:'entity',progress_min:20,progress_max:40});
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='animation').id));
  await expect(settings.locator('[data-animation=progress_source]')).toHaveValue('entity');
  await settings.locator('[data-animation=animation_type]').selectOption('dots');expect(await page.evaluate(()=>studio.item.entity_id)).toBe('');
  await openView(page,'Bootscreen');await page.evaluate(()=>studio.insertCard('animation'));await settings.locator('[data-animation=animation_type]').selectOption('progress');
  await expect(settings.locator('[data-animation=progress_source] option[value=entity]')).toHaveCount(0);
});

test('Grafik has fixed names, own sizes, tight bounds and direct settings',async({page})=>{
  await boardPreview(page);
  await page.evaluate(()=>{studio.insertCard('logo');studio.item.x=40;studio.item.y=40;studio.changed(true);});
  const properties=page.locator('.properties');
  await expect(properties.locator('h2')).toHaveText('Grafik · ESPHome✎');
  await expect(properties.locator('[data-prop=label],[data-prop=show_label],[data-prop=font_size],[data-prop=font],[data-prop=align]')).toHaveCount(0);
  expect(await properties.locator('[data-home-size] option').allTextContents()).toEqual(['Manuell · freie Größe','Klein','Mittel','Groß']);
  await expect(properties.locator('[data-home-size]')).toHaveValue('graphic_medium');
  await expect(page.locator('.selection.selected')).toHaveCSS('cursor','move');
  const center=await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2]);
  for(const key of ['graphic_small','graphic_large','graphic_medium']){
    await properties.locator('[data-home-size]').selectOption(key);
    const info=await page.evaluate(()=>{
      const item=studio.item,node=studio.renderer.nodes[item.id],box=node.getBoundingClientRect(),image=node._animationVisual.firstChild.getBoundingClientRect();
      return {center:[item.x+item.width/2,item.y+item.height/2],gap:[image.left-box.left,image.top-box.top,box.right-image.right,box.bottom-image.bottom],svg:node._animationVisual.firstChild.getAttribute('viewBox')};
    });
    info.center.forEach((c,i)=>expect(c).toBeCloseTo(center[i],5));
    expect(Math.max(...info.gap)-Math.min(...info.gap)).toBeLessThan(.15);
    expect(info.svg).toBe('80 80 240 234');
  }
  await properties.locator('[data-graphic]').selectOption('display');
  await expect(properties.locator('h2')).toHaveText('Grafik · Display✎');
  expect(await page.evaluate(()=>{const i=studio.renderer.nodes[studio.item.id]._animationVisual.firstChild;return i.tagName==='IMG'&&i.complete&&i.naturalWidth>0;})).toBe(true);
  await properties.locator('[data-home-size]').selectOption('custom');
  await expect(properties.locator('[data-prop=width]')).toBeVisible();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));
  await openView(page,'Dashboard PiP');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.graphic_id==='display').id));
  await expect(properties.locator('h2')).toHaveText('Grafik · Display✎');
});

test('Grafik custom upload retains alpha and survives the offline boot bundle',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    studio.insertCard('logo');
    window.uploads=[];
    hass.fetchWithAuth=async(url,options)=>{uploads.push({url,type:options.body.type});return new Response(JSON.stringify({graphic:{width:2,height:1,palette:'f800ff001f80',runs:'01000101'}}),{status:200});};
  });
  await page.locator('[data-graphic-upload]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
  await expect(page.locator('.properties h2')).toHaveText('Grafik · Custom✎');
  expect(await page.evaluate(()=>uploads[0].url)).toContain('/layout_graphic/');
  const decoded=await page.evaluate(async()=>{
    const img=studio.renderer.nodes[studio.item.id]._animationVisual.firstChild;await img.decode();
    const c=document.createElement('canvas');c.width=2;c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,2,1).data];
  });
  expect(decoded).toEqual([255,0,0,255,0,0,255,128]);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>{
    const scene=JSON.parse(JSON.stringify(studio.scene));scene.elements=[JSON.parse(JSON.stringify(studio.item))];
    Object.assign(scene,{background:'solid',media_background_enabled:false,media_background_entity:''});
    localStorage.setItem('lg-display-startup-v1:/',JSON.stringify({schema:1,version:'a'.repeat(64),timezone:'Europe/Berlin',scene,image:null}));
  });
  await page.addScriptTag({content:fs.readFileSync('custom_components/display_studio/www/runtime/startup-design.js','utf8')});
  expect(await page.evaluate(()=>LGStartupDesign.status().cached)).toBe(true);
  await page.evaluate(()=>{const root=document.createElement('div');root.id='offline';root.style.cssText='width:800px;height:600px';document.body.append(root);LGStartupDesign.render(root);});
  await expect(page.locator('#offline .lg-startup-logo img')).toBeVisible();
});

test('Home Assistant Grafik keeps tight equal margins at every standard size',async({page})=>{
  await boardPreview(page);
  await page.evaluate(()=>{studio.insertCard('logo');studio.item.x=35;studio.item.y=35;studio.changed(true);});
  const settings=page.locator('.properties');
  await settings.locator('[data-graphic]').selectOption('home_assistant');
  await expect(settings.locator('h2')).toHaveText('Grafik · Home Assistant✎');
  const center=await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2]);
  for(const size of ['graphic_small','graphic_medium','graphic_large']){
    await settings.locator('[data-home-size]').selectOption(size);
    const bounds=await page.evaluate(async()=>{
      const item=studio.item,node=studio.renderer.nodes[item.id],image=node._animationVisual.firstChild;await image.decode();
      const frame=node.getBoundingClientRect(),r=image.getBoundingClientRect();
      return {gap:[r.left-frame.left,r.top-frame.top,frame.right-r.right,frame.bottom-r.bottom],center:[item.x+item.width/2,item.y+item.height/2],pixels:[image.naturalWidth,image.naturalHeight]};
    });
    expect(Math.max(...bounds.gap)-Math.min(...bounds.gap)).toBeLessThan(.15);
    expect(Math.min(...bounds.gap)).toBeGreaterThan(0);expect(Math.max(...bounds.gap)).toBeLessThan(3);
    expect(bounds.pixels[0]).toBeGreaterThan(80);bounds.center.forEach((value,i)=>expect(value).toBeCloseTo(center[i],5));
  }
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard PiP');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.graphic_id==='home_assistant').id));
  await expect(settings.locator('h2')).toHaveText('Grafik · Home Assistant✎');
  await expect(settings.locator('[data-home-size]')).toHaveValue('graphic_large');
  if(process.env.STUDIO_VISUAL_QA)await page.screenshot({path:process.env.STUDIO_VISUAL_QA});
});

test('Symbols Slider and Dropdown are separate addable elements with stable saved bindings',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  const settings=page.locator('.properties');
  expect(await page.evaluate(()=>Object.values(studio.availableKinds))).toEqual(expect.arrayContaining(['Symbole','Slider','Dropdown']));
  await page.evaluate(()=>{window.controlIds={};hass.states['media_player.av']={entity_id:'media_player.av',state:'on',attributes:{friendly_name:'AV System'}};});
  for(const [choice,type,action,title] of [['control','icon','none','Symbole · Play'],['slider','slider','av_volume_set','Slider'],['dropdown','source','av_select_source','Dropdown']]){
    await addElement(page,choice);
    await expect(settings.locator('h2')).toContainText(title);
    await expect(settings.locator('[data-prop=control_type]')).toHaveCount(0);
    expect(await page.evaluate(()=>({kind:studio.item.kind,type:studio.item.control_type,action:studio.item.tap_action.action}))).toEqual({kind:'control',type,action});
    await page.evaluate(type=>{controlIds[type]=studio.item.id;},type);
    if(type==='icon'){
      await expect(settings.locator('[data-prop=label],[data-prop=show_label]')).toHaveCount(0);
      await chooseSymbol(page,settings,'remote');
      await expect(settings.locator('h2')).toContainText('Symbole · Fernbedienung');
      await expect(page.locator('.layers .name').filter({hasText:'Symbole · Fernbedienung'})).toHaveCount(1);
      await settings.locator('[data-prop=tap_action]').selectOption('av_remote_home');
    }else{
      await expect(settings.locator('[data-prop=control_icon]')).toHaveCount(0);
      expect(await settings.locator('[data-prop=tap_action] option').allTextContents()).toHaveLength(1);
    }
    await settings.locator('[data-prop=entity_id]').fill('media_player.av');await settings.locator('[data-prop=entity_id]').press('Tab');
  }
  const before=await page.evaluate(()=>studio.scene.elements.filter(i=>Object.values(controlIds).includes(i.id)));
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>Object.values(controlIds).includes(i.id)))).toEqual(before);
  for(const [type,title] of [['icon','Symbole · Fernbedienung'],['slider','Slider'],['source','Dropdown']]){
    await page.evaluate(type=>studio.select(controlIds[type]),type);await expect(settings.locator('h2')).toContainText(title);
  }
});


test('tight symbols keep equal margins, stable centers and only their own sizes',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('control');studio.item.x=40;studio.item.y=40;studio.changed(true);});
  const p=page.locator('.properties');
  expect(await p.locator('[data-home-size] option').allTextContents()).toEqual(['Manuell · freie Größe','Klein','Mittel','Groß']);
  await expect(p.locator('[data-prop=font_size],[data-prop=font],[data-prop=align]')).toHaveCount(0);
  await expect(page.locator('.selection.selected .resize')).toHaveCount(0);await expect(page.locator('.selection.selected .widget-edit')).toHaveCount(1);
  const center=await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2]);
  for(const icon of await page.evaluate(()=>Object.keys(LGControlSymbols))){
    await chooseSymbol(page,p,icon);
    for(const size of ['symbol_small','symbol_medium','symbol_large']){
      await p.locator('[data-home-size]').selectOption(size);
      const bounds=await page.evaluate(()=>{
        const i=studio.item,node=studio.renderer.nodes[i.id],svg=node._control,b=svg.getBBox(),r=svg.getBoundingClientRect(),f=node.getBoundingClientRect(),scale=r.width/80,radius=svg.querySelector("polyline")?2.5:0;
        return {center:[i.x+i.width/2,i.y+i.height/2],gap:[r.left+(b.x-radius)*scale-f.left,r.top+(b.y-radius)*scale-f.top,f.right-r.left-(b.x+b.width+radius)*scale,f.bottom-r.top-(b.y+b.height+radius)*scale]};
      });
      bounds.center.forEach((v,i)=>expect(v).toBeCloseTo(center[i],5));
      expect(Math.max(...bounds.gap)-Math.min(...bounds.gap)).toBeLessThan(.2);
      expect(Math.min(...bounds.gap)).toBeGreaterThan(.5);expect(Math.max(...bounds.gap)).toBeLessThan(3);
    }
  }
  await p.locator('[data-home-size]').selectOption('custom');await expect(p.locator('[data-prop=width]')).toBeVisible();await expect(page.locator('.selection.selected .resize')).toHaveCount(1);
  await p.locator('[data-home-size]').selectOption('symbol_medium');await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='control').id));
  await expect(p.locator('[data-home-size]')).toHaveValue('symbol_medium');
});

test('symbol functions follow entity capabilities, allow overrides and immediately update selected artwork',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    hass.states['media_player.music']={entity_id:'media_player.music',state:'playing',attributes:{friendly_name:'Music',supported_features:16385|32|8}};
    hass.states['cover.blind']={entity_id:'cover.blind',state:'open',attributes:{friendly_name:'Blind',supported_features:1|2|8}};
    studio.insertCard('control');
  });
  const p=page.locator('.properties'),bind=async id=>{await p.locator('[data-prop=entity_id]').fill(id);await p.locator('[data-prop=entity_id]').press('Tab');};
  await bind('media_player.music');await expect(p.locator('[data-prop=tap_auto]')).toBeChecked();await expect(p.locator('[data-prop=tap_action]')).toHaveValue('media_play_pause');
  await expect(p.locator('[data-prop=tap_action] option[value=media_previous_track]')).toHaveCount(0);
  await chooseSymbol(page,p,'next');await expect(p.locator('[data-prop=tap_action]')).toHaveValue('media_next_track');
  await p.locator('[data-prop=tap_action]').selectOption('media_pause');await expect(p.locator('[data-prop=tap_auto]')).not.toBeChecked();
  await page.evaluate(()=>{hass.states['media_player.second']={...hass.states['media_player.music'],entity_id:'media_player.second'};});await bind('media_player.second');expect(await page.evaluate(()=>studio.item.tap_action)).toMatchObject({action:'media_pause',entity_id:'media_player.second'});
  await chooseSymbol(page,p,'remote');await expect(p.locator('[data-prop=tap_action]')).toHaveValue('media_pause');
  const paths=await page.evaluate(()=>studio.renderer.nodes[studio.item.id]._control.innerHTML);
  await page.evaluate(()=>{studio.item.tap_action.action='media_play_pause';studio.paint();});
  expect(await page.evaluate(()=>studio.renderer.nodes[studio.item.id]._control.innerHTML)).toBe(paths);
  await chooseSymbol(page,p,'up');await expect(p.locator('[data-prop=tap_auto]')).toHaveCount(0);await bind('cover.blind');await p.locator('[data-prop=tap_auto]').check();
  await expect(p.locator('[data-prop=tap_action]')).toHaveValue('open_cover');await expect(p.locator('[data-prop=tap_action] option[value=media_play_pause]')).toHaveCount(0);
  await p.locator('[data-prop=tap_action]').selectOption('stop_cover');await chooseSymbol(page,p,'down');await expect(p.locator('[data-prop=tap_action]')).toHaveValue('stop_cover');
  const before=await page.evaluate(()=>studio.item);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='control').id));
  expect(await page.evaluate(()=>studio.item)).toEqual(before);await expect(p.locator('[data-prop=tap_auto]')).not.toBeChecked();
  await page.evaluate(()=>studio.insertCard('entity'));await bind('media_player.music');await p.locator('[data-prop=tap_action]').selectOption('media_mute');
  expect(await page.evaluate(()=>studio.item.tap_action)).toMatchObject({action:'media_mute',entity_id:'media_player.music'});
});

test('widget text opacity updates clock and home text live, composes alpha and saves independently of the surface',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('clock');studio.elementStyling(studio.item,true);studio.scene.text_opacity=.5;studio.item.color='#ffffff80';studio.item.opacity=.7;studio.item.background='#123456';studio.changed(true);});
  const p=page.locator('.properties'),slider=p.getByRole('slider',{name:'Schriftdeckkraft',exact:true});
  const colors=()=>page.evaluate(()=>{
    const n=studio.renderer.nodes[studio.item.id];return [n._value,n._detail].map(el=>({color:getComputedStyle(el).color,opacity:getComputedStyle(el).opacity}));
  });
  await slider.fill('0.4');await slider.dispatchEvent('input');
  for(const c of await colors())expect(parseFloat(c.color.split(',').at(-1))).toBeCloseTo(.4*.5*128/255,2);
  expect(await page.evaluate(()=>getComputedStyle(studio.renderer.nodes[studio.item.id]).backgroundColor)).toBe('rgba(18, 52, 86, 0.7)');
  await slider.dispatchEvent('change');await slider.fill('0');await slider.dispatchEvent('input');
  for(const c of await colors())expect(parseFloat(c.color.split(',').at(-1))).toBe(0);
  await slider.dispatchEvent('change');await slider.fill('0.4');await slider.dispatchEvent('change');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='clock'&&i.text_opacity===.4).id));
  await expect(slider).toHaveValue('0.4');
  if(process.env.STUDIO_OPACITY_VISUAL_QA){await page.evaluate(()=>{studio.scene.elements=[studio.item];studio.item.color='#f2f6fa';studio.scene.text_opacity=1;studio.item.x=40;studio.item.y=20;studio.changed(true);});await page.setViewportSize({width:1500,height:1500});await page.screenshot({path:process.env.STUDIO_OPACITY_VISUAL_QA});}
  await page.evaluate(()=>{
    hass.states['light.desk']={entity_id:'light.desk',state:'on',attributes:{friendly_name:'Desk',brightness:128}};
    studio.insertCard('status');studio.elementStyling(studio.item,true);studio.item.entity_id='light.desk';studio.item.card_style='homekit';studio.item.parts={label:{color:'#ff000080',opacity:.5}};studio.changed(true);
  });
  await slider.fill('0.4');await slider.dispatchEvent('input');
  expect(await page.evaluate(()=>{const p=studio.renderer.nodes[studio.item.id]._homeParts.label;return {opacity:getComputedStyle(p).opacity,color:getComputedStyle(p).color};})).toEqual({opacity:'0.2',color:'rgba(255, 0, 0, 0.5)'});
  await slider.fill('0');await slider.dispatchEvent('input');
  const parts=await page.evaluate(()=>Object.fromEntries(Object.entries(studio.renderer.nodes[studio.item.id]._homeParts).map(([k,el])=>[k,getComputedStyle(el).opacity])));
  expect(parts.label).toBe('0');expect(parts.value).toBe('0');expect(parts.icon).not.toBe('0');
});

test('uniform widget inset preserves the surface, centers the clock group and survives editing',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
  const field=page.locator('.properties [data-prop=content_padding]');await field.fill('8');await field.dispatchEvent('change');
  const geometry=()=>page.evaluate(()=>{
    const i=studio.item,n=studio.renderer.nodes[i.id],outer=n._frame.getBoundingClientRect(),inner=n.getBoundingClientRect(),frames=[n._value,n._detail].filter(el=>getComputedStyle(el).display!=='none').map(el=>({...el._clockFrame}));
    return {surface:[i.width,i.height],margins:[inner.left-outer.left,inner.top-outer.top,outer.right-inner.right,outer.bottom-inner.bottom],top:Math.min(...frames.map(f=>f.y)),bottom:inner.height-Math.max(...frames.map(f=>f.y+f.height)),frames};
  });
  const spacing=page.locator('.properties [data-prop=clock_gap]');await spacing.fill('12');await spacing.dispatchEvent('change');
  await expect(page.locator('.properties').getByLabel('Zeilenabstand',{exact:true})).toHaveValue('12');
  const before=await geometry();expect(before.surface).toEqual([25,20]);for(const m of before.margins)expect(m).toBeCloseTo(before.margins[0],1);expect(before.top).toBeCloseTo(before.bottom,1);
  await page.evaluate(()=>studio.renderer.tick(new Date(2027,8,30,11,11,11)));expect((await geometry()).frames).toEqual(before.frames);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await expect(editor.getByLabel('Zeilenabstand',{exact:true})).toHaveValue('12');
  await expect(editor.locator('[data-field=z_index]')).toHaveCount(0);await expect(editor.locator('[data-delete-part]')).toHaveCount(0);
  await editor.locator('[data-widget-size]').selectOption('custom');await expect(editor.locator('[data-field=z_index]')).toBeVisible();await expect(editor.locator('[data-delete-part]')).toHaveCount(0);
  await editor.locator('[data-widget-size]').selectOption('clock_medium');await expect(editor.locator('[data-field=z_index]')).toHaveCount(0);
  await editor.locator('[data-clock-view]').selectOption('date');const single=await geometry();expect(single.surface[1]).toBeLessThan(20);expect(single.top).toBeCloseTo(single.bottom,1);
  await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();expect((await geometry()).surface).toEqual([25,20]);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).content_padding)).toBe(8);expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).clock_gap)).toBe(12);
  await field.fill('0');await field.dispatchEvent('change');expect(await page.evaluate(()=>studio.renderer.nodes[studio.item.id]._frame)).toBeNull();
});

test('insets preserve weather, symbol and camera nodes and position handles',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  for(const kind of ['weather','control','logo','animation','camera']){
    await page.evaluate(kind=>{studio.insertCard(kind);window.keptInsetNode=studio.renderer.nodes[studio.item.id];},kind);
    const field=page.locator('.properties [data-prop=content_padding]');await field.fill('10');await field.dispatchEvent('change');
    expect(await page.evaluate(()=>{const n=studio.renderer.nodes[studio.item.id];return n===keptInsetNode&&n._frame.contains(n);})).toBe(true);
    const selection=page.locator('.selection.selected');const sizes=await page.evaluate(()=>{const i=studio.item,n=studio.renderer.nodes[i.id];return [studio.selectionRect(i).width,n._frame.getBoundingClientRect().width];});expect(sizes[0]).toBeCloseTo(sizes[1],2);
    await selection.hover();await expect(selection).toHaveCSS('cursor','move');
    await selection.press('ArrowRight');expect(await page.evaluate(()=>studio.item.content_padding)).toBe(10);
    if(kind==='camera'){
      for(const size of ['camera_small','camera_medium','camera_large']){
        await page.locator('[data-home-size]').selectOption(size);
        await selection.hover();await expect(selection).toHaveAttribute('data-standard-size','true');await expect(selection).toHaveCSS('cursor','move');
      }
      const before=await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height}));
      const rect=await selection.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+20,{steps:4});await page.mouse.up();
      const after=await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height}));
      expect(after.x).not.toBe(before.x);expect(after.y).not.toBe(before.y);expect(after.width).toBeCloseTo(before.width,2);expect(after.height).toBeCloseTo(before.height,2);
      expect(await page.evaluate(()=>studio.renderer.nodes[studio.item.id]===keptInsetNode)).toBe(true);
    }
  }
});

test('widget own styling is opt-in, isolated and returns to the view theme',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.useTheme('morning');studio.insertCard('clock');});
  const properties=page.locator('.properties'),toggle=properties.locator('[data-element-styling]');
  await expect(properties.locator('[data-element-theme]')).toHaveCount(0);
  await expect(toggle).not.toBeChecked();await expect(properties.locator('[data-prop=color]')).toBeHidden();
  const original=await page.evaluate(()=>({id:studio.item.id,x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,parts:JSON.stringify(studio.item.parts),view:studio.view.theme_override}));
  await toggle.check();await setColor(properties.locator('[data-prop=color]'),'#ff3300');
  await properties.locator('[data-prop=font]').selectOption('mono');
  expect(await page.evaluate(()=>studio.view.theme_override)).toBe(original.view);
  await page.evaluate(()=>studio.useTheme('sand'));
  expect(await page.evaluate(()=>studio.item.color)).toBe('#ff3300');expect(await page.evaluate(()=>studio.item.font)).toBe('mono');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');await page.evaluate(id=>studio.select(id),original.id);
  await expect(toggle).toBeChecked();expect(await page.evaluate(()=>studio.item.color)).toBe('#ff3300');
  await toggle.uncheck();await expect(properties.locator('[data-prop=color]')).toBeHidden();
  const result=await page.evaluate(()=>({id:studio.item.id,x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,parts:JSON.stringify(studio.item.parts),view:studio.view.theme_override,color:studio.item.color,expected:studio.config.themes.find(t=>t.id==='sand').style.ink,card:studio.item.card_style}));
  expect({...result,color:undefined,expected:undefined,card:undefined}).toEqual({...original,color:undefined,expected:undefined,card:undefined});expect(result.color).toBe(result.expected);expect(result.card).toBe('inherit');
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));const dialog=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await expect(dialog.locator('[data-color]')).toBeHidden();await expect(dialog.locator('[data-choice=font]')).toBeHidden();
  await dialog.locator('[data-widget-styling]').check();await expect(dialog.locator('[data-color]')).toBeVisible();
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();await expect(toggle).not.toBeChecked();
  for(const kind of ['weather','control','animation','logo','camera','text','status']){
    await page.evaluate(kind=>studio.insertCard(kind),kind);
    await expect(toggle).not.toBeChecked();await expect(properties.locator('.widget-appearance')).toBeHidden();
    await toggle.check();await expect(properties.locator('.widget-appearance')).toBeVisible();
  }
});

test('inset surfaces retain color alpha and rounding across repeated paints and geometry edits',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{
    studio.insertCard('button');Object.assign(studio.item,{style_override:true,card_style:'standard',background:'#ba4c16',opacity:.75,radius:36,content_padding:8});studio.changed();
    window.insetProofNode=studio.renderer.nodes[studio.item.id];
    const root=document.createElement('div');root.style.cssText='position:fixed;left:0;top:0;width:1024px;height:600px';document.body.appendChild(root);window.insetRuntime=new LGLayoutRenderer(root,null,false);
  });
  async function check(){
    const cases=await page.evaluate(()=>{
      for(let n=0;n<4;n++){studio.paint();insetRuntime.render(studio.scene,studio.values(),{});}
      return [studio.renderer,insetRuntime].map(r=>{const node=r.nodes[studio.item.id],frame=node._frame,css=getComputedStyle(frame);return {color:css.backgroundColor,radius:parseFloat(css.borderRadius),expectedRadius:r.root.clientHeight*studio.item.radius/1080,inner:getComputedStyle(node).backgroundColor,kept:r===studio.renderer?node===insetProofNode:true};});
    });
    for(const value of cases){expect(value.color).toBe('rgba(186, 76, 22, 0.75)');expect(value.radius).toBeCloseTo(value.expectedRadius,2);expect(value.inner).toBe('rgba(0, 0, 0, 0)');expect(value.kept).toBe(true);}
  }
  await check();
  await page.evaluate(()=>{Object.assign(studio.item,{x:12,width:40,content_padding:12});studio.changed();});await check();
  await page.evaluate(()=>{studio.item.content_padding=0;studio.changed();insetRuntime.render(studio.scene,studio.values(),{});});
  expect(await page.evaluate(()=>[studio.renderer,insetRuntime].every(r=>!r.nodes[studio.item.id]._frame&&getComputedStyle(r.nodes[studio.item.id]).backgroundColor==='rgba(186, 76, 22, 0.75)'))).toBe(true);
});

for(const native of [false,true])test('text line spacing changes multiline layout and survives save: '+native,async({page})=>{
  if(native)await boardPreview(page);else await mount(page);
  await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('text');studio.item.text='Freitag\nZweite Zeile\nDritte Zeile';studio.item.show_label=false;studio.changed(true);});
  const spacing=page.locator('.properties').getByLabel('Zeilenabstand',{exact:true});
  await expect(spacing).toHaveValue('1.35');
  const metrics=()=>page.evaluate(()=>{const n=studio.renderer.nodes[studio.item.id]._value,s=getComputedStyle(n);return {ratio:parseFloat(s.lineHeight)/parseFloat(s.fontSize),height:n.getBoundingClientRect().height,text:n.textContent};});
  const before=await metrics();expect(before.ratio).toBeCloseTo(1.35,2);
  await spacing.fill('1.8');await spacing.dispatchEvent('change');
  const after=await metrics();expect(after.ratio).toBeCloseTo(1.8,2);expect(after.height).toBeGreaterThan(before.height);expect(after.text).toBe(before.text);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  expect(await page.evaluate(()=>saved.scenes.dashboard.elements.at(-1).text_line_height)).toBe(1.8);
  await page.evaluate(()=>{studio.config=JSON.parse(JSON.stringify(saved));studio.paint();});
  expect((await metrics()).ratio).toBeCloseTo(1.8,2);
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  const inner=editor.getByLabel('Zeilenabstand',{exact:true});await expect(inner).toHaveValue('1.8');
  await inner.fill('2');await inner.dispatchEvent('change');
  expect(await page.evaluate(()=>studio.item.text_line_height)).toBe(2);
  await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();
  expect((await metrics()).ratio).toBeCloseTo(1.8,2);
});

test('widget help overlays open on hover click and keyboard without duplicate size labels',async({page})=>{
  await mount(page);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
  const properties=page.locator('.properties');
  await expect(properties.getByRole('combobox',{name:'Größe',exact:true})).toHaveCount(1);
  await expect(properties.getByText('Standardgröße',{exact:true})).toHaveCount(0);
  for(const title of ['Größe','Aussehen','Rahmen & Inhalt','Touch-Aktion']){
    const button=properties.getByRole('button',{name:'Informationen zu '+title,exact:true});
    const overlay=properties.locator('#'+await button.getAttribute('aria-controls'));
    await expect(overlay).toBeHidden();await button.hover();await expect(overlay).toBeVisible();await expect(button).toHaveAttribute('aria-expanded','true');
    await page.mouse.move(0,0);await expect(overlay).toBeHidden();
    await button.click();await page.mouse.move(0,0);await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');await expect(overlay).toBeHidden();await expect(button).toHaveAttribute('aria-expanded','false');
  }
  const button=properties.getByRole('button',{name:'Informationen zu Größe',exact:true});
  await button.focus();await expect(properties.getByRole('tooltip').filter({hasText:'Standardgrößen bleiben fest.'})).toBeVisible();
  await page.keyboard.press('Enter');await page.keyboard.press('Tab');
  await expect(properties.getByRole('tooltip').filter({hasText:'Standardgrößen bleiben fest.'})).toBeVisible();
  await properties.locator('.widget-property-title').click();
  await expect(properties.locator('.help-overlay:popover-open')).toHaveCount(0);
});

test.describe('mobile widget help',()=>{
  test.use({hasTouch:true});
  test('tap opens and dismisses overlays inside a narrow viewport',async({page})=>{
    await mount(page,390);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('text'));
    const button=page.getByRole('button',{name:'Informationen zu Rahmen & Inhalt',exact:true});
    const overlay=page.locator('#'+await button.getAttribute('aria-controls'));
    await button.tap();await expect(overlay).toBeVisible();
    const box=await overlay.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
    await button.tap();await expect(overlay).toBeHidden();
    await button.tap();await expect(overlay).toBeVisible();
    await page.locator('.properties [data-prop=content_padding]').tap();await expect(overlay).toBeHidden();
  });
});

test('all widget help stays behind info controls without changing the draft',async({page})=>{
  await boardPreview(page);
  for(const [kind,title] of [['camera','Kameraquelle'],['camera','Bildausschnitt'],['media','Mediensteuerung'],['logo','Grafik'],['animation','Animation'],['control','Aktion automatisch vorschlagen']]){
    await page.evaluate(kind=>{const camera=kind==='camera'&&studio.scene.elements.find(i=>i.kind==='camera');if(camera)studio.select(camera.id);else studio.insertCard(kind);if(kind==='control'){hass.states['switch.test_help']={entity_id:'switch.test_help',state:'on',attributes:{}};Object.assign(studio.item,{entity_id:'switch.test_help',control_icon:'power'});studio.changed(true);}},kind);
    const properties=page.locator('.properties'),button=properties.getByRole('button',{name:'Informationen zu '+title,exact:true});
    await expect(properties.locator('p.note,p.hint')).toHaveCount(0);
    const before=await page.evaluate(()=>JSON.stringify(studio.config));
    await button.click();const overlay=properties.locator('#'+await button.getAttribute('aria-controls'));await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');await expect(overlay).toBeHidden();
    expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
  }
  await page.evaluate(()=>{studio.insertCard('animation');studio.item.animation_type='progress';studio.item.progress_source='entity';studio.changed(true);});
  await page.getByRole('button',{name:'Informationen zu Fortschrittsquelle',exact:true}).click();
  await expect(page.getByRole('tooltip').filter({hasText:'Zahlenwerte werden auf 0–100 %'})).toBeVisible();
});

test.describe('remaining mobile widget help',()=>{
  test.use({hasTouch:true});
  test('content editor info supports tap and Escape without cancelling edits',async({page})=>{
    await mount(page,390);await openView(page,'Dashboard');await page.evaluate(()=>studio.insertCard('clock'));
    await page.evaluate(()=>studio.editContentsForTest(studio.selected));
    const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
    for(const title of ['Widget bearbeiten','Inhaltselement','Widget-Grundfläche','Zeilenabstand']){
      const button=editor.getByRole('button',{name:'Informationen zu '+title,exact:true});
      await button.tap();const overlay=editor.locator('#'+await button.getAttribute('aria-controls'));await expect(overlay).toBeVisible();
      const box=await overlay.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');await expect(overlay).toBeHidden();await expect(editor).toBeVisible();
    }
    await expect(editor.locator('p.note,p.hint')).toHaveCount(0);
    await editor.getByLabel('Zeilenabstand',{exact:true}).fill('8');await editor.getByLabel('Zeilenabstand',{exact:true}).dispatchEvent('change');
    await editor.getByRole('button',{name:'Informationen zu Zeilenabstand',exact:true}).tap();
    await expect(editor.getByRole('tooltip').filter({hasText:'Anteil der inneren Widgethöhe'})).toBeVisible();
  });
});

test('camera tile binds to measured aspect ratio and keeps it during resize and saved reload',async({page})=>{
  await boardPreview(page);
  await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='camera');studio.select(item.id);Object.defineProperty(studio.shadowRoot.querySelector('.scene video'),'videoWidth',{value:1288,configurable:true});Object.defineProperty(studio.shadowRoot.querySelector('.scene video'),'videoHeight',{value:728,configurable:true});studio.shadowRoot.querySelector('.scene video').dispatchEvent(new Event('loadedmetadata'));});
  const properties=page.locator('.properties');await properties.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).check();
  const ratio=1288/728;
  const geometry=()=>page.evaluate(()=>{const i=studio.item,r=studio.renderer.nodes[i.id].getBoundingClientRect();return {width:i.width,height:i.height,ratio:i.camera_aspect_ratio,actual:r.width/r.height,locked:i.camera_lock_aspect};});
  await expect.poll(async()=>(await geometry()).actual).toBeCloseTo(ratio,2);
  await properties.getByRole('combobox',{name:'Größe',exact:true}).selectOption('custom');
  await properties.getByLabel('Breite (%)',{exact:true}).fill('42');await properties.getByLabel('Breite (%)',{exact:true}).dispatchEvent('change');
  expect((await geometry()).actual).toBeCloseTo(ratio,2);
  await properties.getByLabel('Höhe (%)',{exact:true}).fill('24');await properties.getByLabel('Höhe (%)',{exact:true}).dispatchEvent('change');
  expect((await geometry()).actual).toBeCloseTo(ratio,2);
  const selection=page.locator('.selection').filter({has:page.locator('.resize')});
  const box=await selection.locator('.resize').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y+30,{steps:5});await page.mouse.up();
  expect((await geometry()).actual).toBeCloseTo(ratio,2);
  await page.evaluate(()=>studio.save());const saved=await geometry();
  await page.evaluate(()=>{const view=studio.viewId,descriptor=studio.cameraDescriptor;studio.accept({config:window.saved,revision:window.revision,camera_preview:descriptor});studio.viewId=view;studio.selected=studio.scene.elements.find(i=>i.kind==='camera').id;studio.refreshScene();});
  expect((await geometry()).ratio).toBeCloseTo(ratio,6);expect((await geometry()).height).toBeCloseTo(saved.height,6);
  await properties.getByLabel('Innenabstand (%)',{exact:true}).fill('10');await properties.getByLabel('Innenabstand (%)',{exact:true}).dispatchEvent('change');
  const innerRatio=await page.evaluate(()=>{const node=studio.renderer.nodes[studio.item.id],box=node.querySelector('.lg-camera-picture').getBoundingClientRect();return box.width/box.height;});
  expect(innerRatio).toBeCloseTo(ratio,2);
  await properties.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).uncheck();
  await properties.getByLabel('Höhe (%)',{exact:true}).fill('40');await properties.getByLabel('Höhe (%)',{exact:true}).dispatchEvent('change');
  expect((await geometry()).actual).not.toBeCloseTo(ratio,1);
});

test('HA camera keeps named sizes and complete frames across binding, still, live and fullscreen',async({page})=>{
  await boardPreview(page,{offline:true});
  await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    canvas.getContext('2d').fillRect(0,0,640,480);const blob=await new Promise(r=>canvas.toBlob(r));
    hass.fetchWithAuth=async(path)=>{window.haImagePath=path;return new Response(blob);};
    studio.scene.elements=studio.scene.elements.filter(i=>i.kind!=='camera');studio.paint();studio.insertCard('camera','camera.hall');
  });
  const props=page.locator('.properties'),size=props.getByRole('combobox',{name:'Größe',exact:true});
  const tile=page.locator('.scene .lg-camera').last();
  await expect(size).toHaveValue('camera_medium');
  await expect.poll(()=>page.evaluate(()=>studio.item.camera_aspect_ratio)).toBeCloseTo(4/3,5);
  const ratio=()=>tile.locator('.lg-camera-picture').evaluate(n=>{const b=n.getBoundingClientRect();return b.width/b.height;});
  await expect.poll(ratio).toBeCloseTo(4/3,2);
  await expect(tile.locator('img')).toBeVisible();expect(await page.evaluate(()=>haImagePath)).toBe('/api/camera_proxy/camera.hall');
  for(const key of ['camera_small','camera_medium','camera_large']){
    await size.selectOption(key);await expect(size).toHaveValue(key);
    await expect.poll(ratio).toBeCloseTo(4/3,2);await expect(props.getByLabel('Breite (%)',{exact:true})).toHaveCount(0);
    await props.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).uncheck();
    await expect(size).toHaveValue(key);await expect.poll(ratio).toBeCloseTo(16/9,2);
    await props.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).check();await expect(size).toHaveValue(key);
  }
  const before=await page.evaluate(()=>{studio.interactionPreview=true;studio.paint();studio.item.tap_action={action:'camera_fullscreen',entity_id:'',view:''};studio.paint();return {node:studio.item.id,width:studio.item.width,height:studio.item.height};});
  for(const mode of ['stream','snapshot','stream']){
    await props.getByLabel('Wiedergabe',{exact:true}).selectOption(mode);
    if(mode==='stream'){
      await expect(tile.locator('video')).toHaveCount(1);
      await tile.locator('video').evaluate(v=>{Object.defineProperty(v,'videoWidth',{value:640,configurable:true});Object.defineProperty(v,'videoHeight',{value:480,configurable:true});v.dispatchEvent(new Event('loadedmetadata'));});
    }else await expect(tile.locator('img')).toBeVisible();
    await expect(size).toHaveValue('camera_large');await expect.poll(ratio).toBeCloseTo(4/3,2);
    await tile.dispatchEvent('click');await expect(page.locator('.lg-camera-fullscreen video')).toHaveCount(1);
    await expect(page.locator('.lg-camera-fullscreen video')).toHaveCSS('object-fit','contain');
    expect(await page.evaluate(()=>cameraRequests.at(-1).entity_id)).toBe('camera.hall');
    await page.getByRole('button',{name:'Kamera schließen',exact:true}).click();
    await expect(page.locator('.lg-camera-fullscreen')).toHaveCount(0);
    expect(await page.evaluate(()=>({node:studio.item.id,width:studio.item.width,height:studio.item.height}))).toEqual(before);
  }
  await page.evaluate(()=>studio.save());
  expect(await page.evaluate(()=>saved.views.flatMap(v=>v.scene.elements).find(i=>i.id===studio.item.id).camera_size)).toBe('camera_large');
  await size.selectOption('custom');await expect(props.getByLabel('Breite (%)',{exact:true})).toBeVisible();
});

test('camera source controls expose only matching fields and respect device capabilities',async({page})=>{
  await boardPreview(page);await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='camera').id));
  const props=page.locator('.properties'),source=props.getByLabel('Kameraquelle',{exact:true});
  await expect(source.locator('option')).toHaveCount(4);
  for(const key of ['local','entity','multicast','test','entity','local']){
    await source.selectOption(key);
    await expect(props.getByLabel('Home-Assistant-Entität',{exact:true})).toHaveCount(key==='entity'?1:0);
    await expect(props.getByLabel('Multicast-Adresse',{exact:true})).toHaveCount(key==='multicast'?1:0);
    await expect(props.getByLabel('Wiedergabe',{exact:true}).locator('option')).toHaveCount(3);
  }
  await page.evaluate(()=>{studio.catalog.entries[0].provider='lg';studio.catalog.entries[0].capabilities={hdmi:true,video:true};studio.renderProperties();});
  await expect(source.locator('option[value="local"]')).toHaveCount(0);
  await expect(source.locator('option')).toHaveCount(3);
});

test('test and multicast previews use the selected local relay, never the board stream',async({page})=>{
  await boardPreview(page,{offline:true});
  await page.evaluate(()=>{
    window.relayRequests=[];hass.fetchWithAuth=async(path,options)=>{
      const data=JSON.parse(options.body);relayRequests.push({path,...data});
      return new Response(JSON.stringify({stream:data.camera_source==='test'?'/display_studio/runtime/test-stream.m3u8':'/api/hls/multicast/master_playlist.m3u8'}),{headers:{'Content-Type':'application/json'}});
    };
    studio.select(studio.scene.elements.find(i=>i.kind==='camera').id);
  });
  const props=page.locator('.properties');
  for(const source of ['test','multicast']){
    await props.getByLabel('Kameraquelle',{exact:true}).selectOption(source);
    if(source==='multicast'){await props.getByLabel('Multicast-Adresse',{exact:true}).fill('udp://239.1.2.3:5000');await props.getByLabel('Multicast-Adresse',{exact:true}).dispatchEvent('change');}
    await expect.poll(()=>page.evaluate(()=>relayRequests.filter(r=>r.kind==='stream').at(-1)?.camera_source)).toBe(source);
    await expect(page.locator('.scene .lg-camera video')).toHaveCount(1);
    expect(await page.evaluate(()=>decoders.filter(d=>!d.destroyed).at(-1).url)).toContain(source==='test'?'/runtime/test-stream.m3u8':'/api/hls/multicast/');
    expect(await page.evaluate(()=>cameraRequests.length)).toBe(0);
  }
});


test('camera editor preserves bound geometry, fixed name, explicit fullscreen action and separate fullscreen layout',async({page})=>{
  await boardPreview(page);
  await page.evaluate(()=>{studio.scene.elements=studio.scene.elements.filter(i=>i.kind!=='camera');studio.insertCard('camera');studio.item.label='Haustür';studio.item.camera_aspect_ratio=16/9;studio.fitCamera(studio.item);studio.changed(true);});
  const props=page.locator('.properties');
  await expect(props.locator('h2')).toContainText('Kamera/Stream');
  await expect(page.locator('.layers .active .name')).toHaveText('Kamera/Stream');
  await expect(props.locator('[data-prop="camera_fit"]')).toHaveCount(0);
  await props.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).uncheck();
  await expect(props.locator('[data-prop="camera_fit"]')).toHaveCount(1);
  await props.getByLabel('Kachel an Kamera-Seitenverhältnis binden',{exact:true}).check();
  await page.evaluate(()=>{studio.interactionPreview=true;studio.paint();});
  const tile=page.locator('.scene .lg-camera').last();
  await tile.dispatchEvent('click');await expect(page.locator('.lg-camera-fullscreen')).toHaveCount(0);
  await props.getByLabel('Bei Berührung',{exact:true}).selectOption('camera_fullscreen');
  await expect(props.locator('[data-prop="tap_entity_id"]')).toHaveCount(0);
  await tile.dispatchEvent('click');await expect(page.locator('.lg-camera-fullscreen')).toHaveCount(1);
  await page.getByRole('button',{name:'Kamera schließen',exact:true}).click();
  const original=await page.evaluate(()=>JSON.stringify({parts:studio.item.parts,width:studio.item.width,height:studio.item.height}));
  await page.evaluate(()=>studio.editContentsForTest(studio.selected));
  const dialog=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
  await expect(dialog.locator('h2')).toHaveText('Kamera/Stream · Widget bearbeiten');
  const geometry=()=>dialog.locator('.lg-camera').evaluate(n=>{const a=n.getBoundingClientRect(),b=n.closest('.widget-frame').getBoundingClientRect();return {width:a.width/b.width,height:a.height/b.height};});
  await expect.poll(async()=>(await geometry()).height).toBeCloseTo(1,2);
  await expect.poll(async()=>(await geometry()).width).toBeCloseTo(1,2);
  await dialog.getByLabel('Kameraansicht bearbeiten',{exact:true}).selectOption('fullscreen');
  await expect(dialog.locator('.camera-close-preview')).toBeVisible();
  const y=dialog.locator('[data-field="y"]');await y.fill('15');await y.dispatchEvent('change');
  await expect.poll(()=>page.evaluate(()=>studio.item.camera_fullscreen.parts.picture.y)).toBe(9); // Bounds retain the full image within its canvas.
  const h=dialog.locator('[data-field="height"]');await h.fill('70');await h.dispatchEvent('change');
  await y.fill('15');await y.dispatchEvent('change');
  await expect.poll(()=>page.evaluate(()=>studio.item.camera_fullscreen.parts.picture.y)).toBe(15);
  expect(await page.evaluate(()=>JSON.stringify({parts:studio.item.parts,width:studio.item.width,height:studio.item.height}))).toBe(original);
  await dialog.getByRole('button',{name:'Fertig',exact:true}).click();
  expect(await page.evaluate(()=>saved.views.flatMap(v=>v.scene.elements).find(i=>i.id===studio.item.id).camera_fullscreen.parts.picture.y)).toBe(15);
  await tile.dispatchEvent('click');
  const actual=await page.locator('.lg-camera-fullscreen .lg-camera-picture').evaluate(n=>{const b=n.getBoundingClientRect(),p=n.closest('.lg-camera-fullscreen').getBoundingClientRect();return {y:(b.top-p.top)/p.height*100,h:b.height/p.height*100};});
  expect(actual.y).toBeCloseTo(15,1);expect(actual.h).toBeCloseTo(70,1);
});

test('other LG display preview uses decoded MJPEG in tile and fullscreen without HLS',async({page})=>{
  test.setTimeout(60000);
  await boardPreview(page);
  await page.evaluate(()=>{
    const original=window.fetch;window.lgStreams={opened:0,active:0,max:0,cancelled:0,urls:[],sent:0,pause:false};
    window.fetch=async(url,options)=>{
      if(!String(url).includes('/api/camera_proxy_stream/camera.lg_other?'))return original(url,options);
      const metrics=window.lgStreams;metrics.opened++;metrics.active++;metrics.max=Math.max(metrics.max,metrics.active);metrics.urls.push(String(url));
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const frames=['red','blue'].map(color=>{const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,160,90);return Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0));});
      let timer,closed=false,index=0;
      const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);metrics.active--;metrics.cancelled++;};
      return new Response(new ReadableStream({
        start(controller){
          const send=()=>{
            if(metrics.pause || closed)return;
            const bytes=frames[index++%2],header=new TextEncoder().encode(`--lg-display-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`);
            const part=new Uint8Array(header.length+bytes.length+2);part.set(header);part.set(bytes,header.length);part.set([13,10],header.length+bytes.length);
            // Headers and JPEG bodies may straddle arbitrary network chunks.
            for(const [start,end] of [[0,3],[3,41],[41,header.length+9],[header.length+9,part.length]])controller.enqueue(part.slice(start,end));
            metrics.sent++;
          };
          options.signal.addEventListener('abort',()=>{cleanup();controller.error(new DOMException('Aborted','AbortError'));},{once:true});
          send();timer=setInterval(send,200);
        },cancel:cleanup
      }),{headers:{'Content-Type':'application/octet-stream'}});
    };
  });
  await page.evaluate(()=>{
    studio.hass.states['camera.lg_other']={entity_id:'camera.lg_other',state:'idle',attributes:{integration_domain:'lg_rs232_ip'}};
    studio.hass.fetchWithAuth=async(path,options)=>{
      window.lgPreviewRequest=JSON.parse(options.body);
      return new Response(JSON.stringify({stream:'/api/camera_proxy_stream/camera.lg_other?token=camera_only'}),{headers:{'Content-Type':'application/json'}});
    };
    const item=studio.scene.elements.find(i=>i.kind==='camera');
    Object.assign(item,{camera_source:'entity',entity_id:'camera.lg_other',camera_mode:'stream',tap_action:{action:'camera_fullscreen',entity_id:'',view:''}});
    studio.paint();
  });
  const picture=page.locator('.scene .lg-camera-picture');
  await expect(picture).toHaveAttribute('data-preview-transport','mjpeg');await expect(picture).toHaveAttribute('data-preview-state','playing');
  await expect(picture.locator('.lg-camera-age')).toHaveText('Live');
  await expect(picture.locator('img')).toBeVisible();await expect(picture.locator('video')).toHaveCount(0);
  expect((await page.evaluate(()=>lgPreviewRequest)).entity_id).toBe('camera.lg_other');
  const first=await picture.locator('img').getAttribute('src');
  await expect.poll(()=>picture.locator('img').getAttribute('src')).not.toBe(first);
  // An ongoing response never fires a multipart load event or reaches EOF.
  // It must outlive the initial 15-second connection watchdog without restart.
  await page.waitForTimeout(16000);
  await expect(picture).toHaveAttribute('data-preview-state','playing');
  await expect(picture.locator('.lg-camera-age')).toHaveText('Live');
  expect(await page.evaluate(()=>lgStreams.opened)).toBe(1);
  expect(await page.evaluate(()=>lgStreams.urls.every(url=>new URL(url).searchParams.get('lg_preview')==='frames'))).toBe(true);
  await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='camera');LGCamera.openFullscreen(studio.renderer,studio.renderer.nodes[item.id],item);});
  await expect(page.locator('.lg-camera-fullscreen img')).toBeVisible();
  await expect(page.locator('.lg-camera-fullscreen .lg-camera-picture')).toHaveAttribute('data-preview-transport','mjpeg');
  await page.getByRole('button',{name:'Kamera schließen',exact:true}).click();
  await expect(picture).toHaveAttribute('data-preview-state','playing');
  expect(await page.evaluate(()=>lgStreams.max)).toBe(1);
  await page.evaluate(()=>lgStreams.pause=true);
  await expect(picture).toHaveAttribute('data-preview-error','stalled',{timeout:17000});
  await expect.poll(()=>page.evaluate(()=>lgStreams.active)).toBe(0);
  await page.evaluate(()=>lgStreams.pause=false);
  await expect(picture).toHaveAttribute('data-preview-state','playing',{timeout:9000});
  expect(await page.evaluate(()=>lgStreams.opened)).toBe(4);
  expect(await page.evaluate(()=>lgStreams.max)).toBe(1);
  await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>lgStreams.active)).toBe(0);
  expect(await page.evaluate(()=>lgStreams.cancelled)).toBe(4);
});


test('searchable HA symbols and Siri remote retain button sizes and centered padding',async({page})=>{
  await boardPreview(page);await openView(page,'Dashboard');
  await page.evaluate(()=>{studio.insertCard('control');studio.item.x=35;studio.item.y=35;studio.changed(true);});
  const p=page.locator('.properties');
  const choose=async(term,name)=>{
    await p.locator('[data-open-symbol]').click();const symbols=page.getByRole('dialog',{name:'Symbol auswählen',exact:true});await symbols.locator('[data-symbol-query]').fill(term);
    await symbols.getByRole('button',{name,exact:true}).click();
    await expect(p.locator('h2')).toContainText(name);
  };
  const center=await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2]);
  await choose('Fernbedienung','Fernbedienung · Siri');
  await expect(page.locator('.scene .lg-control svg path')).toHaveCount(1);
  await choose('lightbulb','mdi:lightbulb');
  expect(await page.evaluate(()=>studio.item.symbol_art.fill)).toBe(true);
  await p.locator('[data-prop=symbol_button]').check();
  for(const shape of ['round','rounded']){
    await p.locator('[data-prop=symbol_button_shape]').selectOption(shape);
    for(const size of ['symbol_small','symbol_medium','symbol_large']){
      await p.locator('[data-home-size]').selectOption(size);
      let last=Infinity;
      for(const padding of [0,10,25]){
        const input=p.locator('[data-prop=content_padding]');await input.fill(String(padding));await input.press('Tab');
        const data=await page.evaluate(()=>{
          const i=studio.item,n=studio.renderer.nodes[i.id],svg=n._control,r=svg.getBoundingClientRect(),box=svg.getBBox(),f=(n._frame||n).getBoundingClientRect(),scale=r.width/80;
          return {center:[i.x+i.width/2,i.y+i.height/2],dx:r.left+(box.x+box.width/2)*scale-(f.left+f.width/2),dy:r.top+(box.y+box.height/2)*scale-(f.top+f.height/2),ink:box.height*scale,w:f.width,h:f.height};
        });
        data.center.forEach((v,i)=>expect(v).toBeCloseTo(center[i],4));
        expect(Math.abs(data.dx)).toBeLessThan(.1);expect(Math.abs(data.dy)).toBeLessThan(.1);
        expect(Math.abs(data.w-data.h)).toBeLessThan(.1);expect(data.ink).toBeLessThan(last);last=data.ink;
        await expect(p.locator('[data-home-size]')).toHaveValue(size);
      }
    }
  }
  // The alias search includes upstream MDI aliases, keyboard selection and reopen.
  await choose('remote-tv','mdi:remote-tv');
  const before=await page.evaluate(()=>studio.item);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));await openView(page,'Dashboard');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='control').id));
  expect(await page.evaluate(()=>studio.item)).toEqual(before);
  if(process.env.STUDIO_SYMBOL_QA)await page.screenshot({path:process.env.STUDIO_SYMBOL_QA});
});

test('symbol opacity matches native availability and survives repeated redraws',async({page})=>{
  await mount(page);await openView(page,'Dashboard');
  const results=await page.evaluate(()=>{
    studio.insertCard('control');
    const item=studio.item;
    Object.assign(item,{x:85.38,y:83.58,width:3.07,height:6.67,control_icon:'play',symbol_fit:'tight',content_padding:20,color:'#302c2680',accent_color:'#00ff00',text_opacity:.4,style_override:true});
    const scene={...studio.scene,text_opacity:.5,elements:[item]},result=[];
    for(const preview of [true,false]){
      const root=document.createElement('div');root.style.cssText='position:relative;width:1024px;height:600px';document.body.appendChild(root);
      const renderer=new LGLayoutRenderer(root,null,preview);
      for(const [action,entity,data,opacity] of [
        ['av_play_pause','',{},1],
        ['none','media_player.av',{state:'unavailable'},1],
        ['av_play_pause','media_player.av',{state:'paused',av_available_actions:['av_play_pause']},1],
        ['av_play_pause','media_player.av',{state:'unavailable'},.35],
        ['av_play_pause','media_player.av',{state:'paused',av_available_actions:[]},.35],
        ['av_power','media_player.av',{state:'on',av_power:'on',av_available_actions:['av_power']},1],
        ['av_play_pause','',{},1],
      ]){
        item.entity_id=entity;item.tap_action={action,entity_id:action==='none'?'':entity,view:''};
        for(let repaint=0;repaint<3;repaint++){
          renderer.render(scene,{[entity]:data},{});
          const svg=renderer.nodes[item.id]._control,style=getComputedStyle(svg);
          result.push({preview,action,entity,repaint,expected:opacity,opacity:Number(style.opacity),color:style.color});
        }
      }
      renderer.clear();root.remove();
    }
    return result;
  });
  for(const row of results){
    expect(row.opacity,JSON.stringify(row)).toBe(row.expected);
    expect(row.color,JSON.stringify(row)).toBe(row.action==='av_power'?'rgba(0, 255, 0, 0.2)':'rgba(48, 44, 38, 0.1)');
  }
});

test('native camera tiles retain independent source and playback modes up to eight',async({page})=>{
  await boardPreview(page);
  await page.evaluate(()=>{
    studio.scene.elements=[];
    for(let i=0;i<8;i++){
      studio.insertCard('camera');
      Object.assign(studio.item,{camera_source:i%2?'test':'local',camera_mode:i%3===0?'stream':i%3===1?'auto':'snapshot',camera_interval:5+i});
    }
    studio.paint();
  });
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').length)).toBe(8);
  await expect(page.locator('.scene .lg-camera')).toHaveCount(8);
  const expected=await page.evaluate(()=>studio.scene.elements.map(i=>({id:i.id,source:i.camera_source,mode:i.camera_mode,interval:i.camera_interval})));
  await page.evaluate(()=>studio.insertCard('camera'));
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').length)).toBe(8);
  await page.evaluate(()=>studio.save());
  expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.elements.filter(i=>i.kind==='camera').map(i=>({id:i.id,source:i.camera_source,mode:i.camera_mode,interval:i.camera_interval})))).toEqual(expected);
  await page.evaluate(()=>{
    studio.catalog.entries[0].provider='lg';studio.catalog.entries[0].capabilities={hdmi:true,video:true};
    studio.scene.elements=[];studio.insertCard('camera');studio.insertCard('camera');
  });
  expect(await page.evaluate(()=>studio.scene.elements.filter(i=>i.kind==='camera').length)).toBe(1);
});


test('touch timing and independent long press action round trip through the editor',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await addElement(page,'text');
 await page.getByLabel('Bei Berührung',{exact:true}).selectOption('show_view');
 await page.locator('[data-prop="tap_view"]').selectOption('media_view');
 await page.getByLabel('Auslösen',{exact:true}).selectOption('press');
 await page.getByLabel('Langes Tippen',{exact:true}).selectOption('press');
 await page.locator('[data-prop="hold_entity_id"]').fill('input_button.held');await page.locator('[data-prop="hold_entity_id"]').press('Tab');
 await page.locator('[data-prop="hold_ms"]').fill('850');await page.locator('[data-prop="hold_ms"]').press('Tab');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 const item=await page.evaluate(()=>saved.views.find(v=>v.id==='dashboard').scene.elements.find(i=>i.tap_trigger==='press'));
 expect(item.tap_action).toEqual({action:'show_view',entity_id:'',view:'media_view'});
 expect(item.hold_action).toEqual({action:'press',entity_id:'input_button.held',view:''});expect(item.hold_ms).toBe(850);
});

test('all native ESP profiles expose a protected editable offline firmware update view',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    Object.assign(studio.catalog.entries[0],{provider:'esphome',capabilities:{native_lvgl:true,hdmi:false,startup:true}});
    studio.config=studio.withViews(studio.config);studio.saved=JSON.parse(JSON.stringify(studio.config));studio.mount();
  });
  await openView(page,'Firmwareaktualisierung');
  await expect(page.locator('#view-name')).toBeDisabled();
  await expect(page.locator('.context-hint')).toContainText('Firmwareaktualisierung');
  expect(await page.evaluate(()=>studio.availableKinds.camera)).toBeUndefined();
  await expect(page.locator('#background option[value="image"]')).toHaveCount(0);
  await expect(page.locator('.scene .lg-animation-shine')).toBeVisible();
  expect(await page.locator('.scene .lg-animation-shine').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('255, 255, 255');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.kind==='animation').id));
  await expect(page.getByLabel('Highlight',{exact:true})).toHaveValue('white');
  await page.getByLabel('Highlight',{exact:true}).selectOption('black');
  expect(await page.locator('.scene .lg-animation-shine').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('0, 0, 0');
  await page.evaluate(()=>studio.select(studio.scene.elements.find(i=>i.update_role==='status').id));
  await expect(page.getByLabel('Update-Text',{exact:true})).toHaveValue('status');
  await page.getByLabel('Text',{exact:true}).fill('Bitte warten …');await page.getByLabel('Text',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  const update=await page.evaluate(()=>saved.views.find(v=>v.id==='updating'));
  expect(update.scene.elements.find(i=>i.update_role==='status').text).toBe('Bitte warten …');
  expect(update.scene.elements.find(i=>i.kind==='animation').progress_highlight).toBe('black');
  const counts=await page.evaluate(()=>{
    const base=studio.config.views.find(v=>v.id==='dashboard');
    studio.config.views=studio.config.views.filter(v=>!v.id.startsWith('view_'));
    for(let n=0;n<23;n++)studio.config.views.push({...JSON.parse(JSON.stringify(base)),id:'view_limit_'+n,name:'Custom '+n});
    studio.duplicateView('dashboard');const atLimit=studio.config.views.filter(v=>v.id.startsWith('view_')).length;
    studio.duplicateView('dashboard');return [atLimit,studio.config.views.filter(v=>v.id.startsWith('view_')).length];
  });
  expect(counts).toEqual([24,24]); // Native protected views never consume custom slots.
});

async function mountRotatableStudio(page,rotation=0,width=1024,height=600) {
 await mount(page);
 await page.evaluate(({rotation,width,height})=>{
  const entry=studio.catalog.entries[0],portrait=[90,270].includes(rotation);
  entry.provider='esphome';entry.capabilities={native_lvgl:true,hdmi:false,video:false,pip:true,startup:true};
  window.serverRendering={width:portrait?height:width,height:portrait?width:height,panel_width:width,panel_height:height,rotation,rotation_supported:true};
  entry.rendering=structuredClone(serverRendering);window.rotationRequests=[];
  const original=hass.callApi;
  hass.callApi=async(method,url,data)=>{
   if(url.startsWith('display_studio/layout_orientation/')){
    rotationRequests.push(data);if(window.failRotation)throw Error('offline');
    const r=serverRendering,swap=[90,270].includes(data.rotation);
    serverRendering={...r,rotation:data.rotation,width:swap?r.panel_height:r.panel_width,height:swap?r.panel_width:r.panel_height};
    return {rendering:structuredClone(serverRendering)};
   }
   const result=await original(method,url,data);
   return method==='GET'&&url.startsWith('display_studio/layout_library/')?{...result,rendering:structuredClone(serverRendering)}:result;
  };
  studio.config=studio.withViews(studio.config);window.saved=structuredClone(studio.config);studio.saved=structuredClone(saved);studio.mount();
 },{rotation,width,height});
}

test('rotation changes every Studio preview immediately but sends nothing before Save, including Live',async({page})=>{
 await mountRotatableStudio(page);
 await openView(page,'Dashboard PiP');
 const original=await page.evaluate(()=>structuredClone(studio.config));
 for(const angle of [90,180,270,0]){
  await page.getByLabel('Display-Drehung',{exact:true}).selectOption(String(angle));
  await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue(String(angle));
  const state=await page.evaluate(()=>({ratio:studio.displayRatio,style:Number(studio.style.getPropertyValue('--studio-aspect')),dirty:studio.dirty,rendering:studio.displayRendering,actual:studio.deviceRendering.rotation,requests:rotationRequests,config:studio.config}));
  expect(state.actual).toBe(0);expect(state.requests).toEqual([]);expect(state.config).toEqual(original);
  expect(state.ratio).toBe([90,270].includes(angle)?600/1024:1024/600);expect(state.style).toBe(state.ratio);expect(state.dirty).toBe(angle!==0);
 }
 await page.evaluate(()=>studio.toggleLive());
 await page.getByLabel('Display-Drehung',{exact:true}).selectOption('90');
 await page.evaluate(()=>studio.sendLive());
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(0);
 expect(await page.evaluate(()=>rotationRequests)).toEqual([]);
 const live=await page.evaluate(()=>calls.findLast(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_live/'))[2]);
 expect(live).not.toHaveProperty('rotation');expect(live.config || {}).not.toHaveProperty('rotation');
 await page.evaluate(()=>studio.stopLive());
 await openView(page,'Mediaplayer');
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('90');
 await expect.poll(async()=>{const box=await page.locator('.stage').boundingBox();return Math.round(box.width/box.height*1000);}).toBe(Math.round(600/1024*1000));
 await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
 expect(await page.locator('.view-thumbnail').first().evaluate(el=>el.clientWidth/el.clientHeight)).toBeCloseTo(600/1024,1);
});

test('rotation persists only after successful layout save and restores zero after reload',async({page})=>{
 await mountRotatableStudio(page,90);
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('90');
 for(const angle of [180,270,0,90,0]){
  const before=await page.evaluate(()=>serverRendering.rotation);
  await page.getByLabel('Display-Drehung',{exact:true}).selectOption(String(angle));
  expect(await page.evaluate(()=>serverRendering.rotation)).toBe(before);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Gespeichert');
  expect(await page.evaluate(()=>serverRendering.rotation)).toBe(angle);
  // Even a stale catalogue entry must not overwrite the setting returned by GET.
  await page.evaluate(async()=>{studio.catalog.entries[0].rendering.rotation=180;studio.accept(await hass.callApi('GET','display_studio/layout_library/'+studio.entryId));studio.mount();});
  await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue(String(angle));
 }
 expect(await page.evaluate(()=>rotationRequests.map(r=>r.rotation))).toEqual([180,270,0,90,0]);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>rotationRequests)).toHaveLength(5);
});

test('rotation failures keep the selected draft and cannot rotate a conflicting layout',async({page})=>{
 await mountRotatableStudio(page);
 await page.getByLabel('Display-Drehung',{exact:true}).selectOption('90');
 await page.evaluate(()=>{window.failSave=true;});
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>rotationRequests)).toEqual([]);
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('90');
 await expect(page.locator('.status')).toHaveText('Ungespeichert');
 await page.evaluate(()=>{window.failSave=false;window.failRotation=true;});
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await expect(page.locator('.gallery-flash')).toContainText('Ansichten gespeichert. Die Drehung konnte nicht gespeichert werden.');
 await expect(page.locator('.status')).toHaveText('Ungespeichert');
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('90');
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(0);
 expect(await page.evaluate(()=>studio.revision)).toBe(1);
 await page.evaluate(()=>{window.failRotation=false;});
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await expect(page.locator('.status')).toHaveText('Gespeichert');
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(90);
});

test('rotation undo redo and cancel restore preview without device changes',async({page})=>{
 await mountRotatableStudio(page);
 await openView(page,'Dashboard');
 await page.getByLabel('Display-Drehung',{exact:true}).selectOption('90');
 await page.getByTitle('Rückgängig',{exact:true}).click();
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('0');
 await expect(page.locator('.status')).toHaveText('Gespeichert');
 await page.getByTitle('Wiederholen',{exact:true}).click();
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('90');
 await page.locator('[data-action=cancel-edit]').click();
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('0');
 expect(await page.evaluate(()=>rotationRequests)).toEqual([]);
 // Saving inside an edit session and cancelling that session restores both saves.
 await openView(page,'Dashboard');
 await page.getByLabel('Display-Drehung',{exact:true}).selectOption('270');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(270);
 await page.locator('[data-action=cancel-edit]').click();
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(0);
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('0');
 await expect(page.locator('.status')).toHaveText('Gespeichert');
});

test('square rotation stays selected and dirty and device switching cannot discard it',async({page})=>{
 await mountRotatableStudio(page,0,480,480);
 await page.getByLabel('Display-Drehung',{exact:true}).selectOption('270');
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveValue('270');
 expect(await page.evaluate(()=>studio.displayRatio)).toBe(1);
 await page.evaluate(()=>studio.switchDisplay('other'));
 expect(await page.evaluate(()=>studio.entryId)).toBe('one');
 await expect(page.locator('.gallery-flash')).toContainText('Speichere deinen Entwurf');
 expect(await page.evaluate(()=>rotationRequests)).toEqual([]);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>serverRendering.rotation)).toBe(270);
 await page.evaluate(()=>{studio.catalog.entries[0].rendering.rotation_supported=false;studio.mount();});
 await expect(page.getByLabel('Display-Drehung',{exact:true})).toHaveCount(0);
});

test('weather edge and per-widget reactions are independent saved options',async({page})=>{
 await mount(page);await openView(page,'Dashboard');await enableStyling(page);
 await page.locator('.presets').getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
 await page.locator('#background').selectOption('weather');
 await page.locator('#weather-entity').selectOption('weather.home');
 await page.locator('#weather-impact').check();
 await page.locator('#weather-accumulation').check();
 await page.getByRole('button',{name:'Für diese Ansicht verwenden',exact:true}).click();
 await page.evaluate(()=>{studio.select(studio.scene.elements.find(e=>e.kind==='weather').id);});
 await page.getByLabel('Auf Wetter reagieren',{exact:true}).check();
 expect(await page.evaluate(()=>studio.scene.weather_impact)).toBe(true);
 expect(await page.evaluate(()=>studio.scene.elements.find(e=>e.kind==='weather').weather_reactive)).toBe(true);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.weather_impact)).toBe(true);
 expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.weather_accumulation)).toBe(true);
 expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.elements.find(e=>e.kind==='weather').weather_reactive)).toBe(true);
 await page.locator('.presets').getByRole('button',{name:'Mein Theme Theme bearbeiten',exact:true}).click();
 await page.locator('#weather-impact').uncheck();
 await page.getByRole('button',{name:'Für diese Ansicht verwenden',exact:true}).click();
 expect(await page.evaluate(()=>studio.scene.elements.find(e=>e.kind==='weather').weather_reactive)).toBe(true);
});

test('weather source settings persist manual skies and filter precipitation units',async({page})=>{
 await mount(page);await openView(page,'Dashboard');await enableStyling(page);
 await page.evaluate(()=>{hass.states['sensor.rain']={entity_id:'sensor.rain',state:'0.3',attributes:{friendly_name:'Regenrate',unit_of_measurement:'mm/h'}};hass.states['sensor.total']={entity_id:'sensor.total',state:'60',attributes:{friendly_name:'Tagessumme',unit_of_measurement:'mm'}};hass.states['weather.home'].attributes.supported_features=3;});
 await page.locator('.presets').getByRole('button',{name:'＋ Neues Theme',exact:true}).click();
 await page.locator('#background').selectOption('weather');
 await page.locator('#weather-entity').selectOption('weather.home');
 await page.locator('#weather-condition').selectOption('drizzle');
 await expect(page.locator('.weather-precipitation-source')).toBeHidden();
 await page.locator('#weather-precipitation-mode').selectOption('sensor');
 await expect(page.locator('.weather-precipitation-source')).toBeVisible();
 await expect(page.locator('#weather-precipitation-entity option[value="sensor.total"]')).toHaveCount(0);
 await page.locator('#weather-precipitation-entity').selectOption('sensor.rain');
 await page.getByRole('button',{name:'Für diese Ansicht verwenden',exact:true}).click();
 expect(await page.evaluate(()=>[studio.scene.weather_condition,studio.scene.weather_precipitation_mode,studio.scene.weather_precipitation_entity])).toEqual(['drizzle','sensor','sensor.rain']);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.weather_precipitation_entity)).toBe('sensor.rain');
});


test('integrated media controls are configurable in the existing widget inspector',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{supported_features:16387,media_position:30,media_duration:120}};studio.insertCard('media','media_player.sonos','Wohnzimmer');});
 const enabled=page.locator('[data-prop="media_controls"]');await expect(enabled).toBeChecked();
 await expect(page.locator('[data-media-control]')).toHaveCount(11);
 await page.locator('[data-media-control="seek_back"]').uncheck();
 expect(await page.evaluate(()=>studio.item.media_controls_hidden)).toContain('seek_back');
 await enabled.uncheck();await expect(page.locator('[data-media-control]')).toHaveCount(0);
 await enabled.check();await expect(page.locator('[data-media-control="seek_back"]')).not.toBeChecked();
});

test('media controls can be freely moved, resized, saved, cancelled and restored inside the card',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{studio.insertCard('media','media_player.sonos','Wohnzimmer');window.playerId=studio.item.id;studio.item.content_padding=4;studio.editContentsForTest(playerId);});
 const editor=page.locator('.widget-dialog'),select=editor.locator('[data-part]');
 await expect(select.locator('option[value^="control_"]')).toHaveCount(11);
 for(const key of ['previous','seek_back','play_pause','seek_forward','next','remote','select_source','volume_down','volume_set','volume_up','mute']){
  await select.selectOption('control_'+key);
  await expect(editor.locator('.part-outline')).toBeVisible();
  await expect(editor.locator('.part-resize')).toBeVisible();
 }
 await select.selectOption('control_play_pause');
 const field=key=>editor.locator('[data-field="'+key+'"]');
 for(const [key,value] of Object.entries({x:12,y:24,width:18,height:18})){
  await field(key).fill(String(value));await field(key).press('Tab');
 }
 expect(await page.evaluate(()=>studio.item.parts.control_play_pause)).toMatchObject({x:12,y:24,width:18,height:18});
 const geometry=()=>page.evaluate(()=>{const e=studio.widgetEditor;return {box:e.inkBox(),saved:e.config};});
 let g=await geometry();for(const k of ['x','y','width','height'])expect(g.box[k]).toBeCloseTo(g.saved[k],1);
 // A real pointer drag, with the same snapping and resize handles as other parts.
 let outline=editor.locator('.part-outline'),b=await outline.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+40,b.y+b.height/2+25,{steps:8});await page.mouse.up();
 g=await geometry();expect(g.saved.x).toBeGreaterThan(12);expect(g.saved.y).toBeGreaterThan(24);
 const beforeWidth=g.saved.width;
 b=await editor.locator('.part-resize').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+35,b.y+25,{steps:8});await page.mouse.up();
 expect((await geometry()).saved.width).toBeGreaterThan(beforeWidth);
 await editor.locator('.part-outline').focus();const beforeX=(await geometry()).saved.x;
 await page.keyboard.press('ArrowLeft');expect((await geometry()).saved.x).toBeCloseTo(beforeX-1,1);
 // Slider/source controls remain selectable rather than swallowing editor input.
 for(const key of ['volume_set','select_source']){
  await select.selectOption('control_'+key);await field('x').fill('8');await field('x').press('Tab');
  expect((await geometry()).saved.x).toBe(8);
 }
 await select.selectOption('control_mute');await editor.locator('[data-visible]').uncheck();
 await expect(editor.locator('.part-outline')).toHaveCount(0);
 await editor.locator('[data-reset-part]').click();await expect(editor.locator('.part-outline')).toBeVisible();
 const expected=await page.evaluate(()=>JSON.parse(JSON.stringify(studio.item.parts)));
 await editor.locator('[data-close]').click();await expect(editor).toHaveCount(0);
 expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(e=>e.id===playerId).parts)).toEqual(expected);
 await page.evaluate(()=>studio.editContentsForTest(playerId));await select.selectOption('control_play_pause');
 await field('x').fill('0');await field('x').press('Tab');await editor.locator('[data-cancel]').click();
 expect(await page.evaluate(()=>studio.item.parts)).toEqual(expected);
 await page.evaluate(()=>studio.editContentsForTest(playerId));await editor.locator('[data-reset]').click();
 expect(await page.evaluate(()=>studio.item.parts || {})).toEqual({});
 await select.selectOption('control_play_pause');expect((await geometry()).box.x).toBeCloseTo(38,1);
});

test('fullscreen media is a fixed preset and hidden controls reflow without resizing it',async({page},testInfo)=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'paused',attributes:{supported_features:2048|4|8|16384,source_list:['TV','Musik'],volume_level:.5}};studio.insertCard('media','media_player.sonos','Wohnzimmer');window.playerId=studio.item.id;});
 await page.locator('[data-home-size]').selectOption('media_fullscreen');
 await expect(page.locator('[data-home-size]')).toHaveValue('media_fullscreen');
 expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual([0,0,100,100]);
 await expect(page.locator('.selection[data-id] .resize')).toHaveCount(0);
 const control=key=>page.locator('.scene [data-layout-id="'+key+'"]');
 const sliderId=await page.evaluate(()=>playerId+'/media/volume_set');
 const initial=await control(sliderId).boundingBox();
 await page.locator('[data-media-control="select_source"]').uncheck();
 expect((await control(sliderId).boundingBox()).width).toBeGreaterThan(initial.width);
 await expect(page.locator('[data-home-size]')).toHaveValue('media_fullscreen');
 await page.evaluate(()=>studio.editContentsForTest(playerId));
 const editor=page.locator('.widget-dialog');await expect(editor.locator('[data-widget-size]')).toHaveValue('media_fullscreen');
 await expect(editor.locator('[data-base="width"]')).toHaveCount(0);
 await editor.locator('[data-part]').selectOption('control_play_pause');
 await expect(editor.locator('.part-resize')).toBeVisible();
 await editor.locator('[data-field="x"]').fill('40');await editor.locator('[data-field="x"]').press('Tab');
 const pinned=await page.evaluate(()=>structuredClone(studio.item.parts.control_play_pause));
 await editor.locator('[data-part]').selectOption('control_next');await editor.locator('[data-visible]').uncheck();
 expect(await page.evaluate(()=>studio.item.parts.control_play_pause)).toEqual(pinned);
 await editor.locator('[data-close]').click();
 expect(await page.evaluate(()=>saved.scenes.dashboard.elements.find(i=>i.id===playerId).width)).toBe(100);
 await page.evaluate(()=>studio.editContentsForTest(playerId));
 await expect(editor.locator('[data-widget-size]')).toHaveValue('media_fullscreen');
 await editor.locator('[data-widget-size]').selectOption('custom');
 await expect(editor.locator('[data-base="width"]')).toBeVisible();
 await editor.locator('[data-widget-size]').selectOption('media_fullscreen');
 await expect(editor.locator('[data-base="width"]')).toHaveCount(0);
 await editor.locator('[data-close]').click();
 await page.locator('[data-prop="show_cover"]').uncheck();
 expect(await page.evaluate(()=>LGMediaWidgetLayout(studio.item).parts.title.width)).toBe(93);
 for(const width of [1500,700,390]){
  await page.setViewportSize({width,height:1100});
  const bounds=await page.locator('.media-controls-options').evaluate(el=>{const p=el.closest('.properties').getBoundingClientRect();return [...el.querySelectorAll('label')].every(n=>{const r=n.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;});});
  expect(bounds).toBe(true);
 }
 await page.setViewportSize({width:1500,height:1100});
 await page.locator('.scene').screenshot({path:path.resolve('test-results/media-reflow-'+testInfo.project.name+'.png')});
});

test('new-view modal previews custom grids, validates input, cancels cleanly and inherits the theme',async({page},testInfo)=>{
 await mount(page);await page.getByRole('button',{name:'Aurora als Standard-Theme',exact:true}).click();
 const before=await page.evaluate(()=>JSON.stringify(studio.config));
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Wie möchtest du starten?',exact:true});
 await expect(dialog).toBeVisible();await expect(dialog.locator('[data-grid-template]')).toHaveCount(12);
 await expect(dialog.locator('.creator-theme')).toContainText('Aurora');
 await expect(dialog.locator('[data-grid-template=four]')).toHaveAttribute('aria-pressed','true');
 await expect(dialog.locator('[data-grid-template=four] .grid-mini>span')).toHaveCount(4);
 await dialog.locator('[data-grid-template=custom]').click();
 for(const [key,value] of Object.entries({columns:4,rows:3,gap:3,margin:5}))await dialog.locator('[data-grid-value='+key+']').fill(String(value));
 await expect(dialog.locator('[data-custom-preview] .grid-mini>span')).toHaveCount(12);
 await dialog.locator('[data-grid-value=rows]').fill('9');await expect(dialog.locator('[data-create-view]')).toBeDisabled();await expect(dialog.locator('.creator-error')).toContainText('1–8');
 await dialog.locator('[data-grid-value=rows]').fill('2.5');await expect(dialog.locator('[data-create-view]')).toBeDisabled();
 await dialog.locator('[data-grid-value=rows]').fill('3');await expect(dialog.locator('[data-create-view]')).toBeEnabled();
 await dialog.screenshot({path:path.resolve('test-results/view-grid-dialog-'+testInfo.project.name+'.png')});
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 await dialog.locator('[data-grid-template=custom]').click();
 await dialog.locator('[data-grid-value=columns]').fill('4');await dialog.locator('[data-grid-value=rows]').fill('3');
 await dialog.locator('#new-view-name').fill('Mein Raster');await dialog.locator('[data-create-view]').click();
 await expect(dialog).not.toBeVisible();await expect(page.locator('#own-styling')).not.toBeChecked();
 expect(await page.evaluate(()=>({grid:studio.view.grid,background:studio.scene.background,override:studio.view.theme_override,count:studio.scene.elements.length}))).toEqual({grid:regularGrid(4,3),background:'aurora',override:false,count:0});
 await expect(page.locator('[data-grid-slot]')).toHaveCount(12);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();await openView(page,'Mein Raster');
 expect(await page.evaluate(()=>studio.view.grid)).toEqual(regularGrid(4,3));
 await page.locator('#own-styling').check();await page.locator('.presets').getByRole('button',{name:'Paper & Sand',exact:true}).click();
 expect(await page.evaluate(()=>studio.scene.background)).toBe('sand');expect(await page.evaluate(()=>studio.view.theme_override)).toBe(true);
});

for(const [template,name,source] of [['overview','Fünf Felder · asymmetrisch','dashboard'],['sidebar','Seitenleiste & Hauptfeld','pip_view'],['main_header','Hauptfeld & Kopfzeile','media_view'],['split_side','Zwei links · eins rechts',null]])test('asymmetric grid template '+template+' retains individual cell sizes and neutral previews',async({page},testInfo)=>{
 await mount(page);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 const dialog=page.locator('.view-creator'),card=dialog.locator('[data-grid-template='+template+']');
 const cells=await card.locator('.grid-mini>span').evaluateAll(nodes=>nodes.map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height)})));
 expect(cells).toHaveLength({overview:5,sidebar:6,main_header:2,split_side:3}[template]);expectUniformSpacing(cells,1920,1080);
 await expect(card.locator('strong')).toHaveText(name);await expect(card.locator('.grid-mini>span')).toHaveCount(cells.length);
 expect(await card.locator('.grid-mini>span').evaluateAll(nodes=>nodes.map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height)})))).toEqual(cells);
 if(template==='overview')await dialog.screenshot({path:path.resolve('test-results/asymmetric-grid-templates-'+testInfo.project.name+'.png')});
 await card.click();await dialog.locator('#new-view-name').fill(name);await dialog.locator('[data-create-view]').click();
 const stored=await page.evaluate(()=>structuredClone(studio.view.grid.cells));expectUniformSpacing(stored,1920,1080);stored.forEach((c,i)=>{for(const key of ['x','y','width','height'])expect(c[key]).toBeCloseTo(cells[i][key],3);});cells.splice(0,cells.length,...stored);
 expect(await page.evaluate(()=>({grid:studio.view.grid,elements:studio.scene.elements,own:studio.view.theme_override}))).toEqual({grid:{cells},elements:[],own:false});
 for(let index=0;index<cells.length;index++){
  await page.locator('[data-grid-slot="'+index+'"]').click();await page.locator('[data-element-kind=text]').click();await page.locator('[data-add-element]').click();
  expect(await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,size:studio.currentSize(studio.item)}))).toEqual({...cells[index],size:'grid'});
 }
 await expect(page.locator('[data-grid-slot]')).toHaveCount(0);
 // Resetting content must retain this slot, rather than adopting the first one.
 const last=cells.at(-1);await page.evaluate(()=>studio.editContentsForTest(studio.selected));
 await page.getByRole('button',{name:'Inhalt-Layout zurücksetzen',exact:true}).click();
 expect(await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,size:studio.currentSize(studio.item)}))).toEqual({...last,size:'grid'});
 await page.getByRole('button',{name:'Fertig',exact:true}).click();
 await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,name);
 expect(await page.evaluate(()=>({grid:studio.view.grid,sizes:studio.scene.elements.map(i=>studio.currentSize(i))}))).toEqual({grid:{cells},sizes:cells.map(()=>'grid')});
});

test('grid slots place widgets without placeholders, stay editable and persist through saved reload',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 await page.locator('#new-view-name').fill('Rasterplatzierung');await page.locator('[data-create-view]').click();
 await page.locator('[data-grid-slot="2"]').click();await page.locator('[data-element-kind=weather]').click();await page.locator('[data-add-element]').click();
 const first=await page.evaluate(()=>structuredClone(studio.item));expect(first).toMatchObject({x:1.125,y:51,width:48.3125,height:47,style_override:false});
 await expect(page.locator('[data-grid-slot]')).toHaveCount(3);
 await addElement(page,'clock');
 const clock=await page.evaluate(()=>structuredClone(studio.item));expect(clock).toMatchObject({x:1.125,y:2,width:48.3125,height:47,grid_size:true,clock_base_height:47});await expect(page.locator('[data-home-size]')).toHaveValue('grid');
 await expect(page.locator('[data-grid-slot]')).toHaveCount(2);
 await addElement(page,'camera');
 const camera=await page.evaluate(()=>structuredClone(studio.item));expect(camera).toMatchObject({x:50.5625,y:2,width:48.3125,height:47,grid_size:true,camera_lock_aspect:false,camera_fit:'contain'});await expect(page.locator('[data-home-size]')).toHaveValue('grid');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 const view=await page.evaluate(()=>saved.views.find(v=>v.name==='Rasterplatzierung'));expect(view.scene.elements).toHaveLength(3);expect(view.grid).toEqual(regularGrid(2,2));
 await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,'Rasterplatzierung');
 await expect(page.locator('[data-grid-slot]')).toHaveCount(1);
 await page.evaluate(id=>studio.select(id),first.id);const selection=page.locator('.selection[data-id="'+first.id+'"]');await selection.focus();await selection.press('ArrowRight');
 expect(await page.evaluate(id=>studio.scene.elements.find(i=>i.id===id).x,first.id)).toBe(2.125);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>saved.views.find(v=>v.name==='Rasterplatzierung').scene.elements.length)).toBe(3);
});

for(const width of [390,1500])test('view grid dialog fits viewport and supports cancel at '+width,async({page})=>{
 await mount(page,width);const before=await page.evaluate(()=>JSON.stringify(studio.config));
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();const dialog=page.locator('.view-creator');
 await dialog.locator('[data-grid-template=custom]').click();await dialog.locator('[data-grid-value=columns]').fill('8');await dialog.locator('[data-grid-value=rows]').fill('8');
 await expect(dialog.locator('[data-custom-preview] .grid-mini>span')).toHaveCount(64);
 const bounds=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.width).toBeLessThanOrEqual(width);expect(bounds.scroll).toBeLessThanOrEqual(bounds.client+1);
 await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
});


test('grid size fits every added widget and its selection to the complete cell',async({page},testInfo)=>{
 await mount(page);
 await page.evaluate(()=>{studio.catalog.entries.find(e=>e.entry_id===studio.entryId).capabilities={native_lvgl:true,hdmi:false};});
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 await page.locator('[data-grid-template=custom]').click();
 await page.locator('[data-grid-value=columns]').fill('4');await page.locator('[data-grid-value=rows]').fill('4');
 await page.locator('[data-grid-value=margin]').fill('3');await page.locator('[data-grid-value=gap]').fill('1.5');
 await page.locator('#new-view-name').fill('Rastergrößen');await page.locator('[data-create-view]').click();
 const kinds=await page.evaluate(()=>Object.keys(studio.availableKinds));
 expect(kinds).toHaveLength(16);
 for(const [index,kind] of kinds.entries()){
  await addElement(page,kind);
  expect(await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,preset:studio.currentSize(studio.item),manual:!!studio.item.manual_size})),kind).toEqual({x:1.6875+(index%4)*24.3671875,y:3+Math.floor(index/4)*23.875,width:23.5234375,height:22.375,preset:'grid',manual:false});
  await expect(page.locator('[data-home-size]')).toHaveValue('grid');
  await expect(page.locator('.selection.selected .resize')).toHaveCount(0);
  const bounds=await page.evaluate(()=>{const item=studio.item,node=studio.renderer.nodes[item.id],r=studio.renderer.root.getBoundingClientRect(),s=studio.selectionRect(item);return {width:s.width/r.width*100,height:s.height/r.height*100};});
  expect(bounds.width,kind).toBeCloseTo(23.5234375,1);expect(bounds.height,kind).toBeCloseTo(22.375,1);
 }
 await expect(page.locator('[data-grid-slot]')).toHaveCount(0);
 await page.locator('.scene').screenshot({path:path.resolve('test-results/grid-size-'+testInfo.project.name+'.png')});
 // Even a full raster remains the size template for the next element.
 await addElement(page,'text');
 expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.currentSize(studio.item)])).toEqual([23.5234375,22.375,'grid']);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,'Rastergrößen');
 expect(await page.evaluate(()=>studio.scene.elements.every(item=>studio.currentSize(item)==='grid'))).toBe(true);
});

test('grid presets preserve center, allow manual sizes and keep clock subsets in the cell',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await addElement(page,'clock');
 await page.locator('[data-home-size]').selectOption('clock_small');
 expect(await page.evaluate(()=>[studio.item.x+studio.item.width/2,studio.item.y+studio.item.height/2])).toEqual([25.28125,25.5]);
 await page.locator('[data-home-size]').selectOption('grid');
 expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height])).toEqual([1.125,2,48.3125,47]);
 await page.evaluate(()=>studio.editContentsForTest(studio.selected));const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
 for(const visible of ['time','date','both']){
  await editor.locator('[data-clock-view]').selectOption(visible);
  expect(await page.evaluate(()=>({size:studio.currentSize(studio.item),height:studio.item.height,base:studio.item.clock_base_height,clock:studio.item.clock_size}))).toEqual({size:'grid',height:47,base:47,clock:undefined});
 }
 await editor.locator('[data-reset]').click();
 expect(await page.evaluate(()=>[studio.item.x,studio.item.y,studio.item.width,studio.item.height,studio.currentSize(studio.item)])).toEqual([1.125,2,48.3125,47,'grid']);
 await editor.locator('[data-widget-size]').selectOption('custom');
 await editor.locator('[data-base=width]').fill('30');await editor.locator('[data-base=width]').dispatchEvent('change');
 expect(await page.evaluate(()=>studio.currentSize(studio.item))).toBe('custom');
 await editor.locator('[data-widget-size]').selectOption('grid');
 expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.currentSize(studio.item)])).toEqual([48.3125,47,'grid']);
 await editor.locator('[data-close]').click();
 await expect(page.locator('[data-prop=width]')).toHaveCount(0);
 await page.locator('[data-home-size]').selectOption('custom');await expect(page.locator('[data-prop=width]')).toBeVisible();
 await expect(page.locator('.selection .resize')).toHaveCount(1);
 await page.locator('[data-home-size]').selectOption('clock_medium');expect(await page.evaluate(()=>studio.item.grid_size)).toBeUndefined();
});

test('grid camera keeps its frame across aspect detection unless camera binding is explicitly enabled',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await addElement(page,'camera');
 await page.evaluate(async()=>{studio.item.camera_lock_aspect=true;studio.cameraDimensions({...studio.item},640,480,true);studio.standardSize(studio.item,'grid');await Promise.resolve();studio.changed();});
 expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.currentSize(studio.item)])).toEqual([48.3125,47,'grid']);
 await page.locator('[data-prop=camera_lock_aspect]').check();
 expect(await page.evaluate(()=>({preset:studio.currentSize(studio.item),grid:studio.item.grid_size}))).toEqual({preset:'custom',grid:undefined});
 expect(await page.evaluate(()=>studio.item.width*studio.displayRatio/studio.item.height)).toBeCloseTo(4/3,8);
 await page.locator('[data-home-size]').selectOption('grid');
 await expect(page.locator('[data-prop=camera_lock_aspect]')).not.toBeChecked();
 expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.item.camera_fit])).toEqual([48.3125,47,'contain']);
 await page.locator('[data-home-size]').selectOption('camera_small');
 expect(await page.evaluate(()=>studio.currentSize(studio.item))).toBe('camera_small');
 expect(await page.evaluate(()=>studio.item.grid_size)).toBeUndefined();
});


for(const width of [390,1500])test('ESP system views are grouped below messages with no HDMI at '+width,async({page},testInfo)=>{
 await mount(page,width);
 await page.evaluate(()=>{Object.assign(studio.catalog.entries[0],{provider:'esphome',capabilities:{native_lvgl:true,hdmi:false,startup:true}});studio.config=studio.withViews(studio.config);studio.mount();});
 await expect(page.locator('.primary-gallery .view-card h3')).toHaveText(['Dashboard','Dashboard PiP','Mediaplayer']);
 await expect(page.locator('.system-gallery .view-card h3')).toHaveText(['Bootscreen','Verbindungsaufbau','Firmwareaktualisierung']);
 await expect(page.locator('.system-gallery [data-delete-view]')).toHaveCount(0);
 expect(await page.locator('.system-views').evaluate(el=>el.previousElementSibling.className)).toBe('notification-views');
 await page.locator('.system-views').screenshot({path:path.resolve('test-results/system-views-'+width+'-'+testInfo.project.name+'.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('.system-gallery [data-open-view=connecting]').first().click();
 await expect(page.locator('#view-name')).toBeDisabled();
 await expect(page.locator('#view-name')).toHaveValue('Verbindungsaufbau');
});


test('theme live preview uses an existing custom view at the source limit without restoring Dashboard',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{
  const base=structuredClone(studio.config.views.find(v=>v.id==='dashboard'));
  studio.config.views=studio.config.views.filter(v=>!['dashboard','pip_view','media_view'].includes(v.id));
  for(let i=0;i<27;i++)studio.config.views.push({...structuredClone(base),id:'view_limit_'+i,name:'Ansicht '+i});
  studio.ensureView();studio.createTheme();
 });
 await page.evaluate(()=>studio.toggleLive());
 const preview=await page.evaluate(()=>calls.findLast(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_live/'))[2]);
 expect(preview.view).toBe('view_limit_0');expect(preview.config.views).toHaveLength(32);
 expect(preview.config.views.some(v=>v.id==='dashboard')).toBe(false);
 await page.evaluate(()=>studio.stopLive());
});

for(const [width,height] of [[1024,600],[600,1024],[1920,1080],[900,900]])test('uniform grid spacing on display '+width+'x'+height,async({page},testInfo)=>{
 test.setTimeout(90000); // Multiple create/edit/save cycles per display shape.
 await mount(page);
 await page.evaluate(({width,height})=>{const e=studio.catalog.entries.find(e=>e.entry_id===studio.entryId);e.capabilities={native_lvgl:true,hdmi:false};e.rendering={width,height,panel_width:width,panel_height:height,rotation:0};studio.mount();},{width,height});
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 const dialog=page.locator('.view-creator'),ids=await dialog.locator('[data-grid-template]').evaluateAll(nodes=>nodes.map(n=>n.dataset.gridTemplate).filter(id=>id!=='free'));
 if(width===1024)await dialog.screenshot({path:path.resolve('test-results/uniform-grid-'+testInfo.project.name+'.png')});
 const cases=[];
 for(const id of ids){
  if(!await dialog.isVisible())await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
  await dialog.locator('[data-grid-template='+id+']').click();
  const preview=await dialog.locator('[data-grid-template='+id+'] .grid-mini>span').evaluateAll(nodes=>nodes.map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height)})));
  expectUniformSpacing(preview,width,height);
  await dialog.locator('#new-view-name').fill('Abstände '+id);await dialog.locator('[data-create-view]').click();
  const grid=await page.evaluate(()=>structuredClone(studio.view.grid));expectUniformSpacing(grid.cells,width,height);expect(grid.cells).toHaveLength(preview.length);
  grid.cells.forEach((c,i)=>{for(const key of ['x','y','width','height'])expect(c[key]).toBeCloseTo(preview[i][key],3);});
  await addElement(page,'text');
  expect(await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height}))).toEqual(grid.cells[0]);
  cases.push({id,width,height,grid});
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();
 }
 if(testInfo.project.name==='chromium')fs.writeFileSync('tests/fixtures/uniform-grid-'+width+'x'+height+'.json',JSON.stringify(cases,null,2)+'\n');
});

test('legacy grid keeps its saved spacing and widgets',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{const view=studio.config.views.find(v=>v.id==='dashboard');view.grid={columns:2,rows:2,gap:2,margin:4};view.scene.elements=[];studio.changed();});
 await openView(page,'Dashboard');await addElement(page,'text');
 expect(await page.evaluate(()=>({x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height}))).toEqual({x:4,y:4,width:45,height:45});
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>{studio.remove();document.body.append(studio);});await page.locator('.display-actions [data-open-display]').first().click();await openView(page,'Dashboard');
 expect(await page.evaluate(()=>studio.view.grid)).toEqual({columns:2,rows:2,gap:2,margin:4});await page.evaluate(()=>studio.select(studio.scene.elements[0].id));await expect(page.locator('[data-home-size]')).toHaveValue('grid');
});

for(const width of [390,1500])test('empty grid card opens searchable element previews without changing the draft at '+width,async({page},testInfo)=>{
 await mount(page,width);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 const before=await page.evaluate(()=>JSON.stringify(studio.config));
 await page.evaluate(()=>{window.calls=[];});
 const slot=page.locator('[data-grid-slot="2"]');await slot.click();
 const dialog=page.getByRole('dialog',{name:'Element hinzufügen',exact:true});await expect(dialog).toBeVisible();
 const kinds=await page.evaluate(()=>Object.keys(studio.availableKinds));
 await expect(dialog.locator('[data-element-kind]')).toHaveCount(kinds.length);
 for(const kind of kinds)await expect(dialog.locator('[data-element-kind='+kind+'] '+(kind==='hdmi'?'.lg-hdmi-placeholder':'[data-layout-id=picker_'+kind+']'))).toHaveCount(1);
 const bounds=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.width).toBeLessThanOrEqual(width);expect(bounds.scroll).toBeLessThanOrEqual(bounds.client+1);
 // The thumbnail must show the complete widget, including in mobile WebKit.
 const preview=await dialog.locator('[data-element-kind=control]').evaluate(b=>{const c=b.querySelector('.element-preview-crop').getBoundingClientRect(),node=b.querySelector('[data-layout-id]'),w=(node._frame||node).getBoundingClientRect();return {dx:w.x-c.x,dy:w.y-c.y,dw:w.width-c.width,dh:w.height-c.height};});
 for(const delta of Object.values(preview))expect(Math.abs(delta)).toBeLessThan(2);
 for(const kind of kinds){
  const surface=await dialog.locator('[data-element-kind='+kind+']').evaluate(b=>{const n=b.querySelector('.lg-widget,.lg-hdmi-placeholder'),s=getComputedStyle(n._frame||n);return s.backgroundImage!=='none'||!['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor);});
  expect(surface,kind+' has a visible preview surface').toBe(true);
 }
 for(const kind of ['control','logo']){
  const insets=await dialog.locator('[data-element-kind='+kind+']').evaluate(b=>{const n=b.querySelector('[data-layout-id]'),inner=n.getBoundingClientRect(),outer=n._frame.getBoundingClientRect();return [inner.left-outer.left,inner.top-outer.top,outer.right-inner.right,outer.bottom-inner.bottom].map(v=>v/Math.min(outer.width,outer.height));});
  expect(Math.min(...insets)).toBeGreaterThan(.1);expect(Math.max(...insets)-Math.min(...insets)).toBeLessThan(.02);
 }
 await dialog.screenshot({path:path.resolve('test-results/grid-element-picker-'+width+'-'+testInfo.project.name+'.png')});
 const search=dialog.locator('[data-element-search]');await search.fill('WETTER');
 await expect(dialog.locator('[data-element-kind]:visible')).toHaveCount(1);await expect(dialog.locator('[data-element-kind=weather]')).toContainText('22');
 await search.fill('Nicht vorhanden');await expect(dialog.locator('.element-picker-empty')).toBeVisible();await expect(dialog.locator('[data-element-kind]:visible')).toHaveCount(0);
 await search.fill('');await expect(dialog.locator('[data-element-kind]:visible')).toHaveCount(kinds.length);
 // Repainting search results must not accumulate renderer containers.
 await expect(dialog.locator('[data-element-kind=weather] .lg-scroll-viewport')).toHaveCount(1);
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'||c[0]==='media_player'||c[0]==='camera'))).toEqual([]);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(slot).toBeFocused();
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await slot.click();await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await slot.click();await dialog.locator('[data-element-search]').fill('Wetter');
 await dialog.locator('[data-element-kind=weather]').focus();await page.keyboard.press('Enter');
 const setup=page.getByRole('dialog',{name:'Element einrichten',exact:true});await expect(setup).toBeVisible();
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await setup.locator('[data-draft=entity_id]').selectOption('weather.home');await setup.locator('[data-add-element]').click();await expect(setup).toHaveCount(0);
 expect(await page.evaluate(()=>({kind:studio.item.kind,x:studio.item.x,y:studio.item.y,width:studio.item.width,height:studio.item.height,own:studio.item.style_override,size:studio.currentSize(studio.item)}))).toEqual({kind:'weather',x:1.125,y:51,width:48.3125,height:47,own:false,size:'grid'});
 await expect(page.locator('[data-grid-slot]')).toHaveCount(3);
 // Grid insertion must retain the same inherited tile surface and artwork inset.
 for(const [slotIndex,kind] of [[0,'control'],[1,'logo']]){
  await page.locator('[data-grid-slot="'+slotIndex+'"]').click();await dialog.locator('[data-element-kind='+kind+']').click();await page.locator('[data-add-element]').click();
  expect(await page.evaluate(()=>({own:studio.item.style_override,opacity:studio.item.opacity,padding:studio.item.content_padding||0,tile:studio.item.tile_surface}))).toEqual({own:false,opacity:.92,padding:14,tile:true});
 }
});

test('element picker respects device capabilities and camera limits and cleans up on disconnect',async({page})=>{
 await mount(page);await page.evaluate(()=>{studio.catalog.entries.find(e=>e.entry_id===studio.entryId).capabilities={native_lvgl:true,hdmi:false};});
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await page.locator('[data-grid-slot="0"]').click();const dialog=page.locator('.element-picker');
 await expect(dialog.locator('[data-element-kind=hdmi]')).toHaveCount(0);await dialog.locator('[data-element-kind=camera]').click();await dialog.locator('[data-add-element]').click();
 await page.locator('[data-grid-slot="1"]').click();await expect(dialog.locator('[data-element-kind=camera]')).toBeEnabled();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const camera=studio.scene.elements[0];for(let i=1;i<8;i++)studio.scene.elements.push({...structuredClone(camera),id:'extra_camera_'+i});studio.refreshScene();});
 await page.locator('[data-grid-slot="1"]').click();await expect(dialog.locator('[data-element-kind=camera]')).toBeDisabled();await expect(dialog.locator('[data-element-kind=camera]')).toContainText('Maximal acht');
 await page.evaluate(()=>studio.remove());expect(await page.evaluate(()=>studio.elementPicker)).toBeNull();
});

for(const width of [390,1500])for(const available of [true,false])test('element picker renders automatic weather on ESP at '+width+' available '+available,async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mount(page,width);await page.emulateMedia({colorScheme:'dark'});
 await page.evaluate(()=>{studio.catalog.entries.find(e=>e.entry_id===studio.entryId).capabilities={native_lvgl:true,hdmi:false};});
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await page.evaluate(available=>{
  studio.view.grid={columns:3,rows:2,gap:2,margin:4};
  Object.assign(studio.scene,{background:'weather',glass:true,weather_condition:'auto',weather_entity:'weather.home',surface_opacity:.45});
  if(available){hass.states['weather.home'].state='rainy';hass.states['weather.home'].attributes.cloud_coverage=91;}else delete hass.states['weather.home'];
  studio.refreshScene();
 },available);
 await page.locator('[data-grid-slot="0"]').click();const dialog=page.locator('.element-picker');
 for(const kind of await page.evaluate(()=>Object.keys(studio.availableKinds)))await expect(dialog.locator('[data-layout-id=picker_'+kind+']')).toHaveCount(1);
 await expect(dialog.locator('.lg-hdmi-placeholder')).toHaveCount(0);
 await expect(dialog.locator('[data-element-kind=control] .lg-weather-sky')).toHaveAttribute('data-condition',available?'rainy':'unavailable');
 await expect(dialog.locator('[data-element-kind=weather] .lg-weather-sky')).toHaveAttribute('data-motion','off');
 await expect(dialog.locator('.element-preview-error')).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);
 for(const kind of ['control','logo','clock']){
  const surface=await dialog.locator('[data-layout-id=picker_'+kind+']').evaluate(n=>({background:getComputedStyle(n._frame||n).backgroundColor,innerBorder:n._frame?getComputedStyle(n).borderTopWidth:null}));
  expect(surface.background).not.toBe('rgba(0, 0, 0, 0)');
  if(kind!=='clock')expect(surface.innerBorder).toBe('0px');
 }
 if(available)await dialog.screenshot({path:path.resolve('test-results/grid-element-picker-weather-'+width+'-'+testInfo.project.name+'.png')});
 await dialog.locator('[data-element-search]').fill('Uhr');await expect(dialog.locator('[data-element-kind]:visible')).toHaveCount(1);
 await dialog.locator('[data-element-search]').fill('');await expect(dialog.locator('[data-layout-id=picker_media]')).toHaveCount(1);
 await page.keyboard.press('Escape');expect(errors).toEqual([]);
});

test('one failed thumbnail does not block other element previews or leave HDMI text',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await page.evaluate(()=>{const render=LGLayoutRenderer.prototype.render;LGLayoutRenderer.prototype.render=function(scene,...args){if(scene.elements[0]?.id==='picker_control')throw Error('Test thumbnail failure');return render.call(this,scene,...args);};});
 await page.locator('[data-grid-slot="0"]').click();const dialog=page.locator('.element-picker');
 await expect(dialog.locator('[data-element-kind=control]')).toContainText('Vorschau nicht verfügbar');
 await expect(dialog.locator('[data-element-kind=control] .lg-hdmi-placeholder')).toHaveCount(0);
 await expect(dialog.locator('[data-layout-id=picker_clock]')).toHaveCount(1);
 await expect(dialog.locator('[data-layout-id=picker_weather]')).toHaveCount(1);
 await dialog.locator('[data-element-kind=weather]').click();await dialog.locator('[data-add-element]').click();expect(await page.evaluate(()=>studio.item.kind)).toBe('weather');
});

async function deviceGallery(page,width=1500){
 await mount(page,width,{devicesHome:true});
 await page.evaluate(()=>{
  const old=hass.callApi;window.deviceWrites=[];
  window.deviceInventory={types:studio.devicesHome.data.types,entries:[
   {entry_id:'one',name:'Wohnzimmer',provider:'esphome',model:'Guition · 7 Zoll',image:'guition-7.webp',width:1024,height:600,compatibility:'esphome:600x1024',status:'online',available:true,target_entry_id:'p4',selected_view:'Dashboard'},
   {entry_id:'offline',name:'Flur',provider:'esphome',model:'Guition · 4 Zoll',image:'guition-4.webp',width:480,height:480,compatibility:'esphome:480x480',status:'offline',available:true,target_entry_id:'square'},
   {entry_id:'lg',name:'Fernseher',provider:'lg',model:'LG Professional Display',image:'lg.jpg',status:'online',available:true},
   {entry_id:'tablet',name:'Tablet',provider:'browser',model:'Browser / Kiosk',image:'browser.jpg',status:'offline',available:true}],targets:[
   {entry_id:'p4',name:'Wohnzimmer',provider:'esphome',model:'Guition',width:1024,height:600,compatibility:'esphome:600x1024',assigned_to:['one'],assigned_names:['Wohnzimmer']},
   {entry_id:'p4-free',name:'Ersatzdisplay',provider:'esphome',model:'Anderes Modell',width:1024,height:600,compatibility:'esphome:600x1024',assigned_to:[],assigned_names:[]},
   {entry_id:'p4-taken',name:'Belegt',provider:'esphome',model:'Guition',width:1024,height:600,compatibility:'esphome:600x1024',assigned_to:['another'],assigned_names:['Anderer Raum']},
   {entry_id:'square',name:'Flur',provider:'esphome',model:'Guition',width:480,height:480,compatibility:'esphome:480x480',assigned_to:['offline'],assigned_names:['Flur']},
   {entry_id:'tv',name:'Fernseher',provider:'lg',model:'LG',compatibility:'lg',assigned_to:['lg'],assigned_names:['Fernseher']}]};
  hass.callApi=async(method,url,data)=>{
   if(method==='POST'&&(url==='display_studio/devices'||url.startsWith('display_studio/device_binding/'))){
    deviceWrites.push({url,data});if(window.failDevice)throw {body:{error:window.failDevice}};
    if(url==='display_studio/devices'){deviceInventory.entries.push({entry_id:'new',name:data.name,provider:data.provider,model:'Browser / Kiosk',image:'browser.jpg',status:'offline',available:true});return {entry_id:'new'};}
    const entry=deviceInventory.entries.find(e=>url.endsWith('/'+e.entry_id));entry.target_entry_id=data.target_entry_id;entry.status=data.target_entry_id?'offline':'unbound';return {entry_id:entry.entry_id};
   }return old(method,url,data);
  };
  return studio.devicesHome.refresh();
 });
}

for(const width of [1500,390])test(`device gallery ${width}: product pictures status and native HA navigation`,async({page},info)=>{
 await deviceGallery(page,width);
 await expect(page.locator('.display-card')).toHaveCount(4);
 await expect(page.locator('.display-card[data-display-card=offline] .display-status')).toHaveText('Offline');
 await expect(page.locator('select.device,.menu')).toHaveCount(0);
 await expect.poll(()=>page.locator('.display-picture img').evaluateAll(ns=>ns.every(n=>n.complete&&n.naturalWidth>0))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath('display-gallery.png'),fullPage:true});
 await page.locator('[data-open-display=one]').first().click();await expect(page.locator('.overview')).toBeVisible();
 await page.getByRole('button',{name:'← Alle Displays',exact:true}).click();await expect(page.locator('.devices-home')).toBeVisible();
 await page.evaluate(()=>{deviceInventory.entries[0].status='offline';return studio.devicesHome.refresh();});
 await expect(page.locator('[data-display-card=one] .display-status')).toHaveText('Offline');
});

test('device binding offers equal resolution across models, blocks occupied devices and retains failed drafts',async({page})=>{
 await deviceGallery(page);await page.locator('[data-bind-display=one]').click();
 const dialog=page.getByRole('dialog',{name:'Zuordnung ändern'}),select=dialog.locator('select[name=target]');
 await expect(select.locator('option[value=square]')).toHaveCount(0);
 await expect(select.locator('option[value=tv]')).toHaveCount(0);
 await expect(select.locator('option[value=p4-taken]')).toHaveJSProperty('disabled',true);
 await expect(dialog.locator('input[value=lg]')).toBeDisabled();
 await select.selectOption('p4-free');await page.evaluate(()=>window.failDevice='device_in_use');
 await dialog.getByRole('button',{name:'Zuordnung speichern'}).click();await expect(dialog.getByRole('alert')).toContainText('bereits zugeordnet');
 await expect(select).toHaveValue('p4-free');await expect(dialog).toBeVisible();
 await page.evaluate(()=>window.failDevice=null);await dialog.getByRole('button',{name:'Zuordnung speichern'}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>deviceWrites.at(-1).data)).toEqual({target_entry_id:'p4-free',previous_target_entry_id:'p4'});
 await page.locator('[data-bind-display=one]').click();await select.selectOption('');await dialog.getByRole('button',{name:'Zuordnung speichern'}).click();
 await expect(page.locator('[data-display-card=one] .display-status')).toHaveText('Nicht zugeordnet');
});

test('add device selects available types and creates a browser with no hardware binding',async({page},info)=>{
 await deviceGallery(page,390);await page.locator('[data-add-display]').click();
 const d=page.getByRole('dialog',{name:'Display hinzufügen'});
 await expect(d.locator('select[name=target] option[value=p4]')).toHaveJSProperty('disabled',true);
 await expect(d.locator('select[name=target] option[value=p4-free]')).toBeEnabled();
 await d.locator('input[value=browser]').check();await expect(d.locator('.device-target')).toBeHidden();await expect(d.locator('.device-setup-link')).toBeHidden();
 await d.getByLabel('Name',{exact:true}).fill('Küche');
 await page.screenshot({path:info.outputPath('display-add-mobile.png'),fullPage:true});
 await d.getByRole('button',{name:'Hinzufügen',exact:true}).click();await expect(d).toHaveCount(0);
 await expect(page.locator('[data-display-card=new] h3')).toHaveText('Küche');
 expect(await page.evaluate(()=>deviceWrites.at(-1).data)).toEqual({provider:'browser',name:'Küche',target_entry_id:null});
});

test('device landing does not leak preview polling and keeps unsaved edits on guarded navigation',async({page})=>{
 await deviceGallery(page);await page.locator('[data-open-display=one]').first().click();await openView(page,'Dashboard');
 await page.evaluate(()=>{studio.config.enabled=!studio.config.enabled;studio.dirty=true;studio.updateStatus();});
 await expect(page.getByRole('button',{name:'← Alle Displays',exact:true})).toBeDisabled();
 await page.evaluate(()=>studio.showDevices());await expect(page.locator('.devices-home')).toHaveCount(0);
 await page.evaluate(()=>{studio.dirty=false;return studio.showDevices();});await expect(page.locator('.devices-home')).toBeVisible();
 expect(await page.evaluate(()=>Boolean(studio.renderer))).toBe(false);
 await page.evaluate(()=>{window.closedHome=studio.devicesHome;studio.remove();});
 expect(await page.evaluate(()=>closedHome.closed)).toBe(true);
});

async function pickerSetup(page,kind,width=1500){
 await mount(page,width);await page.evaluate(()=>{
  studio.catalog.entries.find(e=>e.entry_id===studio.entryId).capabilities={native_lvgl:true,hdmi:false};
  for(const [id,value,attrs] of [['media_player.music','playing',{friendly_name:'Musik',supported_features:16385|32|16|1024|8|128|256|65536,volume_level:.4}],['switch.lamp','off',{friendly_name:'Lampe'}],['camera.test','idle',{friendly_name:'Testkamera'}]])hass.states[id]={entity_id:id,state:value,attributes:attrs};
 });
 await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await page.locator('[data-grid-slot="0"]').click();await page.locator('[data-element-kind='+kind+']').click();
 return page.locator('.element-picker');
}
for(const width of [390,1500])test('template setup keeps a draft across Back, cancels cleanly and inserts once at '+width,async({page},info)=>{
 const dialog=await pickerSetup(page,'weather',width),before=await page.evaluate(()=>JSON.stringify(studio.config));
 await expect(dialog.getByRole('heading')).toHaveText('Element einrichten');
 await expect(dialog.locator('[data-draft=entity_id] option')).toHaveCount(2);
 await dialog.locator('[data-draft=entity_id]').selectOption('weather.home');await dialog.locator('[data-draft=label]').fill('Garten');
 await dialog.locator('[data-draft=forecast_count]').fill('6');await dialog.locator('[data-element-back]').click();
 await dialog.locator('[data-element-kind=weather]').click();await expect(dialog.locator('[data-draft=label]')).toHaveValue('Garten');await expect(dialog.locator('[data-draft=entity_id]')).toHaveValue('weather.home');
 await expect(dialog.locator('[data-layout-id=picker_weather]')).toContainText('23');
 expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await dialog.screenshot({path:info.outputPath('configure-weather.png')});
 await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(before);
 await page.locator('[data-grid-slot="0"]').click();await dialog.locator('[data-element-kind=weather]').click();await dialog.locator('[data-draft=entity_id]').selectOption('weather.home');
 await dialog.locator('[data-draft=forecast_count]').fill('9');await dialog.locator('[data-add-element]').click();await expect(dialog).toBeVisible();expect(await page.evaluate(()=>studio.scene.elements.length)).toBe(0);
 await dialog.locator('[data-draft=forecast_count]').fill('5');await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({count:studio.scene.elements.length,entity:studio.item.entity_id,forecast:studio.item.forecast_count,surface:studio.item.tile_surface}))).toEqual({count:1,entity:'weather.home',forecast:5,surface:true});
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'||c[0]==='media_player'||c[0]==='camera'))).toEqual([]);
});

test('template setup cameras expose only relevant sources and persist live/fullscreen choices',async({page})=>{
 const dialog=await pickerSetup(page,'camera');
 await expect(dialog.locator('[data-draft=entity_id],[data-draft=multicast_url]')).toHaveCount(0);
 await dialog.locator('[data-draft=camera_source]').selectOption('multicast');await expect(dialog.locator('[data-draft=entity_id]')).toHaveCount(0);
 await dialog.locator('[data-draft=multicast_url]').fill('https://invalid');await dialog.locator('[data-add-element]').click();await expect(dialog.locator('[role=alert]')).toContainText('Multicast');
 await dialog.locator('[data-draft=camera_source]').selectOption('entity');await expect(dialog.locator('[data-draft=multicast_url]')).toHaveCount(0);
 await expect(dialog.locator('[data-draft=entity_id] option')).toHaveCount(2);await dialog.locator('[data-draft=entity_id]').selectOption('camera.test');
 await dialog.locator('[data-draft=camera_mode]').selectOption('stream');await expect(dialog.locator('[data-draft=camera_interval]')).toHaveCount(0);
 await dialog.locator('[data-draft=tap_action]').selectOption('camera_fullscreen');await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({source:studio.item.camera_source,mode:studio.item.camera_mode,entity:studio.item.entity_id,tap:studio.item.tap_action.action,size:studio.currentSize(studio.item),url:studio.item.multicast_url}))).toEqual({source:'entity',mode:'stream',entity:'camera.test',tap:'camera_fullscreen',size:'grid',url:''});
});

test('template setup symbol artwork and automatic actions are committed with the tile',async({page})=>{
 const dialog=await pickerSetup(page,'control');await dialog.locator('[data-draft=entity_id]').selectOption('media_player.music');
 await expect(dialog.locator('[data-draft=tap_action]')).toHaveValue('auto');
 await chooseSymbol(page,dialog,'mdi:pause');
 await expect.poll(()=>page.evaluate(()=>studio.elementPicker.draft('control').control_icon)).toBe('mdi:pause');
 await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({icon:studio.item.control_icon,art:!!studio.item.symbol_art,action:studio.item.tap_action.action,target:studio.item.tap_action.entity_id,padding:studio.item.content_padding}))).toEqual({icon:'mdi:pause',art:true,action:'media_play_pause',target:'media_player.music',padding:14});
});

test('template setup selected graphics, animation and clock settings survive adding',async({page})=>{
 const dialog=await pickerSetup(page,'logo');await dialog.locator('[data-draft=graphic_id]').selectOption('home_assistant');await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({graphic:studio.item.graphic_id,label:studio.item.label,padding:studio.item.content_padding}))).toEqual({graphic:'home_assistant',label:'Grafik · Home Assistant',padding:14});
 await page.locator('[data-grid-slot="1"]').click();await dialog.locator('[data-element-kind=animation]').click();await dialog.locator('[data-draft=animation_type]').selectOption('progress');
 await dialog.locator('[data-draft=progress_source]').selectOption('entity');await dialog.locator('[data-draft=entity_id]').selectOption('sensor.temperature');
 await dialog.locator('[data-draft=progress_max]').fill('0');await dialog.locator('[data-add-element]').click();await expect(dialog.locator('[role=alert]')).toContainText('Maximalwert');
 await dialog.locator('[data-draft=progress_max]').fill('40');await dialog.locator('[data-add-element]').click();expect(await page.evaluate(()=>({type:studio.item.animation_type,source:studio.item.progress_source,max:studio.item.progress_max}))).toEqual({type:'progress',source:'entity',max:40});
 await page.locator('[data-grid-slot="2"]').click();await dialog.locator('[data-element-kind=clock]').click();
 await dialog.locator('[data-draft=clock_display]').selectOption('time');await dialog.locator('[data-draft=clock_seconds]').check();await dialog.locator('[data-draft=clock_blink]').check();await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({date:studio.item.parts.date.visible,seconds:studio.item.clock_seconds,blink:studio.item.clock_blink,size:studio.currentSize(studio.item),surface:studio.item.tile_surface}))).toEqual({date:false,seconds:true,blink:true,size:'grid',surface:true});
});

test('every grid template uses the same surface in preview and insertion',async({page})=>{
 const dialog=await pickerSetup(page,'text');await dialog.locator('[data-element-back]').click();
 const kinds=await dialog.locator('[data-element-kind]').evaluateAll(ns=>ns.map(n=>n.dataset.elementKind));
 for(const kind of kinds){
  await dialog.locator('[data-element-kind='+kind+']').click();
  const draft=await page.evaluate(()=>structuredClone(studio.elementPicker.draft(studio.elementPicker.kind)));
  const style=await dialog.locator('[data-layout-id="picker_'+kind+'"]').evaluate(n=>{const s=getComputedStyle(n._frame||n);return {background:s.backgroundColor,image:s.backgroundImage};});
  await dialog.locator('[data-add-element]').click();
  const added=await page.evaluate(()=>structuredClone(studio.item));delete draft.id;delete added.id;expect(added).toEqual(draft);
  const actual=await page.locator('.stage [data-layout-id="'+await page.evaluate(()=>studio.item.id)+'"]').evaluate(n=>{const s=getComputedStyle(n._frame||n);return {background:s.backgroundColor,image:s.backgroundImage};});expect(actual).toEqual(style);
  await page.evaluate(()=>{studio.scene.elements=[];studio.selected=null;studio.refreshScene();});
  await page.locator('[data-grid-slot="0"]').click();
 }
 await page.keyboard.press('Escape');
});


test('template setup clears hidden invalid progress ranges and incompatible manual actions',async({page})=>{
 const dialog=await pickerSetup(page,'animation');await dialog.locator('[data-draft=animation_type]').selectOption('progress');await dialog.locator('[data-draft=progress_source]').selectOption('entity');
 await dialog.locator('[data-draft=progress_min]').fill('200');await dialog.locator('[data-draft=animation_type]').selectOption('spinner');await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({source:studio.item.progress_source,min:studio.item.progress_min??null,max:studio.item.progress_max??null}))).toEqual({source:'fixed',min:null,max:null});
 await page.locator('[data-grid-slot="1"]').click();await dialog.locator('[data-element-kind=control]').click();await dialog.locator('[data-draft=entity_id]').selectOption('media_player.music');await dialog.locator('[data-draft=tap_action]').selectOption('media_play_pause');await dialog.locator('[data-draft=entity_id]').selectOption('switch.lamp');
 await expect(dialog.locator('[data-draft=tap_action]')).toHaveValue('none');await dialog.locator('[data-add-element]').click();expect(await page.evaluate(()=>studio.item.tap_action.action)).toBe('none');
});

for(const width of [390,1500])test('sidebar adds through the same popup with editable sizes; raster slots stay fixed '+width,async({page},info)=>{
 await mount(page,width);await openView(page,'Dashboard');
 await expect(page.locator('#new-kind')).toHaveCount(0);
 await page.locator('[data-action=add]').click();await page.locator('[data-element-kind=clock]').click();const dialog=page.locator('.element-picker');
 await expect(dialog.locator('[data-draft=size]')).toBeVisible();await dialog.locator('[data-draft=size]').selectOption('clock_extra_large');
 expect(await page.evaluate(()=>[studio.elementPicker.draft('clock').width,studio.elementPicker.draft('clock').height])).toEqual([80,60]);
 await dialog.locator('[data-element-back]').click();await dialog.locator('[data-element-kind=clock]').click();await expect(dialog.locator('[data-draft=size]')).toHaveValue('clock_extra_large');
 await dialog.locator('[data-draft=size]').selectOption('custom');await dialog.locator('[data-draft=width]').fill('42');await dialog.locator('[data-draft=height]').fill('31');await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({w:studio.item.width,h:studio.item.height,size:studio.currentSize(studio.item)}))).toEqual({w:42,h:31,size:'custom'});
 await page.locator('[data-action=add]').click();await page.locator('[data-element-kind=logo]').click();await dialog.locator('[data-draft=size]').selectOption('graphic_large');
 const pending=await page.evaluate(()=>JSON.stringify(studio.config));await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify(studio.config))).toBe(pending);
 await page.getByRole('button',{name:'← Alle Ansichten',exact:true}).click();await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.locator('[data-create-view]').click();
 await page.locator('[data-grid-slot="0"]').click();await page.locator('[data-element-kind=clock]').click();await expect(dialog.locator('[data-draft=size],[data-draft=width],[data-draft=height]')).toHaveCount(0);
 await dialog.screenshot({path:info.outputPath('fixed-raster-setup.png')});await dialog.locator('[data-add-element]').click();expect(await page.evaluate(()=>studio.currentSize(studio.item))).toBe('grid');
});

test('native HA entity picker receives domain-filtered entities and commits selection/clear without actions',async({page})=>{
 const dialog=await pickerSetup(page,'weather');
 // Stub only the HA component contract; real search/overlays are covered in live HA.
 await page.evaluate(()=>customElements.define('ha-entity-picker',class extends HTMLElement{}));
 const picker=dialog.locator('ha-entity-picker');await expect(picker).toBeAttached();
 expect(await picker.evaluate(p=>({include:p.includeEntities,label:p.label,custom:p.allowCustomEntity,ids:p.showEntityId,hasHass:!!p.hass}))).toEqual({include:['weather.home'],label:'Home-Assistant-Entität',custom:false,ids:true,hasHass:true});
 await picker.evaluate(p=>p.dispatchEvent(new CustomEvent('value-changed',{detail:{value:'weather.home'},bubbles:true,composed:true})));
 expect(await page.evaluate(()=>studio.elementPicker.draft('weather').entity_id)).toBe('weather.home');
 await picker.evaluate(p=>p.dispatchEvent(new CustomEvent('value-changed',{detail:{value:'media_player.music'},bubbles:true,composed:true})));
 expect(await page.evaluate(()=>studio.elementPicker.draft('weather').entity_id)).toBe('weather.home');
 await picker.evaluate(p=>p.dispatchEvent(new CustomEvent('value-changed',{detail:{value:undefined},bubbles:true,composed:true})));
 expect(await page.evaluate(()=>studio.elementPicker.draft('weather').entity_id)).toBe('');
 expect(await page.evaluate(()=>studio.scene.elements.length)).toBe(0);await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
});

for(const width of [390,1500])test('symbol popup shows vector previews, cancels safely and selects before adding '+width,async({page},info)=>{
 const setup=await pickerSetup(page,'control',width),before=await page.evaluate(()=>JSON.stringify(studio.elementPicker.draft('control')));
 await setup.locator('[data-open-symbol]').click();const symbols=page.getByRole('dialog',{name:'Symbol auswählen',exact:true});
 await expect(symbols.locator('[data-symbol=remote_siri] svg path')).toHaveCount(1);
 await symbols.locator('[data-symbol-query]').fill('lightbulb');await expect(symbols.locator('[data-symbol="mdi:lightbulb"] svg path')).toHaveCount(1);
 await symbols.screenshot({path:info.outputPath('symbol-choices.png')});
 await page.keyboard.press('Escape');await expect(symbols).toHaveCount(0);await expect(setup).toBeVisible();await expect(setup.locator('[data-open-symbol]')).toBeFocused();
 expect(await page.evaluate(()=>JSON.stringify(studio.elementPicker.draft('control')))).toBe(before);
 await chooseSymbol(page,setup,'mdi:lightbulb');await expect(setup.locator('[data-current-symbol] svg path')).toHaveCount(1);
 expect(await page.evaluate(()=>studio.scene.elements.length)).toBe(0);await setup.locator('[data-add-element]').click();expect(await page.evaluate(()=>studio.item.control_icon)).toBe('mdi:lightbulb');
});

test('symbol popup catalogue failure keeps builtin previews and cancels without modifying the draft',async({page})=>{
 const setup=await pickerSetup(page,'control');await page.route('**/symbols/index.json*',r=>r.fulfill({status:503,body:'unavailable'}));
 await setup.locator('[data-open-symbol]').click();const symbols=page.locator('.symbol-dialog');await expect(symbols.locator('.symbol-load-error')).toContainText('konnten nicht geladen');
 await expect(symbols.locator('[data-symbol=play] svg')).toHaveCount(1);await symbols.getByRole('button',{name:'Abbrechen',exact:true}).click();
 await setup.getByRole('button',{name:'Abbrechen',exact:true}).click();expect(await page.evaluate(()=>studio.scene.elements.length)).toBe(0);expect(await page.evaluate(()=>studio.symbolPicker)).toBeNull();
});

for(const width of [390,1500])test('popup locks page scrolling while its own list scrolls and restores the page '+width,async({page})=>{
 await mount(page,width);await openView(page,'Dashboard');
 const add=page.locator('[data-action=add]');await add.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({y:scrollY,hostY:studio.scrollTop,overflow:document.documentElement.style.overflowY,body:document.body.style.overflowY}));
 await add.click();const dialog=page.locator('.element-picker');await expect(dialog).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.scrollingElement).overflowY)).toBe('hidden');
 await page.mouse.move(1,1);await page.mouse.wheel(0,600);await page.waitForTimeout(150);
 expect(await page.evaluate(()=>[scrollY,studio.scrollTop])).toEqual([before.y,before.hostY]);
 const box=await dialog.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,500);
 await expect.poll(()=>dialog.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await page.mouse.wheel(0,800);await page.waitForTimeout(150);
 expect(await page.evaluate(()=>[scrollY,studio.scrollTop])).toEqual([before.y,before.hostY]);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>({y:scrollY,hostY:studio.scrollTop,overflow:document.documentElement.style.overflowY,body:document.body.style.overflowY}))).toEqual(before);
 await page.mouse.move(10,400);const old=await page.evaluate(()=>studio.scrollTop);await page.mouse.wheel(0,old>0?-400:400);await expect.poll(()=>page.evaluate(()=>studio.scrollTop)).not.toBe(old);
});

test('nested symbol popup preserves the parent lock and releases it on cancellation and disconnect',async({page})=>{
 const setup=await pickerSetup(page,'control',390);await setup.locator('[data-open-symbol]').scrollIntoViewIfNeeded();
 const parent=await setup.evaluate(el=>({y:el.scrollTop,overflow:el.style.overflowY}));
 await setup.locator('[data-open-symbol]').click();const symbols=page.locator('.symbol-dialog');await expect(symbols).toBeVisible();
 expect(await setup.evaluate(el=>getComputedStyle(el).overflowY)).toBe('hidden');
 await page.mouse.move(1,1);await page.mouse.wheel(0,600);await page.waitForTimeout(150);
 expect(await setup.evaluate(el=>el.scrollTop)).toBe(parent.y);
 await page.keyboard.press('Escape');await expect(symbols).toHaveCount(0);
 expect(await setup.evaluate(el=>({y:el.scrollTop,overflow:el.style.overflowY}))).toEqual(parent);
 expect(await page.evaluate(()=>getComputedStyle(document.scrollingElement).overflowY)).toBe('hidden');
 await setup.getByRole('button',{name:'Abbrechen',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.style.overflowY)).toBe('');
 await page.locator('[data-action=add]').click();await page.evaluate(()=>studio.remove());
 expect(await page.evaluate(()=>[document.documentElement.style.overflowY,document.body.style.overflowY])).toEqual(['','']);
});

test('new-view, device and widget dialogs restore existing outer scroll styles',async({page})=>{
 await mount(page,390,{devicesHome:true});
 await page.evaluate(()=>{document.scrollingElement.style.setProperty('overflow-y','scroll','important');document.body.style.overscrollBehavior='auto';});
 await page.locator('[data-add-display]').click();
 expect(await page.evaluate(()=>getComputedStyle(document.scrollingElement).overflowY)).toBe('hidden');
 await page.locator('.device-dialog [data-cancel]').click();
 expect(await page.evaluate(()=>[document.scrollingElement.style.overflowY,document.scrollingElement.style.getPropertyPriority('overflow-y'),document.body.style.overscrollBehavior])).toEqual(['scroll','important','auto']);
 await page.locator('[data-open-display]').first().click();await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
 expect(await page.evaluate(()=>getComputedStyle(document.scrollingElement).overflowY)).toBe('hidden');
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.scrollingElement.style.overflowY)).toBe('scroll');
 await openView(page,'Dashboard');await page.evaluate(()=>studio.editContentsForTest(studio.scene.elements.find(i=>i.kind==='clock').id));
 await expect(page.locator('.widget-dialog')).toBeVisible();expect(await page.evaluate(()=>getComputedStyle(document.scrollingElement).overflowY)).toBe('hidden');
 await page.locator('.widget-dialog [data-cancel]').click();await expect(page.locator('.widget-dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>[document.scrollingElement.style.overflowY,document.scrollingElement.style.getPropertyPriority('overflow-y')])).toEqual(['scroll','important']);
});

for(const width of [390,1500])test('symbol setup offers page navigation without an entity and preserves its target '+width,async({page})=>{
 const setup=await pickerSetup(page,'control',width),fields=setup.locator('.element-setup-fields');
 expect(await fields.evaluate(root=>[...root.children].slice(0,3).map(n=>n.querySelector('[data-open-symbol]')?'symbol':n.querySelector('[data-draft]')?.dataset.draft))).toEqual(['symbol','entity_id','tap_action']);
 await expect(setup.locator('[data-draft=tap_action]')).toBeEnabled();
 expect(await setup.locator('[data-draft=tap_action] option').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(['none','show_view']);
 // Native HA custom-element contract; the live test exercises its real dropdown.
 await page.evaluate(()=>customElements.define('ha-select',class extends HTMLElement{}));
 const action=setup.locator('ha-select.studio-action-picker');await expect(action).toBeAttached();expect(await action.evaluate(n=>n.disabled)).toBe(false);
 await action.evaluate(n=>n.dispatchEvent(new CustomEvent('selected',{detail:{value:'toggle'},bubbles:true,composed:true})));
 expect(await page.evaluate(()=>studio.elementPicker.draft('control').tap_auto)).toBe(true);
 await action.evaluate(n=>n.dispatchEvent(new CustomEvent('selected',{detail:{value:'show_view'},bubbles:true,composed:true})));
 const target=setup.locator('[data-draft=tap_view]');await expect(target).toBeVisible();
 const targets=await target.locator('option').evaluateAll(ns=>ns.map(n=>n.value));
 expect(targets).toContain('media_view');for(const id of ['startup','connecting','updating','hdmi_full','overlay'])expect(targets).not.toContain(id);
 await setup.locator('[data-add-element]').click();await expect(setup.locator('[role=alert]')).toContainText('Zielansicht');
 await target.selectOption('media_view');await setup.locator('[data-element-back]').click();await setup.locator('[data-element-kind=control]').click();
 await expect(target).toHaveValue('media_view');await setup.locator('[data-draft=entity_id]').selectOption('switch.lamp');
 expect(await action.evaluate(n=>n.options.some(o=>o.value==='toggle'))).toBe(true);
 await setup.locator('[data-draft=entity_id]').selectOption('');await chooseSymbol(page,setup,'remote');
 await expect(target).toHaveValue('media_view');await setup.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>studio.item.tap_action)).toEqual({action:'show_view',entity_id:'',view:'media_view'});
 const id=await page.evaluate(()=>studio.item.id),view=await page.evaluate(()=>studio.viewId);
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));
 await page.getByRole('button',{name:await page.evaluate(id=>studio.config.views.find(v=>v.id===id).name,view)+' bearbeiten',exact:true}).click();await page.evaluate(id=>studio.select(id),id);
 expect(await page.evaluate(()=>studio.item.tap_action)).toEqual({action:'show_view',entity_id:'',view:'media_view'});
 await expect(page.locator('.properties [data-prop=tap_view]')).toHaveValue('media_view');
});

for(const width of [390,1500])test('symbol state colors configure, reset, persist and react to live state '+width,async({page},info)=>{
 const setup=await pickerSetup(page,'control',width);
 await setup.locator('[data-draft=symbol_state_coloring]').check();await expect(setup.locator('.note')).toContainText('Entität');
 await setup.locator('[data-draft=entity_id]').selectOption('switch.lamp');
 expect(await setup.locator('[data-state-color]').evaluateAll(ns=>ns.map(n=>n.dataset.stateColor))).toEqual(['on','off','unknown','unavailable']);
 await setColor(setup.locator('[data-state-color=on]'),'#ff3300');await setColor(setup.locator('[data-state-color=off]'),'#00aaee');
 await setup.locator('[data-draft=tap_action]').selectOption('show_view');await setup.locator('[data-draft=tap_view]').selectOption('media_view');
 await setup.locator('[data-element-back]').click();await setup.locator('[data-element-kind=control]').click();
 expect(await page.evaluate(()=>studio.elementPicker.draft('control').symbol_state_colors)).toEqual({on:'#ff3300',off:'#00aaee'});
 await setup.locator('[data-add-element]').click();const p=page.locator('.properties');
 await p.locator('[data-prop=symbol_button]').check();
 const itemId=await page.evaluate(()=>studio.item.id),viewId=await page.evaluate(()=>studio.viewId);
 const svg=page.locator('.stage [data-layout-id="'+itemId+'"] svg');
 await expect(svg).toHaveCSS('color','rgb(0, 170, 238)');
 await page.evaluate(()=>{hass.states['switch.lamp']={...hass.states['switch.lamp'],state:'on'};studio.hass={...hass,states:{...hass.states}};});
 await expect(svg).toHaveCSS('color','rgb(255, 51, 0)');
 const background=await page.locator('.stage [data-layout-id="'+itemId+'"]').evaluate(n=>getComputedStyle(n._frame||n).backgroundColor);
 await p.locator('[data-prop=symbol_state_coloring]').uncheck();await expect(p.locator('[data-state-color]')).toHaveCount(0);
 expect(await page.evaluate(()=>studio.item.symbol_state_colors.on)).toBe('#ff3300');
 expect(await svg.evaluate(n=>getComputedStyle(n).color)).not.toContain('255, 51, 0');
 await p.locator('[data-prop=symbol_state_coloring]').check();await expect(svg).toHaveCSS('color','rgb(255, 51, 0)');
 await p.locator('[data-state-color-reset=off]').click();expect(await page.evaluate(()=>Object.hasOwn(studio.item.symbol_state_colors,'off'))).toBe(false);
 expect(await page.locator('.stage [data-layout-id="'+itemId+'"]').evaluate(n=>getComputedStyle(n._frame||n).backgroundColor)).toBe(background);
 await p.screenshot({path:info.outputPath('symbol-state-colors.png')});
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.evaluate(()=>studio.switchDisplay(studio.entryId));
 await page.getByRole('button',{name:await page.evaluate(id=>studio.config.views.find(v=>v.id===id).name,viewId)+' bearbeiten',exact:true}).click();await page.evaluate(id=>studio.select(id),itemId);
 expect(await page.evaluate(()=>({enabled:studio.item.symbol_state_coloring,colors:studio.item.symbol_state_colors,tap:studio.item.tap_action}))).toEqual({enabled:true,colors:{on:'#ff3300'},tap:{action:'show_view',entity_id:'',view:'media_view'}});
});

test('symbol state vocabulary includes entity options, HVAC modes, weather and saved custom states',async({page})=>{
 await mount(page);const result=await page.evaluate(()=>{
  const data=[['select.mode','Eco',{options:['Eco','Boost']}],['climate.room','heat',{hvac_modes:['off','heat','cool','auto']}],['weather.garden','sunny',{}],['person.marc','Arbeit',{}]];
  return data.map(([id,state,attributes])=>{hass.states[id]={entity_id:id,state,attributes};return studio.PickerControls.symbolStates(studio,{entity_id:id,symbol_state_colors:{'Eigener Zustand':'#ffffff'}}).map(s=>s.value);});
 });
 expect(result[0]).toEqual(['Eco','Boost','Eigener Zustand','unknown','unavailable']);
 expect(result[1]).toEqual(['off','heat','cool','auto','Eigener Zustand','unknown','unavailable']);
 expect(result[2]).toEqual(expect.arrayContaining(['sunny','rainy','snowy','partlycloudy','lightning-rainy']));
 expect(result[3]).toEqual(['home','not_home','Arbeit','Eigener Zustand','unknown','unavailable']);
});

test('symbol state colors match in Studio and LG renderer with alpha and theme fallback',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 const result=await page.evaluate(()=>{
  studio.insertCard('control');const item=studio.item;
  Object.assign(item,{entity_id:'switch.lamp',tap_action:{action:'none',entity_id:'',view:''},style_override:true,color:'#778899',text_opacity:.5,symbol_state_coloring:true,symbol_state_colors:{on:'#ff440080',off:'#112233',unavailable:'#ffffff00'}});
  const rows=[];for(const preview of [true,false]){
   const root=document.createElement('div');root.style.cssText='position:relative;width:1024px;height:600px';document.body.append(root);
   const renderer=new LGLayoutRenderer(root,null,preview),scene={...studio.scene,elements:[item],text_opacity:.5};
   for(const state of ['on','off','unavailable','unknown','on']){renderer.render(scene,{'switch.lamp':{state}},{});rows.push(getComputedStyle(renderer.nodes[item.id]._control).color);}
   item.symbol_state_coloring=false;renderer.render(scene,{'switch.lamp':{state:'on'}},{});rows.push(getComputedStyle(renderer.nodes[item.id]._control).color);item.symbol_state_coloring=true;renderer.clear();root.remove();
  }return rows;
 });
 expect(result).toEqual(Array(2).fill(['rgba(255, 68, 0, 0.125)','rgba(17, 34, 51, 0.25)','rgba(255, 255, 255, 0)','rgba(119, 136, 153, 0.25)','rgba(255, 68, 0, 0.125)','rgba(119, 136, 153, 0.25)']).flat());
});

for(const width of [390,1500])test('automatic symbol action is offered only for a supported matching capability '+width,async({page})=>{
 const setup=await pickerSetup(page,'control',width),auto=setup.locator('[data-draft=tap_action] option[value=auto]');
 await expect(auto).toHaveCount(0);
 await setup.locator('[data-draft=entity_id]').selectOption('sensor.temperature');await expect(auto).toHaveCount(0);
 await expect(setup.locator('[data-draft=tap_action]')).toHaveValue('none');
 await expect(setup.locator('[data-draft=tap_action] option[value=show_view]')).toHaveCount(1);
 await setup.locator('[data-draft=entity_id]').selectOption('switch.lamp');await expect(auto).toHaveCount(0);
 await expect(setup.locator('[data-draft=tap_action]')).toHaveValue('none');
 await chooseSymbol(page,setup,'power');await expect(auto).toHaveCount(1);
 await chooseSymbol(page,setup,'play');await expect(auto).toHaveCount(0);
 await setup.locator('[data-draft=entity_id]').selectOption('media_player.music');await expect(auto).toHaveCount(1);
 await expect(setup.locator('[data-draft=tap_action]')).toHaveValue('auto');
 await chooseSymbol(page,setup,'remote');await expect(auto).toHaveCount(0);await expect(setup.locator('[data-draft=tap_action]')).toHaveValue('none');
 await chooseSymbol(page,setup,'play');await expect(auto).toHaveCount(1);
 await page.evaluate(()=>{hass.states['media_player.music'].attributes.supported_features=32;studio.elementPicker.configure('control',false);});
 await expect(auto).toHaveCount(0);await expect(setup.locator('[data-draft=tap_action]')).toHaveValue('none');
 // Capability loss after opening the popup is rechecked when committing it.
 await setup.locator('[data-add-element]').click();expect(await page.evaluate(()=>studio.item.tap_action.action)).toBe('none');
 await expect(page.locator('.properties [data-prop=tap_auto]')).toHaveCount(0);
 await chooseSymbol(page,page.locator('.properties'),'next');await expect(page.locator('.properties [data-prop=tap_auto]')).toBeChecked();
 await expect(page.locator('.properties [data-prop=tap_action]')).toHaveValue('media_next_track');
});

test('automatic action checks missing feature masks and routed AV capabilities',async({page})=>{
 await mount(page);const results=await page.evaluate(()=>{
  const cases=[
   ['media_player.test','play',{},null,'none'],
   ['media_player.test','play',{supported_features:0},null,'none'],
   ['media_player.test','play',{supported_features:32},null,'none'],
   ['media_player.test','play',{supported_features:16385},null,'media_play_pause'],
   ['media_player.test','next',{supported_features:32},null,'media_next_track'],
   ['media_player.test','play',{supported_features:16385},{av_routed:true,av_available_actions:[]},'none'],
   ['media_player.test','play',{}, {av_routed:true,av_available_actions:['av_play_pause']},'av_play_pause'],
   ['media_player.test','home',{}, {av_routed:true,av_available_actions:['av_play_pause']},'none'],
   ['cover.test','up',{supported_features:2},null,'none'],
   ['cover.test','up',{supported_features:1},null,'open_cover'],
   ['switch.test','power',{},null,'toggle'],
   ['sensor.test','play',{},null,'none'],
  ];
  return cases.map(([entity_id,control_icon,attributes,backend,expected])=>{
   hass.states[entity_id]={entity_id,state:'on',attributes};studio.backendValues={[entity_id]:backend};
   return {actual:studio.suggestedAction({kind:'control',control_type:'icon',control_icon,entity_id}),expected};
  }).concat({actual:studio.suggestedAction({kind:'control',control_type:'icon',control_icon:'power',entity_id:'switch.missing'}),expected:'none'});
 });for(const row of results)expect(row.actual).toBe(row.expected);
});

test('all supported automatic action meanings stay within their matching entity capability',async({page})=>{
 await mount(page);
 const cases=[
  ['power','switch',0,'toggle'],['mdi:toggle-switch','input_boolean',0,'toggle'],['mdi:led-outline','switch',0,'toggle'],['mdi:lightbulb','light',0,'toggle'],
  ['mdi:power-on','climate',256,'turn_on'],['mdi:power-off','climate',128,'turn_off'],
  ['check','button',0,'press'],['mdi:gesture-tap','input_button',0,'press'],
  ['play','scene',0,'activate'],['mdi:play-circle-outline','script',0,'activate'],
  ['play','media_player',16385,'media_play_pause'],['play','media_player',16384,'media_play'],['pause','media_player',1,'media_pause'],
  ['mdi:stop-circle','media_player',4096,'media_stop'],['previous','media_player',16,'media_previous_track'],['next','media_player',32,'media_next_track'],
  ['mdi:volume-plus','media_player',1024,'volume_up'],['mdi:volume-minus','media_player',1024,'volume_down'],['volume','media_player',8,'media_mute'],
  ['up','cover',1,'open_cover'],['down','cover',2,'close_cover'],['pause','cover',8,'stop_cover'],
  ['mdi:blinds-horizontal','cover',16,'open_cover_tilt'],['mdi:blinds-horizontal-closed','cover',32,'close_cover_tilt'],['mdi:stop','cover',64,'stop_cover_tilt'],
  ['play','switch',0,'none'],['play','light',0,'none'],['play','climate',384,'none'],['play','fan',48,'none'],['play','button',0,'none'],['play','input_button',0,'none'],
  ['pause','scene',0,'none'],['pause','script',0,'none'],['remote','button',0,'none'],['remote_siri','switch',0,'none'],['home','light',0,'none'],
  ['next','switch',0,'none'],['next','media_player',16,'none'],['play','media_player',1,'none'],['pause','media_player',16384,'none'],['mdi:play-pause','media_player',16384,'none'],
  ['power','media_player',128,'none'],['mdi:power-on','media_player',128,'turn_on'],['power','climate',384,'none'],
  ['mdi:google-play','media_player',0x7fffffff,'none'],['mdi:bus-stop','media_player',0x7fffffff,'none'],['mdi:timer-play','switch',0,'none'],
 ];
 const result=await page.evaluate(cases=>cases.map(([symbol,domain,features,expected])=>{
  const entity=domain+'.test';hass.states[entity]={entity_id:entity,state:'on',attributes:{supported_features:features}};studio.backendValues={};
  return {symbol,domain,expected,actual:studio.suggestedAction({kind:'control',control_type:'icon',control_icon:symbol,entity_id:entity})};
 }),cases);
 for(const row of result)expect(row.actual,JSON.stringify(row)).toBe(row.expected);
 // Every generic action from the shared schema has a positive representative.
 const actions=await page.evaluate(()=>Object.keys(LGEntityActions));expect([...new Set(cases.map(c=>c[3]))]).toEqual(expect.arrayContaining(actions));
});

test('every built-in and HA catalog symbol rejects unsupported domains and feature masks',async({page})=>{
 await mount(page);
 const icons=Object.keys(JSON.parse(fs.readFileSync('custom_components/display_studio/www/symbols/index.json','utf8')).icons);
 const result=await page.evaluate(icons=>{
  const keys=[...Object.keys(LGControlSymbols),...icons],failures=[];let checks=0;
  for(const symbol of keys)for(const domain of ['switch','light','input_boolean','fan','climate','media_player','cover','scene','script','button','input_button','sensor','binary_sensor','weather','camera','remote','lock']){
   const id=domain+'.test';
   for(const features of [undefined,0,0x7fffffff]){
    hass.states[id]={entity_id:id,state:'on',attributes:{supported_features:features}};studio.backendValues={};
    const action=studio.suggestedAction({kind:'control',control_type:'icon',control_icon:symbol,entity_id:id});checks++;
    if(action==='none')continue;
    const spec=LGEntityActions[action],mask=spec?.features?.[domain]||0;
    if(!spec?.domains.includes(domain)||(mask&&((features||0)&mask)!==mask))failures.push({symbol,domain,features,action});
    if(['play','pause','previous','next','volume','mute','mdi:play','mdi:pause','mdi:play-pause','mdi:skip-next','mdi:stop'].includes(symbol)&&['switch','light','input_boolean','fan','climate','button','input_button'].includes(domain))failures.push({symbol,domain,action,wrongMeaning:true});
   }
  }
  return {symbols:keys.length,checks,failures:failures.slice(0,20)};
 },icons);
 expect(result.symbols).toBe(icons.length+16);expect(result.checks).toBe(result.symbols*17*3);expect(result.failures).toEqual([]);
 console.log('Symbol capability matrix:',result.symbols,'symbols,',result.checks,'checks');
});

test('all built-in AV symbol suggestions require the exact advertised routed action',async({page})=>{
 await mount(page);
 const cases={play:'av_play_pause',pause:'av_play_pause',previous:'av_previous',next:'av_next',power:'av_power',volume:'av_mute',mute:'av_mute',up:'av_remote_up',down:'av_remote_down',left:'av_remote_left',right:'av_remote_right',home:'av_remote_home',back:'av_remote_menu',check:'av_remote_select',remote:'none',remote_siri:'none','mdi:volume-plus':'av_volume_up','mdi:volume-minus':'av_volume_down'};
 const result=await page.evaluate(cases=>{
  const id='media_player.test';hass.states[id]={entity_id:id,state:'on',attributes:{supported_features:0x7fffffff}};
  const rows=[];for(const [symbol,action] of Object.entries(cases))for(const available of [[],['av_volume_set','av_select_source'],[action]]){
   studio.backendValues={[id]:{av_routed:true,av_available_actions:available}};
   rows.push({symbol,available,expected:available.includes(action)?action:'none',actual:studio.suggestedAction({kind:'control',control_type:'icon',control_icon:symbol,entity_id:id})});
  }return rows;
 },cases);
 for(const row of result)expect(row.actual,JSON.stringify(row)).toBe(row.expected);
});

for(const width of [390,1500])test('media picker selects only supported controls and preserves choices at '+width,async({page},info)=>{
 const dialog=await pickerSetup(page,'media',width),control=key=>dialog.locator('[data-media-control="'+key+'"]');
 await expect(dialog.locator('[data-media-control]')).toHaveCount(11);
 await expect(control('play_pause')).toBeDisabled();await expect(control('play_pause')).not.toBeChecked();
 await expect(control('remote')).toBeDisabled();
 await dialog.locator('[data-draft=entity_id]').selectOption('media_player.music');
 const supported=['previous','play_pause','next','volume_down','volume_up','mute'];
 for(const key of await dialog.locator('[data-media-control]').evaluateAll(ns=>ns.map(n=>n.dataset.mediaControl))){
  if(supported.includes(key)){await expect(control(key)).toBeEnabled();await expect(control(key)).toBeChecked();}
  else{await expect(control(key)).toBeDisabled();await expect(control(key)).not.toBeChecked();}
 }
 await control('next').uncheck();
 const target=await dialog.locator('[data-draft=media_remote_view] option').evaluateAll(ns=>ns.find(n=>n.value).value);
 await dialog.locator('[data-draft=media_remote_view]').selectOption(target);await expect(control('remote')).toBeEnabled();await expect(control('remote')).toBeChecked();await control('remote').uncheck();
 await dialog.locator('[data-draft=media_controls]').uncheck();await expect(dialog.locator('[data-media-control]')).toHaveCount(0);await expect(dialog.locator('[data-draft=media_remote_view]')).toHaveCount(0);
 await dialog.locator('[data-draft=media_controls]').check();await expect(control('next')).not.toBeChecked();await expect(control('remote')).not.toBeChecked();
 // Entity changes recalculate abilities without forgetting deliberate deselections.
 await dialog.locator('[data-draft=entity_id]').selectOption('');await expect(control('mute')).toBeDisabled();
 await dialog.locator('[data-draft=entity_id]').selectOption('media_player.music');await expect(control('mute')).toBeChecked();await expect(control('next')).not.toBeChecked();
 await dialog.locator('[data-element-back]').click();await dialog.locator('[data-element-kind=media]').click();await expect(control('next')).not.toBeChecked();
 const expected=supported.filter(k=>k!=='next');
 expect(await page.evaluate(()=>LGExpandMedia({elements:[studio.elementPicker.draft('media')]},studio.values([studio.elementPicker.draft('media')])).elements.slice(1).map(c=>c.id.split('/media/')[1]))).toEqual(expected);
 await dialog.screenshot({path:info.outputPath('media-control-selection.png')});
 await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>LGExpandMedia({elements:[studio.item]},studio.values([studio.item])).elements.slice(1).map(c=>c.id.split('/media/')[1]))).toEqual(expected);
 expect(await page.evaluate(()=>studio.currentSize(studio.item))).toBe('grid');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();
 expect(await page.evaluate(()=>saved.views.find(v=>v.id===studio.viewId).scene.elements[0].media_controls_hidden)).toEqual(['next','remote']);
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='media_player'))).toEqual([]);
});

test('media picker supports seek source slider remote and sidebar size; inspector uses identical capabilities',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{hass.states['media_player.full']={entity_id:'media_player.full',state:'paused',attributes:{friendly_name:'Vollständig',supported_features:16384|1|2|4|8|16|32|2048,media_position:10,media_duration:200,volume_level:.5,source_list:['TV','Musik']}};});
 await page.locator('[data-action=add]').click();await page.locator('[data-element-kind=media]').click();const dialog=page.locator('.element-picker');
 await dialog.locator('[data-draft=entity_id]').selectOption('media_player.full');
 await expect(dialog.locator('[data-media-control]:enabled')).toHaveCount(10);
 const target=await dialog.locator('[data-draft=media_remote_view] option').evaluateAll(ns=>ns.find(n=>n.value).value);await dialog.locator('[data-draft=media_remote_view]').selectOption(target);
 await expect(dialog.locator('[data-media-control]:enabled')).toHaveCount(11);
 await dialog.locator('[data-draft=size]').selectOption('custom');await dialog.locator('[data-draft=width]').fill('70');await dialog.locator('[data-draft=height]').fill('60');
 await dialog.locator('[data-media-control=volume_set]').uncheck();await dialog.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>[studio.item.width,studio.item.height,studio.currentSize(studio.item)])).toEqual([70,60,'custom']);
 await expect(page.locator('[data-media-control]:enabled')).toHaveCount(11);await expect(page.locator('[data-media-control=volume_set]')).not.toBeChecked();
 await page.locator('[data-media-control=volume_set]').check();await expect(page.locator('[data-media-control=volume_set]')).toBeChecked();
 // A routed AV player must use its actual routed capabilities, not direct flags.
 await page.evaluate(()=>{studio.backendValues={'media_player.full':{av_routed:true,av_available_actions:['av_mute','av_volume_set']}};});
 await page.locator('[data-prop=media_av_auto]').check();await expect(page.locator('[data-media-control]:enabled')).toHaveCount(3);
 await expect(page.locator('[data-media-control=play_pause]')).toBeDisabled();await expect(page.locator('[data-media-control=volume_set]')).toBeEnabled();
 await page.evaluate(()=>{studio.backendValues['media_player.full'].av_remote_state='off';studio.refreshMediaControls();studio.paint();});
 await expect(page.locator('[data-media-control=remote]')).toBeDisabled();
 await expect(page.locator('[data-media-control=remote]').locator('..')).toHaveAttribute('title','Apple TV ist ausgeschaltet oder nicht erreichbar');
 await page.evaluate(()=>{studio.backendValues['media_player.full'].av_remote_state='playing';studio.refreshMediaControls();studio.paint();});
 await expect(page.locator('[data-media-control=remote]')).toBeEnabled();
 await expect(page.locator('[data-media-control=remote]')).toBeChecked();
 await page.locator('[data-prop=media_remote_view]').selectOption('');await expect(page.locator('[data-media-control=remote]')).toBeDisabled();
});

test('media capability checks match feature and attribute requirements for every control',async({page})=>{
 await mount(page);
 const result=await page.evaluate(()=>{
  const get=(state,features,extra={})=>studio.PickerControls.playerControls({entity_id:'media_player.test',state,attributes:{supported_features:features,...extra}});
  const all=1|2|4|8|16|32|2048|16384,attrs={media_position:0,media_duration:120,volume_level:0,source_list:['TV']};
  return {
   full:get('playing',all,attrs),playingPlayOnly:get('playing',16384),pausedPauseOnly:get('paused',1),
   step:get('idle',1024),setMissingLevel:get('idle',4),idleSeek:get('idle',2,attrs),
   unavailable:get('unavailable',all,attrs),unknown:get('unknown',all,attrs),
   invalid:[null,-1,true,'12',NaN,Infinity].map(v=>get('playing',2,{...attrs,media_position:v}).actions),
   invalidDuration:[0,-1,true,'12',NaN,Infinity].map(v=>get('paused',2,{...attrs,media_duration:v}).actions),
   badSources:get('idle',2048,{source_list:['',null,'bad\nsource','x'.repeat(181)]}),
   sourceLimit:get('idle',2048,{source_list:[...Array(64).fill(null),'TV']}),
   buffering:get('buffering',2,attrs),readonly:studio.PickerControls.playerControls({entity_id:'sensor.test',state:'on',attributes:{supported_features:all}})
  };
 });
 expect(result.full.actions).toEqual(['player_play_pause','player_previous','player_next','player_seek_back','player_seek_forward','player_volume_down','player_volume_up','player_volume_set','player_mute','player_select_source']);
 expect(result.full.sources).toEqual([{value:'TV',label:'TV'}]);
 expect(result.step.actions).toEqual(['player_volume_down','player_volume_up']);expect(result.setMissingLevel.actions).toEqual(['player_volume_set']);expect(result.buffering.actions).toEqual(['player_seek_back','player_seek_forward']);
 for(const key of ['playingPlayOnly','pausedPauseOnly','idleSeek','unavailable','unknown','badSources','sourceLimit','readonly'])expect(result[key].actions,key).toEqual([]);
 for(const actions of [...result.invalid,...result.invalidDuration])expect(actions).toEqual([]);
});


test('open media draft follows changing HA capabilities without losing explicit preferences',async({page})=>{
 const dialog=await pickerSetup(page,'media');await dialog.locator('[data-draft=entity_id]').selectOption('media_player.music');
 const control=key=>dialog.locator('[data-media-control="'+key+'"]');await control('next').uncheck();
 await page.evaluate(()=>{studio.hass={...hass,states:{...hass.states,'media_player.music':{...hass.states['media_player.music'],state:'unavailable'}}};});
 await expect(control('mute')).toBeDisabled();await expect(control('mute')).not.toBeChecked();
 await page.evaluate(()=>{studio.hass={...hass,states:{...hass.states,'media_player.music':{...hass.states['media_player.music'],attributes:{...hass.states['media_player.music'].attributes,supported_features:2048|16384|32,source_list:['Music']}}}};});
 await expect(control('select_source')).toBeEnabled();await expect(control('select_source')).toBeChecked();await expect(control('mute')).toBeDisabled();await expect(control('next')).not.toBeChecked();
});


test('routed artwork hashes are accepted and an app change invalidates the previous cover',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{
  const id='media_player.av';hass.states[id]={entity_id:id,state:'playing',attributes:{entity_picture:'/api/media_player_proxy/av',app_name:'Netflix'}};
  studio.backendValues={[id]:{av_routed:true,artwork:'first-server-hash'}};
  window.artworkRequests=[];hass.fetchWithAuth=async(url)=>{artworkRequests.push(url);return {ok:true,status:200,blob:async()=>new Blob(['picture'],{type:'image/jpeg'})};};
  studio.mediaUrl(id,'first-server-hash');
 });
 await expect.poll(()=>page.evaluate(()=>studio.coverUrls['media_player.av/640']?.key)).toBe('first-server-hash');
 expect(await page.evaluate(()=>studio.coverUrls['media_player.av/640'].url)).toMatch(/^blob:/);
 await page.evaluate(()=>{studio.backendValues['media_player.av'].artwork='second-server-hash';studio.mediaUrl('media_player.av','second-server-hash');});
 await expect.poll(()=>page.evaluate(()=>studio.coverUrls['media_player.av/640']?.key)).toBe('second-server-hash');
 expect(await page.evaluate(()=>artworkRequests.length)).toBe(2);
});

test('design library edits an existing widget and cancels back without saving layout content',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mount(page,1500,{devicesHome:true});
 await page.evaluate(()=>{const api=hass.callApi;hass.callApi=async(method,url,data)=>{const result=await api(method,url,data);return method==='GET'&&url.startsWith('display_studio/layout_library/')?{...result,rendering:{width:480,height:480}}:result;};});
 await page.locator('[data-open-widgets]').click();
 const card=page.locator('.design-card').filter({has:page.getByRole('heading',{name:'Dein Wetter',exact:true})}).first();
 await card.waitFor();await expect(card.locator('.design-preview .lg-weather')).toBeVisible();
 await expect.poll(()=>card.locator('.design-preview-scene').evaluate(el=>parseFloat(el.style.width)/parseFloat(el.style.height))).toBeCloseTo(1,5);
 await page.setViewportSize({width:390,height:900});await card.scrollIntoViewIfNeeded();
 await expect.poll(async()=>card.locator('.design-preview-crop').evaluate(el=>{const child=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect();return child.left>=parent.left&&child.right<=parent.right&&child.top>=parent.top&&child.bottom<=parent.bottom;})).toBe(true);
 await page.setViewportSize({width:1500,height:1100});await card.scrollIntoViewIfNeeded();await expect(card.locator('.design-preview .lg-weather')).toBeVisible();
 await page.screenshot({path:path.resolve('test-results/previews/widget-library-'+info.project.name+'.png'),fullPage:true});
 await card.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Widget bearbeiten',exact:true})).toBeVisible();
 await page.locator('.widget-dialog [data-cancel]').click();
 await expect(page.getByRole('heading',{name:'Widgeteditor',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'))).toEqual([]);
 expect(errors).toEqual([]);
});

test('design library save failure retains template draft and permits retry',async({page})=>{
 await mount(page,390,{devicesHome:true});await page.locator('[data-open-widgets]').click();
 await page.locator('[data-design-new]').click();await page.locator('[data-element-kind=clock]').click();
 await page.locator('#view-name').fill('Uhr zum Wiederverwenden');await page.locator('#view-name').dispatchEvent('change');
 await page.evaluate(()=>{const api=hass.callApi;window.retryWidgetApi=api;hass.callApi=(method,path,data)=>method==='POST'&&path==='display_studio/widget_library'?Promise.reject({status_code:409}):api(method,path,data);});
 await page.locator('[data-action=finish-edit]').click();
 await expect(page.locator('#view-name')).toHaveValue('Uhr zum Wiederverwenden');
 await expect(page.locator('.flash')).toContainText('inzwischen geändert');
 expect(await page.evaluate(()=>studio.dirty)).toBe(true);
 await page.evaluate(()=>hass.callApi=retryWidgetApi);
 await page.locator('[data-action=finish-edit]').click();
 await expect(page.getByRole('heading',{name:'Uhr zum Wiederverwenden',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>calls.filter(c=>c[0]==='POST'&&c[1].startsWith('display_studio/layout_library/')))).toEqual([]);
});

test('design library shared widget preserves design while instance parameters are changed',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(async()=>{
  hass.states['media_player.sonos']={entity_id:'media_player.sonos',state:'playing',attributes:{friendly_name:'Sonos',supported_features:152461,volume_level:.3}};
  const item=studio.gridDraft('media',null);item.parts={title:{font_size:9}};item.media_controls=true;
  widgetLibrary={widgets:[{id:'widget_media',name:'Meine Medien',item}],revision:1,usage:{}};
  await studio.showElementPicker();
 });
 await page.locator('[data-element-template=widget_media]').click();await page.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>studio.item.parts)).toEqual({title:{font_size:9}});
 await expect(page.locator('.properties [data-prop=font_size]')).toHaveCount(0);
 await page.locator('.properties [data-widget-edit]').click();
 await expect(page.locator('.element-picker')).toBeVisible();await expect(page.locator('.widget-dialog')).toHaveCount(0);
 await page.locator('[data-draft=entity_id]').selectOption('media_player.sonos');
 await page.locator('[data-draft=media_controls]').uncheck();await page.locator('[data-add-element]').click();
 expect(await page.evaluate(()=>({entity:studio.item.entity_id,controls:studio.item.media_controls,parts:studio.item.parts}))).toEqual({entity:'media_player.sonos',controls:false,parts:{title:{font_size:9}}});
 const oldCount=await page.evaluate(()=>studio.scene.elements.length);await page.locator('.properties [data-remove]').click();
 expect(await page.evaluate(()=>studio.scene.elements.length)).toBe(oldCount-1);await expect(page.locator('display-studio')).toBeVisible();
});


test('widget repaint retains the focused text handle and keyboard editing',async({page})=>{
 await mount(page);await openView(page,'Dashboard');
 await page.evaluate(()=>{const item=studio.scene.elements.find(i=>i.kind==='weather');Object.assign(item,{manual_size:true,width:65,height:65,style_override:true});studio.select(item.id);studio.paint();studio.editContentsForTest(item.id);});
 const editor=page.getByRole('dialog',{name:'Widget bearbeiten',exact:true});
 await editor.locator('[data-part]').selectOption('label');
 const handle=editor.locator('.part-outline');await expect(handle).toBeVisible();await handle.focus();
 const before=await page.evaluate(()=>{const w=studio.widgetEditor;w.paint();return w.inkBox().x;});
 await expect(handle).toBeFocused();await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>studio.widgetEditor.inkBox().x)).toBeGreaterThan(before);
});
