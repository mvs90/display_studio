const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const assets=path.resolve('custom_components/display_studio/www/runtime');
const catalog=require('../fixtures/studio-catalog.json');

// The Signage webOS browser rejects the newer inset CSS shorthand.
// Strip it at the CSS parser boundary while keeping ordinary positioning intact.
test('legacy LG browser displays dashboard cards in a full-size viewport',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1920,height:1080});
 await page.setContent('<div id="root" style="position:absolute;top:0;left:0;right:0;bottom:0"></div>');
 await page.evaluate(()=>{
   const descriptor=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'cssText');
   Object.defineProperty(CSSStyleDeclaration.prototype,'cssText',{...descriptor,set(value){descriptor.set.call(this,value.replace(/\binset\s*:[^;]*(;|$)/g,''));}});
 });
 await page.addStyleTag({path:path.join(assets,'layout.css')});
 for(const name of ['weather.js','cards.js','layout.js'])await page.addScriptTag({path:path.join(assets,name)});
 const scene=JSON.parse(JSON.stringify(catalog.presets[0].layout.scenes.dashboard));
 await page.evaluate(scene=>{
   window.renderer=new window.LGLayoutRenderer(document.getElementById('root'),null,false);
   window.renderer.render(scene,{}, {timezone:'Europe/Berlin',now:new Date(),sun:{elevation:25,azimuth:140}});
 },scene);
 await expect(page.locator('.lg-clock')).toBeVisible();
 const dimensions=await page.locator('.lg-scroll-viewport').boundingBox();
 expect(dimensions.width).toBe(1920);expect(dimensions.height).toBe(1080);
 expect((await page.locator('.lg-clock').boundingBox()).width).toBeGreaterThan(100);
 expect(errors).toEqual([]);
});
