// Opt-in test against the actual components supplied by the local HA frontend.
// No services or configuration writes. HA_SESSION points to a private token file.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.HA_URL||'http://127.0.0.1:8123';
const session=JSON.parse(fs.readFileSync(process.env.HA_SESSION));
const assets=path.resolve(__dirname,'../../custom_components/display_studio/www');
(async()=>{
  for(const [engineName,engine] of Object.entries({chromium,webkit})){
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],writes=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(services\/|display_studio\/(layout_library|device_binding|devices))/.test(request.url()))writes.push(request.url());});
      await page.addInitScript(a=>localStorage.setItem('hassTokens',JSON.stringify(a)),{...session,expires:Date.now()+1800000,clientId:base+'/',hassUrl:base});
      if(process.env.SOURCE==='1')await page.route('**/display_studio/*',route=>{
        const file=new URL(route.request().url()).pathname.split('/').pop();
        return ['studio.js','studio.css','native_controls.js','picker_controls.js','element_picker.js','devices.js'].includes(file)?route.fulfill({path:path.join(assets,file),contentType:file.endsWith('.css')?'text/css':'application/javascript'}):route.continue();
      });
      await page.goto(base+'/display-studio');
      await page.locator('.devices-home').waitFor({timeout:45000});
      await page.locator('display-studio').evaluate(studio=>{
        window.controlStudio=studio;window.controlEvents=[];
        const form=document.createElement('form');window.controlForm=form;
        form.id='native-contract';form.style.cssText='position:fixed;inset:20px auto 20px 20px;width:560px;overflow:auto;z-index:10000;padding:20px;background:var(--card-background-color)';
        form.innerHTML=`<label class="field">Testtext<input id="contract-text" name="text" required></label>
          <label class="field">Mehrzeilig<textarea id="contract-multiline" name="multiline"></textarea></label>
          <label class="field">Zahl<input type="number" id="contract-number" name="number" min="1" max="20" step="1" value="5" required></label>
          <label class="field">Auswahl<select id="contract-select" name="choice"><option value="one">Erste Option</option><option value="two">Zweite Option</option><option value="blocked" disabled>Gesperrt</option></select></label>
          <label><input type="checkbox" id="contract-check" name="enabled">Test aktivieren</label>
          <div role="radiogroup" aria-label="Testoption"><label><input type="radio" id="contract-radio-a" name="mode" value="a" checked>Variante A</label><label><input type="radio" id="contract-radio-b" name="mode" value="b">Variante B</label></div>
          <label class="field">Regler<input type="range" id="contract-range" name="range" min="0" max="100" step="5" value="50"></label>
          <label class="field">Entität<input id="contract-entity" name="entity" list="contract-entities"><datalist id="contract-entities"></datalist></label>
          <button type="button" class="secondary" id="contract-toggle">Aktion</button>
          <button type="submit" class="primary" id="contract-submit">Prüfen</button>`;
        form.addEventListener('input',e=>{if(e.target.matches('input,textarea,select'))controlEvents.push(['input',e.target.id,e.target.value,e.target.checked]);});
        form.addEventListener('change',e=>{if(e.target.matches('input,textarea,select'))controlEvents.push(['change',e.target.id,e.target.value,e.target.checked]);});
        form.onsubmit=e=>{e.preventDefault();controlEvents.push(['submit']);};
        form.querySelector('#contract-toggle').onclick=()=>controlEvents.push(['click']);
        for(const key of Object.keys(studio.hass.states).filter(k=>k.startsWith('input_boolean.')).slice(0,2)){const option=document.createElement('option');option.value=key;form.querySelector('datalist').append(option);}
        studio.shadowRoot.append(form);
      });
      const native=id=>page.locator('.ha-native-control[data-native-for="contract-'+id+'"]');
      const source=async key=>page.evaluate(key=>controlForm.elements[key].type==='checkbox'?controlForm.elements[key].checked:controlForm.elements[key].value,key);
      await native('multiline').waitFor();
      assert.equal(await native('multiline').evaluate(n=>n.localName),'ha-textarea');
      await native('text').locator('input').fill('Eigener Text');await native('text').locator('input').press('Tab');
      assert.equal(await source('text'),'Eigener Text');
      await native('multiline').locator('textarea').fill('Erste Zeile\nZweite Zeile');await native('multiline').locator('textarea').press('Tab');
      assert.equal(await source('multiline'),'Erste Zeile\nZweite Zeile');
      await native('number').locator('input').fill('31');
      assert.equal(await page.evaluate(()=>controlForm.reportValidity()),false);
      assert.equal(await native('number').evaluate(n=>n.invalid),true);
      await native('number').locator('input').fill('12');await native('number').locator('input').press('Tab');
      assert.equal(await source('number'),'12');
      await native('select').click();await native('select').getByText('Zweite Option',{exact:true}).click();assert.equal(await source('choice'),'two');
      await native('check').click();assert.equal(await source('enabled'),true);
      await page.locator('#native-contract').getByText('Test aktivieren',{exact:true}).click();assert.equal(await source('enabled'),false);
      await native('radio-b').click();assert.equal(await source('mode'),'b');
      await native('radio-a').press('Space');assert.equal(await source('mode'),'a');
      await native('radio-a').press('ArrowRight');assert.equal(await source('mode'),'b');
      const slider=native('range').getByRole('slider');await slider.focus();await slider.press('ArrowRight');assert.equal(await source('range'),'55');
      const entity=await native('entity').evaluate(n=>n.includeEntities[0]);assert.ok(entity,'An input_boolean is needed for the entity picker test');
      await native('entity').click();await native('entity').locator('input').last().fill(entity);await native('entity').getByText(entity,{exact:true}).last().click();
      await page.waitForFunction(value=>controlForm.elements.entity.value===value,entity);
      assert.equal(await source('entity'),entity);
      await page.evaluate(()=>{controlForm.elements.range.value='25';controlForm.elements.enabled.checked=true;controlForm.elements.choice.innerHTML='<option value="new">Neue Option</option>';controlForm.elements.choice.value='new';controlForm.querySelector('#contract-toggle').disabled=true;});
      await page.waitForFunction(()=>controlForm.querySelector('ha-select').value==='new');
      assert.equal(await native('range').evaluate(n=>n.value),25);
      assert.equal(await native('check').evaluate(n=>n.checked),true);
      assert.equal(await native('toggle').evaluate(n=>n.disabled),true);
      await page.evaluate(()=>{const b=controlForm.querySelector('#contract-toggle');b.disabled=false;b.textContent='Geänderte Aktion';});
      await native('toggle').getByText('Geänderte Aktion',{exact:true}).waitFor();await native('toggle').click();
      await native('submit').click();
      assert.equal(await page.evaluate(()=>controlEvents.filter(e=>e[0]==='click').length),1);
      assert.equal(await page.evaluate(()=>controlEvents.filter(e=>e[0]==='submit').length),1);
      await page.evaluate(()=>controlForm.style.setProperty('--primary-color','#932bbd'));
      assert.equal(await native('submit').evaluate(n=>getComputedStyle(n).getPropertyValue('--primary-color').trim()),'#932bbd');
      await page.evaluate(()=>controlForm.remove());
      await page.waitForFunction(()=>![...controlStudio.nativeControls.records.keys()].some(n=>n.id.startsWith('contract-')));
      // Exercise the real device dialog, including radio selection and validation.
      await page.getByRole('button',{name:'＋ Display hinzufügen',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Display hinzufügen',exact:true});
      await dialog.locator('.device-type').filter({hasText:'Browser'}).click();
      assert.equal(await dialog.locator('form').evaluate(f=>f.elements.provider.value),'browser');
      assert.equal(await dialog.locator('.device-target').isVisible(),false);
      await dialog.getByRole('button',{name:'Hinzufügen',exact:true}).click();
      assert.equal(await dialog.isVisible(),true); // Empty required name: no API call.
      await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
      // Actual draft editing, native submit and Cancel: no layout is saved.
      const entry=process.env.HA_DISPLAY_ENTRY||await page.evaluate(()=>controlStudio.devicesHome.data.entries.find(e=>e.available&&e.provider==='esphome')?.entry_id);
      assert.ok(entry,'A configured ESPHome Studio display is needed for the draft test');
      await page.locator('[data-open-display="'+entry+'"]').first().click();
      await page.getByRole('button',{name:'＋ Neue Ansicht',exact:true}).click();
      const name=page.locator('ha-input[data-native-for="new-view-name"]');
      await name.locator('input').fill('Native Felder · ungespeicherter Test');await name.locator('input').press('Enter');
      await page.getByRole('button',{name:'＋ Element hinzufügen',exact:true}).click();
      await page.locator('[data-element-kind=text]').click();
      const setup=page.locator('.element-setup');
      await setup.locator('ha-textarea').locator('textarea').fill('Text mit HA-Komponenten');
      await setup.locator('ha-textarea').locator('textarea').press('Tab');
      assert.equal(await setup.locator('[data-add-element]').evaluate(b=>b._nativeControl?.localName),'ha-button');
      await setup.getByRole('button',{name:'Hinzufügen',exact:true}).click();
      assert.equal(await page.evaluate(()=>controlStudio.item.text),'Text mit HA-Komponenten');
      await page.evaluate(()=>{window.itemBeforeEditing=JSON.stringify(controlStudio.item);controlStudio.editWidget(controlStudio.item.id);});
      const editor=page.locator('.widget-dialog');
      const help=editor.getByRole('button',{name:'Informationen zu Widget bearbeiten',exact:true});
      await help.hover();await editor.locator('.help-overlay:popover-open').waitFor();
      const position=await editor.locator('.help-overlay:popover-open').boundingBox();assert.ok(position.x>=0&&position.y>0);
      await page.mouse.move(1400,1000);await page.waitForTimeout(250);
      await editor.getByRole('button',{name:'Abbrechen',exact:true}).click();
      assert.equal(await page.evaluate(()=>JSON.stringify(controlStudio.item)),await page.evaluate(()=>itemBeforeEditing));
      assert.deepEqual(errors,[]);
      assert.deepEqual(writes,[],'The live UI test must not save configurations or call device services');
      console.log(engineName+': native fields, buttons, events, validation, theme, cleanup, device dialog, draft editing and help passed');
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
