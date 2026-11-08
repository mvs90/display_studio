/* Dedicated design workspaces. Display bindings stay in the view editor. */
const copy=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const widgetKind=item=>item.kind==='control'?({slider:'slider',source:'dropdown'}[item.control_type]||'control'):item.kind;
export class DesignLibrary {
  constructor(host,type,version){Object.assign(this,{host,type,version,closed:false,renderers:[],documents:[],records:[],images:new Map()});}
  async mount(){
    const h=this.host;
    h.shadowRoot.innerHTML=`<link rel="stylesheet" href="/display_studio/studio.css?v=${this.version}"><link rel="stylesheet" href="/display_studio/layout.css?v=${this.version}"><header class="devices-header"><button class="secondary" data-design-back>← Displays</button><div><h1>${this.type==='widgets'?'Widgeteditor':'Themeseditor'}</h1><p>${this.type==='widgets'?'Inhalte gestalten und als wiederverwendbare Widgets speichern.':'Farben, Glasflächen und Hintergründe deiner Displays gestalten.'}</p></div><div class="spacer"></div><button class="primary" data-design-new>＋ ${this.type==='widgets'?'Neues Widget':'Neues Theme'}</button></header><main class="design-library"><div class="design-tabs"><button class="secondary" data-design-tab="widgets" aria-pressed="${this.type==='widgets'}">Widgeteditor</button><button class="secondary" data-design-tab="themes" aria-pressed="${this.type==='themes'}">Themeseditor</button></div><label class="field">${this.type==='widgets'?'Widget':'Theme'} suchen<input type="search" data-design-search autocomplete="off"></label><p class="design-feedback" role="status">Bibliothek wird geladen …</p><div class="design-groups"></div></main>`;
    h.shadowRoot.querySelector('[data-design-back]').onclick=()=>h.showDevices();
    h.shadowRoot.querySelectorAll('[data-design-tab]').forEach(b=>b.onclick=()=>h.showDesigns(b.dataset.designTab));
    h.shadowRoot.querySelector('[data-design-new]').onclick=()=>this.newDesign();
    h.shadowRoot.querySelector('[data-design-search]').oninput=()=>this.render();
    try{
      const [catalog,widgets]=await Promise.all([h.hass.callApi('GET','display_studio/layouts'),h.hass.callApi('GET','display_studio/widget_library')]);
      if(this.closed)return;
      h.catalog=catalog;h.widgetLibraryDoc=widgets;
      const results=await Promise.allSettled(catalog.entries.map(async entry=>({entry,doc:await h.hass.callApi('GET','display_studio/layout_library/'+entry.entry_id)})));
      if(this.closed)return;
      this.documents=results.filter(r=>r.status==='fulfilled').map(r=>({...r.value,doc:{...r.value.doc,config:h.withViews(copy(r.value.doc.config))}}));
      this.records=[];
      if(this.type==='widgets'){
        for(const widget of widgets.widgets||[])this.records.push({key:widget.id,name:widget.name,group:'Eigene Widgets',description:(widgets.usage?.[widget.id]?.length||0)+' Verwendungen',widget,item:widget.item});
        for(const {entry,doc} of this.documents)for(const view of doc.config.views||[])for(const item of view.scene.elements){
          if(item.kind==='hdmi'||item.widget_template)continue;
          this.records.push({key:[entry.entry_id,view.id,item.id].join('/'),name:h.kindName(item),group:entry.name,description:view.name,entry,view,item,doc});
        }
      }else{
        for(const {entry,doc} of this.documents)for(const theme of doc.config.themes||[])this.records.push({key:entry.entry_id+'/'+theme.id,name:theme.name,group:entry.name,description:h.isBuiltinTheme(theme.id)?'Standard · als Kopie bearbeiten':'Eigenes Theme',entry,theme,doc});
      }
      this.feedback(results.some(r=>r.status==='rejected')?'Einzelne Displays sind noch nicht bereit. Ihre gespeicherten Designs werden nach dem Laden wieder aufgeführt.':'');this.render();
      this.layoutObserver=new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(this.layoutWidth&&Math.abs(width-this.layoutWidth)>1){cancelAnimationFrame(this.resizeFrame);this.resizeFrame=requestAnimationFrame(()=>{if(!this.closed)this.refreshPreviews();});}this.layoutWidth=width;});this.layoutObserver.observe(h.shadowRoot.querySelector('.design-library'));
    }catch(_){if(!this.closed)this.feedback('Die Bibliothek konnte nicht geladen werden. Bitte erneut öffnen.',true);}
  }
  feedback(text,error=false){const n=this.host.shadowRoot.querySelector('.design-feedback');if(n){n.textContent=text;n.classList.toggle('error',error);}}
  clear(){this.observer?.disconnect();for(const r of this.renderers)r.clear();this.renderers=[];}
  close(){this.closed=true;this.layoutObserver?.disconnect();cancelAnimationFrame(this.resizeFrame);this.clear();for(const url of this.images.values())if(url)URL.revokeObjectURL(url);this.images.clear();if(this.dialog){this.host.PickerControls.unlockPopup(this.dialog);this.dialog.remove();}}
  render(){
    this.clear();const root=this.host.shadowRoot,query=root.querySelector('[data-design-search]').value.trim().toLocaleLowerCase('de'),rows=this.records.filter(r=>(r.name+' '+r.group+' '+r.description).toLocaleLowerCase('de').includes(query));
    const groups=[...new Set(rows.map(r=>r.group))],box=root.querySelector('.design-groups');
    box.innerHTML=groups.map(group=>`<section><h2>${esc(group)}</h2><div class="design-grid">${rows.filter(r=>r.group===group).map(r=>`<article class="design-card" data-design-card="${esc(r.key)}"><div class="design-preview" aria-hidden="true" inert></div><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><div class="design-actions"><button class="primary" data-design-edit="${esc(r.key)}">${r.theme&&this.host.isBuiltinTheme(r.theme.id)?'Kopie bearbeiten':'Bearbeiten'}</button>${this.type==='widgets'?`<button class="secondary" data-design-copy="${esc(r.key)}">${r.widget?'Duplizieren':'Als neues Widget'}</button>`:''}</div></article>`).join('')}</div></section>`).join('')||'<p class="empty-library">Noch keine passenden Designs. Erstelle eine neue Vorlage.</p>';
    for(const kind of ['edit','copy'])box.querySelectorAll('[data-design-'+kind+']').forEach(b=>b.onclick=()=>this.open(this.records.find(r=>r.key===b.dataset[kind==='edit'?'designEdit':'designCopy']),kind==='copy'));
    this.refreshPreviews();
  }
  refreshPreviews(){
    this.clear();
    this.observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){this.observer.unobserve(e.target);this.preview(e.target,this.records.find(r=>r.key===e.target.dataset.designCard));}},{rootMargin:'120px'});
    this.host.shadowRoot.querySelectorAll('[data-design-card]').forEach(card=>{card.querySelector('.design-preview').replaceChildren();this.observer.observe(card);});
  }
  preview(card,record){
    const h=this.host,target=card.querySelector('.design-preview');
    let scene=copy(record.view?.scene||record.doc?.config.views?.find(v=>v.id==='dashboard')?.scene||h.catalog.presets[0].layout.scenes.dashboard);
    let stage=target,values={};
    if(record.theme){scene=h.applyDesignTheme(scene,record.theme.style);scene.elements=[];}
    else{
      const item=copy(record.item),rendering=record.doc?.rendering||record.entry?.rendering,displayRatio=rendering?.width>0&&rendering?.height>0?rendering.width/rendering.height:16/9,ratio=displayRatio*item.width/item.height;
      const width=Math.min(target.clientWidth-28,(target.clientHeight-28)*ratio,4096*item.width/100,4096*item.height/100*ratio),height=width/ratio;
      // Crop a proportional miniature of the source display, never stretch the
      // widget into the gallery card's unrelated aspect ratio.
      target.innerHTML='<div class="design-preview-crop"><div class="design-preview-scene"></div></div>';
      const crop=target.firstElementChild;Object.assign(crop.style,{width:width+'px',height:height+'px',left:(target.clientWidth-width)/2+'px',top:(target.clientHeight-height)/2+'px'});
      stage=crop.firstElementChild;Object.assign(stage.style,{width:100*width/item.width+'px',height:100*height/item.height+'px',left:-item.x*width/item.width+'px',top:-item.y*height/item.height+'px'});
      item.animate=false;scene.elements=[item];values=copy(record.doc?.values||{});
      const state=h.hass.states[item.entity_id];if(state)values[item.entity_id]={...state.attributes,state:state.state,name:state.attributes.friendly_name,...values[item.entity_id]};
    }
    Object.assign(scene,{scroll_height:100,weather_animate:false,weather_impact:false,weather_accumulation:false,media_background_enabled:false});
    const renderer=new window.LGLayoutRenderer(stage,null,true);this.renderers.push(renderer);
    try{renderer.render(scene,values, {hideHdmi:true,now:new Date(),timezone:h.timezone||h.hass.config?.time_zone,nativeFonts:false,imageUrl:id=>this.imageUrl(record.entry?.entry_id,id),message:{title:'Home Assistant',message:'Deine Nachricht'}});}catch(_){renderer.clear();target.textContent=record.name;}
  }
  imageUrl(entry,id){
    if(!entry||!id)return '';
    const key=entry+'/'+id;if(this.images.has(key))return this.images.get(key)||'';
    this.images.set(key,null);
    this.host.hass.fetchWithAuth('/api/display_studio/layout_background/'+key).then(async r=>{
      if(!r.ok)throw Error();const blob=await r.blob();if(this.closed)return;
      this.images.set(key,URL.createObjectURL(blob));this.render();
    }).catch(()=>{});return '';
  }
  async open(record,duplicate=false){
    if(!record||this.opening)return;this.opening=true;
    try{
      const h=this.host;
      if(record.widget||duplicate){await h.openWidgetTemplate(record.widget&&!duplicate?record.widget:null,widgetKind(record.item),duplicate?copy(record.item):null,record.entry?.entry_id,duplicate?record.name+' · Kopie':null);return;}
      await h.switchDisplay(record.entry.entry_id);
      if(h.entryId!==record.entry.entry_id||h.devicesHome)return;
      h.designWorkspace={type:this.type};
      if(record.theme){if(h.isBuiltinTheme(record.theme.id))h.duplicateTheme(record.theme.id);else h.openTheme(record.theme.id);}
      else {await h.openView(record.view.id);h.editWidget(record.item.id);}
      h.updateDesignWorkspace();
    }catch(_){this.feedback('Der Editor konnte nicht geöffnet werden. Bitte erneut versuchen.',true);}
    finally{this.opening=false;}
  }
  async newDesign(){
    if(this.dialog||this.opening)return;
    if(this.type==='widgets'){
      const h=this.host,entry=this.documents[0]?.entry.entry_id;
      this.opening=true;try{await h.prepareWidgetCreation(entry);}catch(_){if(this.closed)h.flash('Der Widgeteditor konnte nicht geöffnet werden. Bitte erneut versuchen.',true);else this.feedback('Der Widgeteditor konnte nicht geöffnet werden. Bitte erneut versuchen.',true);}finally{this.opening=false;}return;
    }
    const d=this.dialog=document.createElement('dialog');d.className='view-creator';d.setAttribute('aria-label','Neues Theme');
    d.innerHTML=`<h2>Neues Theme</h2><label class="field">Display<select data-theme-display>${this.documents.map(({entry})=>`<option value="${esc(entry.entry_id)}">${esc(entry.name)}</option>`).join('')}</select></label><div class="creator-footer"><button class="secondary" data-cancel>Abbrechen</button><button class="primary" data-create ${this.documents.length?'':'disabled'}>Erstellen</button></div>`;
    this.host.shadowRoot.append(d);const close=()=>{d.close();this.host.PickerControls.unlockPopup(d);d.remove();this.dialog=null;};
    d.querySelector('[data-cancel]').onclick=close;d.oncancel=e=>{e.preventDefault();close();};
    d.querySelector('[data-create]').onclick=async()=>{const entry=d.querySelector('select').value;close();await this.host.switchDisplay(entry);this.host.designWorkspace={type:'themes'};this.host.createTheme();this.host.updateDesignWorkspace();};
    this.host.PickerControls.lockPopup(d);d.showModal();
  }
}
