const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const catalog=require('../fixtures/studio-catalog.json');
async function mount(page){
 await page.setViewportSize({width:1920,height:1080});
 await page.setContent('<body style="margin:0"><div id="sky" style="width:100vw;height:100vh"></div></body>');
 const base=path.resolve('custom_components/display_studio/www/runtime');
 await page.addStyleTag({content:fs.readFileSync(path.join(base,'layout.css'),'utf8').replace(/\binset:\s*0\s*;?/g,'')});
 for(const name of ['weather.js','cards.js','layout.js'])await page.addScriptTag({content:fs.readFileSync(path.join(base,name),'utf8')});
 await page.evaluate(scene=>{
  window.scene=scene;Object.assign(scene,{background:'weather',weather_entity:'weather.home',weather_animate:true,glass:true});
  scene.elements=scene.elements.filter(item=>['clock','weather'].includes(item.kind));
  const clock=scene.elements.find(item=>item.kind==='clock'),weather=scene.elements.find(item=>item.kind==='weather');
  Object.assign(clock,{x:4,y:15,width:56,height:65,font_size:18,show_label:false});
  Object.assign(weather,{x:66,y:57,width:29,height:35,forecast_type:'current',label:'Berlin',weather_style:'glass'});
  for(const item of scene.elements)if(item.kind==='weather')item.entity_id='weather.home';
  window.data={'weather.home':{state:'rainy',temperature:'13',temperature_unit:'°C',wind_speed:'14',wind_speed_unit:'km/h',uv_index:'1',cloud_coverage:'96',wind_bearing:'150'}};
  window.sun={is_daytime:true,elevation:30,azimuth:145,moon:{elevation:32,azimuth:85,phase:.48}};
  window.renderer=new LGLayoutRenderer(document.getElementById('sky'),null,false);
  window.paint=()=>renderer.render(scene,data,{sun,now:new Date('2026-10-23T11:47:00Z'),timezone:'Europe/Berlin'});paint();
 },JSON.parse(JSON.stringify(catalog.presets[0].layout.scenes.dashboard)));
}
test('weather changes sky, full-screen precipitation, sun and moon without rebuilding widgets',async({page})=>{
 await mount(page);
 await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind','rain');
 await expect(page.locator('.lg-sky-drop')).toHaveCount(64);
 await expect(page.locator('#sky')).toHaveClass(/lg-glass/);
 expect(await page.locator('#sky').evaluate(node=>node.style.background)).toContain('169, 186, 201');
 await expect(page.locator('.lg-weather-metrics')).toContainText('14 km/h');
 await page.evaluate(()=>{window.firstWidget=renderer.nodes[scene.elements[0].id];window.firstSky=renderer.sky;for(let i=0;i<50;i++)paint();});
 expect(await page.evaluate(()=>renderer.sky===firstSky&&renderer.nodes[scene.elements[0].id]===firstWidget)).toBe(true);
 await expect(page.locator('.lg-weather-sky')).toHaveCount(1);await expect(page.locator('.lg-sky-drop')).toHaveCount(64);
 await page.screenshot({path:'test-results/weather-glass-rain-'+test.info().project.name+'.png'});
 for(const [state,kind,count] of [['hail','hail',48],['snowy','snow',40],['snowy-rainy','sleet',64],['fog','none',0]]){
  await page.evaluate(state=>{data['weather.home'].state=state;paint();},state);
  await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind',kind);await expect(page.locator('.lg-sky-drop')).toHaveCount(count);
 }
 await expect(page.locator('.lg-sky-fog')).toHaveCSS('opacity','0.85');
 const fogBox=await page.locator('.lg-sky-fog').boundingBox();expect(fogBox.width).toBeCloseTo(1920,1);expect(fogBox.height).toBeCloseTo(1080,1);
 await page.evaluate(()=>{data['weather.home'].state='sunny';data['weather.home'].cloud_coverage='8';paint();});
 await expect(page.locator('.lg-sky-sun')).toBeVisible();expect(await page.locator('.lg-sky-sun').evaluate(node=>parseFloat(node.style.left))).toBeCloseTo(40.278,2);
 const day=await page.locator('#sky').evaluate(node=>node.style.background);
 await page.evaluate(()=>{sun.is_daytime=false;sun.elevation=-25;data['weather.home'].state='clear-night';paint();});
 await expect(page.locator('.lg-sky-moon')).toBeVisible();await expect(page.locator('.lg-sky-sun')).toBeHidden();
 expect(await page.locator('#sky').evaluate(node=>node.style.background)).not.toBe(day);
 await page.waitForTimeout(3100);await page.screenshot({path:'test-results/weather-glass-night-'+test.info().project.name+'.png'});
 await page.evaluate(()=>{sun.moon.elevation=-20;paint();});await expect(page.locator('.lg-sky-moon')).toBeHidden();
 await page.evaluate(()=>{data['weather.home'].state='unavailable';paint();});await expect(page.locator('.lg-sky-drop')).toHaveCount(0);
 await page.evaluate(()=>{renderer.clear();});await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);
});
test('weather motion respects settings, reduced motion and hidden pages; switching theme cleans up',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{scene.weather_animate=false;paint();});await expect(page.locator('.lg-sky-drop').first()).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{scene.weather_animate=true;paint();});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.lg-sky-drop').first()).toHaveCSS('animation-name','none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.lg-sky-drop').first()).toHaveCSS('animation-play-state','paused');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.lg-sky-drop').first()).toHaveCSS('animation-play-state','running');
 await page.evaluate(()=>{scene.background='solid';scene.glass=false;paint();});await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);await expect(page.locator('#sky')).not.toHaveClass(/lg-glass/);
});
