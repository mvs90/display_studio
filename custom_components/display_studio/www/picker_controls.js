// Scroll containers can live outside Studio, including HA's shadow-root panel.
// Each popup owns a reference so closing a nested dialog never unlocks its parent.
const popupLocks=new Map(),scrollLocks=new Map();
const scrollParent=node=>node.assignedSlot||node.parentElement||node.getRootNode()?.host;
export function lockPopup(popup){
  if(popupLocks.has(popup))return;
  const nodes=new Set([document.scrollingElement||document.documentElement]);
  for(let node=scrollParent(popup);node;node=scrollParent(node)){
    if(scrollLocks.has(node)||((node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1)&&/(auto|scroll)/.test(getComputedStyle(node).overflowX+' '+getComputedStyle(node).overflowY)))nodes.add(node);
  }
  // Our symbol dialog is a sibling of its parent dialog in the same shadow root.
  for(const other of popupLocks.keys())for(const node of [other,...other.querySelectorAll('*')]){
    if(node===other||scrollLocks.has(node)||/(auto|scroll)/.test(getComputedStyle(node).overflowX+' '+getComputedStyle(node).overflowY))nodes.add(node);
  }
  nodes.delete(null);
  for(const node of nodes){
    const existing=scrollLocks.get(node);if(existing){existing.count++;continue;}
    const properties=['overflow-x','overflow-y','overscroll-behavior','scrollbar-gutter','scroll-behavior'];
    const saved={count:1,x:node.scrollLeft,y:node.scrollTop,style:properties.map(key=>[key,node.style.getPropertyValue(key),node.style.getPropertyPriority(key)])};
    scrollLocks.set(node,saved);
    if(node.scrollHeight>node.clientHeight)node.style.setProperty('scrollbar-gutter','stable','important');
    node.style.setProperty('overflow-x','hidden','important');node.style.setProperty('overflow-y','hidden','important');
    node.style.setProperty('overscroll-behavior','none','important');node.style.setProperty('scroll-behavior','auto','important');
  }
  const close=()=>unlockPopup(popup);
  popupLocks.set(popup,{nodes,owner:popup.getRootNode(),close});popup.addEventListener('close',close);
}
export function unlockPopup(popup){
  const lock=popupLocks.get(popup);if(!lock)return;
  popupLocks.delete(popup);popup.removeEventListener('close',lock.close);
  for(const node of lock.nodes){
    const saved=scrollLocks.get(node);if(--saved.count)continue;
    scrollLocks.delete(node);
    for(const [key,value,priority] of saved.style)if(key!=='scroll-behavior'){if(value)node.style.setProperty(key,value,priority);else node.style.removeProperty(key);}
    node.scrollLeft=saved.x;node.scrollTop=saved.y;
    const [,value,priority]=saved.style.find(([key])=>key==='scroll-behavior');if(value)node.style.setProperty('scroll-behavior',value,priority);else node.style.removeProperty('scroll-behavior');
  }
}
export function releasePopupLocks(owner){for(const [popup,lock] of [...popupLocks].reverse())if(lock.owner===owner)unlockPopup(popup);}

// Use HA's own searchable entity picker; retain the ordinary field as a fallback
// for standalone editors or while HA is still registering its custom elements.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function enhanceEntityFields(root,host){
  const fields=root.querySelectorAll('[data-draft="entity_id"],input[data-prop="entity_id"],input[data-animation="entity_id"]');
  for(const field of fields){
    if(field._haPicker)continue;
    const upgrade=()=>{
      if(!field.isConnected||field._haPicker)return;
      const picker=document.createElement('ha-entity-picker');
      const options=field.tagName==='SELECT'?field.querySelectorAll('option'):root.querySelector(`#${field.getAttribute('list')}`)?.querySelectorAll('option')||[];
      const allowed=[...options].map(o=>o.value).filter(Boolean);
      Object.assign(picker,{hass:host.hass,label:'Home-Assistant-Entität',value:field.value||undefined,includeEntities:allowed,allowCustomEntity:false,showEntityId:true,placeholder:'Entität auswählen',searchLabel:'Entitäten suchen'});
      picker.className='studio-entity-picker';field._haPicker=picker;
      // Keep the containing label out of the click path: a label must not forward
      // a native picker's click into its hidden legacy input.
      const wrapper=document.createElement('div');wrapper.className='field studio-entity-field';field.closest('label').after(wrapper);wrapper.append(picker);field.closest('label').hidden=true;
      picker.addEventListener('value-changed',event=>{
        event.stopPropagation();const value=event.detail?.value||'';
        if(value&&!allowed.includes(value))return;
        if(value===field.value)return;
        field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));
      });
    };
    if(customElements.get('ha-entity-picker'))upgrade();
    else customElements.whenDefined('ha-entity-picker').then(upgrade);
  }
}
// Use the same native HA field as its selectors, while preserving legacy change handlers.
export function enhanceActionFields(root){
  for(const field of root.querySelectorAll('select[data-draft="tap_action"],select[data-prop="tap_action"]')){
    const upgrade=()=>{
      if(!field.isConnected||field._haSelect)return;
      const picker=document.createElement('ha-select'),label=field.closest('label');
      Object.assign(picker,{label:field.getAttribute('aria-label')||'Touch-Aktion',value:field.value,disabled:field.disabled,clearable:false,options:[...field.options].map(o=>({value:o.value,label:o.textContent,disabled:o.disabled}))});
      field._haSelect=picker;picker.className='studio-action-picker';
      const wrapper=document.createElement('div');wrapper.className='field studio-entity-field';label.after(wrapper);wrapper.append(picker);label.hidden=true;
      picker.addEventListener('selected',event=>{
        event.stopPropagation();const value=event.detail?.value;
        if(field.disabled||!picker.options.some(o=>o.value===value&&!o.disabled)||value===field.value)return;
        picker.value=value;field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));
      });
    };
    if(customElements.get('ha-select'))upgrade();else customElements.whenDefined('ha-select').then(upgrade);
  }
}
export function symbolField(item){
  return `<div class="field symbol-picker"><span>Symbol</span><button type="button" class="symbol-picker-open secondary" data-open-symbol aria-haspopup="dialog" aria-label="Symbol auswählen"><span data-current-symbol aria-hidden="true"></span><span>${escape(window.LGControlSymbols[item.control_icon]||item.control_icon||'Play')}</span><span aria-hidden="true">⌄</span></button></div>`;
}
// Only explicit icon meanings may suggest an action. Domain defaults belong
// to entity widgets, never to arbitrary artwork (e.g. Play on an LED switch).
const symbolIntents={play:'play',pause:'pause',previous:'previous',next:'next',power:'power',volume:'mute',mute:'mute',up:'up',down:'down',left:'left',right:'right',home:'home',back:'back',check:'confirm'};
for(const [intent,roots] of Object.entries({
  play:['play'],pause:['pause'],play_pause:['play-pause'],stop:['stop'],
  previous:['skip-previous'],next:['skip-next'],power:['power'],on:['power-on'],off:['power-off'],
  mute:['volume-high','volume-off','volume-mute'],volume_up:['volume-plus'],volume_down:['volume-minus'],
  up:['chevron-up','arrow-up'],down:['chevron-down','arrow-down'],left:['chevron-left'],right:['chevron-right','arrow-right'],
  home:['home'],back:['arrow-left','keyboard-return','arrow-u-left-top'],confirm:['check'],
  toggle:['toggle-switch','lightbulb','lightbulb-on','led','led-on','led-off','power-plug','power-socket','power-socket-eu','power-socket-us','power-socket-uk','fan'],
  open:['window-shutter-open','blinds-open'],close:['window-shutter','blinds'],
  tilt_open:['blinds-horizontal','blinds-vertical'],tilt_close:['blinds-horizontal-closed','blinds-vertical-closed'],
  press:['gesture-tap','gesture-tap-button','button-pointer'],
}))for(const root of roots)for(const suffix of ['', '-outline','-circle','-circle-outline','-box','-box-outline'])symbolIntents['mdi:'+root+suffix]=intent;
export function symbolActionCandidates(symbol,routed=false){
  const intent=Object.hasOwn(symbolIntents,symbol)?symbolIntents[symbol]:null;
  if(routed){
    // Value controls and destination views need explicit parameters, so they
    // are never inferred from a decorative remote/source/volume icon.
    const actions={play:'av_play_pause',pause:'av_play_pause',play_pause:'av_play_pause',previous:'av_previous',next:'av_next',power:'av_power',mute:'av_mute',volume_up:'av_volume_up',volume_down:'av_volume_down',up:'av_remote_up',down:'av_remote_down',left:'av_remote_left',right:'av_remote_right',home:'av_remote_home',back:'av_remote_menu',confirm:'av_remote_select'};
    return actions[intent]?[actions[intent]]:[];
  }
  return ({play:['media_play_pause','media_play','activate'],pause:['media_play_pause','media_pause','stop_cover','stop_cover_tilt'],play_pause:['media_play_pause'],stop:['media_stop','stop_cover','stop_cover_tilt'],previous:['media_previous_track'],next:['media_next_track'],power:['toggle'],on:['turn_on'],off:['turn_off'],toggle:['toggle'],mute:['media_mute'],volume_up:['volume_up'],volume_down:['volume_down'],up:['volume_up','open_cover'],down:['volume_down','close_cover'],open:['open_cover'],close:['close_cover'],tilt_open:['open_cover_tilt'],tilt_close:['close_cover_tilt'],press:['press'],confirm:['press']})[intent]||[];
}
// HA exposes selectable/enum states in attributes; common entity domains have
// fixed state vocabularies. Also retain current/custom states and saved colors.
export function symbolStates(host,item){
  const id=item.entity_id||item.tap_action?.entity_id,state=host.hass.states[id],domain=(id||'').split('.')[0],attrs=state?.attributes||{};
  const fixed={light:['on','off'],switch:['on','off'],input_boolean:['on','off'],binary_sensor:['on','off'],fan:['on','off'],humidifier:['on','off'],remote:['on','off'],siren:['on','off'],media_player:['off','on','idle','playing','paused','standby','buffering'],cover:['open','opening','closed','closing'],lock:['locked','locking','unlocked','unlocking','jammed','open','opening'],vacuum:['cleaning','docked','idle','paused','returning','error'],alarm_control_panel:['disarmed','armed_home','armed_away','armed_night','armed_vacation','armed_custom_bypass','pending','arming','disarming','triggered'],person:['home','not_home'],device_tracker:['home','not_home'],sun:['above_horizon','below_horizon'],automation:['on','off'],calendar:['on','off'],schedule:['on','off'],update:['on','off'],timer:['idle','active','paused'],lawn_mower:['mowing','docked','paused','error'],camera:['idle','streaming','recording'],weather:['clear-night','cloudy','exceptional','fog','hail','lightning','lightning-rainy','partlycloudy','pouring','rainy','snowy','snowy-rainy','sunny','windy','windy-variant'],climate:attrs.hvac_modes||[],water_heater:attrs.operation_list||[]};
  const options=Array.isArray(attrs.options)?attrs.options:fixed[domain]||[];
  return [...new Set([...options,state?.state,...Object.keys(item.symbol_state_colors||{}),'unknown','unavailable'].filter(s=>typeof s==='string'&&s.trim().length>0&&s.length<=255&&!/[\x00-\x1f]/.test(s)))].slice(0,256).map(value=>{
    let label=value;try{label=state&&host.hass.formatEntityState?host.hass.formatEntityState({...state,state:value}):({on:'Ein',off:'Aus',unknown:'Unbekannt',unavailable:'Nicht verfügbar',playing:'Wiedergabe',paused:'Pausiert',idle:'Inaktiv',open:'Geöffnet',closed:'Geschlossen',opening:'Öffnet',closing:'Schließt'}[value]||value);}catch(_){}
    return {value,label:label===value?value:label+' · '+value};
  });
}
export function symbolStateFields(host,item,attribute='data-prop'){
  let result=`<label class="toggle"><input type="checkbox" ${attribute}="symbol_state_coloring" ${item.symbol_state_coloring?'checked':''}>Nach Status einfärben</label>`;
  if(!item.symbol_state_coloring)return result;
  if(!(item.entity_id||item.tap_action?.entity_id))return result+'<p class="note">Wähle eine Home-Assistant-Entität, um ihre Statusfarben festzulegen.</p>';
  return result+'<div class="symbol-state-colors">'+symbolStates(host,item).map(({value,label})=>`<div class="symbol-state-color"><label class="field">${escape(label)}<input type="color" alpha colorspace="limited-srgb" data-state-color="${escape(value)}" aria-label="Farbe für ${escape(label)}" value="${escape(Object.hasOwn(item.symbol_state_colors||{},value)?item.symbol_state_colors[value]:item.color)}"></label><button type="button" class="small" data-state-color-reset="${escape(value)}" aria-label="Standardfarbe für ${escape(label)}">Standard</button></div>`).join('')+'</div>';
}
function drawIcon(target,key,art){
  const g=window.LGControlGeometry(key,key,{control_icon:key,...(art?{symbol_art:art}:{})}),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 80 80');svg.setAttribute('aria-hidden','true');
  const paths=g.paths||[];
  if(g.fill){const path=document.createElementNS(ns,'path');path.setAttribute('d',paths.map(p=>'M'+p.map(pt=>pt.map(Number).join(',')).join('L')+'Z').join(''));path.setAttribute('fill','currentColor');path.setAttribute('fill-rule','nonzero');svg.append(path);}
  else for(const points of paths){const p=document.createElementNS(ns,'polyline');p.setAttribute('points',points.map(pt=>pt.map(Number).join(',')).join(' '));p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','5');p.setAttribute('stroke-linejoin','round');p.setAttribute('stroke-linecap','round');svg.append(p);}
  target.replaceChildren(svg);
}
export function bindSymbolPicker(root,host,item,onSelect,version){
  const button=root.querySelector('[data-open-symbol]');if(!button)return;
  drawIcon(button.querySelector('[data-current-symbol]'),item.control_icon||'play',item.symbol_art);
  button.onclick=()=>{
    host.symbolPicker?.close();
    host.symbolPicker=new SymbolPicker(host,item,version,button,(key,art)=>{if(button.isConnected)onSelect(key,art);});
    host.symbolPicker.open();
  };
}
class SymbolPicker {
  constructor(host,item,version,opener,onSelect){Object.assign(this,{host,item,version,opener,onSelect,generation:0,limit:48});}
  async index(){
    this.host._symbolIndex ||= fetch(`/display_studio/symbols/index.json?v=${this.version}`).then(r=>{if(!r.ok)throw Error();return r.json();});
    try{return (await this.host._symbolIndex).icons;}catch(error){this.host._symbolIndex=null;throw error;}
  }
  async art(key){
    const chunk=this.catalog[key].chunk;this.host._symbolChunks||=new Map();this.host._symbolPending||=new Map();
    const cache=this.host._symbolChunks,pending=this.host._symbolPending;
    if(!cache.has(chunk)){
      if(!pending.has(chunk))pending.set(chunk,fetch(`/display_studio/symbols/${chunk}.json?v=${this.version}`).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(chunk,data);return data;}).finally(()=>pending.delete(chunk)));
      const data=await pending.get(chunk);if(!data[key])throw Error();return data[key];
    }
    if(!cache.get(chunk)[key])throw Error();return cache.get(chunk)[key];
  }
  open(){
    const d=this.root=document.createElement('dialog');d.className='view-creator symbol-dialog';d.setAttribute('aria-labelledby','symbol-dialog-title');
    d.innerHTML=`<div class="creator-header"><h2 id="symbol-dialog-title">Symbol auswählen</h2><button type="button" class="secondary" data-symbol-cancel aria-label="Symbolauswahl schließen">×</button></div><label class="field">Symbole suchen<input type="search" data-symbol-query aria-label="Symbole suchen" placeholder="Zum Beispiel Licht, Fernbedienung oder mdi:…" autocomplete="off"></label><p class="symbol-results" role="status"></p><div class="symbol-grid"></div><p class="symbol-load-error" role="alert"></p><div class="creator-footer"><button type="button" class="secondary" data-symbol-cancel>Abbrechen</button><button type="button" class="secondary" data-symbol-more>Weitere Symbole</button></div>`;
    this.host.shadowRoot.append(d);d.querySelectorAll('[data-symbol-cancel]').forEach(b=>b.onclick=()=>this.close());d.oncancel=e=>{e.preventDefault();e.stopPropagation();this.close();};
    d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}});
    d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.close();}};
    d.querySelector('[data-symbol-query]').oninput=()=>{clearTimeout(this.timer);this.limit=48;this.timer=setTimeout(()=>this.paint(),120);};
    d.querySelector('[data-symbol-more]').onclick=()=>{this.limit+=48;this.paint();};
    lockPopup(d);d.showModal();this.paint();d.querySelector('input').focus();
    this.index().then(catalog=>{this.catalog=catalog;if(d.isConnected)this.paint();}).catch(()=>{if(d.isConnected){d.querySelector('.symbol-load-error').textContent='Home-Assistant-Symbole konnten nicht geladen werden. Erneut versuchen.';const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Erneut laden';retry.onclick=()=>{this.close();this.opener.click();};d.querySelector('.symbol-load-error').append(retry);}});
  }
  close(){clearTimeout(this.timer);this.generation++;this.root.close();unlockPopup(this.root);this.root.remove();if(this.host.symbolPicker===this)this.host.symbolPicker=null;this.opener?.focus({preventScroll:true});}
  paint(){
    if(!this.root.isConnected)return;
    if(this.catalog)this.root.querySelector('.symbol-load-error').textContent='';
    const generation=++this.generation,terms=this.root.querySelector('input').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const names={...window.LGControlSymbols,...Object.fromEntries(Object.keys(this.catalog||{}).map(k=>[k,k]))};
    const matches=Object.keys(names).filter(k=>terms.every(t=>(k+' '+names[k]+' '+(this.catalog?.[k]?.aliases||[]).join(' ')).toLocaleLowerCase().includes(t)));
    const grid=this.root.querySelector('.symbol-grid');grid.replaceChildren();const queue=[];
    this.root.querySelector('.symbol-results').textContent=matches.length?`${Math.min(this.limit,matches.length)} von ${matches.length} Symbolen`:this.catalog?'Keine passenden Symbole':'Symbole werden geladen …';
    this.root.querySelector('[data-symbol-more]').hidden=matches.length<=this.limit;
    for(const key of matches.slice(0,this.limit)){
      const button=document.createElement('button');button.type='button';button.className='symbol-choice';button.dataset.symbol=key;button.setAttribute('aria-label',names[key]);button.setAttribute('aria-pressed',String(this.item.control_icon===key));
      const icon=document.createElement('span');icon.className='symbol-choice-icon';icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=names[key];button.append(icon,label);grid.append(button);
      const ready=art=>{if(generation!==this.generation||!button.isConnected)return;drawIcon(icon,key,art);button.disabled=false;button.removeAttribute('aria-busy');button.onclick=()=>{this.close();this.onSelect(key,art);};};
      if(key.startsWith('mdi:')){button.disabled=true;button.setAttribute('aria-busy','true');queue.push(async()=>{try{ready(await this.art(key));}catch(_){if(button.isConnected){icon.textContent='!';button.title='Symbol konnte nicht geladen werden';this.root.querySelector('.symbol-load-error').textContent='Einige Symbole konnten nicht geladen werden. Suche erneut, um es noch einmal zu versuchen.';}}});}else ready();
    }
    // Bound concurrent loads; superseded searches cannot paint or commit choices.
    const worker=async()=>{while(queue.length&&generation===this.generation&&this.root.isConnected)await queue.shift()();};
    for(let i=0;i<4;i++)void worker();
  }
}

// Keep the editor's direct-player capabilities aligned with player_controls.py.
// Attribute values matter as well as flags (e.g. seek position and source list).
export function playerControls(state){
  const a=state?.attributes||{},features=Number(a.supported_features)||0;
  const sources=(Array.isArray(a.source_list)?a.source_list:[]).slice(0,64).filter(v=>typeof v==='string'&&v.length>0&&v.length<=180&&!v.includes('\n')).map(v=>({value:v,label:v}));
  const masks={play_pause:state?.state==='playing'?1:16384,previous:16,next:32,seek_back:2,seek_forward:2,volume_down:1028,volume_up:1028,volume_set:4,mute:8,select_source:2048};
  const actions=!state?.entity_id?.startsWith('media_player.')||['unavailable','unknown'].includes(state.state)?[]:Object.keys(masks).filter(key=>{
    if(!(features&masks[key]))return false;
    if(key.startsWith('seek_'))return ['playing','paused','buffering'].includes(state.state)&&Number.isFinite(a.media_position)&&a.media_position>=0&&Number.isFinite(a.media_duration)&&a.media_duration>0;
    if(key==='select_source')return sources.length>0;
    if(['volume_up','volume_down'].includes(key)&&!(features&1024))return Number.isFinite(a.volume_level);
    return true;
  }).map(key=>'player_'+key);
  return {actions,sources};
}
