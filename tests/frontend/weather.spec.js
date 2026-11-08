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
 expect(await page.locator('#sky').evaluate(node=>node.style.background)).toContain('139, 153, 165');
 await expect(page.locator('.lg-weather-metrics')).toContainText('14 km/h');
 await page.evaluate(()=>{window.firstWidget=renderer.nodes[scene.elements[0].id];window.firstSky=renderer.sky;for(let i=0;i<50;i++)paint();});
 expect(await page.evaluate(()=>renderer.sky===firstSky&&renderer.nodes[scene.elements[0].id]===firstWidget)).toBe(true);
 await expect(page.locator('.lg-weather-sky')).toHaveCount(1);await expect(page.locator('.lg-sky-drop')).toHaveCount(64);
 await page.screenshot({path:'test-results/weather-glass-rain-'+test.info().project.name+'.png'});
 for(const [state,kind,count] of [['hail','hail',48],['snowy','snow',48],['snowy-rainy','sleet',64],['fog','none',0]]){
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
 await expect.poll(()=>page.locator('#sky').evaluate(node=>node.style.background)).not.toBe(day);
 await page.waitForTimeout(3100);await page.screenshot({path:'test-results/weather-glass-night-'+test.info().project.name+'.png'});
 await page.evaluate(()=>{sun.moon.elevation=-20;paint();});await expect(page.locator('.lg-sky-moon')).toBeHidden();
 await page.evaluate(()=>{data['weather.home'].state='unavailable';paint();});await expect(page.locator('.lg-sky-drop')).toHaveCount(0);
 await page.evaluate(()=>{renderer.clear();});await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);
});
test('weather motion respects settings, reduced motion and hidden pages; switching theme cleans up',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{scene.weather_animate=false;paint();});await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{scene.weather_animate=true;paint();});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-name','none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-play-state','paused');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-play-state','running');
 await page.evaluate(()=>{scene.background='solid';scene.glass=false;paint();});await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);await expect(page.locator('#sky')).not.toHaveClass(/lg-glass/);
});
test('precipitation stays behind widget surfaces and never covers their content',async({page})=>{
 await mount(page);
 expect(await page.locator('.lg-weather-precipitation').evaluate(node=>node.parentElement.classList.contains('lg-weather-sky'))).toBe(true);
 await page.addStyleTag({content:'.lg-weather{background:#224466!important;opacity:1!important;backdrop-filter:none!important;border-radius:0!important}.lg-weather>*{visibility:hidden!important}.lg-sky-drop{animation:none!important}'});
 const widget=page.locator('.lg-widget.lg-weather');
 await page.locator('.lg-weather-precipitation').evaluate(node=>{node.style.visibility='hidden';});
 const box=await widget.boundingBox();
 // Exclude the translucent theme border and fractional CSS edge pixels.
 const clip={x:Math.ceil(box.x)+2,y:Math.ceil(box.y)+2,width:Math.floor(box.width)-4,height:Math.floor(box.height)-4};
 const before=await page.screenshot({clip});
 // A solid test layer makes even a one-pixel foreground leak observable.
 await page.locator('.lg-weather-precipitation').evaluate(node=>{node.style.visibility='visible';node.style.background='white';});
 const after=await page.screenshot({clip});
 expect(after.equals(before)).toBe(true);
 await page.evaluate(()=>renderer.clear());
 await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);
});
test('glass animations have no frame and the foreground clock stays legible',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{
  const clock=scene.elements.find(item=>item.kind==='clock');
  window.originalClock=clock;
  scene.elements.unshift({...clock,id:'test-bars',kind:'animation',animation_type:'bars',animation_duration:1000,opacity:0,parts:{}});
  paint();
 });
 const bars=page.locator('[data-layout-id="test-bars"]');
 await expect(bars).toHaveCSS('border-top-width','0px');
 await expect(bars).toHaveCSS('box-shadow','none');
 await expect(bars).toHaveCSS('backdrop-filter','none');
 const clock=page.locator('.lg-clock');
 await expect(clock).toHaveCSS('border-top-width','0px');
 expect(await clock.evaluate(n=>Number(n.style.zIndex))).toBeGreaterThan(await bars.evaluate(n=>Number(n.style.zIndex)));
 await expect(clock.locator(':scope > .lg-value')).toHaveCSS('color','rgb(217, 237, 252)');
 expect(await clock.evaluate(n=>getComputedStyle(n).textShadow)).not.toBe('none');
 await page.evaluate(()=>{originalClock.style_override=true;originalClock.color='#eeaa55';paint();});
 await expect(clock.locator(':scope > .lg-value')).toHaveCSS('color','rgb(238, 170, 85)');
 await page.screenshot({path:'test-results/weather-clock-foreground-'+test.info().project.name+'.png'});
});

test('symbols and graphics have no theme surface; explicit styling and buttons retain it',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{
  const base=scene.elements[0];scene.elements=[];
  for(const kind of ['logo','control','animation','spinner','progress'])scene.elements.push({...base,id:'plain-'+kind,kind,x:3+scene.elements.length*18,y:4,width:15,height:18,opacity:.88,radius:24,style_override:false,parts:{},control_type:'icon',control_icon:'play',graphic_id:'esphome',animation_type:'spinner'});
  paint();
 });
 for(const kind of ['logo','control','animation','spinner','progress']){
  const node=page.locator('[data-layout-id="plain-'+kind+'"]');
  await expect(node).toHaveCSS('border-top-width','0px');
  await expect(node).toHaveCSS('box-shadow','none');
  await expect(node).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(node).toHaveCSS('backdrop-filter','none');
 }
 await page.evaluate(()=>{scene.elements[0].style_override=true;paint();});
 await expect(page.locator('[data-layout-id="plain-logo"]')).toHaveCSS('border-top-width','1px');
 expect(await page.locator('[data-layout-id="plain-logo"]').evaluate(n=>getComputedStyle(n).boxShadow)).not.toBe('none');
 await page.evaluate(()=>{scene.elements[1].symbol_button=true;paint();});
 expect(await page.locator('[data-layout-id="plain-control"]').evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('night clouds are distinct, stars subdued and the shared atmosphere is bounded',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{scene.elements=[];sun.is_daytime=false;sun.elevation=-25;data['weather.home'].state='partlycloudy';data['weather.home'].cloud_coverage=48;paint();});
 const look=await page.evaluate(()=>LGWeather.atmosphere(true,.48));
 expect(look.brightness).toBe(.64);expect(look.stars).toBeLessThan(.18);
 expect(look.clouds[0]).toBeGreaterThan(.5);
 await expect(page.locator('.lg-sky-cloud').first()).toHaveCSS('filter','brightness(0.64)');
 expect(await page.locator('.lg-sky-cloud').first().evaluate(node=>Array.from(node.parentElement.children).indexOf(node))).toBeGreaterThan(await page.locator('.lg-sky-stars').evaluate(node=>Array.from(node.parentElement.children).indexOf(node)));
 await page.waitForTimeout(3200);await page.screenshot({path:'test-results/weather-night-clouds-'+test.info().project.name+'.png'});
 await page.evaluate(()=>{data['weather.home'].state='cloudy';data['weather.home'].cloud_coverage=96;paint();});
 expect(await page.locator('.lg-sky-stars').evaluate(node=>Number(node.style.opacity))).toBeLessThan(.002);
 await page.waitForTimeout(3200);await page.screenshot({path:'test-results/weather-night-overcast-'+test.info().project.name+'.png'});
 for(const coverage of [-1,0,.48,.96,1,2]){
  const value=await page.evaluate(c=>LGWeather.atmosphere(true,c),coverage);
  expect(value.clouds.every(v=>v>=0&&v<=1)).toBe(true);expect(value.stars>=0&&value.stars<=.65).toBe(true);
 }
});

test('lightning animates locally behind widgets and respects all stop modes',async({page})=>{
 await page.clock.install();await mount(page);
 await page.evaluate(()=>{sun.is_daytime=false;sun.elevation=-25;data['weather.home'].state='lightning-rainy';paint();});
 await expect(page.locator('.lg-weather-sky')).toHaveAttribute('data-storm','false');
 await page.clock.runFor(241000);
 const bolt=page.locator('.lg-sky-lightning');
 await expect(page.locator('.lg-weather-sky')).toHaveAttribute('data-storm','true');
 await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind','rain');
 await expect(bolt).toHaveCSS('display','block');await expect(bolt).toHaveCSS('animation-duration','12s');
 const skyBox=await page.locator('.lg-weather-sky').boundingBox(),boltBox=await bolt.boundingBox();
 expect(boltBox.width/skyBox.width).toBeCloseTo(.64,2);expect(boltBox.height/skyBox.height).toBeCloseTo(.85,2);
 expect(await page.evaluate(()=>LGWeather.effects.strokes[2][0]*LGWeather.effects.viewport[2]/100)).toBeGreaterThan(.2);
 await bolt.evaluate(node=>{const a=node.getAnimations()[0];a.pause();a.currentTime=6250;});
 expect(Number(await bolt.evaluate(n=>getComputedStyle(n).opacity))).toBeCloseTo(1,3);
 await bolt.evaluate(node=>{const a=node.getAnimations()[0];a.pause();a.currentTime=6080;});
 expect(Number(await bolt.evaluate(n=>getComputedStyle(n).opacity))).toBeCloseTo(1,3);
 await page.waitForTimeout(3200);await page.screenshot({path:'test-results/weather-lightning-'+test.info().project.name+'.png'});
 await page.evaluate(()=>{sun.is_daytime=true;sun.elevation=30;paint();});
 await page.waitForTimeout(3200);await page.screenshot({path:'test-results/weather-lightning-day-'+test.info().project.name+'.png'});
 // A completely opaque foreground widget cannot be brightened by lightning.
 await page.addStyleTag({content:'.lg-weather{background:#224466!important;opacity:1!important;backdrop-filter:none!important;border-radius:0!important}.lg-weather>*{visibility:hidden!important}'});
 const box=await page.locator('.lg-weather').boundingBox();const clip={x:Math.ceil(box.x)+2,y:Math.ceil(box.y)+2,width:Math.floor(box.width)-4,height:Math.floor(box.height)-4};
 const before=await page.screenshot({clip});
 await bolt.evaluate(n=>{n.style.background='white';});
 expect((await page.screenshot({clip})).equals(before)).toBe(true);
 await page.evaluate(()=>{data['weather.home'].state='lightning';paint();});
 await expect(page.locator('.lg-sky-drop')).toHaveCount(0);
 await page.evaluate(()=>{scene.weather_animate=false;paint();});await expect(bolt).toHaveCSS('display','none');
 await expect(bolt).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{scene.weather_animate=true;paint();});await page.emulateMedia({reducedMotion:'reduce'});
 await expect(bolt).toHaveCSS('animation-name','none');await expect(bolt).toHaveCSS('opacity','0');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(bolt).toHaveCSS('animation-play-state','paused');
 await page.evaluate(()=>{data['weather.home'].state='cloudy';paint();});await expect(bolt).toHaveCSS('display','none');
 await page.evaluate(()=>renderer.clear());await expect(bolt).toHaveCount(0);
});

test('all weather states retain bounded layers in day/night and animated/static mode',async({page})=>{
 await mount(page);await page.setViewportSize({width:1024,height:600});
 await page.addStyleTag({content:'.lg-weather-sky *{transition:none!important}'});
 const states=['sunny','clear','clear-night','partlycloudy','cloudy','rainy','pouring','hail','snowy','snowy-rainy','fog','windy','windy-variant','lightning','lightning-rainy','exceptional','unknown','unavailable'];
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(()=>{window.matrixSky=renderer.sky;window.matrixWidget=renderer.nodes[scene.elements[0].id];});
 for(const motion of [true,false])for(const day of [true,false])for(const state of states){
  const cloudy=['cloudy','rainy','pouring','hail','snowy','snowy-rainy','fog','lightning','lightning-rainy'].includes(state);
  await page.evaluate(({state,day,motion,cloudy})=>{
   Object.assign(data['weather.home'],{state,cloud_coverage:state==='partlycloudy'?48:cloudy?96:['unknown','unavailable'].includes(state)?0:8});
   Object.assign(sun,{is_daytime:day,elevation:day?35:-25});scene.weather_animate=motion;paint();
   for(let i=0;i<5;i++)paint();
  },{state,day,motion,cloudy});
  const sky=page.locator('.lg-weather-sky');
  await expect(sky).toHaveCount(1);await expect(sky).toHaveAttribute('data-night',String(!day));
  await expect(sky).toHaveAttribute('data-motion',motion?'on':'off');
  const kind=['rainy','pouring','lightning-rainy'].includes(state)?'rain':state==='snowy'?'snow':state==='snowy-rainy'?'sleet':state==='hail'?'hail':'none';
  await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind',kind);
  await expect(page.locator('.lg-sky-drop')).toHaveCount(kind==='none'?0:kind==='snow'?48:kind==='hail'?48:64);
  await page.evaluate(()=>{renderer.sky.backgroundDone=0;renderer.sky.activateStorm();});
  await expect(sky).toHaveAttribute('data-storm',String(motion&&state.startsWith('lightning')));
  const unavailable=['unknown','unavailable'].includes(state);
  await expect(page.locator('.lg-sky-sun')).toHaveCSS('display',day&&!cloudy&&!unavailable?'block':'none');
  await expect(page.locator('.lg-sky-moon')).toHaveCSS('display',!day&&!cloudy&&!unavailable?'block':'none');
  if(!motion&&kind!=='none')await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-name','none');
  expect(await page.evaluate(()=>renderer.sky===matrixSky&&renderer.nodes[scene.elements[0].id]===matrixWidget)).toBe(true);
  const invalid=await page.locator('#sky').evaluate(n=>{const html=n.innerHTML.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,'embedded-image');const m=html.match(/NaN|Infinity/);return m?html.slice(Math.max(0,m.index-90),m.index+100):null;});expect(invalid,`${motion}/${day}/${state}`).toBeNull();
  if(motion){
   await page.locator('.lg-sky-lightning').evaluate(n=>{for(const a of n.getAnimations()){a.pause();a.currentTime=6250;}});
   await page.screenshot({path:`test-results/weather-matrix-${day?'day':'night'}-${state}-${test.info().project.name}.png`});
  }
 }
 await page.evaluate(()=>renderer.clear());await expect(page.locator('.lg-weather-sky,.lg-weather-precipitation')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('rare local meteors respect night, cloud cover, motion, visibility and cleanup',async({page})=>{
 await page.clock.install();await page.evaluate(()=>{Math.random=()=>.25;});await mount(page);
 const meteor=page.locator('.lg-sky-meteor');
 await page.evaluate(()=>{sun.is_daytime=false;sun.elevation=-25;data['weather.home'].state='clear-night';data['weather.home'].cloud_coverage=0;paint();});
 expect(await page.evaluate(()=>renderer.sky.meteorTimer!==null)).toBe(true);
 await page.clock.fastForward(34000);await expect(meteor).not.toHaveClass(/lg-sky-meteor-active/);
 await page.clock.fastForward(1000);await expect(meteor).toHaveClass(/lg-sky-meteor-active/);
 await expect(meteor.locator('line')).toHaveCount(16);
 expect(await meteor.evaluate(n=>Array.from(n.parentElement.children).indexOf(n))).toBeLessThan(await page.locator('.lg-sky-cloud').first().evaluate(n=>Array.from(n.parentElement.children).indexOf(n)));
 await meteor.evaluate(n=>{const a=n.getAnimations()[0];a.pause();a.currentTime=400;});
 await page.screenshot({path:'test-results/weather-meteor-'+test.info().project.name+'.png'});
 await page.evaluate(()=>{scene.weather_animate=false;paint();});await expect(meteor).not.toHaveClass(/lg-sky-meteor-active/);
 expect(await page.evaluate(()=>renderer.sky.meteorTimer)).toBe(null);
 await page.evaluate(()=>{scene.weather_animate=true;paint();});await page.emulateMedia({reducedMotion:'reduce'});
 await expect.poll(()=>page.evaluate(()=>renderer.sky.meteorTimer)).toBe(null);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect.poll(()=>page.evaluate(()=>renderer.sky.reduced.matches)).toBe(false);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 expect(await page.evaluate(()=>renderer.sky.meteorTimer)).toBe(null);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 expect(await page.evaluate(()=>renderer.sky.meteorTimer!==null)).toBe(true);
 for(const reason of ['day','overcast','fog']){
  await page.evaluate(reason=>{sun.is_daytime=reason==='day';data['weather.home'].state=reason==='fog'?'fog':'cloudy';data['weather.home'].cloud_coverage=reason==='overcast'?96:0;paint();},reason);
  expect(await page.evaluate(()=>renderer.sky.meteorTimer)).toBe(null);
 }
 await page.evaluate(()=>{sun.is_daytime=false;data['weather.home'].state='clear-night';data['weather.home'].cloud_coverage=0;paint();window.oldSky=renderer.sky;renderer.clear();});
 expect(await page.evaluate(()=>oldSky.meteorTimer)).toBe(null);await expect(meteor).toHaveCount(0);
});

test('rain snow and hail react at the floor and rounded widget edges without restarting on state updates',async({page})=>{
 await mount(page);await page.setViewportSize({width:1024,height:600});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const state of ['rainy','snowy','hail','snowy-rainy']){
  await page.evaluate(state=>{
   data['weather.home'].state=state;scene.weather_impact=true;
   const widget=scene.elements.find(e=>e.kind==='weather');widget.weather_reactive=true;Object.assign(widget,{x:20,y:40,width:60,height:24});paint();
  },state);
  expect(await page.evaluate(()=>renderer.sky.obstacles.length)).toBe(1);
  expect(await page.locator('.lg-sky-drop[data-impact=true]').count()).toBeGreaterThan(10);
  expect(await page.evaluate(()=>{
   const sky=renderer.sky,w=sky.root.clientWidth,h=sky.root.clientHeight;
   return [...sky.precip.querySelectorAll('.lg-sky-drop')].every((drop,i)=>{
    const kind=sky.kind==='snow'||(sky.kind==='sleet'&&i%3===2)?1:sky.kind==='hail'?2:0;
    const particle=new LGWeather.Particle(i,kind,w,h,sky.wind,sky.obstacles,true,Number(drop.dataset.cycle));
    if(!particle.hit)return true;
    const offsets=drop.firstElementChild.getAnimations()[0].effect.getKeyframes().map(f=>f.offset);
    return [.1,.3,.6,1,...(kind===2?[.32,.64,.82]:[])].every(q=>offsets.some(offset=>Math.abs(offset-particle.impact_at-particle.impact_ms/particle.duration*q)<.000001));
   });
  })).toBe(true);
  const before=await page.locator('.lg-weather-precipitation style').textContent();
  await page.evaluate(()=>{for(let i=0;i<25;i++)paint();});
  expect(await page.locator('.lg-weather-precipitation style').textContent()).toBe(before);
  await page.evaluate(()=>{
   const sky=renderer.sky,w=sky.root.clientWidth,h=sky.root.clientHeight;
   sky.precip.querySelectorAll('.lg-sky-drop').forEach((drop,i)=>{
    const kind=sky.kind==='snow'||(sky.kind==='sleet'&&i%3===2)?1:sky.kind==='hail'?2:0;
    const p=new LGWeather.Particle(i,kind,w,h,sky.wind,sky.obstacles,true,Number(drop.dataset.cycle));
    for(const mark of drop.children){mark.style.animationDelay='0ms';const animation=mark.getAnimations()[0];animation.pause();animation.currentTime=p.fall_ms*p.land+p.impact_ms*.3;}
   });
  });
  await page.screenshot({path:'test-results/weather-impact-'+state+'-'+test.info().project.name+'.png'});
 }
 await page.evaluate(()=>{scene.weather_impact=false;scene.elements.forEach(i=>i.weather_reactive=false);paint();});
 await expect(page.locator('.lg-sky-drop[data-impact=true]')).toHaveCount(0);
 await page.evaluate(()=>{scene.scroll_height=200;const widget=scene.elements.find(e=>e.kind==='weather');widget.weather_reactive=true;widget.y=110;paint();renderer.content.scrollTop=500;});
 await expect.poll(()=>page.evaluate(()=>renderer.sky.obstacles[0].y)).toBeCloseTo(160,0);
 await expect(page.locator('.lg-sky-mark').first()).toHaveCSS('animation-play-state','running');
 expect(errors).toEqual([]);await page.evaluate(()=>renderer.clear());
 await expect(page.locator('.lg-weather-precipitation style')).toHaveCount(0);
});

test('drizzle keeps many fine drops and a zero rate stops precipitation',async({page})=>{
 await mount(page);await page.setViewportSize({width:1024,height:600});
 const values=await page.evaluate(()=>{
  scene.weather_condition='drizzle';paint();
  const sky=renderer.sky,fine=sky.falling[4].particle,regular=new LGWeather.Particle(4,0,1024,600,sky.wind,[],false,0,1,false);
  const result={count:sky.falling.length,marks:sky.precip.querySelectorAll(".lg-sky-mark").length,fine:fine.size,regular:regular.size,veil:Number(sky.fog.style.opacity)};
  const p=new LGWeather.Particle(4,0,1024,600,sky.wind,[{x:0,y:100,w:1024,h:100,r:20}],true,0,.18,true);result.behind=p.behind_widgets;result.splash=p.marks(p.impact_at+.01).some(m=>m.alpha>0);
  sky.intensity=0;sky.precipitation();result.zero=sky.falling.length;return result;
 });
 expect(values.veil).toBeGreaterThan(.05);expect(values.count).toBeGreaterThanOrEqual(40);expect(values.fine).toBeCloseTo(values.regular*.7,4);expect(values.zero).toBe(0);expect(values.marks).toBe(values.count*9);expect(values.behind).toBe(true);expect(values.splash).toBe(false);
});

test('rain renews its distributed paths between falls without growing styles or restarting animation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mount(page);
 const first=page.locator('.lg-sky-drop').first();
 const before=await first.evaluate(drop=>{
  window.rainAnimation=drop.firstChild.getAnimations()[0];
  const sheet=drop.parentElement.querySelector('style').sheet;
  return {rules:sheet.cssRules.length,path:sheet.cssRules[0].cssText};
 });
 await expect.poll(()=>first.getAttribute('data-cycle'),{timeout:12000}).toMatch(/^[2-9]\d*$/);
 const after=await first.evaluate(drop=>{
  const sheet=drop.parentElement.querySelector('style').sheet,animation=drop.firstChild.getAnimations()[0];
  return {rules:sheet.cssRules.length,path:sheet.cssRules[0].cssText,same:animation===window.rainAnimation,
   running:animation.playState,cycle:Number(drop.dataset.cycle),time:animation.currentTime};
 });
 expect(after.rules).toBe(before.rules);expect(after.path).not.toBe(before.path);
 expect(after.same).toBe(true);expect(after.running).toBe('running');expect(after.time).toBeGreaterThan(2000);
 await page.evaluate(()=>{scene.weather_animate=false;paint();});
 const stopped=await first.getAttribute('data-cycle');await page.waitForTimeout(2100);
 expect(await first.getAttribute('data-cycle')).toBe(stopped);
 await page.evaluate(()=>renderer.clear());await expect(page.locator('.lg-weather-precipitation style')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('manual weather and precipitation rates remain provider independent',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{scene.weather_condition='partlycloudy';paint();});
 await expect(page.locator('.lg-weather-sky')).toHaveAttribute('data-condition','partlycloudy');
 expect(await page.evaluate(()=>data['weather.home'].state)).toBe('rainy');
 await page.evaluate(()=>{scene.weather_condition='drizzle';paint();});
 expect(await page.locator('.lg-sky-drop').count()).toBeGreaterThanOrEqual(40);
 await page.evaluate(()=>{scene.weather_precipitation_mode='sensor';scene.weather_precipitation_entity='sensor.rain';data['sensor.rain']={state:'0',unit:'mm/h'};paint();});
 await expect(page.locator('.lg-sky-drop')).toHaveCount(0);
  expect(await page.evaluate(()=>Number(renderer.sky.fog.style.opacity))).toBe(0);
 await page.evaluate(()=>{data['sensor.rain'].state='4';scene.weather_condition='auto';paint();});
 await expect(page.locator('.lg-sky-drop')).toHaveCount(64);
 await page.evaluate(()=>{data['sensor.rain'].unit='%';paint();});
 expect(await page.evaluate(()=>LGWeather.resolve(scene,data).rain_rate)).toBeUndefined();
});

test('snow and hail leave bounded layers that survive weather updates and clear when disabled',async({page})=>{
 await page.clock.install();await mount(page);
 await page.evaluate(()=>{data['weather.home'].temperature=-5;scene.weather_accumulation=true;scene.weather_impact=true;scene.elements.find(e=>e.kind==='weather').weather_reactive=true;data['weather.home'].state='snowy';paint();});
 await page.clock.runFor(15000);
 expect(await page.locator('.lg-weather-deposit').count()).toBeGreaterThan(0);
 expect(await page.evaluate(()=>renderer.sky.accumulation.deposits.some(p=>p.surface>=0))).toBe(true);
 const count=await page.locator('.lg-weather-deposit').count();
 await page.evaluate(()=>{data['weather.home'].state='sunny';paint();});await page.clock.runFor(10000);
 await expect(page.locator('.lg-weather-deposit')).toHaveCount(count);
 expect(await page.evaluate(()=>renderer.sky.depositTimer)).toBe(null);
 await page.evaluate(()=>{data['weather.home'].state='hail';paint();});await page.clock.runFor(12000);
 expect(await page.evaluate(()=>renderer.sky.accumulation.deposits.every(p=>p.amount>0&&p.w>100))).toBe(true);
 expect(await page.locator('.lg-weather-deposit').first().evaluate(n=>{const a=n._pixels.data;let columns=0;for(let x=0;x<n.width;x++){for(let y=0;y<n.height;y++)if(a[(y*n.width+x)*4+3]>0){columns++;break;}}return columns/n.width;})).toBeGreaterThan(.9);
 expect(await page.locator('.lg-weather-deposit').count()).toBeLessThanOrEqual(65);
 await page.screenshot({path:'test-results/weather-settled-'+test.info().project.name+'.png'});
 const frozen=await page.evaluate(()=>renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0));
 await page.evaluate(()=>{data['weather.home'].state='sunny';data['weather.home'].temperature=0;scene.elements.push(Object.assign({},scene.elements[0],{id:'frost-caption',kind:'text',text:'Schnee bleibt bei Frost',x:1,y:1,width:40,height:6,weather_reactive:false}));paint();});await page.clock.runFor(20000);
 expect(await page.evaluate(()=>renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0))).toBeCloseTo(frozen,6);
 await page.evaluate(()=>{data['weather.home'].temperature=10;paint();});await page.clock.runFor(6000);
 expect(await page.evaluate(()=>renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0))).toBeLessThan(frozen);
 expect(await page.locator('.lg-snow-melt-drop').count()).toBeGreaterThan(0);
 const silhouette=await page.locator('.lg-snow-melt-drop').first().evaluate(n=>Array.from(n.getContext('2d').getImageData(0,0,n.width,n.height).data).filter((v,i)=>i%4===3));
 expect(silhouette.length).toBe(144);expect(silhouette[0]).toBe(0);expect(silhouette[8]).toBe(0);
 expect(silhouette.slice(18,27).reduce((a,b)=>a+b,0)).toBeLessThan(silhouette.slice(90,99).reduce((a,b)=>a+b,0));
 await page.screenshot({path:'test-results/weather-melting-'+test.info().project.name+'.png'});
 await page.clock.runFor(120000);await expect(page.locator('.lg-weather-deposit')).toHaveCount(0);
 expect(await page.evaluate(()=>renderer.sky.depositTimer)).toBe(null);
 await page.evaluate(()=>{scene.weather_accumulation=false;paint();});
 await expect(page.locator('.lg-weather-deposit')).toHaveCount(0);
 expect(await page.evaluate(()=>renderer.sky.depositTimer)).toBe(null);
 await page.evaluate(()=>renderer.clear());await expect(page.locator('.lg-weather-settled')).toHaveCount(0);
});

test('snowfall density increases from light to heavy and stops at zero rate',async({page})=>{
 await mount(page);await page.evaluate(()=>{scene.weather_condition='snowy';scene.weather_precipitation_mode='sensor';scene.weather_precipitation_entity='sensor.rain';data['sensor.rain']={state:'0',unit:'mm/h'};paint();});
 const counts=[];for(const rate of [0,.2,2,12]){await page.evaluate(rate=>{data['sensor.rain'].state=String(rate);paint();},rate);const groups=await page.locator('.lg-sky-drop').count();counts.push(groups);await expect(page.locator('.lg-sky-snow')).toHaveCount(groups*(rate<1?4:rate<10?6:9));if(groups){expect(await page.locator('.lg-sky-snow').first().evaluate(n=>getComputedStyle(n).backgroundImage)).toContain('data:image/png');}}
 expect(counts[0]).toBe(0);expect(counts[1]).toBeGreaterThan(10);expect(counts[2]).toBeGreaterThan(counts[1]);expect(counts[3]).toBeGreaterThan(counts[2]);expect(counts[3]).toBeLessThanOrEqual(64);
});


test('frameless clock snowfall follows glyphs and keeps falling timelines through local ticks',async({page})=>{
 await page.clock.install({time:new Date('2026-10-23T11:46:00Z')});await page.clock.pauseAt(new Date('2026-10-23T11:47:00Z'));await mount(page);
 await page.evaluate(()=>{const clock=scene.elements.find(e=>e.kind==='clock');Object.assign(clock,{weather_reactive:true,opacity:0,style_override:true,clock_seconds:true,clock_blink:true});scene.weather_impact=true;scene.weather_accumulation=true;data['weather.home'].state='snowy';data['weather.home'].temperature=-4;paint();});
 const edges=await page.evaluate(()=>renderer.sky.obstacles.filter(b=>b.profile&&b.profile.length));expect(edges.length).toBeGreaterThan(5);
 expect(edges.every(b=>b.profile.some(y=>y>=0)&&b.w<400)).toBe(true);
 const initial=await page.evaluate(()=>{window.firstFall=renderer.sky.precip.querySelector('.lg-sky-drop');return renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0);});
 await page.clock.runFor(12000);const before=await page.evaluate(()=>renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0));expect(before).toBeGreaterThan(initial);
 const caps=await page.evaluate(()=>{const a=renderer.sky.accumulation;return a.deposits.filter(p=>p.exposure>0&&/\/0\/\d+$/.test(a.obstacles[p.surface]?.key||'')).map(p=>p.amount);});
 expect(caps).toHaveLength(6);expect(caps.every(amount=>amount>0)).toBe(true);
 await page.evaluate(()=>renderer.tick(new Date('2026-10-23T11:47:31Z')));
 expect(await page.evaluate(()=>renderer.sky.precip.querySelector('.lg-sky-drop')===firstFall)).toBe(true);
 expect(await page.evaluate(()=>renderer.sky.accumulation.deposits.reduce((n,p)=>n+p.amount,0))).toBeCloseTo(before,6);
 await page.screenshot({path:'test-results/weather-clock-glyph-'+test.info().project.name+'.png'});
 const layers=await page.evaluate(()=>{let through=0,front=0;renderer.sky.falling.forEach(r=>r.particle.behind_widgets?through++:front++);return {through,front};});expect(layers.through).toBeGreaterThan(0);expect(layers.front).toBeGreaterThan(0);
});


test('rain waits for cloud buildup then fades in without host updates',async({page})=>{
 await page.clock.install({time:new Date('2026-10-23T11:46:00Z')});await page.clock.pauseAt(new Date('2026-10-23T11:47:00Z'));await mount(page);
 await page.evaluate(()=>{scene.weather_animate=false;data['weather.home'].state='sunny';data['weather.home'].cloud_coverage=8;paint();scene.weather_animate=true;data['weather.home'].state='rainy';data['weather.home'].cloud_coverage=96;paint();});
 const rain=page.locator('.lg-weather-precipitation');
 expect(Number(await rain.evaluate(n=>n.style.opacity))).toBe(0);
 await page.clock.runFor(130000);expect(Number(await rain.evaluate(n=>n.style.opacity))).toBe(0);
 await page.clock.runFor(50000);expect(Number(await rain.evaluate(n=>n.style.opacity))).toBeCloseTo(.5,2);
 await page.evaluate(()=>paint());expect(Number(await rain.evaluate(n=>n.style.opacity))).toBeCloseTo(.5,2);
 await page.clock.runFor(61000);expect(Number(await rain.evaluate(n=>n.style.opacity))).toBe(1);
 await page.evaluate(()=>{data['weather.home'].state='lightning-rainy';paint();});expect(Number(await rain.evaluate(n=>n.style.opacity))).toBe(1);
});


test('automatic weather tolerates missing and partial entity states and recovers when data arrives',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mount(page);
 await page.evaluate(()=>{scene.weather_condition='auto';scene.weather_animate=false;});
 for(const value of [null,{}, {temperature:12}, {state:null}, {state:''}, {state:' '}, {state:0}, {state:false}, {state:'unknown'}, {state:'unavailable'}]){
  await page.evaluate(value=>{data['weather.home']=value;paint();},value);
  await expect(page.locator('.lg-weather-sky')).toHaveAttribute('data-condition','unavailable');
  await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind','none');
  await expect(page.locator('.lg-widget.lg-clock')).toBeVisible();
 }
 await page.evaluate(()=>{data['weather.home']={state:'rainy',temperature:13,temperature_unit:'°C'};scene.weather_animate=true;paint();});
 await expect(page.locator('.lg-weather-sky')).toHaveAttribute('data-condition','rainy');
 await expect(page.locator('.lg-weather-precipitation')).toHaveAttribute('data-kind','rain');
 expect(errors).toEqual([]);await page.evaluate(()=>renderer.clear());
});
