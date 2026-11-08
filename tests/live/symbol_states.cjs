// Real HA controls + server validation, with unsaved drafts only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.HA_URL||'http://127.0.0.1:8123';
const auth=JSON.parse(fs.readFileSync(process.env.HA_SESSION));
const assets=path.resolve(__dirname,'../../custom_components/display_studio/www');
(async()=>{
 for(const [engineName,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(services\/|display_studio\/(layout_library|device_binding|devices))/.test(r.url()))writes.push(r.url());});
   await page.addInitScript(a=>localStorage.setItem('hassTokens',JSON.stringify(a)),{...auth,expires:Date.now()+1800000,clientId:base+'/',hassUrl:base});
   if(process.env.SOURCE==='1')await page.route('**/display_studio/*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop(),local=name==='layout-runtime.js'?'runtime/layout.js':name;return ['studio.js','studio.css','element_picker.js','picker_controls.js','native_controls.js','layout-runtime.js'].includes(name)?route.fulfill({path:path.join(assets,local),contentType:name.endsWith('.css')?'text/css':'application/javascript'}):route.continue();});
   await page.goto(base+'/display-studio');await page.locator('.devices-home').waitFor({timeout:45000});
   await page.locator('display-studio').evaluate(s=>window.studio=s);
   const entry=process.env.HA_DISPLAY_ENTRY||await page.evaluate(()=>studio.devicesHome.data.entries.find(e=>e.provider==='esphome')?.entry_id);
   assert.ok(entry);await page.locator('[data-open-display="'+entry+'"]').first().click();
   await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
   await page.getByRole('button',{name:'＋ Element hinzufügen',exact:true}).click();await page.locator('[data-element-kind=control]').click();
   const setup=page.locator('.element-picker'),action=setup.locator('ha-select.studio-action-picker');
   await action.waitFor();assert.equal(await action.evaluate(n=>n.disabled),false);
   assert.deepEqual(await action.evaluate(n=>n.options.map(o=>o.value)),['none','show_view']);
   // Read-only sensors must not offer a meaningless automatic symbol action.
   const sensor=await page.evaluate(()=>Object.keys(studio.hass.states).find(k=>k.startsWith('sensor.')));assert.ok(sensor);
   const sensorPicker=setup.locator('ha-entity-picker');await sensorPicker.click();await sensorPicker.locator('input').last().fill(sensor);await sensorPicker.getByText(sensor,{exact:true}).last().click();
   await page.waitForFunction(sensor=>studio.elementPicker.draft('control').entity_id===sensor,sensor);
   assert.deepEqual(await action.evaluate(n=>n.options.map(o=>o.value)),['none','show_view']);
   await action.click();await action.getByText('Seitenwechsel',{exact:true}).click();
   const target=setup.locator('ha-select[data-native-for="tap_view"]');
   await target.waitFor();const choice=await target.evaluate(n=>n.options.find(o=>o.value&&o.value!=='hdmi_full'));
   assert.ok(choice);await target.click();await target.getByText(choice.label,{exact:true}).last().click();
   const entity=await page.evaluate(()=>Object.keys(studio.hass.states).find(k=>k==='switch.wohnzimmer_up_air_quality_aktivitatsanzeige')||Object.keys(studio.hass.states).find(k=>k.startsWith('input_boolean.')));assert.ok(entity);
   const picker=setup.locator('ha-entity-picker');await picker.click();await picker.locator('input').last().fill(entity);await picker.getByText(entity,{exact:true}).last().click();
   await page.waitForFunction(entity=>studio.elementPicker.draft('control').entity_id===entity,entity);
   assert.equal(await action.evaluate(n=>n.options.some(o=>o.value==='auto')),false); // Play is not Toggle.
   await setup.getByRole('button',{name:'Symbol auswählen',exact:true}).click();const symbolDialog=page.locator('.symbol-dialog');
   await symbolDialog.locator('ha-input').locator('input').fill('Ein/Aus');await symbolDialog.locator('[data-symbol=power]').click();
   assert.equal(await action.evaluate(n=>n.options.some(o=>o.value==='auto')),true);
   assert.deepEqual(await page.evaluate(()=>studio.elementPicker.draft('control').tap_action),{action:'show_view',entity_id:'',view:choice.value});
   await setup.getByText('Nach Status einfärben',{exact:true}).click();await setup.locator('[data-state-color=on]').waitFor();
   assert.deepEqual(await setup.locator('[data-state-color]').evaluateAll(ns=>ns.map(n=>n.dataset.stateColor)),['on','off','unknown','unavailable']);
   for(const [state,color] of [['on','#20c060'],['off','#d04020']])await setup.locator('[data-state-color="'+state+'"]').evaluate((n,color)=>{n.value=color;n.dispatchEvent(new Event('change',{bubbles:true}));},color);
   await setup.getByRole('button',{name:'Hinzufügen',exact:true}).click();
   const palette={on:'#20c060',off:'#d04020'};
   assert.deepEqual(await page.evaluate(()=>studio.item.symbol_state_colors),palette);
   // Use actual entity values without changing the entity or calling a service.
   const actual=await page.evaluate(()=>{const item=studio.item,node=studio.renderer.nodes[item.id],state=studio.hass.states[item.entity_id].state;return {color:getComputedStyle(node._control).color,state};});
   assert.equal(actual.color,actual.state==='on'?'rgb(32, 192, 96)':'rgb(208, 64, 32)');
   if(process.env.SOURCE!=='1'){
    const result=await page.evaluate(async()=>{const config=JSON.parse(JSON.stringify(studio.config)),id=studio.item.id;const answer=await studio.hass.callApi('POST','display_studio/layout_validate',{entry_id:studio.entryId,config});return answer.config.views.flatMap(v=>v.scene.elements).find(i=>i.id===id);});
    assert.deepEqual(result.symbol_state_colors,palette);assert.equal(result.symbol_state_coloring,true);assert.equal(result.tap_action.view,choice.value);
   }
   if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.locator('.properties').screenshot({path:path.join(process.env.SCREENSHOT_DIR,'state-colors-'+engineName+'.png')});}
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   console.log(engineName,JSON.stringify({pageNavigation:true,statePalette:palette,nativeControls:true,serverValidation:process.env.SOURCE!=='1',savedChanges:false,errors}));
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1)});
