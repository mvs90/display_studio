const {test,expect}=require('@playwright/test');
const path=require('node:path');
const catalog=require('../fixtures/studio-catalog.json');
async function mount(page,trigger='release'){
 await page.setViewportSize({width:480,height:480});
 await page.setContent('<div id="root" style="position:absolute;inset:0"></div>');
 const root=path.resolve('custom_components/display_studio/www/runtime');
 await page.addStyleTag({path:path.join(root,'layout.css')});
 for(const name of ['weather.js','cards.js','camera.js','layout.js'])await page.addScriptTag({path:path.join(root,name)});
 await page.evaluate(({scene,trigger})=>{
  window.taps=[];window.scene=scene;scene.scroll_height=200;
  const item=JSON.parse(JSON.stringify(scene.elements.find(i=>i.kind==='clock')));
  Object.assign(item,{id:'gesture',kind:'text',x:5,y:5,width:80,height:40,text:'Touch',tap_trigger:trigger,hold_ms:600,
    tap_action:{action:'show_view',view:'media_view'},hold_action:{action:'show_view',view:'dashboard'}});
  scene.elements=[item];window.renderer=new LGLayoutRenderer(document.getElementById('root'),null,false);
  window.repaint=()=>renderer.render(scene,{}, {onTap:item=>taps.push(item.id),now:new Date()});repaint();
 },{scene:catalog.presets[0].layout.scenes.dashboard,trigger});
 await page.clock.install();
}
test('press acts immediately; hold acts once; release does not duplicate; repaint preserves hold',async({page})=>{
 await mount(page,'press');await page.mouse.move(100,100);await page.mouse.down();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture']);
 await page.clock.runFor(400);await page.evaluate(()=>repaint());await page.clock.runFor(250);
 expect(await page.evaluate(()=>taps)).toEqual(['gesture','gesture/hold']);
 await page.clock.runFor(1000);await page.mouse.up();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture','gesture/hold']);
});
test('release, exclusive hold, movement and cancellation',async({page})=>{
 await mount(page);await page.mouse.move(100,100);await page.mouse.down();
 expect(await page.evaluate(()=>taps)).toEqual([]);await page.mouse.up();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture']);
 await page.mouse.down();await page.clock.runFor(650);await page.mouse.up();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture','gesture/hold']);
 await page.mouse.down();await page.mouse.move(130,130);await page.clock.runFor(700);await page.mouse.up();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture','gesture/hold']);
 await page.mouse.down();await page.locator('.lg-text').dispatchEvent('pointercancel',{pointerId:1});await page.clock.runFor(700);await page.mouse.up();
 expect(await page.evaluate(()=>taps)).toEqual(['gesture','gesture/hold']);
});


test('progress highlight contrasts with light and dark fill and reacts to edits',async({page})=>{
 await mount(page);
 for(const [color,ink] of [['#ffffff','0, 0, 0'],['#101010','255, 255, 255'],['#f2f6fa','0, 0, 0']]){
  await page.evaluate(color=>{Object.assign(scene.elements[0],{kind:'animation',animation_type:'progress',style_override:true,color,progress_value:65,progress_source:'fixed',x:5,y:40,width:90,height:6});repaint();},color);
  const shine=page.locator('.lg-animation-shine');await expect(shine).toBeVisible();
  expect(await shine.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(ink);
 }
});
