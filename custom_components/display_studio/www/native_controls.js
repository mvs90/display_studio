/* Adapt editor forms to the components supplied by the running HA frontend.
 * Keep the original controls as the model/validation boundary: existing handlers,
 * form.elements and persistence continue to use the same values and constraints.
 * No HA component implementation or shadow-root CSS is copied into Studio.
 */
const selector='input,select,textarea,button.primary,button.secondary,button.small,button.icon,button.name,button.help-button,button[data-creator-mode],button[data-theme-tab],button[data-add-element]';
const previews='.design-preview,.scene,.widget-preview,.view-thumbnail,.element-preview-scene,.grid-mini,.selection-layer,.widget-part-selection';
const parentLabel=field=>field.closest('label');
function labelText(field){const label=parentLabel(field)?.cloneNode(true);if(!label)return '';label.querySelectorAll('input,select,textarea,button,.ha-native-control,.help-control,output').forEach(n=>n.remove());return label.textContent.trim();}
function descriptor(node,key){for(let proto=Object.getPrototypeOf(node);proto;proto=Object.getPrototypeOf(proto)){const d=Object.getOwnPropertyDescriptor(proto,key);if(d?.get&&d?.set)return d;}}
export class NativeControls {
  constructor(host){
    this.host=host;this.root=host.shadowRoot;this.records=new Map();this.waiting=new Set();this.closed=false;
    Promise.all(['ha-input','ha-button'].map(name=>customElements.whenDefined(name))).then(()=>{
      if(this.closed)return;
      this.observer=new MutationObserver(mutations=>{
        let scan=false;
        for(const m of mutations){
          // Live previews can change each frame; they never contain editor fields.
          if(m.target.closest?.(previews))continue;
          if(this.records.has(m.target))this.sync(this.records.get(m.target));
          if(m.type==='childList'){
            const field=m.target.closest?.('select,button');if(field&&this.records.has(field))this.sync(this.records.get(field));
            if([...m.addedNodes].some(n=>n.nodeType===1&&!n.closest(previews)&&(n.matches(selector)||n.querySelector(selector))))scan=true;
            for(const n of m.removedNodes)if(n.nodeType===1&&[...this.records.keys()].some(f=>n===f||n.contains(f)))scan=true;
          }
        }
        if(scan)this.scan();
      });
      this.observer.observe(this.root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','required','hidden','value','checked','min','max','step','minlength','maxlength','placeholder','title','aria-label','aria-pressed','aria-selected','aria-expanded','role','tabindex']});
      this.scan();
    });
  }
  close(){this.closed=true;this.observer?.disconnect();for(const r of this.records.values())this.restore(r);this.records.clear();}
  restore(r){
    for(const key of r.patched)delete r.field[key];
    for(const [target,type,listener] of r.listeners)target.removeEventListener(type,listener);
    delete r.field._nativeControl;
    if(r.label){if(r.labelFor===null)r.label.removeAttribute('for');else r.label.setAttribute('for',r.labelFor);}
    if(r.display)r.field.style.setProperty('display',r.display,r.displayPriority);else r.field.style.removeProperty('display');
    r.field.classList.remove('ha-native-source');r.native.remove();
  }
  load(name){
    if(this.waiting.has(name))return;this.waiting.add(name);
    customElements.whenDefined(name).then(()=>{this.waiting.delete(name);if(!this.closed)this.scan();});
    // HA's selector loader owns lazy module URLs and loads the matching component.
    const config=name==='ha-textarea'?{text:{multiline:true}}:name==='ha-radio-option'?{select:{mode:'list',options:['']}}:name==='ha-entity-picker'?{entity:{}}:null;
    if(config&&customElements.get('ha-selector')){
      const loader=document.createElement('ha-selector');loader.hidden=true;loader.hass=this.host.hass;loader.selector=config;loader.value='';this.root.append(loader);
      customElements.whenDefined(name).then(()=>loader.remove());
    }
  }
  scan(){
    if(this.closed)return;
    for(const [field,r] of this.records)if(!field.isConnected){this.restore(r);this.records.delete(field);}
    for(const field of this.root.querySelectorAll(selector)){
      if(this.records.has(field)||field._haPicker||field._haSelect||field.closest(previews)||field.closest('ha-selector')||['file','color','hidden'].includes(field.type)||field.multiple)continue;
      const button=field.tagName==='BUTTON';
      const name=button?'ha-button':field.tagName==='SELECT'?'ha-select':field.tagName==='TEXTAREA'?'ha-textarea':field.hasAttribute('list')?'ha-entity-picker':field.type==='checkbox'?'ha-checkbox':field.type==='radio'?'ha-radio-option':field.type==='range'?'ha-slider':'ha-input';
      if(!customElements.get(name)){this.load(name);continue;}
      this.upgrade(field,name);
    }
  }
  upgrade(field,name){
    const focused=this.root.activeElement===field;
    const native=document.createElement(name),r={field,native,patched:[],listeners:[],button:name==='ha-button',display:field.style.getPropertyValue('display'),displayPriority:field.style.getPropertyPriority('display')};
    const listen=(target,type,listener)=>{target.addEventListener(type,listener);r.listeners.push([target,type,listener]);};
    this.records.set(field,r);native.classList.add('ha-native-control');native.dataset.nativeFor=field.id||field.dataset.draft||field.dataset.prop||field.name||'';
    field._nativeControl=native;
    if(r.button){native.classList.add('ha-native-button');native.type='button';if(field.matches('[data-open-symbol]'))native.classList.add('ha-symbol-button');if(field.classList.contains('name'))native.classList.add('ha-layer-name');if(field.classList.contains('help-button'))native.classList.add('ha-native-help');}
    // The stylesheet is replaced during view mounts; hide the source even while
    // that stylesheet is loading, preventing duplicate fields and focus targets.
    field.after(native);field.classList.add('ha-native-source');field.style.setProperty('display','none','important');
    const label=parentLabel(field);
    if(label){
      r.label=label;r.labelFor=label.getAttribute('for');
      // Prevent HTML label default forwarding from toggling the hidden input twice.
      label.htmlFor='studio-native-label';
      listen(label,'click',event=>{
        if(event.composedPath().includes(native)||event.target.closest('button,a,ha-button'))return;
        if(['checkbox','radio'].includes(field.type))field.click();else native.focus();
      });
    }
    const sync=()=>this.sync(r);
    for(const type of ['input','change'])listen(field,type,sync);
    for(const key of ['value','checked','disabled','readOnly','required','hidden']){
      const d=descriptor(field,key);if(!d)continue;
      Object.defineProperty(field,key,{configurable:true,get(){return d.get.call(this);},set(value){const before=d.get.call(this);d.set.call(this,value);if(before!==d.get.call(this))sync();}});r.patched.push(key);
    }
    for(const key of ['focus','select']){field[key]=(...args)=>native[key]?.(...args);r.patched.push(key);}
    listen(field,'invalid',event=>{event.preventDefault();native.invalid=true;native.validationMessage=field.validationMessage;native.focus();});
    const forward=(event,type)=>{
      event.stopPropagation();if(field.disabled)return;
      if(name==='ha-select'){const value=event.detail?.value;if(![...field.options].some(o=>o.value===value&&!o.disabled))return;field.value=value;}
      else if(name==='ha-entity-picker'){const value=event.detail?.value||'';if(value&&!native.includeEntities.includes(value))return;field.value=value;}
      else if(name==='ha-checkbox')field.checked=native.checked;
      else field.value=native.value??'';
      field.dispatchEvent(new Event(type,{bubbles:true}));sync();
    };
    if(r.button)listen(native,'click',event=>{event.stopPropagation();if(!field.disabled)field.click();});
    else if(name==='ha-radio-option')listen(native,'click',event=>{event.stopPropagation();if(!field.disabled){field.click();for(const other of this.records.values())if(other.field.type==='radio')this.sync(other);}});
    else if(name==='ha-select')listen(native,'selected',event=>forward(event,'change'));
    else if(name==='ha-entity-picker')listen(native,'value-changed',event=>forward(event,'change'));
    else for(const type of ['input','change'])listen(native,type,event=>forward(event,type));
    if(field.classList.contains('help-button')){
      for(const type of ['pointerenter','pointerleave'])listen(native,type,event=>field.dispatchEvent(new PointerEvent(type,{pointerType:event.pointerType})));
      for(const type of ['focus','blur'])listen(native,type,()=>field.dispatchEvent(new Event(type)));
    }
    listen(native,'keydown',event=>{
      // The original HTML group retains form ownership. Bridge its keyboard
      // navigation as well as pointer clicks to the visible HA radio options.
      if(name==='ha-radio-option'&&[' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        const group=[...this.records.values()].filter(other=>other.field.type==='radio'&&other.field.name===field.name&&other.field.form===field.form&&!other.field.disabled);
        const index=group.indexOf(r),delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
        const target=event.key===' '?r:event.key==='Home'?group[0]:event.key==='End'?group.at(-1):group[(index+delta+group.length)%group.length];
        target?.native.click();target?.native.focus();return;
      }
      // Explicit source key handlers (e.g. Enter in the new-view name) remain active.
      if(!field.onkeydown)return;
      const key=new KeyboardEvent('keydown',{key:event.key,code:event.code,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,bubbles:false,cancelable:true});
      field.dispatchEvent(key);if(key.defaultPrevented){event.preventDefault();event.stopPropagation();}
    });
    sync();
    if(focused)Promise.resolve(native.updateComplete).then(()=>{if(native.isConnected&&(!this.root.activeElement||this.root.activeElement===field||this.root.activeElement===native))native.focus({preventScroll:true});});
  }
  sync(r){
    const {field,native}=r;if(!field.isConnected)return;
    native.hidden=field.hidden;native.disabled=field.disabled;
    native.setAttribute('aria-label',field.getAttribute('aria-label')||labelText(field)||field.title||field.name||'');
    native.title=field.title||'';
    if(r.button){
      const primary=field.matches('.primary,[data-add-element]'),plain=field.matches('.icon,.help-button,.name');
      native.appearance=primary?'accent':plain?'plain':'outlined';
      native.variant=field.classList.contains('delete')?'danger':primary?'brand':'neutral';
      native.size=field.matches('.small,.icon,.help-button,.name')?'s':'m';
      if(field.matches('[data-creator-mode],[data-theme-tab]'))native.appearance=field.getAttribute('aria-pressed')==='true'||field.getAttribute('aria-selected')==='true'?'accent':'outlined';
      for(const key of ['role','tabindex','aria-selected','aria-controls','aria-describedby','aria-pressed','aria-expanded','aria-haspopup']){if(field.hasAttribute(key))native.setAttribute(key,field.getAttribute(key));else native.removeAttribute(key);}
      if(r.content!==field.innerHTML){r.content=field.innerHTML;native.replaceChildren(...[...field.childNodes].map(n=>n.cloneNode(true)));}
      return;
    }
    if(native.localName==='ha-select'){
      const options=[...field.options].map(o=>({value:o.value,label:o.textContent,disabled:o.disabled})),key=JSON.stringify(options);
      if(r.options!==key){r.options=key;native.options=options;}native.value=field.value;native.required=field.required;return;
    }
    if(native.localName==='ha-entity-picker'){
      const list=this.root.getElementById(field.getAttribute('list'));
      native.hass=this.host.hass;native.includeEntities=[...list?.querySelectorAll('option')||[]].map(o=>o.value).filter(Boolean);
      native.allowCustomEntity=false;native.showEntityId=true;native.value=field.value||undefined;return;
    }
    if(native.invalid&&field.validity?.valid)native.invalid=false;
    native.checked=field.checked;native.required=field.required;
    if(field.type==='radio')native.tabIndex=field.checked?0:-1;
    native.readOnly=field.readOnly;native.readonly=field.readOnly;
    if(native.localName==='ha-input')native.type=field.type;
    native.value=field.type==='range'?Number(field.value):field.value;
    for(const key of ['min','max','step','minlength','maxlength','placeholder','autocomplete','pattern']){
      const value=field.getAttribute(key);if(value!==null)native.setAttribute(key,value);else native.removeAttribute(key);
    }
    if(field.type==='range'){native.min=Number(field.min||0);native.max=Number(field.max||100);native.step=Number(field.step||1);}
    if(native.localName==='ha-textarea'){native.rows=field.rows||3;native.resize='vertical';}
  }
}
