const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const cases=require('../fixtures/weather-metrics.json');
async function mount(page,fixture){
 await page.setViewportSize({width:1024,height:600});
 await page.setContent('<body style="margin:0"><div id="root" style="position:absolute;inset:0"></div></body>');
 const root=path.resolve('custom_components/display_studio/www/runtime');
 await page.addStyleTag({path:path.join(root,'layout.css')});
 for(const name of ['weather.js','cards.js','layout.js'])await page.addScriptTag({path:path.join(root,name)});
 const regular=fs.readFileSync(path.resolve('custom_components/display_studio/fonts/Roboto.ttf')).toString('base64');
 const bold=fs.readFileSync(path.resolve('custom_components/display_studio/fonts/Roboto-Semibold.ttf')).toString('base64');
 await page.evaluate(async({fixture,regular,bold})=>{
  for(const [weight,data] of [[400,regular],[600,bold]]){const font=new FontFace('StudioNative','url(data:font/ttf;base64,'+data+')',{weight:String(weight)});await font.load();document.fonts.add(font);}
  window.scene=fixture.scene;window.data=fixture.data;
  window.renderer=new LGLayoutRenderer(document.getElementById('root'),null,false);
  window.paint=()=>renderer.render(scene,{'weather.test':data},{nativeFonts:true,nativeHeight:600,now:new Date('2026-10-27T12:00:00Z'),sun:{is_daytime:true}});paint();
 },{fixture,regular,bold});
}
for(const fixture of cases)test('weather badge parity '+fixture.name,async({page},testInfo)=>{
 await mount(page,fixture);
 const bounds=await page.evaluate(()=>{const node=renderer.nodes.weather,outer=node.getBoundingClientRect(),result={};
  for(const badge of node._metrics.children){const key=badge.dataset.metric;for(const [suffix,el] of [['badge',badge],['icon',badge.querySelector('svg')],['value',badge.querySelector('strong')],['label',badge.querySelector('small')]]){const r=el.getBoundingClientRect();result[key+'_'+suffix]={x:r.x-outer.x,y:r.y-outer.y,width:suffix==='value'?el.parentElement.getBoundingClientRect().width:r.width,height:r.height};}}
  return result;
 });
 const widget=fixture.native.widgets.find(w=>w.id==='dashboard/weather');
 for(const part of widget.parts.filter(p=>/^(wind|uv)_/.test(p.id))){
  for(const axis of ['x','y','width','height'])expect(Math.abs(bounds[part.id][axis]-part[axis]),part.id+' '+axis+' '+JSON.stringify(bounds[part.id])).toBeLessThanOrEqual(4);
 }
 await page.locator('.lg-weather').screenshot({path:path.resolve('test-results/weather-badges-'+fixture.name+'-'+testInfo.project.name+'.png')});
});
test('weather badges accept zero, reject missing values and update without replacing their nodes',async({page})=>{
 await mount(page,cases[0]);
 await page.evaluate(()=>{window.badges=renderer.nodes.weather._metrics;data.wind_speed='0.000';data.uv_index='0.0';paint();});
 await expect(page.locator('[data-metric=wind] strong')).toHaveText('0 km/h');await expect(page.locator('[data-metric=uv] strong')).toHaveText('0');
 for(const value of [null,'',' ',false,'NaN','unavailable']){
  await page.evaluate(value=>{data.wind_speed=value;data.uv_index=value;paint();},value);
  await expect(page.locator('[data-metric=wind]')).toBeHidden();await expect(page.locator('[data-metric=uv]')).toBeHidden();
 }
 await page.evaluate(()=>{delete data.wind_speed;data.uv_index='6';paint();});
 await expect(page.locator('[data-metric=uv] strong')).toHaveText('6');await expect(page.locator('[data-metric=uv]')).toBeVisible();
 expect(await page.evaluate(()=>badges===renderer.nodes.weather._metrics)).toBe(true);
 await page.evaluate(()=>{data.state='unavailable';paint();});await expect(page.locator('.lg-weather-metrics')).toBeHidden();
});
