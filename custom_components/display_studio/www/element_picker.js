// One draft per template, shared by sidebar and grid insertion. Browsing never edits the view.
const copy=value=>JSON.parse(JSON.stringify(value));
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const samples={weather:{state:'sunny',temperature:22,temperature_unit:'°C',humidity:48,forecast:[]},calendar:{state:'on',events:[{summary:'Abendessen',start:new Date().toISOString()}]},entity:{state:'22,5',unit:'°C',name:'Temperatur'},status:{state:'22,5',unit:'°C',name:'Temperatur'},switch:{state:'on'},button:{state:'unknown'},media:{state:'playing',media_title:'Deine Musik',media_artist:'Wohnzimmer',volume_level:.45,media_duration:240,media_position:90},slider:{state:'playing',volume_level:.45},dropdown:{state:'playing',av_sources:[{value:'tv',label:'Fernsehen'}],av_selected_source:'tv'}};
export class ElementPicker {
  constructor(host,cell,index,version,settings={}){
    Object.assign(this,{host,cell,index,version,scene:host.scene,viewId:host.viewId,previousSlot:host.gridSlot,drafts:new Map(),mediaChoices:new Map(),renderers:[],kind:null});
    this.settings=settings;this.editId=settings.item?.id;
    if(settings.item){const kind=host.pickerKind(settings.item);const draft=copy(settings.item);draft.tap_action||={action:"none",entity_id:"",view:""};this.drafts.set(kind,draft);this.kind=kind;this.mediaChoices=new Map((settings.item.media_controls_hidden||[]).map(k=>[k,false]));}
    this.previousFocus=host.shadowRoot.querySelector(`[data-grid-slot="${index}"]`)||host.shadowRoot.activeElement;
  }
  draft(kind){if(this.templateDraft&&kind===this.kind)return this.templateDraft;if(!this.drafts.has(kind)){const item=this.host.gridDraft(kind,this.cell);item.id='picker_'+kind;this.drafts.set(kind,item);if(kind==='media')this.syncMediaControls(item);}return this.drafts.get(kind);}
  open(){
    const root=this.root=document.createElement('dialog');root.className='view-creator element-picker';root.setAttribute('aria-labelledby','element-picker-title');
    this.host.shadowRoot.append(root);root.oncancel=e=>{e.preventDefault();this.close();};
    root.onclick=e=>{if(e.target===root){const r=root.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.close();}};
    if(this.editId)this.configure(this.kind,false);else this.choose();this.host.PickerControls.lockPopup(root);root.showModal();this.paint();root.querySelector('[data-element-search],.element-setup-fields input,.element-setup-fields select,[data-add-element]')?.focus();
    let width=root.clientWidth;this.observer=new ResizeObserver(()=>{if(width===root.clientWidth)return;width=root.clientWidth;cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.root.isConnected&&this.paint());});this.observer.observe(root);
  }
  close(restore=true){
    this.host.symbolPicker?.close();this.observer?.disconnect();cancelAnimationFrame(this.frame);this.clear();
    this.root.close();this.host.PickerControls.unlockPopup(this.root);this.root.remove();this.host.elementPicker=null;
    if(restore){this.host.gridSlot=this.previousSlot;this.previousFocus?.focus({preventScroll:true});}
    if(restore)this.settings.onCancel?.();
  }
  clear(){for(const renderer of this.renderers)renderer.clear();this.renderers=[];}
  header(title,step){return `<div class="creator-header"><div><p class="eyebrow">${this.editId?'WIDGET-EINSTELLUNGEN':this.cell?'RASTERFELD '+(this.index+1)+' · '+step+' / 2':this.settings.onChoose?'NEUE WIDGETVORLAGE':'NEUES ELEMENT · '+step+' / 2'}</p><h2 id="element-picker-title">${this.editId?'Element einrichten':title}</h2></div><button type="button" class="secondary" data-cancel-element aria-label="Elementauswahl schließen">×</button></div>`;}
  preview(kind){const box=this.cell||this.draft(kind),ratio=this.host.displayRatio*box.width/box.height;return `<span class="element-preview" aria-hidden="true" inert><span class="element-preview-crop" style="width:min(100%,calc(var(--element-preview-height) * ${ratio}));aspect-ratio:${ratio}"><span class="element-preview-scene"></span></span></span>`;}
  bindCancel(){this.root.querySelectorAll('[data-cancel-element]').forEach(b=>b.onclick=()=>this.close());}
  choose(){
    this.clear();this.kind=null;this.templateDraft=null;this.templateRecord=null;
    this.root.innerHTML=this.header('Element hinzufügen',1)+`<label class="field creator-name">Element suchen<input type="search" data-element-search placeholder="Zum Beispiel Uhr, Wetter oder Kamera" autocomplete="off"></label><p class="element-picker-hint">Wähle eine Vorlage. ${this.cell?'Im nächsten Schritt stellst du den Inhalt ein. Größe und Hintergrundfläche entsprechen deiner Rasterkachel.':'Im nächsten Schritt wählst du Größe und Inhalt.'}</p><div class="element-picker-list"></div><p class="element-picker-empty" role="status" hidden>Keine passenden Elemente gefunden.</p><div class="creator-footer"><button type="button" class="secondary" data-cancel-element>Abbrechen</button></div>`;
    const list=this.root.querySelector('.element-picker-list');
    for(const [kind,name] of Object.entries(this.host.availableKinds)){
      const b=document.createElement('button'),error=this.host.insertionError(kind);b.type='button';b.className='element-choice';b.dataset.elementKind=kind;b.disabled=!!error;b.setAttribute('aria-label',name+' hinzufügen');
      b.innerHTML=this.preview(kind)+`<strong>${html(name)}</strong><small>${html(error||'Vorlage einrichten')}</small>`;
      b.onclick=()=>{if(this.settings.onChoose){this.close(false);this.settings.onChoose(kind);}else this.configure(kind);};list.append(b);
    }
    if(!this.settings.onChoose)for(const template of this.host.widgetLibraryDoc?.widgets||[]){
      const kind=this.host.pickerKind(template.item);if(this.host.insertionError(kind))continue;
      const b=document.createElement('button');b.type='button';b.className='element-choice';b.dataset.elementTemplate=template.id;b.dataset.elementKind=kind;b.setAttribute('aria-label',template.name+' hinzufügen');
      b.innerHTML=this.preview(kind)+`<strong>${html(template.name)}</strong><small>Eigene Widgetvorlage</small>`;b.onclick=()=>this.useTemplate(template);list.append(b);
    }
    this.bindCancel();this.root.querySelector('[data-element-search]').oninput=e=>{
      const query=e.target.value.trim().toLocaleLowerCase('de');
      for(const b of list.children)b.hidden=!b.textContent.toLocaleLowerCase('de').includes(query);
      this.root.querySelector('.element-picker-empty').hidden=[...list.children].some(b=>!b.hidden);this.paint();
    };
    this.paint();
  }
  useTemplate(template){
    this.templateRecord=template;this.kind=this.host.pickerKind(template.item);this.templateDraft=this.host.templateInstance(template,this.cell);this.templateDraft.id='picker_'+this.kind;
    this.mediaChoices=new Map((this.templateDraft.media_controls_hidden||[]).map(k=>[k,false]));this.configure(this.kind);
  }
  select(key,label,choices,value,disabled=false){return `<label class="field">${label}<select data-draft="${key}" aria-label="${label}" ${disabled?'disabled':''}>${Object.entries(choices).map(([id,name])=>`<option value="${html(id)}" ${String(value)===id?'selected':''}>${html(name)}</option>`).join('')}</select></label>`;}
  input(key,label,value,type='text',limits=''){return `<label class="field">${label}<input data-draft="${key}" aria-label="${label}" type="${type}" value="${html(value)}" ${limits}></label>`;}
  toggle(key,label,value){return `<label class="toggle"><input data-draft="${key}" type="checkbox" ${value?'checked':''}>${label}</label>`;}
  entities(item){
    const kind=this.kind,domains={weather:['weather'],calendar:['calendar'],media:['media_player'],slider:['media_player'],dropdown:['media_player'],switch:['switch','light','input_boolean'],button:['button','input_button'],camera:['camera'],animation:['sensor','number','input_number','counter']}[kind];
    return Object.values(this.host.hass.states).filter(s=>!domains||domains.includes(s.entity_id.split('.')[0])).sort((a,b)=>(a.attributes.friendly_name||a.entity_id).localeCompare(b.attributes.friendly_name||b.entity_id));
  }
  needsEntity(item){return ['entity','status','control','slider','dropdown','switch','button','weather','calendar','media'].includes(this.kind)||(this.kind==='camera'&&item.camera_source==='entity')||(this.kind==='animation'&&item.animation_type==='progress'&&item.progress_source==='entity');}
  actionField(item){
    const actions={none:'Keine',show_view:'Seitenwechsel',...Object.fromEntries(Object.entries(window.LGEntityActions).filter(([k])=>item.entity_id&&this.host.entityActionAllowed(k,item.entity_id)).map(([k,v])=>[k,v.label]))};
    const automatic=this.kind==='control'&&this.host.suggestedAction(item)!=='none';
    const selected=automatic&&item.tap_auto?'auto':Object.hasOwn(actions,item.tap_action.action)?item.tap_action.action:'none';
    return this.select('tap_action','Touch-Aktion',automatic?{auto:'Automatisch zum Symbol',...actions}:actions,selected)+
      (item.tap_action.action==='show_view'?this.select('tap_view','Zielansicht',{'':'Ansicht wählen',...Object.fromEntries(this.host.navigationViews.map(v=>[v.id,v.name]))},item.tap_action.view):'');
  }
  fields(item){
    const kind=this.kind,shared=!!item.widget_template;
    const entityField=this.needsEntity(item)?this.select('entity_id','Home-Assistant-Entität',{'':'Später auswählen',...Object.fromEntries(this.entities(item).map(s=>[s.entity_id,(s.attributes.friendly_name||s.entity_id)+' · '+s.entity_id]))},item.entity_id):'';
    let fields=kind==='control'?(shared?'':this.host.PickerControls.symbolField(item))+entityField+this.actionField(item):'';
    if(!this.cell&&kind!=='hdmi'){const choices=this.host.sizeChoices(false,item);fields+=this.select('size','Größe',choices,this.host.currentSize(item));if(this.host.currentSize(item)==='custom')fields+=this.input('width','Breite (%)',Number(item.width.toFixed(2)),'number','min="0.01" max="100" step="any" required')+this.input('height','Höhe (%)',Number(item.height.toFixed(2)),'number','min="0.01" max="100" step="any" required');}
    if(!['clock','logo','animation','control'].includes(kind))fields+=this.input('label','Beschriftung',item.label,'text','maxlength="100"');
    if(kind==='camera')fields+=this.select('camera_source','Kameraquelle',{...(this.host.nativeLvgl?{local:'Kamera direkt am ESP'}:{}),entity:'Home-Assistant-Kamera',test:'Lokaler Teststream',multicast:'UDP-Multicast · lokales Netz'},item.camera_source);
    if(kind==='animation'){
      if(!shared)fields+=this.select('animation_type','Animation',Object.fromEntries(Object.entries(window.LGAnimations).map(([k,v])=>[k,v.label])),item.animation_type)+this.input('animation_duration','Dauer eines Durchlaufs (ms)',item.animation_duration,'number','min="250" max="10000" step="50" required');
      if(item.animation_type==='progress')fields+=this.select('progress_source','Fortschrittsquelle',{fixed:'Fester Wert',boot:'Startfortschritt des ESP',...(!this.host.startupView?{entity:'Home-Assistant-Entität'}:{})},item.progress_source)+(item.progress_source==='entity'?this.input('progress_min','Minimalwert (0 %)',item.progress_min??0,'number','min="-1000000000" max="1000000000" step="any" required')+this.input('progress_max','Maximalwert (100 %)',item.progress_max??100,'number','min="-1000000000" max="1000000000" step="any" required'):this.input('progress_value','Fortschritt (%)',item.progress_value,'number','min="0" max="100" required'));
    }
    if(kind!=='control')fields+=entityField;
    if(kind==='logo'&&!shared)fields+=this.select('graphic_id','Grafik',Object.fromEntries(Object.entries(window.LGGraphics).map(([k,v])=>[k,v.name])),item.graphic_id);
    if(kind==='text'&&!shared&&!this.editId)fields+=`<label class="field">Text<textarea data-draft="text" aria-label="Text" maxlength="2000">${html(item.text)}</textarea></label>`;
    if(kind==='clock'){
      const time=item.parts?.time?.visible!==false,date=item.parts?.date?.visible!==false;
      fields+=this.select('clock_display','Element anzeigen',{both:'Uhrzeit und Datum',time:'Nur Uhrzeit',date:'Nur Datum'},time&&date?'both':time?'time':'date')+this.toggle('clock_seconds','Sekunden anzeigen',item.clock_seconds)+this.toggle('clock_blink','Trennpunkte blinken',item.clock_blink);
    }
    if(kind==='weather')fields+=this.select('forecast_type','Vorhersage',{current:'Nur aktuelles Wetter',daily:'Täglich',hourly:'Stündlich'},item.forecast_type)+(item.forecast_type!=='current'?this.input('forecast_count','Anzahl Vorhersagen',item.forecast_count,'number','min="1" max="8" required'):'');
    if(kind==='media')fields+=this.host.mediaControlsSettings(item,'data-draft');
    if(kind==='camera'){
      if(item.camera_source==='multicast')fields+=this.input('multicast_url','Multicast-Adresse',item.multicast_url||'','text','maxlength="80" placeholder="udp://239.1.2.3:5000" required');
      fields+=this.select('camera_mode','Wiedergabe',{auto:'Automatisch',stream:'Livebild',snapshot:'Standbild mit Altersanzeige'},item.camera_mode);
      if(item.camera_mode!=='stream')fields+=this.input('camera_interval','Standbild-Abstand (s)',item.camera_interval,'number','min="1" max="300" required');
      fields+=this.select('camera_fit','Bildformat',{contain:'Vollständig einpassen',cover:'Fläche füllen'},item.camera_fit)+this.select('tap_action','Touch-Aktion',{none:'Keine',camera_fullscreen:'Kamera im Vollbild öffnen'},item.tap_action.action);
    }else if(['switch','button','entity','status'].includes(kind))fields+=this.actionField(item);
    if(kind==='control'&&!shared)fields+=this.host.PickerControls.symbolStateFields(this.host,item,'data-draft');
    return fields;
  }
  configure(kind,focus=true){
    if(this.host.scene!==this.scene||this.host.viewId!==this.viewId){this.close();return;}
    this.clear();this.kind=kind;const item=this.draft(kind);if(kind==='media')this.syncMediaControls(item);
    this.root.innerHTML=this.header('Element einrichten',2)+`<form class="element-setup"><div class="element-setup-body"><div class="element-setup-preview">${this.preview(kind)}<strong>${html(this.templateRecord?.name||this.host.availableKinds[kind])}</strong><p class="element-picker-hint">${this.editId?'Entitäten, Aktionen und allgemeine Einstellungen dieser Kachel. Inhalte werden im Widgeteditor gestaltet.':this.cell?'Größe, Position und Gestaltung werden so in die Rasterkachel übernommen.':'Das Element wird mit dieser Größe und Gestaltung hinzugefügt.'}</p></div><div class="element-setup-fields">${this.fields(item)}</div></div><p class="element-setup-error" role="alert"></p><div class="creator-footer">${this.editId?'':'<button type="button" class="secondary" data-element-back>Zurück</button>'}<button type="button" class="secondary" data-cancel-element>Abbrechen</button><button type="submit" data-add-element>${this.editId?'Fertig':'Hinzufügen'}</button></div></form>`;
    this.bindCancel();const back=this.root.querySelector('[data-element-back]');if(back)back.onclick=()=>{this.choose();this.root.querySelector(`[data-element-kind="${kind}"]`).focus();};
    this.root.querySelectorAll('[data-draft]').forEach(input=>{
      input.oninput=()=>{if(['text','label','number'].includes(input.type)||input.tagName==='TEXTAREA')this.update(input,false);};
      input.onchange=()=>this.update(input,true);
    });
    this.host.PickerControls.enhanceEntityFields(this.root,this.host);
    this.host.PickerControls.enhanceActionFields(this.root);
    if(kind==='media')this.host.bindMediaControls(this.root,item,(key,checked)=>{this.mediaChoices.set(key,checked);this.paint();});
    if(kind==='control')this.host.bindSymbolStateColors(this.root,item,true);
    this.host.PickerControls.bindSymbolPicker(this.root,this.host,item,(key,art)=>{
      const preset=this.host.currentSize(item);item.control_icon=key;if(art)item.symbol_art=copy(art);else delete item.symbol_art;
      item.label='Symbole · '+(window.LGControlSymbols[key]||key);item.show_label=false;this.host.applySuggestedAction(item);
      if(!this.cell&&preset.startsWith('symbol_'))this.host.standardSize(item,preset);this.configure(this.kind,false);
    },this.version);
    this.root.querySelector('form').onsubmit=e=>{e.preventDefault();this.add();};
    this.paint();if(kind==='media'&&item.entity_id&&this.mediaRequested!==item.entity_id){this.mediaRequested=item.entity_id;void this.host.refreshValues();}if(focus)this.root.querySelector('.element-setup-fields input,.element-setup-fields select,.element-setup-fields textarea,[data-add-element]')?.focus();
  }
  update(input,rebuild){
    if(input.disabled||!input.checkValidity())return;
    const item=this.draft(this.kind),key=input.dataset.draft,value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
    const preset=this.host.currentSize(item);
    if(key==='size'){if(value==='custom'){item.manual_size=true;delete item.grid_size;}else this.host.standardSize(item,value);this.configure(this.kind,false);return;}
    if(key==='tap_action'){item.tap_auto=value==='auto';if(item.tap_auto)this.host.applySuggestedAction(item);else item.tap_action={action:value,entity_id:['none','camera_fullscreen','show_view'].includes(value)?'':item.entity_id,view:''};}
    else if(key==='tap_view')item.tap_action.view=value;
    else if(key==='clock_display'){item.parts||={};for(const p of ['time','date']){item.parts[p]||={};item.parts[p].visible=value==='both'||value===p;}}
    else item[key]=value;
    if(key==='entity_id'){
      if(item.tap_auto)this.host.applySuggestedAction(item);else if(!['none','camera_fullscreen','show_view'].includes(item.tap_action.action)){
        if(!value||!this.host.entityActionAllowed(item.tap_action.action,value))item.tap_action={action:'none',entity_id:'',view:''};else item.tap_action.entity_id=value;
      }
    }
    if(key==='camera_source'){if(value!=='entity')item.entity_id='';if(value!=='multicast')item.multicast_url='';}
    if(key==='animation_type'){
      item.label='Animation · '+window.LGAnimations[value].label;
      if(value!=='progress'&&item.progress_source==='entity'){item.progress_source='fixed';item.entity_id='';}
    }
    if(key==='progress_source'&&value!=='entity')item.entity_id='';
    if(item.kind==='animation'&&item.progress_source!=='entity'){delete item.progress_min;delete item.progress_max;}
    if(key==='graphic_id')item.label='Grafik · '+window.LGGraphics[value].name;
    if(!this.cell){
      if(['width','height'].includes(key)){item.manual_size=true;if(!this.editId)Object.assign(item,this.host.freeElementPosition(item));else {item.x=Math.min(item.x,100-item.width);item.y=Math.min(item.y,(this.scene.scroll_height||100)-item.height);}}
      if(['graphic_id','animation_type','entity_id'].includes(key)&&preset!=='custom')this.host.standardSize(item,preset);
      if(key==='clock_display')this.host.fitClockHeight(item);
    }
    const conditional=['camera_source','camera_mode','animation_type','progress_source','forecast_type','entity_id','graphic_id','clock_display','tap_action','symbol_state_coloring','media_controls','media_remote_view'];
    if(rebuild&&conditional.includes(key))this.configure(this.kind,false);else this.paint();
  }
  syncMediaControls(item){
    // Persist only deliberate deselections. A currently unavailable control may
    // become available when AV switches from music to TV (or reconnects).
    item.media_controls_hidden=window.LGMediaWidgetSpec.controls.filter(c=>this.mediaChoices.get(c.key)===false).map(c=>c.key);
  }
  async add(){
    if(!this.root.isConnected)return;
    const form=this.root.querySelector('form');if(!form?.reportValidity())return;
    const item=this.draft(this.kind);if(this.kind==='media')this.syncMediaControls(item);this.host.applySuggestedAction(item);let error='';
    if(this.host.scene!==this.scene||this.host.viewId!==this.viewId)error='Die Ansicht wurde inzwischen gewechselt.';
    if(item.tap_action.action==='show_view'&&!this.host.navigationViews.some(v=>v.id===item.tap_action.view))error='Bitte eine verfügbare Zielansicht für den Seitenwechsel wählen.';
    if(item.kind==='animation'&&item.progress_source==='entity'&&(item.progress_max??100)<=(item.progress_min??0))error='Der Maximalwert muss größer als der Minimalwert sein.';
    if(item.kind==='camera'&&item.camera_source==='multicast'&&(!/^udp:\/\/239(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}:[1-9]\d{0,4}$/.test(item.multicast_url||'')||Number(item.multicast_url.split(':').pop())>65535))error='Bitte eine Multicast-Adresse wie udp://239.1.2.3:5000 wählen.';
    if(!error&&this.editId){
      const position=this.scene.elements.findIndex(i=>i.id===this.editId);
      if(position<0)error='Das Element wurde inzwischen entfernt.';
      else{
        const before=this.host.captureEdit();this.host.checkpoint();this.scene.elements[position]=copy(item);this.host.changed(true);
        if(!await this.host.save()){await this.host.restoreEdit(before);this.scene=this.host.scene;error='Speichern fehlgeschlagen. Dein Entwurf bleibt im Popup erhalten.';}
      }
    }else if(!error)error=this.host.insertPreparedCard(this.kind,item,this.index);
    if(error){this.root.querySelector('.element-setup-error').textContent=error;return;}
    this.close(false);this.host.shadowRoot.querySelector(`.selection[data-id="${this.host.selected}"]`)?.focus({preventScroll:true});
  }
  paint(){
    this.clear();const host=this.host,targets=this.kind?[this.root.querySelector('.element-setup-preview')]:[...this.root.querySelectorAll('[data-element-kind]')].filter(b=>!b.hidden);
    for(const container of targets){
      if(!container)continue;const kind=this.kind||container.dataset.elementKind,template=container.dataset.elementTemplate&&host.widgetLibraryDoc?.widgets.find(t=>t.id===container.dataset.elementTemplate),item=template?host.templateInstance(template,this.cell):copy(this.draft(kind));item.animate=false;
      const values=host.values([item]);
      if(!item.entity_id&&samples[kind]){item.entity_id='preview.'+kind;values[item.entity_id]=samples[kind];}
      const target=container.querySelector('.element-preview-scene'),crop=target.parentElement,box=this.cell||item,ratio=host.displayRatio*box.width/box.height;
      crop.style.width=`min(100%,calc(var(--element-preview-height) * ${ratio}))`;crop.style.aspectRatio=ratio;
      const width=crop.clientWidth,height=width/ratio;
      Object.assign(target.style,{left:-box.x*width/box.width+'px',top:-box.y*height/box.height+'px',width:100*width/box.width+'px',height:100*height/box.height+'px'});
      target.innerHTML=kind==='hdmi'?'<span class="lg-hdmi-placeholder">HDMI</span>':'';
      const renderer=new window.LGLayoutRenderer(target,target.querySelector('.lg-hdmi-placeholder'),true);this.renderers.push(renderer);
      try{renderer.render({...copy(this.scene),elements:[item],scroll_height:100,weather_animate:false,weather_impact:false,weather_accumulation:false,media_background_enabled:false},values,{hideHdmi:!host.hardwareHdmi,now:new Date(),timezone:host.timezone,sun:host.sun(),nativeFonts:host.nativeLvgl,nativeHeight:host.displayRendering?.height||600,imageUrl:id=>host.imageUrl(id),message:{title:'Home Assistant',message:'Deine Nachricht'}});}
      catch(error){renderer.clear();target.innerHTML='<span class="element-preview-error">Vorschau nicht verfügbar</span>';Object.assign(target.style,{left:'0',top:'0',width:'100%',height:'100%'});console.warn('Display Studio: Elementvorschau fehlgeschlagen ('+kind+')',error);}
      target.querySelectorAll('button,input,select,[tabindex]').forEach(n=>n.setAttribute('tabindex','-1'));
    }
  }
}
