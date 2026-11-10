const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const catalog=require('../fixtures/studio-catalog.json');
test.use({hasTouch:true});
test('real touchscreen taps navigate into a room and back exactly once',async({page})=>{
 const root=path.resolve('custom_components/display_studio/www/runtime');
 const base=structuredClone(catalog.presets[0].layout.scenes.dashboard);
 const template=structuredClone(base.elements[0]);
 const nav=(id,text,view)=>({...template,id,kind:'text',entity_id:'',x:10,y:20,width:80,height:50,text,opacity:.7,card_style:'standard',tap_action:{action:'show_view',entity_id:'',view}});
 const scenes={dashboard:{...base,background:'solid',elements:[nav('room','Wohnzimmer','view_room')]},view_room:{...base,background:'solid',elements:[nav('home','Übersicht','dashboard')]}};
 let view='dashboard',revision=1;const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://touch.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  if(name==='telemetry')return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  if(name==='state'){
   await new Promise(r=>setTimeout(r,100));
   return route.fulfill({contentType:'application/json',body:JSON.stringify({version:'1.6.0',revision,touch_revision:revision,view,message:null,layout:{config:{enabled:true,scenes:{[view]:scenes[view]}},values:{},timezone:'Europe/Berlin',sun:{elevation:25,azimuth:140}}})});
  }
  if(name==='action'){
   const request=route.request().postDataJSON();calls.push(request);expect(request.scene).toBe(view);expect(request.revision).toBe(revision);
   view=view==='dashboard'?'view_room':'dashboard';revision++;
   return route.fulfill({contentType:'application/json',body:'{"duplicate":false}'});
  }
  return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':name.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(name.endsWith('.ttf')?path.join(root,'../../fonts',name):path.join(root,name))});
 });
 await page.setViewportSize({width:1280,height:800});await page.goto('http://touch.test/index.html?performance=economy');
 await expect(page.locator('#studio-scene .lg-text')).toContainText('Wohnzimmer');
 await page.locator('#studio-scene .lg-text').tap();
 await expect(page.locator('#studio-scene .lg-text')).toContainText('Übersicht');
 await page.locator('#studio-scene .lg-text').tap();
 await expect(page.locator('#studio-scene .lg-text')).toContainText('Wohnzimmer');
 expect(calls.map(c=>c.element)).toEqual(['room','home']);expect(errors).toEqual([]);
});
