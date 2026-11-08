// Real HA entity selectors/checkboxes and validation; never saves or calls a service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.HA_URL||'http://127.0.0.1:8123',auth=JSON.parse(fs.readFileSync(process.env.HA_SESSION));
const assets=path.resolve(__dirname,'../../custom_components/display_studio/www');
(async()=>{
 for(const [engineName,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(services\/|display_studio\/(layout_library|device_binding|devices))/.test(r.url()))writes.push(r.url());});
   await page.addInitScript(a=>localStorage.setItem('hassTokens',JSON.stringify(a)),{...auth,expires:Date.now()+1800000,clientId:base+'/',hassUrl:base});
   if(process.env.SOURCE==='1')await page.route('**/display_studio/*',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();return ['studio.js','studio.css','element_picker.js','picker_controls.js'].includes(name)?r.fulfill({path:path.join(assets,name),contentType:name.endsWith('.css')?'text/css':'application/javascript'}):r.continue();});
   await page.goto(base+'/display-studio');await page.locator('.devices-home').waitFor({timeout:45000});await page.locator('display-studio').evaluate(s=>window.studio=s);
   const entry=process.env.HA_DISPLAY_ENTRY||await page.evaluate(()=>studio.devicesHome.data.entries.find(e=>e.provider==='esphome')?.entry_id);assert.ok(entry);await page.locator('[data-open-display="'+entry+'"]').first().click();
   await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();await page.getByRole('button',{name:'Ansicht anlegen',exact:true}).click();
   await page.locator('[data-grid-slot="0"]').click();await page.locator('[data-element-kind=media]').click();
   const setup=page.locator('.element-picker');await setup.locator('ha-checkbox[data-native-for="media-control-play_pause"]').waitFor();
   const entity=await page.evaluate(()=>Object.values(studio.hass.states).find(s=>s.entity_id.startsWith('media_player.')&&!['unknown','unavailable'].includes(s.state)&&(s.attributes.supported_features&4)&&!(s.attributes.supported_features&2))?.entity_id);assert.ok(entity,'partial-feature local media player');
   const picker=setup.locator('ha-entity-picker');await picker.click();await picker.locator('input').last().fill(entity);await picker.getByText(entity,{exact:true}).last().click();
   await page.waitForFunction(id=>studio.elementPicker.draft('media').entity_id===id,entity);
   const control=key=>setup.locator('ha-checkbox[data-native-for="media-control-'+key+'"]');
   assert.equal(await setup.locator('.media-controls-options').evaluate(n=>getComputedStyle(n).display),'grid');assert.equal(await control('volume_set').evaluate(n=>n.disabled),false);assert.equal(await control('seek_back').evaluate(n=>n.disabled),true);assert.equal(await control('seek_back').evaluate(n=>n.checked),false);
   await control('volume_set').click();assert.equal(await control('volume_set').evaluate(n=>n.checked),false);
   // Use real HA events: enabling must immediately reveal all eleven choices.
   const master=setup.locator('ha-checkbox[data-native-for=media_controls]');
   await master.click();assert.equal(await setup.locator('[data-media-control]').count(),0);
   await master.click();assert.equal(await setup.locator('[data-media-control]').count(),11);
   assert.equal(await control('volume_set').evaluate(n=>n.checked),false);
   const listBox=await setup.locator('.media-controls-options').boundingBox(),masterBox=await master.boundingBox();assert.ok(listBox.y>=masterBox.y+masterBox.height);

   const remote=setup.locator('ha-select[data-native-for=media_remote_view]');const target=await remote.evaluate(n=>n.options.find(o=>o.value));assert.ok(target);
   await remote.click();await remote.getByText(target.label,{exact:true}).last().click();assert.equal(await control('remote').evaluate(n=>n.disabled),false);
   await setup.getByRole('button',{name:'Zurück',exact:true}).click();await setup.locator('[data-element-kind=media]').click();assert.equal(await control('volume_set').evaluate(n=>n.checked),false);
   if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await setup.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'media-picker-'+engineName+'.png')});}
   const selected=await page.evaluate(()=>LGExpandMedia({elements:[studio.elementPicker.draft('media')]},studio.values([studio.elementPicker.draft('media')])).elements.slice(1).map(c=>c.id.split('/media/')[1]));
   await setup.getByRole('button',{name:'Hinzufügen',exact:true}).click();assert.deepEqual(await page.evaluate(()=>LGExpandMedia({elements:[studio.item]},studio.values([studio.item])).elements.slice(1).map(c=>c.id.split('/media/')[1])),selected);
   const inspector=page.locator('.properties'),inspectorMaster=inspector.locator('ha-checkbox[data-native-for=media_controls]');
   assert.equal(await inspector.locator('[data-media-control]').count(),11);
   await inspectorMaster.click();assert.equal(await inspector.locator('[data-media-control]').count(),0);
   await inspectorMaster.click();assert.equal(await inspector.locator('[data-media-control]').count(),11);
   const result=await page.evaluate(async()=>{const config=JSON.parse(JSON.stringify(studio.config)),id=studio.item.id;const answer=await studio.hass.callApi('POST','display_studio/layout_validate',{entry_id:studio.entryId,config});return {config:answer.config,item:answer.config.views.flatMap(v=>v.scene.elements).find(i=>i.id===id)};});
   assert.ok(result.item.media_controls_hidden.includes('volume_set'));assert.ok(!result.item.media_controls_hidden.includes('seek_back'));assert.ok(!result.item.media_controls_hidden.includes('remote'));assert.equal(result.item.media_remote_view,target.value);
   if(process.env.SCREENSHOT_DIR)fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,'media-picker-contract.json'),JSON.stringify({item:result.item,selected},null,2));
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(engineName,JSON.stringify({entity,selected,remote:target.label,nativeControls:true,serverValidated:true,savedChanges:false,errors}));
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1)});
