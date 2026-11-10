const {test,expect}=require('@playwright/test');
const path=require('node:path');
const perf=path.resolve('custom_components/display_studio/www/runtime/performance.js');
test('automatic performance profiles honor Navigator generations and preserve saved scenes',async({page})=>{
 await page.addScriptTag({path:perf});
 const result=await page.evaluate(()=>{
  const nav={deviceMemory:8,hardwareConcurrency:8,userAgent:'Cisco RoomOS'};
  const first=LGPerformance.create(nav,'?device=cisco-navigator-gen1');
  const second=LGPerformance.create(nav,'?device=cisco-navigator-gen2');
  const strong=LGPerformance.create(nav,'?performance=quality&device=cisco-navigator-gen1');
  const saved={weather_animate:true,glass:true,weather_impact:true,weather_accumulation:true,elements:[]};
  const adapted=first.scene(saved);
  return {first:first.report(),second:second.report(),strong:strong.report(),adapted,saved};
 });
 expect(result.first.profile).toBe('economy');expect(result.second.profile).toBe('balanced');expect(result.strong.profile).toBe('quality');
 expect(result.adapted.weather_animate).toBe(false);expect(result.saved.weather_animate).toBe(true);expect(result.adapted.glass).toBe(true);
});
test('sustained expensive rendering downgrades auto but keeps manual selection fixed',async({page})=>{
 await page.addScriptTag({path:perf});
 const profiles=await page.evaluate(()=>{
  const nav={deviceMemory:8,hardwareConcurrency:8};const auto=LGPerformance.create(nav,''),manual=LGPerformance.create(nav,'?performance=quality');
  for(let i=0;i<20;i++){auto.sample(200);manual.sample(200);}return [auto.report().profile,manual.report().profile];
 });
 expect(profiles).toEqual(['economy','quality']);
});
