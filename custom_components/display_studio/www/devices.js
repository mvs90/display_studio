/* Studio device landing page; physical ownership is validated by Home Assistant. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={online:'Verbunden',offline:'Offline',unbound:'Nicht zugeordnet',setup_error:'Einrichtung nicht bereit'};
const errors={device_in_use:'Dieses physische Display ist bereits zugeordnet.',already_configured:'Dieses Display ist bereits zugeordnet.',device_missing:'Das gewählte Display ist nicht mehr vorhanden.',incompatible_device:'Wähle denselben Displaytyp und bei ESPHome dieselbe Auflösung.',binding_changed:'Die Zuordnung wurde zwischenzeitlich geändert. Bitte öffne die Auswahl erneut.',device_busy:'Die aktuelle Zuordnung ist beschäftigt. Bitte erneut versuchen.',device_not_ready:'Das neue Display konnte nicht eingebunden werden. Die bisherige Zuordnung wurde wiederhergestellt.',esphome_not_ready:'Die ESPHome-Display-Integration ist noch nicht bereit.',lg_not_ready:'Die LG-Integration ist noch nicht bereit.',lg_update_required:'Bitte aktualisiere die LG-Display-Integration.',invalid_device:'Bitte Name, Typ und Gerät prüfen.'};
export class DisplayDevices {
  constructor(studio,version){this.studio=studio;this.root=studio.shadowRoot;this.version=version;this.closed=false;}
  async mount(){
    this.root.innerHTML=`<link rel="stylesheet" href="/display_studio/studio.css?v=${this.version}"><header class="devices-header"><div><h1>Display Studio</h1><p>Dein Zuhause. Auf deinen Bildschirmen.</p></div><div class="spacer"></div><button class="secondary" data-open-widgets>Widgeteditor</button><button class="secondary" data-open-themes>Themeseditor</button><button class="primary" data-add-display>＋ Display hinzufügen</button></header><main class="devices-home"><div class="gallery-heading"><div><p class="eyebrow">DEINE DISPLAYS</p><h2>Alle Bildschirme an einem Ort.</h2><p>Öffne die Ansichten eines Displays oder ändere seine Zuordnung.</p></div><button class="secondary" data-refresh-devices>Aktualisieren</button></div><p class="devices-feedback" role="status"></p><div class="display-grid" aria-label="Displays"></div><p class="device-credits"><a href="/display_studio/device-images/sources.html" target="_blank" rel="noopener noreferrer">Gerätebilder &amp; Quellen</a></p></main>`;
    this.root.querySelector('[data-add-display]').onclick=()=>this.dialog();
    this.root.querySelector('[data-open-widgets]').onclick=()=>this.studio.showDesigns('widgets');
    this.root.querySelector('[data-open-themes]').onclick=()=>this.studio.showDesigns('themes');
    this.root.querySelector('[data-refresh-devices]').onclick=()=>this.refresh();
    await this.refresh();
    if(!this.closed)this.timer=setInterval(()=>{if(!document.hidden)this.refresh();},5000);
  }
  close(){this.closed=true;clearInterval(this.timer);this.studio.PickerControls.unlockPopup(this.modal);this.modal?.remove();}
  message(text,error=false){const node=this.root.querySelector('.devices-feedback');if(node){node.textContent=text;node.classList.toggle('error',error);}}
  async refresh(){
    if(this.pending)return;this.pending=true;
    try{const data=await this.studio.hass.callApi('GET','display_studio/devices');if(this.closed)return;this.data=data;this.render();this.message('');}
    catch(_){if(!this.closed)this.message('Gerätestatus konnte nicht aktualisiert werden. Bitte erneut versuchen.',true);}
    finally{this.pending=false;}
  }
  image(file){return `/display_studio/device-images/${encodeURIComponent(file||'generic.svg')}`;}
  render(){
    const grid=this.root.querySelector('.display-grid');if(!grid)return;
    const key=JSON.stringify(this.data.entries);if(key===this.key)return;this.key=key;
    const focus=this.root.activeElement?.dataset;
    grid.innerHTML=this.data.entries.map(e=>`<article class="display-card" data-display-card="${esc(e.entry_id)}"><button class="display-open" data-open-display="${esc(e.entry_id)}" aria-label="${esc(e.name)} öffnen" ${e.available?'':'disabled'}><div class="display-picture"><img src="${this.image(e.image)}" alt="${esc(e.model)}" loading="lazy"><span class="display-status" data-status="${esc(e.status)}"><i></i>${esc(statusNames[e.status]||'Unbekannt')}</span></div><div class="display-summary"><p>${esc(e.model)}${e.width&&e.height?' · '+e.width+' × '+e.height:''}</p><h3>${esc(e.name)}</h3><span>${esc(e.selected_view?'Ansicht · '+e.selected_view:e.provider==='browser'?'Verbindung über privaten Anzeigelink':e.target_name||'Kein physisches Display zugeordnet')}</span></div></button><div class="display-actions"><button class="primary" data-open-display="${esc(e.entry_id)}" ${e.available?'':'disabled'}>Ansichten öffnen</button>${e.provider==='browser'?'<span>HTTP Kiosk</span>':`<button class="secondary" data-bind-display="${esc(e.entry_id)}">Zuordnung ändern</button>`}</div></article>`).join('')||'<div class="empty-library"><h3>Dein erstes Display</h3><p>Füge ein ESPHome-Display, LG-Display oder einen Browser hinzu.</p><button class="primary" data-add-first>Display hinzufügen</button></div>';
    grid.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.onerror=null;img.src=this.image('generic.svg');});
    grid.querySelectorAll('[data-open-display]').forEach(b=>b.onclick=()=>this.studio.switchDisplay(b.dataset.openDisplay));
    grid.querySelectorAll('[data-bind-display]').forEach(b=>b.onclick=()=>this.dialog(this.data.entries.find(e=>e.entry_id===b.dataset.bindDisplay)));
    const first=grid.querySelector('[data-add-first]');if(first)first.onclick=()=>this.dialog();
    const action=focus?.openDisplay?'open-display':focus?.bindDisplay?'bind-display':null;
    if(action)grid.querySelector(`[data-${action}="${CSS.escape(focus.openDisplay||focus.bindDisplay)}"]`)?.focus({preventScroll:true});
  }
  async dialog(entry=null){
    if(this.modal)return;
    await this.refresh();if(this.closed||!this.data)return;
    const d=document.createElement('dialog');this.modal=d;d.className='device-dialog';d.setAttribute('aria-labelledby','device-dialog-title');
    const close=()=>{if(this.saving)return;d.close();this.studio.PickerControls.unlockPopup(d);d.remove();this.modal=null;this.root.querySelector(entry?`[data-bind-display="${CSS.escape(entry.entry_id)}"]`:'[data-add-display]')?.focus({preventScroll:true});};
    d.innerHTML=`<div class="creator-header"><h2 id="device-dialog-title">${entry?'Zuordnung ändern':'Display hinzufügen'}</h2><button class="secondary" data-close aria-label="Schließen">×</button></div><form><div class="device-types" role="radiogroup" aria-label="Displaytyp">${this.data.types.map(t=>`<label class="device-type"><input type="radio" name="provider" value="${esc(t.id)}" ${(entry?.provider||'esphome')===t.id?'checked':''} ${entry&&entry.provider!==t.id?'disabled':''}><img src="${this.image(t.image)}" alt=""><strong>${esc(t.name)}</strong><span>${esc(t.description)}</span></label>`).join('')}</div>${entry?`<p class="device-binding-note">${esc(entry.name)}${entry.width?' · '+entry.width+' × '+entry.height:''}. Deine gespeicherten Ansichten bleiben erhalten.</p>`:'<label class="field">Name<input name="name" required maxlength="80" autocomplete="off" placeholder="Zum Beispiel Wohnzimmer"></label>'}<label class="field device-target">Physisches Display<select name="target"></select></label><p class="device-target-hint"></p><a class="device-setup-link" target="_blank" rel="noopener noreferrer">Gerät in Home Assistant einrichten</a><p class="device-dialog-error" role="alert"></p><div class="creator-footer"><button type="button" class="secondary" data-cancel>Abbrechen</button><button type="submit" class="primary">${entry?'Zuordnung speichern':'Hinzufügen'}</button></div></form>`;
    this.root.append(d);d.querySelector('[data-close]').onclick=d.querySelector('[data-cancel]').onclick=close;
    d.oncancel=e=>{e.preventDefault();close();};
    const form=d.querySelector('form'),select=form.elements.target,hint=d.querySelector('.device-target-hint'),link=d.querySelector('.device-setup-link');
    const update=()=>{
      const provider=form.elements.provider.value,type=this.data.types.find(t=>t.id===provider),browser=provider==='browser';
      d.querySelector('.device-target').hidden=browser;link.hidden=browser;
      const targets=this.data.targets.filter(t=>t.provider===provider&&(!entry||t.compatibility===entry.compatibility));
      select.innerHTML=`<option value="">${entry?'Keine Zuordnung · später neu verbinden':'Display wählen'}</option>`+targets.map(t=>{const assigned=t.assigned_to.filter(id=>id!==entry?.entry_id).length>0;return `<option value="${esc(t.entry_id)}" ${assigned?'disabled':''}>${esc(t.name)} · ${esc(t.model)}${t.width?' · '+t.width+' × '+t.height:''}${assigned?' · belegt: '+esc(t.assigned_names.join(', ')):''}</option>`;}).join('');
      select.value=entry?.target_entry_id||'';select.required=!browser&&!entry;
      if(!browser)link.href='/config/integrations/dashboard/add?domain='+encodeURIComponent(type.integration);
      hint.textContent=browser?'Nach dem Anlegen erhältst du einen privaten Anzeigelink für deinen Browser.':entry?'Nur freie Displays desselben Typs sind wählbar; ESPHome benötigt dieselbe Auflösung.':'Wähle ein in Home Assistant eingerichtetes Display. Bereits zugeordnete Geräte sind gesperrt.';
    };
    d.querySelectorAll('[name=provider]').forEach(r=>r.onchange=update);update();
    form.onsubmit=async e=>{
      e.preventDefault();if(this.saving||!form.reportValidity())return;
      const provider=form.elements.provider.value,target=select.value||null,name=form.elements.name?.value.trim();
      if(!entry&&!name)return;
      this.saving=true;d.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);d.querySelector('.device-dialog-error').textContent='';
      try{
        await this.studio.hass.callApi('POST',entry?'display_studio/device_binding/'+entry.entry_id:'display_studio/devices',entry?{target_entry_id:target,previous_target_entry_id:entry.target_entry_id}:{provider,name,target_entry_id:target});
        this.saving=false;close();await this.refresh();this.message(entry?'Zuordnung gespeichert.':'Display hinzugefügt.');
      }catch(error){
        this.saving=false;d.querySelectorAll('button,input,select').forEach(n=>n.disabled=false);
        if(entry)d.querySelectorAll('[name=provider]').forEach(n=>n.disabled=n.value!==entry.provider);
        d.querySelector('.device-dialog-error').textContent=errors[error.body?.error||error.error]||'Die Änderung konnte nicht gespeichert werden. Bitte aktualisieren und erneut versuchen.';
      }
    };
    this.studio.PickerControls.lockPopup(d);d.showModal();(entry?select:form.elements.name).focus();
  }
}
