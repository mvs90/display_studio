/* Local Home Assistant layout editor. The LG only runs the small ES5 renderer. */
// Inherit the content fingerprint from the registered panel, including imports.
const VERSION = encodeURIComponent(new URL(import.meta.url).searchParams.get("v") || "development");
const clone = value => JSON.parse(JSON.stringify(value));
const displayNumber = value => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)) : value;
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let helpId=0;
const helpControl=(title,message)=>{
  const id='studio-help-'+(++helpId);
  return `<span class="help-control"><button type="button" class="help-button" aria-label="Informationen zu ${escapeHTML(title)}" aria-expanded="false" aria-controls="${id}" aria-describedby="${id}" popovertarget="${id}">i</button><span id="${id}" class="help-overlay" role="tooltip" popover>${escapeHTML(message)}</span></span>`;
};
const helpHeading=(title,message)=>`<h3 class="help-heading"><span>${escapeHTML(title)}</span>${helpControl(title,message)}</h3>`;
const helpLabel=(title,message)=>`<span class="help-heading"><span>${escapeHTML(title)}</span>${helpControl(title,message)}</span>`;
const bindHelp=root=>root.querySelectorAll('.help-control').forEach(control=>{
  if(control._helpBound)return;control._helpBound=true;
  const button=control.querySelector('button'),overlay=control.querySelector('[popover]');let pinned=false,timer;
  const close=()=>{clearTimeout(timer);if(overlay.matches(':popover-open'))overlay.hidePopover();};
  const open=()=>{
    clearTimeout(timer);if(!overlay.matches(':popover-open'))overlay.showPopover();
    const b=(button._nativeControl||button).getBoundingClientRect(),v=window.visualViewport,left=v?.offsetLeft || 0,top=v?.offsetTop || 0,width=v?.width || innerWidth,height=v?.height || innerHeight;
    overlay.style.maxWidth=Math.max(1,width-24)+'px';overlay.style.maxHeight=Math.max(1,height-24)+'px';
    const box=overlay.getBoundingClientRect();
    overlay.style.left=Math.max(left+12,Math.min(b.right-box.width,left+width-box.width-12))+'px';
    overlay.style.top=Math.max(top+12,Math.min(b.bottom+8,top+height-box.height-12))+'px';
  };
  const leave=()=>{clearTimeout(timer);if(!pinned)timer=setTimeout(close,120);};
  button.onpointerenter=e=>{if(e.pointerType==='mouse')open();};button.onpointerleave=leave;
  overlay.onpointerenter=()=>clearTimeout(timer);overlay.onpointerleave=leave;
  button.onfocus=open;button.onblur=()=>{if(!pinned)close();};
  button.onclick=e=>{e.preventDefault();pinned=!pinned;if(pinned)open();else close();};
  overlay.onbeforetoggle=e=>{button.setAttribute('aria-expanded',String(e.newState==='open'));if(e.newState==='closed')pinned=false;};
});
// Normalize Safari's CSS color serialization into portable sRGB hex + alpha.
const colorValue = value => {
  const byte = x => Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0');
  const hex = (rgb,a=1) => '#'+rgb.map(byte).join('')+(a<1?byte(a*255):'');
  if(/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))return value.toLowerCase().replace(/^(#.{6})ff$/,'$1');
  const context=document.createElement('canvas').getContext('2d');context.fillStyle=value;
  const normalized=context.fillStyle;
  if(normalized[0]==='#')return colorValue(normalized);
  const rgb=normalized.match(/^rgba?\(([^)]+)\)$/),srgb=normalized.match(/^color\(srgb\s+([^)]*)\)$/);
  if(rgb){const n=rgb[1].split(/[,\s/]+/).map(Number);return hex(n.slice(0,3),n[3]??1);}
  if(srgb){const n=srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);return hex(n.slice(0,3).map(v=>v*255),n[3]??1);}
  context.canvas.width=context.canvas.height=1;context.fillStyle=value;context.fillRect(0,0,1,1);
  const pixel=context.getImageData(0,0,1,1).data;return hex(Array.from(pixel).slice(0,3),pixel[3]/255);
};
const opacityField = (attribute,label,value) => `<label class="opacity-field">${label}<span class="opacity-control"><input ${attribute} aria-label="${label}" type="range" min="0" max="1" step="0.01" value="${displayNumber(value)}"><output>${Math.round(value*100)} %</output></span></label>`;
const bindOpacity = (input,checkpoint,update,commit) => {
  let editing=false;
  input.oninput=()=>{if(!editing){checkpoint();editing=true;}const value=Number(input.value);input.parentNode.querySelector('output').textContent=Math.round(value*100)+' %';update(value);};
  input.onchange=()=>{if(!editing)input.oninput();editing=false;commit();};
};
const TEXT_DEFAULTS = {card_style:"standard",text_font:"auto",text_weight:"auto",text_italic:false,text_underline:false,text_scale:100,text_opacity:1,surface_opacity:1,card_accent_opacity:1};
const PART_GEOMETRY = ['x','y','width','height','font_size','frame_width','frame_height','anchor_x','anchor_y','radius'];
const defaultFontSize = kind => kind==='status'?4:3.5;
const CLOCK_SIZES = {clock_small:[20,16],clock_medium:[25,20],clock_large:[40,32],clock_extra_large:[80,60]};
const GRID_TEMPLATES = [
  {id:'free',name:'Freie Fläche',columns:0,rows:0},
  {id:'single',name:'Ein großes Feld',columns:1,rows:1},
  {id:'columns',name:'Zwei Spalten',columns:2,rows:1},
  {id:'rows',name:'Zwei Zeilen',columns:1,rows:2},
  {id:'four',name:'Vier Felder',columns:2,rows:2},
  {id:'six',name:'Sechs Felder',columns:3,rows:2},
  {id:'nine',name:'Neun Felder',columns:3,rows:3},
  {id:'overview',name:'Fünf Felder · asymmetrisch',layout:{axis:'x',weights:[36,64],children:[{axis:'y',weights:[35,65],children:[null,null]},{axis:'y',weights:[65,35],children:[null,{axis:'x',children:[null,null]}]}]}},
  {id:'sidebar',name:'Seitenleiste & Hauptfeld',layout:{axis:'x',weights:[30,70],children:[{axis:'y',weights:[30,32,38],children:[null,null,null]},{axis:'y',weights:[75,25],children:[null,{axis:'x',children:[null,null]}]}]}},
  {id:'main_header',name:'Hauptfeld & Kopfzeile',layout:{axis:'y',weights:[14,86],children:[null,null]}},
  {id:'split_side',name:'Zwei links · eins rechts',layout:{axis:'x',children:[{axis:'y',children:[null,null]},null]}},
  {id:'custom',name:'Eigenes Raster',columns:3,rows:2},
];
// New guides are stored as concrete cells, so saved widgets and insertion
// guides keep the same geometry after reload or a later orientation change.
// Legacy percentage grids below remain untouched. Spacing is measured on the
// shorter display edge, giving equal physical gaps on both axes.
const spacedGrid = (template,ratio,gap=2,margin=2) => {
  const scale={x:Math.min(1,1/ratio),y:Math.min(1,ratio)},cells=[];
  const split=(node,box)=>{
    if(!node){cells.push(Object.fromEntries(Object.entries(box).map(([key,n])=>[key,Number(n.toFixed(8))])));return;}
    const axis=node.axis,extent=axis==='x'?'width':'height',space=gap*scale[axis],weights=node.weights || node.children.map(()=>1),total=weights.reduce((a,b)=>a+b,0);
    const available=box[extent]-(node.children.length-1)*space;let offset=box[axis];
    node.children.forEach((child,i)=>{const size=available*weights[i]/total;split(child,{...box,[axis]:offset,[extent]:size});offset+=size+space;});
  };
  const layout=template.layout || {axis:'y',children:Array.from({length:template.rows},()=>({axis:'x',children:Array(template.columns).fill(null)}))};
  split(layout,{x:margin*scale.x,y:margin*scale.y,width:100-2*margin*scale.x,height:100-2*margin*scale.y});
  return {cells};
};
const gridCells = grid => {
  if(!grid)return [];
  if(Array.isArray(grid.cells))return grid.cells.map((cell,index)=>({...cell,index}));
  const {columns,rows,gap,margin}=grid,width=(100-2*margin-(columns-1)*gap)/columns,height=(100-2*margin-(rows-1)*gap)/rows;
  return Array.from({length:columns*rows},(_,index)=>({index,x:margin+(index%columns)*(width+gap),y:margin+Math.floor(index/columns)*(height+gap),width,height}));
};
const gridOccupied = (cell,items) => items.some(item=>cell.x<item.x+item.width-.01&&cell.x+cell.width>item.x+.01&&cell.y<item.y+item.height-.01&&cell.y+cell.height>item.y+.01);
const WIDGET_SIZES = {animation:[12,12],logo:[40,36],spinner:[12,12],progress:[50,4],media:[50,28],status:[26,24],weather:[32,34],calendar:[40,34],hdmi:[60,60],camera:[34,34]};
const IMAGE_DEFAULTS = {image_background:'color',image_scale_x:100,image_scale_y:100,image_lock_ratio:true};
const WEATHER_DEFAULTS = {weather_entity:'',weather_animate:true,weather_impact:false,weather_accumulation:false,glass:false,weather_condition:"auto",weather_precipitation_mode:"condition",weather_precipitation_entity:""};
const THEME_FIELDS = ['background','color','accent','image_id','image_fit','image_dim',...Object.keys(IMAGE_DEFAULTS),...Object.keys(TEXT_DEFAULTS),...Object.keys(WEATHER_DEFAULTS),'gradient_angle','media_background_enabled','media_background_entity','media_background_fit','media_background_color_source','media_background_dim'];
const THEME_VISUAL_FIELDS = THEME_FIELDS.filter(key=>!key.startsWith('media_background_'));
const themeStyle = scene => {const item=scene.elements.find(i=>i.kind!=='hdmi'&&!i.style_override&&!i.element_theme) || {};const palette=scene.element_palette || {};return {...Object.fromEntries(THEME_FIELDS.map(k=>[k,clone(scene[k] ?? IMAGE_DEFAULTS[k] ?? TEXT_DEFAULTS[k] ?? WEATHER_DEFAULTS[k])])),ink:palette.ink || item.color || '#f2f6fa',surface:palette.surface || item.background || '#122333',card_accent:palette.card_accent || item.accent_color || scene.accent};};
const applyThemeStyle = (scene,style,startup=false) => {scene.element_palette={ink:style.ink,surface:style.surface,card_accent:style.card_accent};for(const key of THEME_VISUAL_FIELDS)scene[key]=clone(style[key] ?? IMAGE_DEFAULTS[key] ?? TEXT_DEFAULTS[key] ?? WEATHER_DEFAULTS[key]);if(startup){if(['solar','weather'].includes(scene.background))scene.background='dawn';scene.weather_entity='';scene.media_background_enabled=false;scene.media_background_entity='';}for(const item of scene.elements)if(item.kind!=='hdmi'&&!item.element_theme&&!item.style_override){Object.assign(item,{color:style.ink,background:style.surface,accent_color:style.card_accent});for(const part of Object.values(item.parts || {}))delete part.color;}return scene;};
const SCENES = {signal:"Mit HDMI",no_signal:"Ohne HDMI",dashboard:"Dashboard",overlay:"Meldung · Overlay",pip:"Meldung · PiP",fullscreen:"Meldung · Vollbild",pip_view:"PiP",media_view:"Mediaplayer"};
const TEMPLATE_CONTEXTS = {hdmi_full:"Nur HDMI",dashboard:"Dashboard",pip_view:"Dashboard PiP",media_view:"Mediaplayer",startup:"Startanzeige",connecting:"Verbindungsaufbau",updating:"Firmwareaktualisierung",overlay:"Mitteilung",pip:"Mitteilung PiP",fullscreen:"Mitteilung Vollbild"};
const CONTEXTS = Object.fromEntries(Object.entries(TEMPLATE_CONTEXTS).filter(([id])=>!["dashboard","pip_view","media_view"].includes(id)));
const NOTIFICATION_CONTEXTS = ["overlay","pip","fullscreen"];
const SYSTEM_CONTEXTS = ["startup","connecting","updating","hdmi_full"];
const SOURCE_CONTEXTS = ["hdmi_full","dashboard","pip_view","media_view"];
const KINDS = {control:"Symbole",slider:"Slider",dropdown:"Dropdown",logo:"Grafik",animation:"Animationen",spinner:"Animationen",progress:"Animationen",hdmi:"HDMI / PiP",camera:"Kamera/Stream",clock:"Uhr & Datum",weather:"Wetter",calendar:"Kalender",entity:"HA-Entität",status:"Statuskarte",switch:"HA-Schalter",button:"HA-Button",media:"Medienplayer",text:"Text",message:"Meldungsfenster"};
const isSymbol = item => item.kind==='control' && (item.control_type || 'icon')==='icon';
const controlName = item => isSymbol(item)?'Symbole · '+(window.LGControlSymbols[item.control_icon || 'play'] || item.control_icon || window.LGControlSymbols.play):item.control_type==='slider'?'Slider':'Dropdown';
const isAnimation = item => ['animation','spinner','progress'].includes(item.kind);
const canEditWidget = item => !!item && !['hdmi','logo'].includes(item.kind) && !isAnimation(item) && !isSymbol(item);
const animationPart = item => item.parts?.[item.kind] || {};
// Stable maximum ink bounds, independent of the current animation phase.
// Keep the runtime layout untouched; this is the editor's selection frame.
const animationInkRect = node => {
  const visual=node?._animationVisual;if(!visual)return null;
  let rect=visual.getBoundingClientRect();if(!rect.width || !rect.height)return null;
  const svg=visual.querySelector('svg');
  if(svg){
    if(visual.classList.contains('lg-startup-spinner')){
      const style=getComputedStyle(svg),width=parseFloat(style.width),height=parseFloat(style.height);
      if(!width || !height)return null;
      rect={x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
    }else{
      const view=svg.viewBox.baseVal,outer=svg.getBoundingClientRect(),scale=Math.min(outer.width/view.width,outer.height/view.height);
      const bounds=Array.from(svg.querySelectorAll('circle,rect')).map(shape=>{
        const n=key=>Number(shape.getAttribute(key));
        return shape.tagName.toLowerCase()==='circle'?[n('cx')-n('r'),n('cy')-n('r'),n('r')*2,n('r')*2]:[n('x'),n('y'),n('width'),n('height')];
      });
      if(!bounds.length)return null;
      const x=Math.min(...bounds.map(b=>b[0])),y=Math.min(...bounds.map(b=>b[1]));
      const width=Math.max(...bounds.map(b=>b[0]+b[2]))-x,height=Math.max(...bounds.map(b=>b[1]+b[3]))-y;
      rect={x:outer.x+(outer.width-view.width*scale)/2+(x-view.x)*scale,y:outer.y+(outer.height-view.height*scale)/2+(y-view.y)*scale,width:width*scale,height:height*scale};
    }
  }
  return new DOMRect(rect.x-3,rect.y-3,rect.width+6,rect.height+6);
};
const graphicName = item => 'Grafik · '+(item.graphic_id==='custom'?'Custom':(window.LGGraphics[item.graphic_id || 'esphome']?.name || 'ESPHome'));
const elementName = item => item.kind==='camera'?KINDS.camera:isSymbol(item)?controlName(item):item.kind==='logo'?graphicName(item): item.kind === 'clock' ? KINDS.clock : isAnimation(item) ? 'Animation · '+window.LGAnimations[item.kind==='animation'?(item.animation_type || 'spinner'):item.kind].label : item.label || KINDS[item.kind];
const BACKGROUNDS = {homekit:"Home · Himmel & Gold",solid:"Einfarbig",aurora:"Aurora",dawn:"Warmer Verlauf",ocean:"Ozean",sand:"Sand",midnight:"Mitternacht",solar:"Sonnenstand",weather:"Live-Wetter · Himmel & Niederschlag",gradient:"Eigener Verlauf",image:"Eigenes Bild"};
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M5 6h7M5 9h4"/></svg>';
const options = (items, value) => Object.entries(items).map(([key,label]) => `<option value="${escapeHTML(key)}" ${key === value ? "selected" : ""}>${escapeHTML(label)}</option>`).join("");

// Editor-only ink bounds. Keep the renderer's layout/wrapping boxes intact:
// shrinking those to glyph height would clip accents/descenders on the ESP.
// Measure real DOM line breaks and canvas glyph extents, excluding font leading.
const textInkCache = new WeakMap(), textBaselines = new Map();
let textMeasureContext;
const glyphInk = (context,text,font,spacing) => {
  // WebKit sometimes reports advance widths as actualBoundingBoxRight. Scan a
  // cached offscreen glyph raster instead; this runs only in the editor when
  // text/font/wrapping changes, never in the display's rendering loop.
  context.font=font;context.letterSpacing=spacing+'px';
  const size=parseFloat(font.match(/([\d.]+)px/)[1]),origin=Math.ceil(size);
  const widthNeeded=Math.ceil(context.measureText(text).width+origin*3),heightNeeded=origin*4;
  const scale=Math.min(1,2048/Math.max(1,widthNeeded),1024/Math.max(1,heightNeeded));
  context.canvas.width=Math.max(1,Math.ceil(widthNeeded*scale));context.canvas.height=Math.max(1,Math.ceil(heightNeeded*scale));
  context.font=font;context.letterSpacing=spacing+'px';context.textAlign='left';context.textBaseline='alphabetic';
  context.scale(scale,scale);context.fillStyle='#fff';context.fillText(text,origin,origin*2);
  const {width,height}=context.canvas,data=context.getImageData(0,0,width,height).data;
  let left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>16){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  return {left:left/scale-origin,top:top/scale-origin*2,right:right/scale-origin,bottom:bottom/scale-origin*2};
};
const textInkRect = el => {
  if(!el)return null;
  const rect=el.getBoundingClientRect(),css=getComputedStyle(el);
  if(!rect.width||!rect.height||css.display==='none')return rect;
  const font=[css.fontStyle,css.fontVariant,css.fontWeight,css.fontSize,css.fontFamily].join(' ');
  const key=[el.textContent,rect.width,rect.height,font,css.lineHeight,css.letterSpacing,css.whiteSpace,css.textAlign,css.textTransform,css.overflow,css.textOverflow,document.fonts?.status].join('|');
  let ink=textInkCache.get(el);
  if(!ink||ink.key!==key){
    const context=textMeasureContext ||= document.createElement('canvas').getContext('2d');
    context.font=font;context.textAlign='left';context.textBaseline='alphabetic';
    let baseline=textBaselines.get(font);
    if(baseline===undefined){
      const probe=document.createElement('span'),mark=document.createElement('span');
      probe.style.cssText='position:fixed;left:0;top:0;visibility:hidden;white-space:pre;padding:0;border:0;margin:0;';probe.style.font=font;
      probe.append(document.createTextNode('Mg'));mark.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline;';probe.append(mark);
      el.getRootNode().append(probe);
      const range=document.createRange();range.selectNodeContents(probe.firstChild);
      baseline=mark.getBoundingClientRect().top-range.getBoundingClientRect().top;probe.remove();
      if(textBaselines.size>64)textBaselines.clear();textBaselines.set(font,baseline);
    }
    const lines=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),range=document.createRange();
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      let offset=0;
      for(const char of node.data){
        range.setStart(node,offset);offset+=char.length;range.setEnd(node,offset);
        const r=range.getBoundingClientRect();if(!r.width||!r.height||char==='\n')continue;
        let line=lines.find(row=>Math.abs(row.top-r.top)<.5);
        if(!line){line={top:r.top,left:r.left,text:''};lines.push(line);}
        line.left=Math.min(line.left,r.left);line.text+=char;
      }
    }
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    const spacing=parseFloat(css.letterSpacing)||0;
    for(const line of lines){
      let text=line.text;if(css.textTransform==='uppercase')text=text.toUpperCase();else if(css.textTransform==='lowercase')text=text.toLowerCase();
      if(!text.trim())continue;
      const glyph=glyphInk(context,text,font,spacing);
      left=Math.min(left,line.left+glyph.left);right=Math.max(right,line.left+glyph.right);
      top=Math.min(top,line.top+baseline+glyph.top);bottom=Math.max(bottom,line.top+baseline+glyph.bottom);
    }
    if(css.overflow!=='visible'){left=Math.max(left,rect.left);right=Math.min(right,rect.right);top=Math.max(top,rect.top);bottom=Math.min(bottom,rect.bottom);}
    ink={key,left:Number.isFinite(left)?left-rect.left:0,top:Number.isFinite(top)?top-rect.top:0,width:Math.max(0,Number.isFinite(right-left)?right-left:0),height:Math.max(0,Number.isFinite(bottom-top)?bottom-top:0)};
    textInkCache.set(el,ink);
  }
  return {left:rect.left+ink.left,top:rect.top+ink.top,width:ink.width,height:ink.height};
};

// Capture rendered content once at the beginning of an edit. Relative boxes
// keep nested groups stable; explicit font sizes avoid viewport-dependent text
// staying behind when its widget is resized. Never store preview pixel sizes.
const contentGeometry = (item,node) => {
  if(!node)return [];
  const entries=window.LGWidgetParts.catalog(item);
  return entries.flatMap(part=>{
    const el=window.LGWidgetParts.find(node,part),parent=part.parent?window.LGWidgetParts.find(node,entries.find(p=>p.id===part.parent)):node;
    if(!el||!parent)return [];
    const css=getComputedStyle(el),r=el.getBoundingClientRect(),b=parent.getBoundingClientRect();
    if(css.display==='none'||!r.width||!r.height||!b.width||!b.height)return [];
    const x=Math.max(0,Math.min(99,(r.left-b.left)/b.width*100)),y=Math.max(0,Math.min(99,(r.top-b.top)/b.height*100));
    const box={x,y,width:Math.max(1,Math.min(100-x,r.width/b.width*100)),height:Math.max(1,Math.min(100-y,r.height/b.height*100))};
    return [{id:part.id,box,font:part.text?(item.kind==='clock'&&item.clock_base_height?parseFloat(css.fontSize)/b.height*100:item.parts?.[part.id]?.font_size ?? parseFloat(css.fontSize)/b.height*100):null}];
  });
};
const resizeRatio = (old,width,height) => {
  const dx=width-old.width,dy=height-old.height;
  // Continuous projection, anchored to the pointer-down geometry.
  return 1+(dx*old.width+dy*old.height)/(old.width*old.width+old.height*old.height);
};
const scaleContent = (item,original,contents,ratio) => {
  if(!contents.length)return;
  item.font_size=Math.max(1,Math.min(18,original.font_size*ratio));
  item.parts ||= {};
  for(const part of contents){
    const conf=item.parts[part.id] ||= {};
    Object.assign(conf,part.box);
    if(part.font!==null)conf.font_size=Math.max(1,Math.min(item.kind==='text'?10000:100,part.font*ratio*original.height/item.height));
  }
};
// Text handles preserve proportions: horizontal OR vertical dragging changes
// the font and both dimensions. Bounds constrain the frame, not the chosen font.
const scaleTextBox = (box,font,ratio,maxFont=100,ink=box) => {
  ratio=Math.max(1/font,Math.min(maxFont/font,(100-ink.x)/ink.width,(100-ink.y)/ink.height,ratio));
  return {...box,width:Math.max(1,Math.min(100-box.x,box.width*ratio)),height:Math.max(1,Math.min(100-box.y,box.height*ratio)),font_size:font*ratio};
};

const relativeRect = (rect,parent) => ({x:rect.left-parent.left,y:rect.top-parent.top,width:rect.width,height:rect.height});
// Work in preview pixels so the magnetic range stays gentle at every zoom.
// Peer geometry is captured once on pointer-down, never written to the layout.
const alignMove = (box,area,peers,limits,free=false) => {
  const result={...box},lines=[];
  for(const axis of ['x','y']){
    const size=axis==='x'?'width':'height',cross=axis==='x'?'y':'x',span=axis==='x'?'height':'width';
    const [min,max]=limits[axis],clamp=value=>Math.max(min,Math.min(max,value));
    result[axis]=clamp(box[axis]);if(free)continue;
    const start=result[axis],length=box[size],candidates=[];
    const offer=(position,guides,priority=0)=>{const distance=Math.abs(position-start);if(distance<=6&&position>=min-.01&&position<=max+.01)candidates.push({position:clamp(position),distance,priority,guides});};
    for(const peer of [area,...peers])for(const target of [peer[axis],peer[axis]+peer[size]/2,peer[axis]+peer[size]])for(const offset of [0,length/2,length]){
      offer(target-offset,[{axis,at:target,from:Math.min(box[cross],peer[cross]),to:Math.max(box[cross]+box[span],peer[cross]+peer[span]),kind:'align'}]);
    }
    // Balance the free space between the nearest neighbours on this row/column.
    const row=peers.filter(peer=>Math.min(box[cross]+box[span],peer[cross]+peer[span])-Math.max(box[cross],peer[cross])>1);
    const before=row.filter(peer=>peer[axis]+peer[size]<=start+6).sort((a,b)=>b[axis]+b[size]-a[axis]-a[size])[0];
    const after=row.filter(peer=>peer[axis]>=start+length-6).sort((a,b)=>a[axis]-b[axis])[0];
    if(before&&after){
      const left=before[axis]+before[size],right=after[axis],gap=(right-left-length)/2,position=left+gap;
      if(gap>=0)offer(position,[{axis:cross,at:box[cross]+box[span]/2,from:left,to:position,kind:'gap'},{axis:cross,at:box[cross]+box[span]/2,from:position+length,to:right,kind:'gap'}],1);
    }
    candidates.sort((a,b)=>a.distance-b.distance||b.priority-a.priority);
    if(candidates.length){result[axis]=candidates[0].position;lines.push(...candidates[0].guides);}
  }
  return {box:result,lines};
};
const resizeTargets = (box,area,peers,axis) => {
  const size=axis==='x'?'width':'height',cross=axis==='x'?'y':'x',span=axis==='x'?'height':'width';
  const edge=(peer,at)=>({length:at-box[axis],lines:[{axis,at,from:Math.min(box[cross],peer[cross]),to:Math.max(box[cross]+box[span],peer[cross]+peer[span]),kind:'align'}]});
  return [area,...peers].flatMap(peer=>[peer[axis],peer[axis]+peer[size]/2,peer[axis]+peer[size]].map(at=>edge(peer,at))).concat(peers.map(peer=>({length:peer[size],lines:[box,peer].map(r=>({axis:cross,at:r[cross]+r[span]/2,from:r[axis],to:r[axis]+peer[size],kind:'size'}))})));
};
const resizeLines = (box,area,peers) => ['x','y'].flatMap(axis=>{
  const size=axis==='x'?'width':'height',target=resizeTargets(box,area,peers,axis).find(t=>Math.abs(t.length-box[size])<.6);
  return target?.lines || [];
});
// A locked ratio has only one degree of freedom: choose the closest valid
// corner, rather than snapping width and height separately and distorting it.
const alignResize = (original,width,height,area,peers,limits,locked,free=false) => {
  const clamp=(n,[min,max])=>Math.max(min,Math.min(max,n));let box={...original};
  const minRatio=Math.max(limits.width[0]/original.width,limits.height[0]/original.height),maxRatio=Math.min(limits.width[1]/original.width,limits.height[1]/original.height);
  if(locked){const ratio=clamp(resizeRatio(original,width,height),[minRatio,maxRatio]);box.width=original.width*ratio;box.height=original.height*ratio;}
  else{box.width=clamp(width,limits.width);box.height=clamp(height,limits.height);}
  if(!free){
    const candidates=[];
    for(const axis of ['x','y']){
      const size=axis==='x'?'width':'height',matches=[];
      for(const target of resizeTargets(box,area,peers,axis)){
        if(target.length<limits[size][0]||target.length>limits[size][1])continue;
        const candidate={...box,[size]:target.length};
        if(locked){const ratio=target.length/original[size];if(ratio<minRatio||ratio>maxRatio)continue;candidate.width=original.width*ratio;candidate.height=original.height*ratio;}
        const distance=Math.hypot(candidate.width-box.width,candidate.height-box.height);
        if(distance<=6)matches.push({box:candidate,distance});
      }
      matches.sort((a,b)=>a.distance-b.distance);
      if(matches.length){if(locked)candidates.push(matches[0]);else box[size]=matches[0].box[size];}
    }
    if(locked&&candidates.length){candidates.sort((a,b)=>a.distance-b.distance);box=candidates[0].box;}
  }
  return {box,lines:free?[]:resizeLines(box,area,peers)};
};
class AlignmentGuides {
  constructor(layer,offset={x:0,y:0}){this.node=document.createElement('div');this.node.className='alignment-guides';this.node.setAttribute('aria-hidden','true');layer.append(this.node);this.offset=offset;}
  show(lines){
    const key=JSON.stringify(lines);if(key===this.key)return;this.key=key;
    this.node.replaceChildren(...lines.map(line=>{const el=document.createElement('i'),vertical=line.axis==='x';el.className='alignment-guide';el.dataset.axis=line.axis;el.dataset.kind=line.kind;
      Object.assign(el.style,{left:(vertical?line.at:line.from)+this.offset.x+'px',top:(vertical?line.from:line.at)+this.offset.y+'px',width:vertical?'0':Math.max(0,line.to-line.from)+'px',height:vertical?Math.max(0,line.to-line.from)+'px':'0'});return el;}));
  }
  close(){this.node.remove();}
}

class DisplayStudio extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:"open"}); this.sceneKey="signal"; this.selected=null;
    this.transitionMode="none"; this.dirty=false; this.busy=false; this.history=[]; this.future=[]; this._generation=0;
  }
  set hass(value) {
    const avChanged=Object.values(this.backendValues || {}).some(row=>row.av_routed && (row.av_dependencies || []).some(id=>this._hass?.states[id]!==value.states[id]));
    this._hass=value;
    this.shadowRoot.querySelectorAll('.studio-entity-picker').forEach(picker=>picker.hass=value);
    if(avChanged && !['devices','designs'].includes(this.page))this.refreshValues();
    if (this.isConnected && !this.started) this.start();
    else if (this.renderer && !this._updateTimer) this._updateTimer=setTimeout(() => {this._updateTimer=null; if(this.isConnected){this.paint();this.refreshMediaControls();}},300);
  }
  get hass() {return this._hass;}
  connectedCallback() {if(this._hass && !this.started) this.start();}
  disconnectedCallback() {
    this.nativeControls?.close();this.nativeControls=null;
    this.PickerControls?.releasePopupLocks(this.shadowRoot);
    this.designLibrary?.close();this.devicesHome?.close();this.symbolPicker?.close();this.elementPicker?.close();void this.stopLive();this.widgetEditor?.close();this._generation++; this.started=false;this.renderer?.clear();
    clearTimeout(this._updateTimer); this._updateTimer=null; clearInterval(this._clock);
    clearInterval(this._dataTimer); clearTimeout(this._dataSoon);
    this._resize?.disconnect(); this._resize=null;this.releaseImages();
  }
  async start() {
    this.started=true; this.dirty=false; const generation=++this._generation;
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="/display_studio/studio.css?v=${VERSION}"><link rel="stylesheet" href="/display_studio/layout.css?v=${VERSION}"><div class="empty">Display Studio wird geladen …</div>`;
    try {
      await Promise.all([import(`/display_studio/camera-runtime.js?v=${VERSION}`),import(`/display_studio/weather.js?v=${VERSION}`),import(`/display_studio/cards.js?v=${VERSION}`),import(`/display_studio/layout-runtime.js?v=${VERSION}`)]);
      await window.LGLoadNativeFonts();
      ({CameraPreview:this.CameraPreview,bindCameraCrop:this.bindCameraCrop}=await import(`/display_studio/camera_preview.js?v=${VERSION}`));
      this.catalog=await this.hass.callApi("GET","display_studio/layouts");
      if(generation!==this._generation || !this.isConnected) return;
      ({DisplayDevices:this.DisplayDevices}=await import(`/display_studio/devices.js?v=${VERSION}`));
      this.PickerControls=await import(`/display_studio/picker_controls.js?v=${VERSION}`);
      const {NativeControls}=await import(`/display_studio/native_controls.js?v=${VERSION}`);this.nativeControls?.close();this.nativeControls=new NativeControls(this);
      ({ElementPicker:this.ElementPicker}=await import(`/display_studio/element_picker.js?v=${VERSION}`));
      ({DesignLibrary:this.DesignLibrary,widgetKind:this.pickerKind}=await import(`/display_studio/design_library.js?v=${VERSION}`));
      await this.showDevices();
    } catch(error) { if(generation===this._generation) this.shadowRoot.querySelector('.empty').textContent="Der Editor konnte nicht geladen werden. Bitte als Administrator anmelden und erneut öffnen."; }
  }
  accept(doc) {const entry=this.catalog.entries.find(e=>e.entry_id===this.entryId);if(doc.rendering&&entry)entry.rendering=doc.rendering;this.rotationDraft=null;this.editSession=null;this.cameraDescriptor=doc.camera_preview ?? this.catalog.entries.find(e=>e.entry_id===this.entryId)?.camera_preview;this.startupStatus=doc.startup_design;this.suggestions=[];this.suggestionArea="";this._suggestionRequest=(this._suggestionRequest || 0)+1;this.releaseImages();this.backgrounds=doc.backgrounds || [];this.backendSun=doc.sun;this.config=this.withViews(clone(doc.config));this.viewId=this.config.views.find(v=>this.supportsView(v.id))?.id;this.revision=doc.revision;this.saved=clone(this.config);this.backendValues=doc.values || {};this.timezone=doc.timezone || this.hass.config?.time_zone || "Europe/Berlin";this.dirty=false;this.selected=null;this.history=[];this.future=[];}
  mount() {
    this.PickerControls?.releasePopupLocks(this.shadowRoot);
    this.symbolPicker?.close();this.elementPicker?.close();this.widgetEditor?.close();const selection=this.shadowRoot.querySelector('.selection-layer');if(selection)this.shadowRoot.querySelector('.stage')?.appendChild(selection);this.renderer?.clear();clearInterval(this._clock);clearInterval(this._dataTimer);this._resize?.disconnect();
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="/display_studio/studio.css?v=${VERSION}"><link rel="stylesheet" href="/display_studio/layout.css?v=${VERSION}">
      <header><button class="secondary" data-action="devices">← Alle Displays</button><div class="logo">${icon}</div><div><h1>Display Studio</h1><p>Dein Zuhause. Auf deinem Bildschirm.</p></div><div class="spacer"></div><strong class="current-display">${escapeHTML(this.catalog.entries.find(e=>e.entry_id===this.entryId)?.name || 'Display')}</strong>${this.displayRendering?.rotation_supported?`<label class="display-orientation">Drehung <select id="display-rotation" aria-label="Display-Drehung" title="Vorschau sofort · Display erst nach Speichern. Gilt für alle Ansichten.">${options({0:"0° · Standard",90:"90°",180:"180°",270:"270°"},String(this.displayRendering.rotation ?? 0))}</select><small>${this.displayRendering.width} × ${this.displayRendering.height}</small></label>`:""}<div class="toolbar"><span class="status" role="status"></span><button class="secondary" data-action="undo" title="Rückgängig">↶</button><button class="secondary" data-action="redo" title="Wiederholen">↷</button><button class="primary" data-action="save">Speichern</button></div></header>
      <div class="notice" hidden></div><div class="overview"><div class="gallery-heading"><div><p class="eyebrow">DEINE ANSICHTEN</p><h2>Ein Platz für jeden Moment.</h2><p>Gespeicherte Designs für Fernsehen, Alltag und Meldungen.</p></div><button class="secondary" data-action="browser-link" ${this.hardwareHdmi?'hidden':''}>${this.catalog.entries.find(e=>e.entry_id===this.entryId)?.provider==='esphome'?'ESPHome-Konfiguration':'Anzeigelink'}</button><button class="primary" data-action="new-view">＋ Neue Ansicht</button></div><div class="gallery-flash" role="status"></div><dialog class="view-creator" aria-labelledby="new-view-title"></dialog><section class="primary-views" aria-labelledby="views-heading"><h2 id="views-heading">Ansichten</h2><div class="view-gallery primary-gallery"></div></section><section class="notification-views" aria-labelledby="notifications-heading"><h2 id="notifications-heading">Mitteilungen</h2><p>Gestalte Überblendungen, PiP- und Vollbildmeldungen unabhängig von deinen Ansichten.</p><div class="view-gallery notification-gallery"></div></section><section class="system-views" aria-labelledby="system-views-heading"><h2 id="system-views-heading">Systemansichten</h2><div class="view-gallery system-gallery"></div></section><section class="template-gallery"><div class="gallery-heading"><div><h2>Themes & Hintergründe</h2><p>Ein gemeinsamer Stil für alle Ansichten. Eigene Abweichungen bleiben erhalten.</p></div></div><p class="theme-manager-status"></p><button class="small" data-action="weather-theme">☁ Wetter &amp; Glas erstellen</button><button class="small" data-action="all-follow-theme">Alle Ansichten dem Standard folgen lassen</button><div class="template-options"></div></section></div><div class="editor-navigation"><button class="secondary" data-action="overview">← Alle Ansichten</button><label><span id="editor-name-label">Name der Ansicht</span><input id="view-name" maxlength="80"></label><span class="view-usage"></span><button class="small" data-action="theme-follow">Theme-Standard wiederherstellen</button><button class="small" data-action="theme-use">Als Standard für alle Ansichten</button><button class="primary" data-action="theme-use-view" hidden>Für diese Ansicht verwenden</button><label class="theme-id-field" hidden>Theme-ID für Automationen<input id="theme-id" readonly></label><button class="small" data-action="reset-view">Standard wiederherstellen</button><button class="secondary" data-action="cancel-edit">Abbrechen</button><button class="primary" data-action="finish-edit">Fertig</button></div><div class="workspace">
      <main class="main"><p class="context-hint"></p><p class="startup-cache-status note" role="status" hidden></p><div class="preview-label"><span id="scene-title"></span><span>16:9 · HDMI-Platzhalter · Live-Entitäten</span></div><div class="frame"><div class="stage"><div class="scene"><div class="lg-hdmi-placeholder">HDMI</div></div><div class="selection-layer"></div></div></div><div class="view-scroll-settings"><label class="field">Ansicht scrollen<select id="view-scroll">${options({100:"Aus · eine Bildschirmhöhe",150:"Vertikal · 1,5 Bildschirmhöhen",200:"Vertikal · 2 Bildschirmhöhen",300:"Vertikal · 3 Bildschirmhöhen",400:"Vertikal · 4 Bildschirmhöhen"},String(this.scene.scroll_height || 100))}</select></label><p class="note">Wischen am Display oder Trackpad/Mausrad in der Vorschau. Der Hintergrund bleibt stehen.</p></div><div class="live-controls"><button class="secondary" data-action="interaction-preview" aria-pressed="false">Bedienvorschau</button><button class="secondary live-button" data-action="live" aria-pressed="false"><span class="live-dot" aria-hidden="true"></span>Live</button><span class="live-status" role="status">Entwurf auf dem Display ansehen · dauerhaft erst nach Speichern.</span></div><p class="hint">Element anklicken und ziehen · Größe über die Ecke ändern · Hilfslinien: Mitte, Kanten und gleiche Abstände · Alt/⌥: ohne Einrasten · Pfeiltasten: 1 %, mit Umschalt: 0,1 %</p><div class="flash" aria-live="polite"></div><details class="automation-help"><summary>Ansicht in Automationen verwenden</summary><label class="field">Ansichts-ID<input id="automation-view-id" readonly></label><p class="note">Unter Einstellungen → Automatisierungen &amp; Szenen → Blaupausen die Vorlage „Display Studio · Ereignisansicht mit automatischer Rückkehr“ wählen. Auslöser, diese ID und Anzeigedauer eintragen. Manuelle Bedienung beendet die automatische Rückkehr. Die Aktion <code>display_studio.show_view</code> unterstützt außerdem <code>theme</code>: Hier eine Theme-ID aus der Übersicht eintragen, um beim Anzeigen auch das globale Theme zu wählen. Individuelle Abweichungen bleiben erhalten; die Anzeigedauer setzt das Theme nicht zurück.</p></details><section class="message-test" hidden><h2>Meldung ausprobieren</h2><textarea id="test-message" aria-label="Testnachricht">Die Waschmaschine ist fertig.</textarea><div class="row"><select id="test-layout" aria-label="Nachrichtenlayout">${options((this.hardwareHdmi||this.nativeLvgl)?{overlay:'Overlay',pip:'PiP',fullscreen:'Vollbild'}:{overlay:'Overlay',fullscreen:'Vollbild'},'overlay')}</select><button class="secondary" data-action="test">10 Sekunden anzeigen</button></div><p class="note">Verwendet das gespeicherte Layout. Für die Anzeige muss die App verbunden sein.</p></section><details class="room-suggestions" open><summary>Karten aus deinem Raum</summary><label>Raum für Kartenvorschläge<select id="suggestion-room"><option value="">Raum wählen</option></select></label><button class="small" data-action="suggestions">Vorschläge aktualisieren</button><p class="note room-hint"></p><div class="suggestions"></div></details><section class="cover-background-tools"><h2>Cover-Hintergrund</h2><div class="background-player-field field"><label for="media-background-entity">Hintergrund-Medienplayer</label><div class="background-player-row"><select id="media-background-entity"></select><button type="button" class="small background-player-clear" id="clear-background-player" title="Hintergrund-Medienplayer entfernen" aria-label="Hintergrund-Medienplayer entfernen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div></div><div class="cover-background-settings" hidden><label class="field"><input id="media-background-enabled" type="checkbox">Bei Wiedergabe anzeigen</label><label class="field">Cover darstellen<select id="media-background-fit">${options({colors:'Nur Coverfarben · ohne Bild',stretch:'Gestreckt · ganze Fläche',contain:'Skaliert · vollständig einpassen',center:'Mittig · ohne Vergrößern'},this.scene.media_background_fit || 'contain')}</select></label><label class="field">Farben für den Hintergrund<select id="media-background-color-source">${options({edges:"Coverränder",cover:"Gesamtes Cover"},this.scene.media_background_color_source || "edges")}</select></label><label class="field">Cover und Farbverlauf abdunkeln<input id="media-background-dim" type="range" min="0" max="0.9" step="0.05"></label><p class="note">Nur während der Wiedergabe. Wähle, ob die Coverränder oder die gesamte Bildfläche die Farben des Verlaufs bestimmen. Die Randerkennung überspringt schwarze Außenstreifen bis zum Bildinhalt. „Nur Coverfarben“ blendet das Hintergrundbild aus. Bei Pause, Stopp oder fehlendem Cover erscheint der normale Hintergrund. Der Player ist unabhängig von den Karten wählbar.</p></div></section><section class="view-styling"><h2>Hintergrund &amp; Themes</h2><label class="styling-toggle"><input type="checkbox" id="own-styling">Eigenes Styling</label><p class="styling-status note"></p><div class="appearance-controls" hidden><div class="theme-settings-tabs" role="tablist" aria-label="Theme-Einstellungen" hidden><button type="button" role="tab" id="theme-tab-background" aria-controls="theme-panel-background" data-theme-tab="background">Hintergrund</button><button type="button" role="tab" id="theme-tab-colors" aria-controls="theme-panel-colors" data-theme-tab="colors">Text &amp; Karten</button></div><section id="theme-panel-template" data-theme-panel="template"><h2>Farbthemes</h2><div class="presets"></div><p class="note">Ändert nur Farben und Hintergrund. Inhalte, Entitäten und Anordnung bleiben erhalten.</p></section><section id="theme-panel-colors" data-theme-panel="colors" hidden><h2>Text &amp; Karten</h2><h3>Kacheloptik</h3><label class="field">Darstellung<select data-theme-style="card_style">${options({standard:"Studio",homekit:"Home · Apple Home"},this.scene.card_style || "standard")}</select></label><h3>Schrift</h3><div class="form-grid theme-typography"><label>Schriftart<select id="theme-font" data-theme-style="text_font">${options({auto:"Wie im Widget",...window.LGFontChoices},this.scene.text_font || "auto")}</select></label><label>Schriftstärke<select id="theme-weight" data-theme-style="text_weight">${options({auto:"Wie im Widget",400:"Normal",500:"Mittel",600:"Halbfett",700:"Fett"},this.scene.text_weight || "auto")}</select></label><label>Textgröße (%)<input id="theme-scale" data-theme-style="text_scale" type="number" min="50" max="200" step="1"></label><div class="theme-text-toggles"><label><input type="checkbox" id="theme-italic" data-theme-style="text_italic">Kursiv</label><label><input type="checkbox" id="theme-underline" data-theme-style="text_underline">Unterstrichen</label></div></div><p class="note">Lokale Schriften ohne Download. Individuelle Schriftarten, Stärken und Größen im Widget-Inhalt haben Vorrang.</p><h3>Farben &amp; Transparenz</h3><div class="form-grid theme-palette"><label>Textfarbe<input type="color" alpha colorspace="limited-srgb" id="theme-ink"></label><label>Texttransparenz (%)<input type="number" id="theme-text-opacity" data-theme-style="text_opacity" min="0" max="100" step="1"></label><label>Kartenfarbe<input type="color" alpha colorspace="limited-srgb" id="theme-surface"></label><label>Kartentransparenz (%)<input type="number" id="theme-surface-opacity" data-theme-style="surface_opacity" min="0" max="100" step="1"></label><label>Kartenakzent<input type="color" alpha colorspace="limited-srgb" id="theme-accent"></label><label>Akzenttransparenz (%)<input type="number" id="theme-accent-opacity" data-theme-style="card_accent_opacity" min="0" max="100" step="1"></label></div><p class="note">0 % behält die Deckkraft der Widgets bei, 100 % blendet den jeweiligen Anteil aus. Kartenflächen, Text und Akzente sind unabhängig; Bilder, Kameras und HDMI werden nicht abgedunkelt.</p></section><section id="theme-panel-background" data-theme-panel="background"><h3>Hintergrund</h3><div class="form-grid"><label class="full">Hintergrund<select id="background" aria-label="Hintergrund">${options(BACKGROUNDS,this.scene.background)}</select></label><label>Grundfarbe<input id="scene-color" type="color" alpha colorspace="limited-srgb"></label><label>Akzent<input id="scene-accent" type="color" alpha colorspace="limited-srgb"></label></div><label class="field">Verlaufswinkel<input id="gradient-angle" type="range" min="0" max="360" step="1"></label><label class="field">Sonnenstand-Entität<input id="sun-entity" list="sun-entities" placeholder="sun.sun"><datalist id="sun-entities">${Object.keys(this.hass.states).filter(id=>id.startsWith('sun.')).map(id=>`<option value="${escapeHTML(id)}"></option>`).join('')}</datalist></label><div class="weather-background-settings"><label class="field">Wetter für den Hintergrund<select id="weather-entity" aria-label="Wetter für den Hintergrund"><option value="">Wetterentität wählen</option>${Object.keys(this.hass.states).filter(id=>id.startsWith('weather.')).map(id=>`<option value="${escapeHTML(id)}">${escapeHTML(this.hass.states[id].attributes.friendly_name || id)}</option>`).join('')}</select></label><label class="field">Wetterlage<select id="weather-condition">${options({auto:'Aus Wetterentität',sunny:'Sonnig','clear-night':'Klare Nacht',partlycloudy:'Teilweise bewölkt',cloudy:'Bewölkt',drizzle:'Nieselregen',rainy:'Regen',pouring:'Starkregen',snowy:'Schnee','snowy-rainy':'Schneeregen',hail:'Hagel',fog:'Nebel',windy:'Windig','windy-variant':'Windig und bewölkt',lightning:'Gewitter','lightning-rainy':'Gewitter mit Regen',exceptional:'Außergewöhnlich'},this.scene.weather_condition || 'auto')}</select></label><label class="field">Niederschlagsstärke<select id="weather-precipitation-mode">${options({condition:'Nach Wetterlage',sensor:'Niederschlagssensor · mm/h oder in/h',hourly:'Stündliche Wetterprognose · geschätzt'},this.scene.weather_precipitation_mode || 'condition')}</select></label><label class="field weather-precipitation-source">Quelle für Niederschlag<select id="weather-precipitation-entity"></select></label><label class="field"><input id="weather-animate" type="checkbox">Wolken und Niederschlag animieren</label><label class="field"><input id="weather-impact" type="checkbox">Niederschlag am unteren Bildschirmrand auftreffen lassen</label><label class="field"><input id="weather-accumulation" type="checkbox">Schnee und Hagel liegen lassen</label></div><label class="field"><input id="glass-design" type="checkbox">Glasdesign · Karten, Symbole und Uhr</label><p class="note background-context" hidden></p><div class="background-tools"><label class="field">Eigenes Hintergrundbild<select id="bg-image"></select></label><label class="field">Fläche um das Bild<select id="image-background">${options({color:"Grundfarbe",edges:"Farben aus dem Bildrand"},this.scene.image_background || "color")}</select></label><label class="field">Bild einpassen<select id="image-fit">${options({cover:'Ausfüllen',contain:'Vollständig zeigen'},this.scene.image_fit)}</select></label><div class="image-sizing"><div class="form-grid"><label>Bildbreite (%)<input id="image-scale-x" type="number" min="1" max="200" step="1"></label><label>Bildhöhe (%)<input id="image-scale-y" type="number" min="1" max="200" step="1"></label></div><label class="field image-ratio-lock"><input id="image-lock-ratio" type="checkbox">Seitenverhältnis sperren</label><p class="note">100 % entspricht der gewählten Einpassung. Das Bild bleibt zentriert. Mit Sperre ändern sich Breite und Höhe gemeinsam; ohne Sperre kann das Bild verzerrt werden.</p></div><label class="field">Bild abdunkeln<input id="image-dim" type="range" min="0" max="0.9" step="0.05"></label><input id="bg-upload" class="export" type="file" accept="image/*,.heic,.heif,.tif,.tiff"><button class="small" data-action="upload-background">Bild hochladen</button><button class="small" data-action="clean-backgrounds">Unbenutzte Bilder entfernen</button><p class="note">HEIC/HEIF, JPEG, PNG, TIFF, WebP oder AVIF, bis 20 MiB. Lokal auf maximal 3840 × 2160 verkleinert. Live überträgt den Entwurf. Speichern übernimmt ihn dauerhaft.</p></div></section></div></section></main><aside class="inspector"><section class="section"><h3>Elemente · vorne zuerst</h3><div class="layers"></div><div class="add"><button class="secondary" data-action="add" aria-haspopup="dialog">＋ Element hinzufügen</button></div></section><section class="properties"></section></aside></div><footer class="transfer-tools"><span>Ansichten &amp; Themes sichern oder übertragen</span><div class="links"><button class="small" data-action="export">Exportieren</button><button class="small" data-action="import">Importieren</button><input id="layout-import" class="export" type="file" accept="application/json,.json"></div></footer>`;
    const $=selector=>this.shadowRoot.querySelector(selector);
    if($('#display-rotation'))$('#display-rotation').onchange=event=>this.rotateDisplay(Number(event.target.value));
    const themeTabs=[...this.shadowRoot.querySelectorAll('[data-theme-tab]')];
    themeTabs.forEach((button,index)=>{
      button.onclick=()=>{this.themeTab=button.dataset.themeTab;this.updateAppearancePanels();};
      button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%themeTabs.length;else if(event.key==='ArrowLeft')next=(index+themeTabs.length-1)%themeTabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=themeTabs.length-1;else return;event.preventDefault();themeTabs[next].click();themeTabs[next].focus();};
    });
    this.shadowRoot.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>this.action(button.dataset.action));
    for(const [id,key] of [['theme-ink','color'],['theme-surface','background'],['theme-accent','accent_color']]) $('#'+id).onchange=event=>{this.checkpoint();this.markThemeOverride();if(this.themeEditing)this.theme.style[{color:'ink',background:'surface',accent_color:'card_accent'}[key]]=colorValue(event.target.value);this.scene.element_palette=Object.fromEntries(['color','background','accent_color'].map(k=>[{color:'ink',background:'surface',accent_color:'card_accent'}[k],k===key?colorValue(event.target.value):themeStyle(this.scene)[{color:'ink',background:'surface',accent_color:'card_accent'}[k]]]));for(const item of this.scene.elements)if(item.kind!=='hdmi'&&!item.style_override)item[key]=colorValue(event.target.value);this.changed(true);};
    this.shadowRoot.querySelectorAll('[data-theme-style]').forEach(input=>input.onchange=()=>{
      const key=input.dataset.themeStyle;let value=input.type==='checkbox'?input.checked:input.value;
      if(input.type==='number'){
        value=Number(value);if(input.value==='' || !Number.isFinite(value) || value<Number(input.min) || value>Number(input.max)){this.refreshScene();return;}
        if(key.endsWith('_opacity'))value=(100-value)/100;
      }
      this.checkpoint();this.markThemeOverride();this.scene[key]=value;this.changed(true);
    });
    $('#view-name').onchange=event=>{const name=event.target.value.trim();if(this.themeEditing){if(name){this.checkpoint();this.theme.name=name;this.changed();}return;}if(CONTEXTS[this.viewId] || !name){event.target.value=this.view.name;return;}this.checkpoint();this.view.name=name;this.changed();};
    $('#view-scroll').onchange=e=>{
      const value=Number(e.target.value),needed=Math.max(100,...this.scene.elements.map(i=>i.y+i.height));
      if(value+.01<needed){e.target.value=String(this.scene.scroll_height || 100);this.flash('Verschiebe zuerst die Elemente außerhalb der gewünschten Ansichtshöhe.',true);return;}
      this.checkpoint();this.scene.scroll_height=value;this.changed(true);
    };
    $('#suggestion-room').onchange=event=>this.loadSuggestions(event.target.value);
    $('#own-styling').onchange=event=>{if(!event.target.checked){this.followTheme(this.viewId);return;}this.checkpoint();this.markThemeOverride();this.changed(true);};
    this.loadSuggestions();
    $('#bg-upload').onchange=event=>this.uploadBackground(event.target.files[0]);
    for(const [id,key] of [['image-scale-x','image_scale_x'],['image-scale-y','image_scale_y']]) $('#'+id).onchange=event=>{
      const value=Number(event.target.value);if(!event.target.value || !Number.isFinite(value) || value<1 || value>200){event.target.value=this.scene[key];return;}
      this.checkpoint();this.markThemeOverride();this.scene[key]=value;if(this.scene.image_lock_ratio)this.scene.image_scale_x=this.scene.image_scale_y=value;this.changed(true);
    };
    $('#image-lock-ratio').onchange=event=>{this.checkpoint();this.markThemeOverride();this.scene.image_lock_ratio=event.target.checked;if(event.target.checked)this.scene.image_scale_y=this.scene.image_scale_x;this.changed(true);};
    for(const [id,key] of [['weather-condition','weather_condition'],['weather-precipitation-mode','weather_precipitation_mode'],['weather-precipitation-entity','weather_precipitation_entity'],['weather-entity','weather_entity'],['weather-animate','weather_animate'],['weather-impact','weather_impact'],['weather-accumulation','weather_accumulation'],['glass-design','glass']]) $('#'+id).onchange=event=>{this.checkpoint();this.markThemeOverride();this.scene[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;if(key==='weather_precipitation_mode')this.scene.weather_precipitation_entity='';this.changed(true);};
    $('#sun-entity').onchange=event=>{this.checkpoint();this.config.sun_entity=event.target.value;this.changed();};
    for(const [id,key] of [['background','background'],['scene-color','color'],['scene-accent','accent'],['gradient-angle','gradient_angle'],['bg-image','image_id'],['image-fit','image_fit'],['image-dim','image_dim'],['image-background','image_background']]) $("#"+id).onchange=event=>{this.checkpoint();this.markThemeOverride();this.scene[key]=['gradient_angle','image_dim'].includes(key)?Number(event.target.value):event.target.type==='color'?colorValue(event.target.value):event.target.value;this.changed(key==='background');};
    $('#media-background-enabled').onchange=event=>{this.checkpoint();this.scene.media_background_entity=this.backgroundPlayer;this.scene.media_background_enabled=event.target.checked;this.changed();};
    $('#media-background-entity').onchange=event=>this.setBackgroundPlayer(event.target.value);
    $('#clear-background-player').onclick=()=>this.setBackgroundPlayer('');
    for(const [id,key] of [['media-background-fit','media_background_fit'],['media-background-color-source','media_background_color_source'],['media-background-dim','media_background_dim']]) $('#'+id).onchange=event=>{this.checkpoint();this.scene.media_background_entity=this.backgroundPlayer;this.scene[key]=key==='media_background_dim'?Number(event.target.value):event.target.type==='color'?colorValue(event.target.value):event.target.value;this.changed();};
    $('#layout-import').onchange=event=>this.importFile(event.target.files[0]);
    $('#test-message').oninput=()=>{this.paint();this.queueLive();};
    this.style.setProperty('--studio-aspect',this.displayRatio);
    this.renderer=new window.LGLayoutRenderer($('.scene'),$('.lg-hdmi-placeholder'),true);
    this._resize=new ResizeObserver(()=>this.paint());this._resize.observe($('.stage'));
    this._clock=setInterval(()=>{if(this.page!=="overview")this.renderer?.tick(new Date());this.widgetEditor?.tick(new Date());},1000);
    this._dataTimer=setInterval(()=>this.refreshValues(),30000);
    this.refreshScene();this.updateStatus();this.renderOverview();this.showPage();
  }
  gridSize(item=null) {
    const cells=this.themeEditing?[]:gridCells(this.view?.grid);if(!item)return cells[0] || null;
    const same=cells.filter(cell=>Math.abs(item.width-cell.width)<.01&&Math.abs(item.height-cell.height)<.01);
    const distance=cell=>(cell.x+cell.width/2-item.x-item.width/2)**2+(cell.y+cell.height/2-item.y-item.height/2)**2;
    return (same.length?same:cells).sort((a,b)=>distance(a)-distance(b))[0] || null;
  }
  sizeChoices(adding=false,item=null) {return {...this.baseSizeChoices(adding,item),...(this.gridSize()?{grid:'Rasterkachel'}:{})};}
  baseSizeChoices(adding=false,item=null) {if(item?.kind==='camera')return {custom:'Manuell · freie Größe',camera_small:'Klein',camera_medium:'Mittel',camera_large:'Groß'};if(item&&isSymbol(item))return {custom:'Manuell · freie Größe',symbol_small:'Klein',symbol_medium:'Mittel',symbol_large:'Groß'};if(item?.kind==='logo')return {custom:'Manuell · freie Größe',graphic_small:'Klein',graphic_medium:'Mittel',graphic_large:'Groß'};if(item&&isAnimation(item))return {custom:'Manuell · freie Größe',animation_small:'Klein',animation_medium:'Mittel',animation_large:'Groß'};if(item?.kind==='clock')return {custom:'Manuell · freie Größe',clock_small:'Klein',clock_medium:'Mittel',clock_large:'Groß',clock_extra_large:'Extra groß'};return {...(adding?{auto:'Standard für Element'}:{custom:'Manuell · freie Größe'}),compact:'Kompakt · 154 × 58',large:'Groß · 154 × 126',scene:'Szene · 154 × 58',chip:'Statuschip · 124 × 38',camera:'Kamera · 318 × 168',wide:'Breit · 318 × 58',...(item?.kind==='media'?{media_fullscreen:'Vollbild · 100 × 100 %'}:{})};}
  inheritElementStyle(item,style=themeStyle(this.scene)) {
    const transparent=['clock','logo','animation','spinner','progress'].includes(item.kind)||isSymbol(item);
    Object.assign(item,{card_style:'inherit',color:style.ink,background:style.surface,accent_color:style.card_accent,font:'sans',text_opacity:1,align:item.kind==='clock'?'center':'left',opacity:transparent&&!item.tile_surface?0:.92,radius:transparent&&item.kind!=='clock'&&!item.tile_surface?0:24});
    delete item.element_theme;
    for(const part of Object.values(item.parts || {}))for(const key of ['color','font','font_weight','align','opacity','radius'])delete part[key];
  }
  elementStyling(item,enabled) {
    const style=themeStyle(this.scene);
    this.scene.element_palette={ink:style.ink,surface:style.surface,card_accent:style.card_accent};
    if(enabled&&this.scene.text_font&&this.scene.text_font!=='auto')item.font=this.scene.text_font;item.style_override=enabled;delete item.element_theme;
    if(!enabled)this.inheritElementStyle(item,style);
  }
  graphicSize(item,key='graphic_medium') {
    const image=window.LGGraphicImage(item),ratio=item.graphic_id==='esphome'||!item.graphic_id?240/234:image.width/image.height;
    const span={graphic_small:10,graphic_medium:20,graphic_large:36}[key];
    if(!span)return null;
    const width=span*Math.min(1,ratio),height=span/Math.max(1,ratio);
    return [(width+4/6)/this.displayRatio,height+4/6];
  }
  symbolSize(item,key='symbol_medium') {
    const span={symbol_small:6,symbol_medium:12,symbol_large:20}[key];if(!span)return null;
    if(item.symbol_button)return [(span+4/6)/this.displayRatio,span+4/6];
    const geometry=window.LGControlGeometry(item.control_icon || 'play',window.LGControlBasis(item),item);
    return [(span*geometry.width/80+4/6)/this.displayRatio,span*geometry.height/80+4/6];
  }
  cameraSize(item,key='camera_medium') {
    const width={camera_small:20,camera_medium:318/1024*100,camera_large:50}[key];if(!width)return null;
    const size=window.LGCameraTileSize({...item,x:0,width,camera_aspect_ratio:item.camera_lock_aspect?(item.camera_aspect_ratio || 16/9):16/9},this.displayRatio,100);
    return [size.width,size.height];
  }
  defaultSize(item) {
    if(item.kind==='control')return isSymbol(item)?this.symbolSize(item):[40,10];
    if(item.kind==='logo')return this.graphicSize(item);
    if(isAnimation(item))return window.LGAnimations[item.kind==='animation'?(item.animation_type || 'spinner'):item.kind].size;
    const defaults=this.catalog.widget_defaults?.[item.kind];if(defaults)return [defaults.width,defaults.height];
    if(window.LGHomeTheme.enabled(this.scene,item)){const size=window.LGHomeSpec.sizes[item.home_variant || 'compact'];return [size[0]/1024*100,size[1]/600*100];}
    return WIDGET_SIZES[item.kind] || [30,25];
  }
  standardContent(item) {
    const defaults=this.catalog.widget_defaults?.[item.kind] || {},parts=clone(item.parts || {});
    // Presets replace manual layout only. Content, visibility and visual choices
    // stay with the widget, including overrides on nested media/weather parts.
    for(const id of new Set([...Object.keys(parts),...Object.keys(defaults.parts || {})])){
      const conf=parts[id] ||= {};
      for(const key of PART_GEOMETRY){delete conf[key];if(defaults.parts?.[id]?.[key]!==undefined)conf[key]=defaults.parts[id][key];}
      if(!Object.keys(conf).length)delete parts[id];
    }
    if(Object.keys(parts).length)item.parts=parts;else delete item.parts;
    item.font_size=defaults.font_size ?? defaultFontSize(item.kind);
    if(item.kind==='clock')item.font_size=Math.min(18,item.font_size*item.height/(defaults.height || 20));
  }
  applyGridSize(item,cell=this.gridSize(item)) {
    if(!cell)return;
    item.width=cell.width;item.height=cell.height;item.grid_size=true;item.lock_ratio=true;
    delete item.manual_size;delete item.clock_size;delete item.camera_size;
    // The outer cell is fixed; camera/image content keeps its own aspect ratio.
    if(item.kind==='camera'){item.camera_lock_aspect=false;item.camera_fit='contain';}
    if(item.kind==='clock')item.clock_base_height=item.height;
    this.standardContent(item);
  }
  standardSize(item,key) {
    if(item.widget_template){const reference=item.widget_template,parts=item.parts?clone(item.parts):null;delete item.widget_template;try{this.standardSize(item,key);}finally{item.widget_template=reference;if(parts)item.parts=parts;}return;}

    if(key==='grid'){
      const cell=this.gridSize(item);if(!cell)return;
      const center={x:item.x+item.width/2,y:item.y+item.height/2};
      this.applyGridSize(item,cell);
      item.x=Math.max(0,Math.min(100-item.width,center.x-item.width/2));
      item.y=Math.max(0,Math.min((this.scene.scroll_height||100)-item.height,center.y-item.height/2));return;
    }
    const animation=isAnimation(item),spec=animation?window.LGAnimations[item.kind==='animation'?(item.animation_type || 'spinner'):item.kind]:null;
    const size=item.kind==='media'&&key==='media_fullscreen'?[1024,600]:item.kind==='camera'?this.cameraSize(item,key):isSymbol(item)?this.symbolSize(item,key):item.kind==='logo'?this.graphicSize(item,key):animation?spec.sizes[key.replace('animation_','')]:item.kind==='clock'?CLOCK_SIZES[key]:window.LGHomeSpec.sizes[key];if(!size)return;
    const center={x:item.x+item.width/2,y:item.y+item.height/2};
    const recenter=()=>{item.x=Math.max(0,Math.min(100-item.width,center.x-item.width/2));item.y=Math.max(0,Math.min((this.scene.scroll_height||100)-item.height,center.y-item.height/2));};
    delete item.manual_size;delete item.grid_size;
    if(item.kind==='camera'){item.camera_size=key;this.standardContent(item);[item.width,item.height]=this.cameraSize(item,key);item.lock_ratio=true;recenter();return;}
    if(isSymbol(item)){[item.width,item.height]=size;item.symbol_fit='tight';item.show_label=false;item.label=controlName(item);delete item.parts;recenter();return;}
    if(item.kind==='logo'){[item.width,item.height]=size;item.graphic_id ||= 'esphome';delete item.parts;item.show_label=false;item.label=graphicName(item);recenter();return;}
    if(animation){[item.width,item.height]=size;this.standardContent(item);recenter();return;}
    if(item.kind==='clock'){
      [item.width,item.height]=size;item.clock_size=key;item.clock_base_height=item.height;
      this.standardContent(item);recenter();this.fitClockHeight(item);recenter();return;
    }
    item.width=Math.round(size[0]/1024*10000)/100;item.height=Math.round(size[1]/600*10000)/100;
    if(['compact','large','scene','chip'].includes(key))item.home_variant=key;
    this.standardContent(item);this.fitCamera(item);recenter();
  }
  currentSize(item) {if(item.grid_size&&!item.manual_size){const cell=this.gridSize(item);if(cell&&Math.abs(item.width-cell.width)<.01&&Math.abs(item.height-cell.height)<.01)return 'grid';}if(item.kind==='media'&&!item.manual_size&&Math.abs(item.width-100)<.01&&Math.abs(item.height-100)<.01)return 'media_fullscreen';if(item.kind==='camera'){if(item.manual_size)return 'custom';if(item.camera_size&&this.cameraSize(item,item.camera_size))return item.camera_size;return ['camera_small','camera_medium','camera_large'].find(key=>{const size=this.cameraSize(item,key);return Math.abs(size[0]-item.width)<.02;}) || 'custom';}if(isSymbol(item)){if(item.manual_size||item.symbol_fit!=='tight')return 'custom';return ['symbol_small','symbol_medium','symbol_large'].find(key=>{const s=this.symbolSize(item,key);if(Math.abs(s[0]-item.width)<.01&&Math.abs(s[1]-item.height)<.01)return true;if(item.symbol_button)return false;const g=window.LGControlGeometry(item.control_icon || 'play',window.LGControlBasis(item),item);if(g.fill)return false;const span={symbol_small:6,symbol_medium:12,symbol_large:20}[key];return Math.abs((span*((g.width-5)*76/75+4)/80+4/6)/this.displayRatio-item.width)<.01&&Math.abs(span*((g.height-5)*76/75+4)/80+4/6-item.height)<.01;}) || 'custom';}if(item.kind==='logo'&&!item.manual_size&&item.graphic_id){const key=['graphic_small','graphic_medium','graphic_large'].find(key=>{const s=this.graphicSize(item,key);return Math.abs(s[0]-item.width)<.01&&Math.abs(s[1]-item.height)<.01;});return key||'custom';}if(item.manual_size)return 'custom';if(isAnimation(item)){const sizes=window.LGAnimations[item.kind==='animation'?(item.animation_type || 'spinner'):item.kind].sizes;const key=Object.keys(sizes).find(k=>Math.abs(item.width-sizes[k][0])<.01&&Math.abs(item.height-sizes[k][1])<.01);return key?'animation_'+key:'custom';}if(item.kind==='clock'){if(CLOCK_SIZES[item.clock_size]&&Math.abs(item.width-CLOCK_SIZES[item.clock_size][0])<.01)return item.clock_size;return Object.keys(CLOCK_SIZES).find(k=>Math.abs(item.width-CLOCK_SIZES[k][0])<.01&&Math.abs(item.height-CLOCK_SIZES[k][1])<.01)||'custom';}return Object.keys(window.LGHomeSpec.sizes).find(k=>Math.abs(item.width*1024/100-window.LGHomeSpec.sizes[k][0])<.1 && Math.abs(item.height*600/100-window.LGHomeSpec.sizes[k][1])<.1 && (!['scene','compact'].includes(k) || k===(item.home_variant || 'compact'))) || 'custom';}
  fitClockHeight(item,restore=false) {
    if(item.kind!=='clock')return;
    const preset=this.currentSize(item);if(preset==='grid'){item.clock_base_height=item.height;return;}if(preset!=='custom')item.clock_size=preset;
    const base=item.clock_base_height || item.height;
    const resize=height=>{item.height=height;};
    resize(base);item.clock_base_height=base;
    if(restore)return;
    const visible=['time','date'].filter(id=>item.parts?.[id]?.visible!==false);
    if(visible.length===1){
      this.paint();const node=this.renderer.nodes[item.id],el=visible[0]==='time'?node?._value:node?._detail;
      const rect=node?.getBoundingClientRect(),frame=el?._clockFrame;
      if(rect?.height&&frame?.height){
        // The maximum glyph frame is stable across ticks and date changes.
        resize(Math.min(base,Math.max(.01,(frame.height+2*(node._nativeScale||1))/(1-2*window.LGWidgetPadding(item)/100)/((node._frame||node).getBoundingClientRect().height)*base)));
      }
    }
    item.y=Math.min(item.y,(this.scene.scroll_height||100)-item.height);
  }
  get view() {return this.config.views.find(view=>view.id===this.viewId);}
  get scene() {return this.themeEditing ? this.themeScene : this.view?.scene || this.config.scenes[this.sceneKey];}
  get themeEditing() {return this.page==='theme';}
  get theme() {return this.config.themes.find(theme=>theme.id===this.themeId);}
  markThemeOverride() {if(!this.themeEditing && this.view)this.view.theme_override=true;}
  get startupView() {return !this.themeEditing && ['startup','connecting','updating'].includes(this.viewId);}
  get displayOffline() {return (this.startupStatus?.connected ?? this.catalog?.entries.find(e=>e.entry_id===this.entryId)?.connected) === false;}
  get deviceRendering() {return this.catalog?.entries.find(e=>e.entry_id===this.entryId)?.rendering;}
  get displayRendering() {
    const saved=this.deviceRendering;if(!saved?.rotation_supported)return saved;
    const rotation=this.rotationDraft ?? saved.rotation ?? 0,wasPortrait=[90,270].includes(saved.rotation),portrait=[90,270].includes(rotation);
    const width=saved.panel_width ?? (wasPortrait?saved.height:saved.width),height=saved.panel_height ?? (wasPortrait?saved.width:saved.height);
    return {...saved,rotation,width:portrait?height:width,height:portrait?width:height};
  }
  get rotationDirty() {return !!this.deviceRendering?.rotation_supported && this.displayRendering.rotation!==(this.deviceRendering.rotation ?? 0);}
  get draftDirty() {return this.rotationDirty || JSON.stringify(this.config)!==JSON.stringify(this.saved);}
  get displayRatio() {const r=this.displayRendering;return this.nativeLvgl&&r?.width>0&&r?.height>0?r.width/r.height:16/9;}
  updateOrientation() {
    const r=this.displayRendering,control=this.shadowRoot.querySelector('#display-rotation');
    this.style.setProperty('--studio-aspect',this.displayRatio);
    if(control){control.value=String(r.rotation ?? 0);control.disabled=this.busy;control.nextElementSibling.textContent=r.width+' × '+r.height;}
  }
  draftSnapshot() {return {config:clone(this.config),rotation:this.displayRendering?.rotation ?? null};}
  restoreDraft(snapshot) {this.config=clone(snapshot.config);this.rotationDraft=snapshot.rotation;this.updateOrientation();}
  get hardwareVideo() {return this.catalog?.entries.find(e=>e.entry_id===this.entryId)?.capabilities?.video !== false;}
  get nativeLvgl() {return this.catalog?.entries.find(e=>e.entry_id===this.entryId)?.capabilities?.native_lvgl === true;}
  get hardwareHdmi() {return this.catalog?.entries.find(e=>e.entry_id===this.entryId)?.capabilities?.hdmi !== false;}
  supportsView(id) {if(["connecting","updating"].includes(id))return this.nativeLvgl;if(this.nativeLvgl)return id!=="hdmi_full";return this.hardwareHdmi || !['hdmi_full','pip_view','pip','startup'].includes(id);}
  get navigationViews(){return this.config.views.filter(v=>this.supportsView(v.id)&&(SOURCE_CONTEXTS.includes(v.id)||!CONTEXTS[v.id]));}
  get contexts() {return Object.fromEntries(Object.entries(TEMPLATE_CONTEXTS).filter(([id])=>this.supportsView(id)));}
  get availableKinds() {return Object.fromEntries(Object.entries(KINDS).filter(([id])=>!['spinner','progress'].includes(id) && (this.startupView ? ['logo','animation','text','clock'].includes(id) : (this.hardwareHdmi || id!=='hdmi'))));}
  get availableBackgrounds() {return this.startupView ? Object.fromEntries(Object.entries(BACKGROUNDS).filter(([id])=>!['solar','weather'].includes(id) && (!this.nativeLvgl || id!=='image'))) : BACKGROUNDS;}
  get item() {return this.scene.elements.find(item=>item.id===this.selected);}
  checkpoint() {this.history.push(this.draftSnapshot());if(this.history.length>30)this.history.shift();this.future=[];}
  changed(refresh=false,keepSelection=false) {this.compileViews();this.dirty=this.draftDirty;this.updateOrientation();if(refresh)this.refreshScene();else {this.paint();if(!keepSelection)this.renderSelection();}this.renderSuggestions();this.updateStatus();if(this.page==="overview")this.renderOverview();this.queueLive();}
  updateStatus() {
    const root=this.shadowRoot, status=root.querySelector('.status');if(!status)return;
    status.textContent=this.busy?'Wird gespeichert …':this.dirty?'Ungespeichert':'Gespeichert';status.dataset.dirty=String(this.dirty);
    root.querySelector('[data-action=save]').disabled=this.busy;
    for(const selector of ['.workspace','.editor-navigation','.overview','.toolbar']){const area=root.querySelector(selector);if(area)area.inert=this.busy;}
    if(this.widgetEditor)this.widgetEditor.root.inert=this.busy;
    for(const action of ['cancel-edit','finish-edit'])root.querySelector('[data-action='+action+']').hidden=!!this.widgetEditor;
    root.querySelector('[data-action=devices]').disabled=this.busy || this.dirty;
    root.querySelector('[data-action=undo]').disabled=this.busy || !this.history.length;
    root.querySelector('[data-action=redo]').disabled=this.busy || !this.future.length;
    const reset=root.querySelector('[data-action=reset-view]');reset.hidden=this.themeEditing || !CONTEXTS[this.viewId];reset.disabled=this.busy;
    this.updateOrientation();this.updateStartupStatus();this.updateThemeControls();this.updateCoverControls();
    this.updateLiveStatus();
    this.updateConnectionStatus();this.updateDesignWorkspace();
  }
  updateConnectionStatus() {
    const notice=this.shadowRoot.querySelector('.notice');if(!notice)return;
    const entry=this.catalog.entries.find(e=>e.entry_id===this.entryId);
    const needsLgSetup=entry?.provider==='lg' && !entry.resident_enabled;
    notice.hidden=!this.displayOffline && !needsLgSetup;
    if(this.displayOffline)notice.textContent='Display offline · Du kannst alle Ansichten bearbeiten und in Home Assistant speichern. Änderungen werden beim nächsten Verbinden übertragen.';
    else notice.innerHTML=needsLgSetup?'Für dauerhafte Ansichten aktiviere <b>Display-App</b> und <b>SI-Dauerbetrieb</b> in den <a href="/config/integrations/integration/lg_rs232_ip">LG-Einstellungen</a>. Hier kannst du das Layout schon vorbereiten.':'';
  }
  updateStartupStatus() {
    const node=this.shadowRoot.querySelector('.startup-cache-status');if(!node)return;node.hidden=!this.startupView;
    const changed=this.startupView && JSON.stringify(this.scene)!==JSON.stringify(this.saved.views.find(v=>v.id===this.viewId)?.scene);
    node.textContent=this.startupStatus?.external ? 'Die Gestaltung wurde in einer anderen Sitzung geändert. Lade das Studio neu, um sie zu sehen.' : changed ? 'Entwurf noch nicht gespeichert.' : this.startupStatus?.stored ? (this.nativeLvgl?(this.viewId==='updating'?'Auf dem ESP gespeichert · erscheint bei der nächsten Firmwareübertragung.':'Auf dem ESP gespeichert · erscheint beim nächsten Start auch ohne Home Assistant.'):'Auf dem Display gespeichert · auch das gewählte Hintergrundbild ist lokal verfügbar.') : this.startupStatus?.connected ? 'Übertragung auf das Display ausstehend · Bestätigung wird automatisch aktualisiert.' : 'Die App ist nicht verbunden. Die Gestaltung wird beim nächsten Verbinden auf dem Display gespeichert.';
  }
  rotateDisplay(rotation) {
    if(this.busy || !this.deviceRendering?.rotation_supported || ![0,90,180,270].includes(rotation)){this.updateOrientation();return;}
    if(rotation===this.displayRendering.rotation)return;
    this.checkpoint();this.rotationDraft=rotation;this.dirty=this.draftDirty;this.updateOrientation();
    this.refreshScene();this.renderOverview();this.widgetEditor?.refresh();this.updateStatus();
    this.flash('Vorschau gedreht. Das Display übernimmt die Drehung erst beim Speichern.');
  }
  async persistRotation(rotation) {
    if(!this.deviceRendering?.rotation_supported || rotation===(this.deviceRendering.rotation ?? 0))return;
    const result=await this.hass.callApi('POST',`display_studio/layout_orientation/${this.entryId}`,{rotation});
    this.catalog.entries.find(e=>e.entry_id===this.entryId).rendering=result.rendering;
  }
  kindName(item){return elementName(item);}
  applyDesignTheme(scene,style){return applyThemeStyle(scene,style);}
  async showDesigns(type='widgets') {
    if(this.dirty){this.flash('Bitte zuerst speichern oder die Änderungen abbrechen.',true);return;}
    await this.stopLive();this.widgetEditor?.close();this.elementPicker?.close(false);this.symbolPicker?.close();this.devicesHome?.close();this.designLibrary?.close();
    this.devicesHome=null;this.designWorkspace=null;this.templateSession=null;
    this.renderer?.clear();this.renderer=null;this._resize?.disconnect();clearInterval(this._clock);clearInterval(this._dataTimer);clearTimeout(this._dataSoon);clearTimeout(this._updateTimer);this._updateTimer=null;
    this._generation++;this.releaseImages();this.page='designs';
    this.designLibrary=new this.DesignLibrary(this,type,VERSION);await this.designLibrary.mount();
  }
  async designBase(entryId=null){
    const chosen=entryId||this.catalog.entries[0]?.entry_id;
    if(chosen){await this.switchDisplay(chosen);if(this.entryId!==chosen)throw Error('Display unavailable');}
    else{
      this.designLibrary?.close();this.designLibrary=null;this.entryId=null;
      this.accept({config:clone(this.catalog.presets[0].layout),revision:0,values:{}});
      this.page='overview';this.mount();
    }
    const base=clone(this.config.views.find(v=>!CONTEXTS[v.id])?.scene||this.catalog.presets[0].layout.scenes.dashboard);
    Object.assign(base,{elements:[],scroll_height:100,media_background_enabled:false});
    this.config.views=this.config.views.filter(v=>v.id!=='view_widget_workbench');
    this.config.views.push({id:'view_widget_workbench',name:'Widgeteditor',theme_override:true,scene:base});
    this.viewId='view_widget_workbench';this.sceneKey='dashboard';return base;
  }
  async prepareWidgetCreation(entryId){
    await this.designBase(entryId);this.page='editor';this.showPage();
    this.elementPicker=new this.ElementPicker(this,null,null,VERSION,{onChoose:kind=>this.openWidgetTemplate(null,kind,null,entryId),onCancel:()=>{this.dirty=false;void this.showDesigns('widgets');}});this.elementPicker.open();
  }
  async openWidgetTemplate(record,kind,source=null,entryId=null,name=null){
    const scene=await this.designBase(entryId);
    this.widgetLibraryDoc=await this.hass.callApi('GET','display_studio/widget_library');
    // Reload the selected definition to avoid overwriting a newer editor.
    if(record){record=this.widgetLibraryDoc.widgets.find(w=>w.id===record.id);if(!record)throw Error('Widget removed');}
    const item=clone(record?.item||source||this.gridDraft(kind,null));delete item.widget_template;
    item.id='widget_design';item.entity_id='';item.media_remote_view='';
    for(const key of ['tap_action','hold_action'])if(item[key]){item[key].entity_id='';item[key].view='';if(item[key].action==='show_view')item[key].action='none';}
    delete item.grid_size;item.x=(100-item.width)/2;item.y=(100-item.height)/2;
    scene.elements=[item];this.view.name=record?.name||name||this.availableKinds[kind];
    this.templateSession={id:record?.id||'widget_'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),revision:this.widgetLibraryDoc.revision,name:this.view.name};
    this.designWorkspace={type:'widgets',template:true};this.page='editor';this.selected=item.id;this.history=[];this.future=[];this.saved=clone(this.config);this.dirty=!record;
    this.mount();this.updateDesignWorkspace();
  }
  async saveWidgetTemplate(){
    if(this.busy)return false;
    const session=this.templateSession;this.busy=true;this.updateStatus();
    try{
      this.widgetLibraryDoc=await this.hass.callApi('POST','display_studio/widget_library',{revision:session.revision,widget:{id:session.id,name:this.view.name,item:clone(this.scene.elements[0])}});
      session.revision=this.widgetLibraryDoc.revision;this.saved=clone(this.config);this.dirty=false;this.flash('Widget gespeichert. Verwendungen werden aktualisiert; ihre Zuordnungen bleiben erhalten.');return true;
    }catch(error){this.flash(error?.status_code===409?'Die Widgetbibliothek wurde inzwischen geändert. Bitte den Entwurf kopieren oder neu öffnen.':'Widget konnte nicht gespeichert werden. Bitte Einstellungen und Verbindung prüfen.',true);return false;}
    finally{this.busy=false;this.updateStatus();}
  }
  templateInstance(template,cell=null){
    const item=clone(template.item);item.widget_template=template.id;item.id='template_instance';
    item.entity_id='';item.x=5;item.y=5;
    if(cell){Object.assign(item,{x:cell.x,y:cell.y,width:cell.width,height:cell.height,grid_size:true});delete item.manual_size;}
    else Object.assign(item,this.freeElementPosition(item));
    if(!item.style_override)this.inheritElementStyle(item);return item;
  }
  updateDesignWorkspace(){
    const root=this.shadowRoot;root.querySelector('.workspace')?.classList.toggle('widget-design-workspace',!!this.templateSession);
    const back=root.querySelector('[data-action=overview]');if(back)back.textContent=this.designWorkspace?'← '+(this.designWorkspace.type==='widgets'?'Widgeteditor':'Themeseditor'):'← Alle Ansichten';
    if(!this.templateSession)return;
    const input=root.querySelector('#view-name');if(input){input.value=this.view.name;input.disabled=false;input.readOnly=false;}
    const label=root.querySelector('#editor-name-label');if(label)label.textContent='Name der Widgetvorlage';
    for(const selector of ['.view-scroll-settings','.live-controls','.automation-help','.room-suggestions','.cover-background-tools','.styling','.theme-id-field','[data-action=reset-view]','[data-action=theme-follow]','[data-action=theme-use]','[data-action=theme-use-view]','[data-action=add]']){const node=root.querySelector(selector);if(node)node.hidden=true;}
    const context=root.querySelector('.context-hint');if(context)context.textContent='Widgeteditor · Inhalte hier gestalten. Entitäten und Touch-Ziele werden später je Ansicht zugeordnet.';
  }
  async showDevices() {
    if(this.dirty){this.flash('Speichere deinen Entwurf oder verwirf die Änderungen vor dem Displaywechsel.',true);return;}
    this.designLibrary?.close();this.designLibrary=null;this.designWorkspace=null;this.templateSession=null;
    await this.stopLive();this.PickerControls?.releasePopupLocks(this.shadowRoot);this.symbolPicker?.close();this.elementPicker?.close();this.widgetEditor?.close();this.devicesHome?.close();
    this.renderer?.clear();this.renderer=null;this._resize?.disconnect();
    clearInterval(this._clock);clearInterval(this._dataTimer);clearTimeout(this._dataSoon);clearTimeout(this._updateTimer);this._updateTimer=null;
    this._generation++;this.releaseImages();this.page='devices';
    this.devicesHome=new this.DisplayDevices(this,VERSION);await this.devicesHome.mount();
  }
  async switchDisplay(entryId) {
    if(this.busy)return;
    if(this.dirty){this.flash('Speichere deinen Entwurf oder mache die Änderungen rückgängig, bevor du das Display wechselst.',true);return;}
    this.busy=true;await this.stopLive();const generation=++this._generation;
    try {
      const [catalog,doc]=await Promise.all([this.hass.callApi('GET','display_studio/layouts'),this.hass.callApi('GET',`display_studio/layout_library/${entryId}`)]);
      if(generation!==this._generation||!this.isConnected)return;
      this.designLibrary?.close();this.designLibrary=null;
      this.devicesHome?.close();this.devicesHome=null;this.catalog=catalog;this.entryId=entryId;
      this.accept(doc);this.page='overview';this.mount();
    } catch(_) {if(this.devicesHome)this.devicesHome.message('Display konnte nicht geöffnet werden. Bitte den Einrichtungsstatus prüfen.',true);else this.flash('Display konnte nicht geladen werden.',true);}
    finally {this.busy=false;if(!this.devicesHome&&this.config){this.updateStatus();if(this.page==='overview')this.renderOverview();}}
  }
  refreshScene() {
    const root=this.shadowRoot;root.querySelectorAll('[data-scene]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.scene===this.sceneKey)));
    root.querySelector('#scene-title').textContent=this.view?.name || SCENES[this.sceneKey];root.querySelector('#view-name').value=this.view?.name || '';root.querySelector('.view-usage').textContent=this.usage(this.viewId);root.querySelector('#background').innerHTML=options(this.availableBackgrounds,this.scene.background);root.querySelector('#scene-color').value=this.scene.color;root.querySelector('#scene-accent').value=this.scene.accent;root.querySelector('#gradient-angle').value=this.scene.gradient_angle;root.querySelector('#sun-entity').value=this.config.sun_entity;root.querySelector('#weather-entity').value=this.scene.weather_entity || '';root.querySelector('#weather-condition').value=this.scene.weather_condition || 'auto';root.querySelector('#weather-precipitation-mode').value=this.scene.weather_precipitation_mode || 'condition';
    const precipMode=this.scene.weather_precipitation_mode || 'condition';root.querySelector('.weather-precipitation-source').hidden=precipMode==='condition';root.querySelector('#weather-precipitation-entity').innerHTML=`<option value="">${precipMode==='hourly'?'Gleiche Wetterentität':'Sensor wählen'}</option>`+Object.keys(this.hass.states).filter(id=>precipMode==='hourly'?id.startsWith('weather.')&&!!(this.hass.states[id].attributes.supported_features&2):/^(sensor|input_number)\./.test(id)&&['mm/h','in/h'].includes(this.hass.states[id].attributes.unit_of_measurement)).map(id=>`<option value="${escapeHTML(id)}">${escapeHTML(this.hass.states[id].attributes.friendly_name || id)}</option>`).join('');root.querySelector('#weather-precipitation-entity').value=this.scene.weather_precipitation_entity || '';root.querySelector('#weather-animate').checked=this.scene.weather_animate!==false;root.querySelector('#weather-impact').checked=this.scene.weather_impact===true;root.querySelector('#weather-accumulation').checked=this.scene.weather_accumulation===true;root.querySelector('#glass-design').checked=this.scene.glass===true;root.querySelector('#image-fit').value=this.scene.image_fit;root.querySelector('#image-dim').value=this.scene.image_dim;root.querySelector('#image-background').value=this.scene.image_background || 'color';root.querySelector('#image-scale-x').value=this.scene.image_scale_x ?? 100;root.querySelector('#image-scale-y').value=this.scene.image_scale_y ?? 100;root.querySelector('#image-lock-ratio').checked=this.scene.image_lock_ratio!==false;this.renderBackgrounds();
    root.querySelectorAll('[data-theme-style]').forEach(input=>{const key=input.dataset.themeStyle,value=this.scene[key] ?? TEXT_DEFAULTS[key] ?? WEATHER_DEFAULTS[key];if(input.type==='checkbox')input.checked=value;else input.value=key.endsWith('_opacity')?Math.round((1-value)*100):value;});
    const palette=this.themeEditing?{color:this.theme.style.ink,background:this.theme.style.surface,accent_color:this.theme.style.card_accent}:this.scene.elements.find(i=>i.kind!=='hdmi');root.querySelector('#theme-ink').value=palette?.color || '#f2f6fa';root.querySelector('#theme-surface').value=palette?.background || '#142335';root.querySelector('#theme-accent').value=palette?.accent_color || this.scene.accent;
    root.querySelector('.context-hint').textContent=this.viewId==='hdmi_full' ? 'Gemeinsame Ansicht für HDMI 1, 2 und 3. Standard: HDMI im Vollbild. Live zeigt deinen Entwurf auf dem Display; Speichern übernimmt ihn dauerhaft.' : 'Diese Ansicht gestalten. Live zeigt den Entwurf auf dem Display; Speichern übernimmt ihn dauerhaft.';
    root.querySelector('#view-name').disabled=!!CONTEXTS[this.viewId];
    root.querySelector("#automation-view-id").value=this.viewId;root.querySelector(".automation-help").hidden=NOTIFICATION_CONTEXTS.includes(this.viewId);
    for(const selector of ['.cover-background-tools','.room-suggestions','.message-test','.automation-help'])root.querySelector(selector).hidden=this.startupView || (selector==='.room-suggestions' && this.viewId==='hdmi_full') || (selector==='.automation-help' && NOTIFICATION_CONTEXTS.includes(this.viewId));
    root.querySelector('#sun-entity').closest('label').hidden=this.startupView;
    root.querySelector('.preview-label span:last-child').textContent=this.startupView ? 'Ausschließlich lokale Inhalte · '+this.view.name : this.nativeLvgl ? 'ESP-Display · Bordkamera · Live-Entitäten' : '16:9 · HDMI-Platzhalter · Live-Entitäten';
    if(this.startupView)root.querySelector('.context-hint').textContent=this.viewId==='updating'?'Firmwareaktualisierung: Gestaltung, Texte, Farben und Animationen werden lokal auf dem ESP gespeichert. Die Quelle „Firmwareübertragung des ESP“ zeigt den echten Fortschritt; „Update-Text“ bindet Status oder Prozentwert. Live zeigt einen Entwurf mit Vorschauwerten.':this.nativeLvgl?(this.viewId==='startup'?'Bootscreen während der Initialisierung. Der Balken folgt abgeschlossenen Startschritten; die Vorschau zeigt beispielhaft 60 %.':'Verbindungsaufbau nach der Initialisierung. Der Spinner dreht sich bis zur ersten gültigen Studio-Ansicht. Beide Startansichten sind lokal auf dem ESP gespeichert.'):'Gestalte die Anzeige während des App-Starts. Erlaubt sind Texte, lokale Uhr/Datum, Farben, Verläufe und gespeicherte Bilder. Bei HDMI-Vollbild bleibt sie ausgeblendet.';
    this.updateThemeControls();this.updateCoverControls();this.updateLiveStatus();this.paint();this.renderLayers();this.renderSelection();this.renderProperties();this.renderSuggestions();
  }
  setBackgroundPlayer(entity) {
    this.checkpoint();this.scene.media_background_entity=entity;this.scene.media_background_auto=false;
    if(!entity)this.scene.media_background_enabled=false;
    this.changed();
  }
  get suggestedBackgroundPlayer() {
    return this.themeEditing || this.startupView ? '' : this.scene.elements.find(item=>item.kind==='media' && item.entity_id?.startsWith('media_player.'))?.entity_id || '';
  }
  get backgroundPlayer() {return this.scene.media_background_entity || (this.scene.media_background_auto!==false ? this.suggestedBackgroundPlayer : '');}
  updateCoverControls() {
    const root=this.shadowRoot,select=root.querySelector('#media-background-entity');if(!select)return;
    root.querySelector('.cover-background-tools').hidden=this.startupView || this.themeEditing;
    const players=Object.fromEntries(Object.entries(this.hass.states).filter(([id])=>id.startsWith('media_player.')).sort((a,b)=>(a[1].attributes.friendly_name || a[0]).localeCompare(b[1].attributes.friendly_name || b[0])).map(([id,state])=>[id,(state.attributes.friendly_name || id)+' · '+id]));
    const bound=this.backgroundPlayer;
    if(bound&&!players[bound])players[bound]=bound+' · Nicht verfügbar';
    select.innerHTML=options({'':'Mediaplayer wählen',...players},bound);
    root.querySelector('#clear-background-player').disabled=!bound;
    root.querySelector('.cover-background-settings').hidden=!bound;
    root.querySelector('#media-background-enabled').checked=!!this.scene.media_background_enabled;
    root.querySelector('#media-background-fit').value=this.scene.media_background_fit || 'contain';
    root.querySelector('#media-background-color-source').value=this.scene.media_background_color_source || 'edges';
    root.querySelector('#media-background-dim').value=this.scene.media_background_dim ?? .35;
  }
  values(elements=this.scene.elements) {
    const result=clone(this.backendValues || {});
    const weatherId=this.scene.background==='weather'?this.scene.weather_entity:'';
    if(weatherId&&this.hass.states[weatherId])result[weatherId]={...result[weatherId],state:this.hass.states[weatherId].state,...this.hass.states[weatherId].attributes};
    const precipId=this.scene.weather_precipitation_entity;
    if(precipId&&this.hass.states[precipId])result[precipId]={...result[precipId],state:this.hass.states[precipId].state,...this.hass.states[precipId].attributes,unit:this.hass.states[precipId].attributes.unit_of_measurement || ''};
    const backgroundPlayer=this.scene.media_background_enabled ? this.scene.media_background_entity : '';
    const backgroundState=this.hass.states[backgroundPlayer];
    if(backgroundPlayer && !result[backgroundPlayer]?.av_routed)result[backgroundPlayer]=backgroundState ? {state:backgroundState.state,...this.cardData(backgroundState)} : {state:'unavailable'};
    for(const item of elements) {
      if(result[item.entity_id]?.av_routed)continue;
      const state=this.hass.states[item.entity_id];if(!state)continue;
      const attrs=state.attributes;result[item.entity_id]={...result[item.entity_id],state:state.state,name:attrs.friendly_name || item.entity_id,unit:attrs.unit_of_measurement || ''};
      if(['media','status','control','entity','switch','button'].includes(item.kind))Object.assign(result[item.entity_id],this.cardData(state));
      if(item.kind==='weather') for(const key of ['temperature','temperature_unit','humidity','wind_speed','wind_speed_unit','wind_bearing','cloud_coverage','uv_index'])result[item.entity_id][key]=String(attrs[key] ?? '');
      if(item.kind==='calendar' && !result[item.entity_id].events)result[item.entity_id].events=attrs.message?[{summary:attrs.message,start:attrs.start_time,end:attrs.end_time}]:[];
    }
    return result;
  }
  sun() {const id=this.config.sun_entity,state=this.hass.states[id];if(!id || state && !['above_horizon','below_horizon'].includes(state.state))return null;if(id==='sun.sun' && id===this.saved.sun_entity && this.backendSun)return this.backendSun;return state ? {is_daytime:state.state==='above_horizon',elevation:state.attributes.elevation,azimuth:state.attributes.azimuth,rising:state.attributes.rising} : id===this.saved.sun_entity ? this.backendSun : null;}
  fitCamera(item,axis='width') {
    if(item.kind!=='camera')return;
    const preset=this.currentSize(item);
    if(preset==='grid')return;
    if(preset.startsWith('camera_')){
      item.camera_size=preset;[item.width,item.height]=this.cameraSize(item,preset);
      item.x=Math.max(0,Math.min(100-item.width,item.x));item.y=Math.max(0,Math.min((this.scene.scroll_height||100)-item.height,item.y));
      item.lock_ratio=true;return;
    }
    if(!item.camera_lock_aspect)return;
    if(axis==='height'){
      const unit=window.LGCameraTileSize({...item,x:0,width:1},this.displayRatio,100);
      item.width=item.height/unit.height;
    }
    Object.assign(item,window.LGCameraTileSize(item,this.displayRatio,(this.scene.scroll_height||100)-item.y));
    item.lock_ratio=true;
  }
  cameraSourceKey(item) {return JSON.stringify([item.camera_source,item.entity_id,item.multicast_url || '']);}
  async detectCameraAspect(item) {
    const entity=item.camera_source==='local'?this.cameraDescriptor?.snapshot_entity_id:item.entity_id;
    const external=['test','multicast'].includes(item.camera_source);if(!external&&!/^camera\.[a-z0-9_]+$/.test(entity||''))return;
    const source={id:item.id,camera_source:item.camera_source,entity_id:item.entity_id,multicast_url:item.multicast_url},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    let url;
    try {
      const response=await this.hass.fetchWithAuth(external?'/api/display_studio/layout_camera/'+this.entryId:'/api/camera_proxy/'+entity,{signal:controller.signal,...external?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...source,kind:'image'})}:{}});if(!response.ok)return;
      url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();
      if(!controller.signal.aborted)this.cameraDimensions(source,image.naturalWidth,image.naturalHeight,true);
    }catch(_){}finally{clearTimeout(timer);if(url)URL.revokeObjectURL(url);}
  }
  cameraDimensions(source,width,height,exact=false) {
    const item=this.scene.elements.find(i=>i.id===source?.id);
    if(!item || this.cameraSourceKey(item)!==this.cameraSourceKey(source))return;
    if(width<16||height<16)return;
    let ratio=width/height;if(ratio<.1||ratio>10)return;
    this.cameraRatios ||= new Map();const key=this.cameraSourceKey(item),known=this.cameraRatios.get(key);
    if(!exact&&known?.exact)ratio=known.ratio;else this.cameraRatios.set(key,{ratio,exact});
    if(!item.camera_lock_aspect || Math.abs((item.camera_aspect_ratio||16/9)-ratio)<.0001)return;
    // Metadata may arrive asynchronously; ignore it after changing views/sources.
    queueMicrotask(()=>{if(!this.scene.elements.includes(item)||!item.camera_lock_aspect||this.cameraSourceKey(item)!==this.cameraSourceKey(source))return;item.camera_aspect_ratio=ratio;this.fitCamera(item);this.changed();this.renderProperties();this.widgetEditor?.refresh();});
  }
  cameraPreviewOptions(enabled=true) {return {nativeFonts:this.nativeLvgl,nativeHeight:this.displayRendering?.height || 600,hass:this.hass,cameraDescriptor:{...this.cameraDescriptor,preview_path:'/api/display_studio/layout_camera/'+this.entryId,connected:!this.displayOffline},cameraPreview:enabled?(box,detail)=>new this.CameraPreview(box,detail,(item,width,height,exact)=>this.cameraDimensions(item,width,height,exact)):null};}
  paint() {if(['devices','designs'].includes(this.page))return;if(this.page==="overview"){this.paintGallery();return;}this.paintThemePreviews('.presets ');if(this.renderer && this.config)this.renderer.render(this.scene,this.values(),{...this.cameraPreviewOptions(!this.widgetEditor),hideHdmi:!this.hardwareHdmi,onTap:this.interactionPreview?()=>this.flash('Direktaktion · In der Bedienvorschau wird kein Gerät geschaltet.'):null,onValue:this.interactionPreview?()=>this.flash('Wert gewählt · In der Bedienvorschau wird kein Gerät geschaltet.'):null,timezone:this.timezone,sun:this.sun(),mediaUrl:(id,key,size)=>this.mediaUrl(id,key,size),imageUrl:id=>this.imageUrl(id),now:new Date(),message:{title:'Home Assistant',message:this.shadowRoot.querySelector('#test-message')?.value || 'Deine Benachrichtigung erscheint hier.'}});if(this.renderer?.content && this.page!=='overview'){const selection=this.shadowRoot.querySelector('.selection-layer');if(selection && selection.parentNode!==this.renderer.content)this.renderer.content.appendChild(selection);}this.widgetEditor?.paint();this.positionGridSlots();if(this.page!=='overview')this.shadowRoot.querySelectorAll('.selection').forEach(el=>{const item=this.scene.elements.find(i=>i.id===el.dataset.id);if(item)this.positionSelection(el,item);});}
  async refreshValues() {
    if(!this.isConnected)return;
    if(this._dataBusy){this._dataAgain=true;return;}
    this._dataBusy=true;const id=this.entryId,generation=this._generation;
    const media=this.elementPicker?.kind==='media'?this.elementPicker.draft('media'):this.item,entity=media?.kind==='media'?media.entity_id:'';
    try {const doc=await this.hass.callApi('GET',`display_studio/layout/${id}`+(entity?'?media_entity='+encodeURIComponent(entity):''));if(this.isConnected && this.entryId===id && generation===this._generation && doc.revision>=this.revision){if(doc.camera_preview!==undefined)this.cameraDescriptor=doc.camera_preview;this.backendValues=doc.values || {};this.backendSun=doc.sun;this.startupStatus={...doc.startup_design,external:doc.revision>this.revision};this.updateStartupStatus();this.updateConnectionStatus();this.paint();this.refreshMediaControls();}}
    catch(_){}finally{this._dataBusy=false;if(this._dataAgain){this._dataAgain=false;void this.refreshValues();}}
  }
  renderLayers() {
    const container=this.shadowRoot.querySelector('.layers');container.innerHTML=[...this.scene.elements].reverse().map(item=>`<div class="layer ${item.id===this.selected?'active':''}"><button class="name" data-select="${escapeHTML(item.id)}">${escapeHTML(elementName(item))}</button>${this.canOpenWidget(item)?`<button class="icon widget-edit" data-edit-widget="${escapeHTML(item.id)}" aria-label="${escapeHTML(elementName(item))} Einstellungen öffnen" title="Einstellungen öffnen">✎</button>`:''}<button class="icon" data-up="${escapeHTML(item.id)}" title="Nach vorne">↑</button><button class="icon" data-down="${escapeHTML(item.id)}" title="Nach hinten">↓</button><button class="icon delete" data-delete="${escapeHTML(item.id)}" aria-label="${escapeHTML(elementName(item))} entfernen">×</button></div>`).join('');
    container.querySelectorAll('[data-edit-widget]').forEach(button=>button.onclick=()=>this.editWidget(button.dataset.editWidget));
    container.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>this.removeItem(button.dataset.delete));
    container.querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>this.select(button.dataset.select));
    for(const direction of ['up','down'])container.querySelectorAll(`[data-${direction}]`).forEach(button=>button.onclick=()=>{const id=button.dataset[direction],i=this.scene.elements.findIndex(item=>item.id===id),j=i+(direction==='up'?1:-1);if(j<0||j>=this.scene.elements.length)return;this.checkpoint();[this.scene.elements[i],this.scene.elements[j]]=[this.scene.elements[j],this.scene.elements[i]];this.changed(true);});
  }
  canOpenWidget(item){return this.designWorkspace?canEditWidget(item):item?.kind!=='hdmi';}
  editWidget(id) {
    const item=this.scene.elements.find(i=>i.id===id);if(this.themeEditing||!item)return;
    this.select(id);
    if(!this.designWorkspace){if(this.elementPicker)return;this.elementPicker=new this.ElementPicker(this,null,null,VERSION,{item});this.elementPicker.open();return;}
    if(!canEditWidget(item))return;this.widgetEditor?.close();this.widgetEditor=new LGWidgetEditor(this,id);this.updateStatus();this.paint();
  }
  select(id) {this.selected=id;this.renderLayers();this.renderSelection();this.renderProperties();this.renderSuggestions();if(this.item?.kind==='media'&&!this.backendValues?.[this.item.entity_id])void this.refreshValues();}
  selectionRect(item) {
    const node=item.kind==='hdmi'?this.renderer?.hdmi:this.renderer?.nodes[item.id];
    if(item.kind==='hdmi'&&window.LGWidgetPadding(item)){const r=this.renderer.root.getBoundingClientRect();return new DOMRect(r.x+item.x*r.width/100,r.y+item.y*r.height/100,item.width*r.width/100,item.height*r.height/100);}
    if(this.currentSize(item)==='grid'&&node)return (node._frame || node).getBoundingClientRect();
    if(node?._frame)return node._frame.getBoundingClientRect();
    if(item.kind==='logo'&&!item.graphic_id&&node){const rect=node._primitive?.getBoundingClientRect();if(rect){const side=Math.min(rect.width,rect.height),w=side*.6,h=side*.585;return new DOMRect(rect.x+(rect.width-w)/2-2,rect.y+(rect.height-side)/2+side*.2-2,w+4,h+4);}}
    if(isAnimation(item)&&this.currentSize(item)!=='custom'){const ink=animationInkRect(node);if(ink)return ink;}
    if(item.kind==='text' && !item.show_label && node){const ink=textInkRect(node._value);if(ink?.width&&ink.height)return ink;}
    return node?.getBoundingClientRect();
  }
  positionSelection(target,item) {
    target.dataset.standardSize=String(this.currentSize(item)!=='custom');target.dataset.kind=item.kind;
    const rect=this.selectionRect(item),parent=target.parentNode?.getBoundingClientRect();
    if(rect&&parent){Object.assign(target.style,{left:rect.left-parent.left+'px',top:rect.top-parent.top+'px',width:rect.width+'px',height:rect.height+'px'});}
  }
  positionGridSlots(){
    const bounds=this.renderer?.root?.getBoundingClientRect();if(!bounds)return;
    const cells=gridCells(this.view?.grid);
    this.shadowRoot.querySelectorAll('[data-grid-slot]').forEach(node=>{const c=cells[Number(node.dataset.gridSlot)];if(c)Object.assign(node.style,{left:c.x*bounds.width/100+'px',top:c.y*bounds.height/100+'px',width:c.width*bounds.width/100+'px',height:c.height*bounds.height/100+'px'});});
  }
  renderSelection() {
    const container=this.shadowRoot.querySelector('.selection-layer');container.innerHTML='';
    if(!this.themeEditing)for(const cell of gridCells(this.view?.grid).filter(c=>!gridOccupied(c,this.scene.elements))){
      const button=document.createElement('button');button.type='button';button.className='grid-slot';button.dataset.gridSlot=cell.index;button.setAttribute('aria-label','Rasterfeld '+(cell.index+1)+' auswählen');button.setAttribute('aria-pressed',String(this.gridSlot===cell.index));button.textContent='+ '+(cell.index+1);
      button.setAttribute('aria-haspopup','dialog');button.onclick=()=>this.showElementPicker(cell.index);container.append(button);
    }
    this.positionGridSlots();
    for(const item of this.scene.elements) {
      const node=document.createElement('div');node.className='selection'+(item.id===this.selected?' selected':'');node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`${elementName(item)} verschieben`);node.dataset.id=item.id;
      Object.assign(node.style,{left:item.x+'%',top:item.y+'%',width:item.width+'%',height:item.height+'%'});
      const tag=document.createElement('span');tag.className='tag';tag.textContent=elementName(item);node.append(tag);if(this.canOpenWidget(item)){const edit=document.createElement('button');edit.className='widget-edit';edit.textContent='✎';edit.title=this.designWorkspace?'Inhalte bearbeiten':'Einstellungen öffnen';edit.setAttribute('aria-label',(elementName(item))+' Inhalt öffnen');tag.append(edit);edit.onpointerdown=e=>e.stopPropagation();edit.onkeydown=e=>e.stopPropagation();edit.onclick=e=>{e.stopPropagation();this.editWidget(item.id);};}
      if(item.id===this.selected&&this.currentSize(item)==='custom'){const handle=document.createElement('span');handle.className='resize';handle.title='Größe ändern';node.append(handle);}
      node.onpointerdown=event=>this.pointer(event,item.id,node,event.target.classList.contains('resize'));
      node.onkeydown=event=>{
        if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();this.removeItem(item.id);return;}
        if(event.key==='Enter'||event.key===' '){event.preventDefault();this.select(item.id);return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();this.selected=item.id;this.checkpoint();const n=event.shiftKey ? 0.1 : 1;
        item.x=Math.max(0,Math.min(100-item.width,item.x+(event.key==='ArrowRight'?n:event.key==='ArrowLeft'?-n:0)));
        item.y=Math.max(0,Math.min((this.scene.scroll_height || 100)-item.height,item.y+(event.key==='ArrowDown'?n:event.key==='ArrowUp'?-n:0)));
        this.changed();this.renderProperties();this.shadowRoot.querySelector(`.selection[data-id="${item.id}"]`)?.focus();
      };
      if(this.cropEditing===item.id && item.id===this.selected && item.camera_source==='local') {
        node.querySelector('.resize')?.remove();
        const picture=this.shadowRoot.querySelector(`.scene [data-id="${item.id}"] .lg-camera-picture`) || this.shadowRoot.querySelector('.scene .lg-camera-picture');
        if(picture)this.bindCameraCrop(node,item,picture,{checkpoint:()=>this.checkpoint(),paint:()=>{this.paint();this.queueLive();},commit:()=>{this.changed(false,true);this.renderProperties();}});
      }
      container.append(node);this.positionSelection(node,item);
    }
  }
  pointer(event,id,node,resize) {
    if(event.button!==0 || this.busy)return;event.preventDefault();this.selected=id;this.renderLayers();this.renderProperties();
    this.shadowRoot.querySelectorAll('.selection').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
    if(resize&&this.currentSize(this.item)!=='custom')return;
    const item=this.item, original=clone(item), bounds=this.shadowRoot.querySelector('.stage').getBoundingClientRect(),startX=event.clientX,startY=event.clientY;
    const contents=resize?contentGeometry(item,this.renderer.nodes[id]):[],ink=this.selectionRect(item);
    const layer=node.parentNode,origin=layer.getBoundingClientRect(),visible=relativeRect(ink,origin);
    const area={x:0,y:0,width:bounds.width,height:bounds.height*(this.scene.scroll_height||100)/100};
    const peers=this.scene.elements.filter(peer=>peer.id!==id).map(peer=>this.selectionRect(peer)).filter(rect=>rect?.width&&rect.height).map(rect=>relativeRect(rect,origin));
    const limits={x:[visible.x-original.x*bounds.width/100,visible.x+(100-original.width-original.x)*bounds.width/100],y:[visible.y-original.y*bounds.height/100,visible.y+((this.scene.scroll_height||100)-original.height-original.y)*bounds.height/100]};
    const guides=new AlignmentGuides(layer);
    const resizeBox=item.kind==='text'&&!item.show_label?visible:{x:original.x*bounds.width/100,y:original.y*bounds.height/100,width:original.width*bounds.width/100,height:original.height*bounds.height/100};
    const resizeLimits={width:[resizeBox.width*(original.lock_ratio!==false?.01:2)/original.width,resizeBox.width*(100-original.x)/original.width],height:[resizeBox.height*(original.lock_ratio!==false?.01:2)/original.height,resizeBox.height*((this.scene.scroll_height||100)-original.y)/original.height]};
    this.checkpoint();node.setPointerCapture(event.pointerId);
    node.onpointermove=move=>{
      const current=layer.getBoundingClientRect(),dx=(move.clientX-startX+origin.left-current.left)/bounds.width*100,dy=(move.clientY-startY+origin.top-current.top)/bounds.height*100;
      if(resize){
        if(dx||dy){item.manual_size=true;delete item.clock_base_height;delete item.clock_size;}
        const aligned=alignResize(resizeBox,resizeBox.width+dx*bounds.width/100,resizeBox.height+dy*bounds.height/100,area,peers,resizeLimits,original.lock_ratio!==false,move.altKey);
        item.width=original.width*aligned.box.width/resizeBox.width;item.height=original.height*aligned.box.height/resizeBox.height;
        scaleContent(item,original,contents,resizeRatio(original,item.width,item.height));
      }
      else {
        const aligned=alignMove({...visible,x:visible.x+dx*bounds.width/100,y:visible.y+dy*bounds.height/100},area,peers,limits,move.altKey);
        item.x=original.x+(aligned.box.x-visible.x)/bounds.width*100;item.y=original.y+(aligned.box.y-visible.y)/bounds.height*100;guides.show(aligned.lines);
      }
      for(const key of ['x','y','width','height'])item[key]=Math.round(item[key]*100)/100;
      if(resize)this.fitCamera(item);
      this.paint();this.positionSelection(node,item);if(resize)guides.show(move.altKey?[]:resizeLines(relativeRect(this.selectionRect(item),layer.getBoundingClientRect()),area,peers));this.queueLive();
    };
    const end=()=>{node.onpointermove=node.onpointerup=node.onpointercancel=node.onlostpointercapture=null;guides?.close();if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);this.changed();this.renderProperties();};node.onpointerup=node.onpointercancel=node.onlostpointercapture=end;
  }
  animationSettings(item) {
    const type=item.kind==='animation'?(item.animation_type || 'spinner'):item.kind;
    const choices=Object.fromEntries(Object.entries(window.LGAnimations).map(([id,spec])=>[id,spec.label])),part=animationPart(item);
    const source=item.progress_source || (item.kind==='progress'?'boot':'fixed');
    const entities=Object.values(this.hass.states).filter(s=>/^(sensor|number|input_number|counter)\./.test(s.entity_id)).sort((a,b)=>(a.attributes.friendly_name||a.entity_id).localeCompare(b.attributes.friendly_name||b.entity_id));
    const sources={boot:this.viewId==='updating'?'Firmwareübertragung des ESP':'Startfortschritt des ESP',fixed:'Fester Wert',...(!this.startupView?{entity:'Home-Assistant-Entität'}:{})};
    return `<label class="field">Animation<select aria-label="Animation" data-animation="animation_type">${options(choices,type)}</select></label><label class="field">Dauer eines Durchlaufs (ms)<input data-animation="animation_duration" type="number" min="250" max="10000" step="50" value="${item.animation_duration || item.spinner_duration || 1000}"></label>${type==='progress'?`<label class="field">${helpLabel('Fortschrittsquelle',`Zahlenwerte werden auf 0–100 % begrenzt und live übernommen. Bei fehlendem Wert bleibt der Balken leer.`)}<select aria-label="Fortschrittsquelle" data-animation="progress_source">${options(sources,source)}</select></label><label class="field">Highlight<select aria-label="Highlight" data-animation="progress_highlight">${options({auto:'Automatischer Kontrast',white:'Weiß',black:'Schwarz'},item.progress_highlight || 'auto')}</select></label>${source==='entity'?`<label class="field">Home-Assistant-Entität<input aria-label="Fortschrittsentität" list="animation-entities" data-animation="entity_id" value="${escapeHTML(item.entity_id)}" placeholder="sensor.fortschritt"><datalist id="animation-entities">${entities.map(s=>`<option value="${escapeHTML(s.entity_id)}">${escapeHTML(s.attributes.friendly_name||s.entity_id)}</option>`).join('')}</datalist></label><div class="form-grid">${[['progress_min','Minimalwert (0 %)',0],['progress_max','Maximalwert (100 %)',100]].map(([key,label,value])=>`<label>${label}<input data-animation="${key}" type="number" min="-1000000000" max="1000000000" step="any" value="${item[key] ?? value}"></label>`).join('')}</div>`:`<label class="field">Wert / Vorschau (%)<input data-animation="progress_value" type="number" min="0" max="100" step="1" value="${item.progress_value ?? 60}"></label>`}`:''}<div class="toggle"><label><input data-animation-visible type="checkbox" ${part.visible!==false?'checked':''}>Animation anzeigen</label></div>${opacityField('data-animation-opacity','Deckkraft der Animation',part.opacity ?? 1)}${PART_GEOMETRY.some(key=>part[key]!==undefined)?'<button class="small" data-animation-reset>Animationsfläche zurücksetzen</button>':''}`;
  }
  bindAnimationSettings(root,item) {
    this.PickerControls.enhanceEntityFields(root,this);
    this.PickerControls.enhanceActionFields(root);
    const type=item.kind==='animation'?(item.animation_type || 'spinner'):item.kind;
    const part=()=>{item.parts ||= {};return item.parts[item.kind] ||= {};};
    root.querySelector('[data-animation-visible]').onchange=e=>{this.checkpoint();part().visible=e.target.checked;this.changed(true);};
    bindOpacity(root.querySelector('[data-animation-opacity]'),()=>this.checkpoint(),value=>{part().opacity=value;this.paint();this.queueLive();},()=>this.changed());
    root.querySelector('[data-animation-reset]')?.addEventListener('click',()=>{this.checkpoint();for(const key of PART_GEOMETRY)delete part()[key];this.changed(true);});
    root.querySelectorAll('[data-animation]').forEach(input=>input.onchange=()=>{
      const key=input.dataset.animation;
      const value=input.type==='number'?Number(input.value):input.value.trim();
      if(input.type==='number'&&(!input.value||!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max))){this.renderProperties();return;}
      if((key==='progress_min'&&value>=(item.progress_max??100))||(key==='progress_max'&&value<=(item.progress_min??0))){this.flash('Der Maximalwert muss größer als der Minimalwert sein.',true);this.renderProperties();return;}
      this.checkpoint();
      const sizeBefore=this.currentSize(item);
      if(item.kind!=='animation'){
        item.parts ||= {};if(item.parts[item.kind]){item.parts.animation=item.parts[item.kind];delete item.parts[item.kind];}
        item.animation_type=type;item.animation_duration=item.spinner_duration || 1000;
        item.progress_source ||= item.kind==='progress'?'boot':'fixed';delete item.spinner_duration;item.kind='animation';
      }
      item[key]=value;
      if(key==='progress_source'&&value!=='entity')item.entity_id='';
      if(key==='animation_type'&&value!=='progress'&&item.progress_source==='entity'){item.progress_source='fixed';item.entity_id='';}
      if(input.dataset.animation==='animation_type'){
        if(sizeBefore.startsWith('animation_'))this.standardSize(item,sizeBefore);
        else item.manual_size=true;
      }
      item.label=elementName(item);item.show_label=false;this.changed(true);
    });
  }
  graphicSettings(item) {
    return `${helpHeading('Grafik',`PNG, JPEG, WebP, AVIF, HEIC/HEIF oder TIFF · bis 20 MiB. Transparenz bleibt erhalten; transparente Außenränder werden entfernt. Die Grafik wird für den lokalen Displayspeicher optimiert.`)}<label class="field">Grafikauswahl<select data-graphic>${options({...Object.fromEntries(Object.entries(window.LGGraphics).map(([key,value])=>[key,value.name])),...(item.graphic?{custom:'Custom'}:{})},item.graphic_id || 'esphome')}</select></label><label class="field">Eigene Grafik hochladen<input data-graphic-upload type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif,image/tiff,.heic,.heif"></label>`;
  }
  bindGraphicSettings(root,item) {
    root.querySelector('[data-graphic]').onchange=e=>{
      this.checkpoint();const size=this.currentSize(item);item.graphic_id=e.target.value;
      if(size.startsWith('graphic_'))this.standardSize(item,size);
      item.label=graphicName(item);item.show_label=false;this.changed(true);
    };
    root.querySelector('[data-graphic-upload]').onchange=e=>this.uploadGraphic(item,e.target.files[0]);
  }
  async uploadGraphic(item,file) {
    if(!file)return;
    const generation=this._generation,entry=this.entryId,scene=this.scene,ticket=this._graphicUpload=(this._graphicUpload || 0)+1;
    this.flash('Grafik wird verarbeitet …');
    try {
      const {uploadPhoto}=await import(`/display_studio/photo_upload.js?v=${VERSION}`);
      const data=await uploadPhoto(file,[1024,1024],async blob=>{const response=await this.hass.fetchWithAuth(`/api/display_studio/layout_graphic/${entry}`,{method:'POST',body:blob});if(!response.ok)throw Error(await response.text());return response.json();},true);
      if(ticket!==this._graphicUpload||generation!==this._generation||entry!==this.entryId||scene!==this.scene||!scene.elements.includes(item))return;
      if(!window.LGValidGraphic(data.graphic))throw Error('Ungültige Grafikdaten');
      this.checkpoint();const size=this.currentSize(item);item.graphic_id='custom';item.graphic=data.graphic;
      item.label=graphicName(item);item.show_label=false;delete item.parts;
      if(size.startsWith('graphic_'))this.standardSize(item,size);
      this.changed(true);this.flash('Grafik übernommen');
    } catch(error){this.flash(error.message || String(error),true);}
  }
  renderTemplateProperties(root,item){
    const template=this.widgetLibraryDoc?.widgets?.find(w=>w.id===item.widget_template);
    const field=(key,label)=>`<label class="field">${label}<input type="number" data-placement="${key}" value="${Number(item[key].toFixed(2))}" min="0" max="${key==='y'?this.scene.scroll_height||100:100}" step="0.1"></label>`;
    root.innerHTML=`<h2 class="widget-property-title">${escapeHTML(template?.name||elementName(item))}<button class="icon" data-widget-edit aria-label="Widget-Einstellungen öffnen">✎</button></h2><div class="form-grid">${field('x','Links (%)')}${field('y','Oben (%)')}${this.currentSize(item)==='custom'?field('width','Breite (%)')+field('height','Höhe (%)'):''}</div><label class="field">Größe<select data-home-size>${options(this.sizeChoices(false,item),this.currentSize(item))}</select></label><p class="note">Inhalte stammen aus einer gemeinsamen Widgetvorlage. Änderungen im Widgeteditor gelten für alle Verwendungen. Entitäten und Aktionen bleiben dieser Ansicht zugeordnet.</p><button class="secondary" data-template-design>Im Widgeteditor gestalten</button><div class="links"><button class="small delete" data-remove>Element entfernen</button></div>`;
    root.querySelector('[data-widget-edit]').onclick=()=>this.editWidget(item.id);
    root.querySelector('[data-remove]').onclick=()=>this.removeItem(item.id);
    root.querySelector('[data-template-design]').onclick=async()=>{
      if(this.dirty){this.flash('Bitte die Ansicht zuerst speichern oder Änderungen abbrechen.',true);return;}
      const document=await this.hass.callApi('GET','display_studio/widget_library'),definition=document.widgets.find(w=>w.id===item.widget_template);
      if(definition)await this.openWidgetTemplate(definition,this.pickerKind(item),null,this.entryId);
    };
    root.querySelector('[data-home-size]').onchange=e=>{this.checkpoint();if(e.target.value==='custom'){item.manual_size=true;delete item.grid_size;}else this.standardSize(item,e.target.value);this.changed(true);};
    root.querySelectorAll('[data-placement]').forEach(input=>input.onchange=()=>{
      if(!input.checkValidity())return;this.checkpoint();const key=input.dataset.placement;item[key]=Math.max((key==='width'||key==='height') ? .01 : 0,Number(input.value));
      item.x=Math.min(item.x,100-item.width);item.y=Math.min(item.y,(this.scene.scroll_height||100)-item.height);this.changed(true);
    });
  }
  renderProperties() {
    const root=this.shadowRoot.querySelector('.properties'),item=this.item;
    if(!item){root.innerHTML='<h2>Dein Layout, dein Platz</h2><p class="empty">Wähle ein Element in der Vorschau oder füge eines hinzu. Position, Größe und Gestaltung lassen sich frei anpassen.</p>';return;}
    if(item.widget_template&&!this.designWorkspace){this.renderTemplateProperties(root,item);return;}
    const field=(key,label,min,max,step=1)=>`<label>${label}<input type="number" data-prop="${key}" min="${min}" max="${max}" step="${step}" value="${displayNumber(item[key] ?? (key==='content_padding'?0:key==='clock_gap'?4:key==='text_line_height'?1.35:key==='spinner_duration'?1000:key==='progress_value'?60:key==='camera_interval'?5:key==='camera_zoom'?100:key.startsWith('camera_pan_')?0:''))}"></label>`;
    let binding='';if(['control','entity','status','switch','button','media','weather','calendar','camera'].includes(item.kind)&&(item.kind!=='camera'||item.camera_source==='entity')){
      const states=Object.values(this.hass.states).filter(s=>(['entity','status'].includes(item.kind)||isSymbol(item))||(item.kind==='switch'&&/^(switch|light|input_boolean)\./.test(s.entity_id))||(item.kind==='button'&&/^(button|input_button)\./.test(s.entity_id))||s.entity_id.startsWith((['media','control'].includes(item.kind)?'media_player':item.kind)+'.')).sort((a,b)=>(a.attributes.friendly_name||a.entity_id).localeCompare(b.attributes.friendly_name||b.entity_id));
      binding=`<label class="field">Home-Assistant-Entität<input list="entity-options" data-prop="entity_id" value="${escapeHTML(item.entity_id)}" placeholder="${['entity','status','switch','button'].includes(item.kind)||isSymbol(item)?'light.wohnzimmer':(['media','control'].includes(item.kind)?'media_player':item.kind)+'.…'}"><datalist id="entity-options">${states.map(s=>`<option value="${escapeHTML(s.entity_id)}">${escapeHTML(s.attributes.friendly_name||s.entity_id)}</option>`).join('')}</datalist></label>`;
    }
    root.innerHTML=`<h2 class="widget-property-title">${escapeHTML(item.kind==='control'?controlName(item):isAnimation(item)||item.kind==='logo'?elementName(item):KINDS[item.kind])}${this.canOpenWidget(item)?'<button class="icon" data-widget-edit aria-label="Widget-Einstellungen öffnen">✎</button>':''}</h2><div class="form-grid">${field('x','Links (%)',0,98,.1)}${field('y','Oben (%)',0,(this.scene.scroll_height || 100)-.01,.1)}${this.currentSize(item)==='custom'?field('width','Breite (%)',.01,100,.1)+field('height','Höhe (%)',.01,100,.1):''}</div>${this.currentSize(item)==='custom'?`<div class="toggle"><label><input type="checkbox" data-prop="lock_ratio" ${item.lock_ratio!==false?'checked':''}>Seitenverhältnis beibehalten</label></div>`:''}${item.kind==='hdmi'?helpHeading('HDMI','Das HDMI-Bild wird unverzerrt in dieses Rechteck eingepasst. Pro Szene ist ein HDMI-Bild möglich.'):`${helpHeading('Größe','Standardgrößen bleiben fest. Für eigene Maße „Manuell · freie Größe“ wählen.')}<label class="field"><select aria-label="Größe" data-home-size>${options(this.sizeChoices(false,item),this.currentSize(item))}</select></label>${window.LGHomeTheme.enabled(this.scene,item)?`<label class="field">${helpLabel('Kacheltyp',`Symbol: direkte Aktion · Beschriftung: Feinjustierung.`)}<select aria-label="Kacheltyp" data-prop="home_variant">${options({compact:'Kompakt',large:'Groß · Temperatur oder Gerätesymbol',scene:'Szene',chip:'Statuschip'},item.home_variant || 'compact')}</select></label><label class="field">Symbol<select data-prop="home_icon">${options({auto:'Automatisch',light:'Licht',outlet:'Steckdose',blinds:'Jalousie',window:'Fenster',temperature:'Temperatur',water:'Wasser',lock:'Schloss',tv:'TV',speaker:'Lautsprecher',sun:'Sonne',moon:'Mond',home:'Zuhause',person:'Person',fan:'Klima',scene:'Szene',sofa:'Gemütlich',energy:'Strom'},item.home_icon || 'auto')}</select></label>`:''}${['clock','logo'].includes(item.kind)||isAnimation(item)||isSymbol(item)?'':`<h3>Inhalt</h3><label class="field">Beschriftung<input data-prop="label" value="${escapeHTML(item.label)}" maxlength="100"></label>`}${item.kind==='text'&&this.viewId==='updating'?`<label class="field">Update-Text<select aria-label="Update-Text" data-prop="update_role">${options({none:'Eigener Text',status:'Status · eigener Text während Übertragung',percent:'Fortschritt in Prozent'},item.update_role || 'none')}</select></label>`:''}${item.kind==='logo'?this.graphicSettings(item):''}${isAnimation(item)?`${helpHeading('Animation',`Animationen laufen lokal auf ESP, LG und im Browser. Beim Fortschrittsbalken wandert ein Glanzstreifen über den erreichten Stand. „Startfortschritt des ESP“ zeigt beim Booten den echten Fortschritt; die Vorschau verwendet den eingestellten Wert.`)}`+this.animationSettings(item):''}${item.kind==='camera'?'':binding}${item.kind==='camera'?`<label class="field">${helpLabel('Kameraquelle',`„Kamera direkt am ESP“ zeigt die Bordkamera lokal in LVGL, ohne Home Assistant. Die Entitätsauswahl ist für diese Quelle nicht erforderlich. HA-Kameras unterstützen Standbild und Livebild; Die Touch-Aktion „Kamera im Vollbild öffnen“ öffnet das vollständige Livebild. Studio-Ansichten werden auf dem ESP nativ gerendert. ${this.nativeLvgl?'Die Bordkamera wird auch im Standbildmodus direkt auf dem ESP verarbeitet. Mit der entsprechenden Touch-Aktion öffnet sich das Livebild im Vollbild; Schließen kehrt zur gleichen Scrollposition zurück.': 'Live-Video braucht einen eigenen Bereich neben HDMI. Bei Überlappung verwendet „Automatisch“ Einzelbilder einer HA-Kamera. Multicast: H.264/MPEG-TS auf einer 239.x.x.x-Gruppe; das Netzwerk muss Multicast weiterleiten. Standbild und Livebild stehen für HA-Kameras, den lokalen Teststream und Multicast zur Verfügung. Ein zusätzlicher Stream pro Ansicht. Wiedergabe stumm; HDMI-Ton bleibt erhalten.'} ${this.nativeLvgl?'Bis zu acht Kamerakacheln; maximal drei externe Livequellen neben der Bordkamera, sonst vier. Weitere Quellen als Standbild. Die Editor-Vorschau zeigt die Bordkamera live über Home Assistant, unabhängig von der Live-Übertragung des Entwurfs. Einpassen und Ausfüllen entsprechen dem Bildausschnitt auf dem ESP.':'Die Editor-Vorschau zeigt die gewählte Kamera über Home Assistant. Die gewählte Vollbild-Touch-Aktion lässt sich in der Bedienvorschau testen.'} Die Eigene LG-Vorschaukamera ist als Quelle gesperrt.`)}<select aria-label="Kameraquelle" data-prop="camera_source">${options({...this.nativeLvgl?{local:'Kamera direkt am ESP'}:{},entity:'Home-Assistant-Kamera',test:'Lokaler Teststream',multicast:'UDP-Multicast · lokales Netz'},item.camera_source || (this.nativeLvgl?'local':'entity'))}</select></label>${binding}${item.camera_source==='multicast'?`<label class="field">Multicast-Adresse<input data-prop="multicast_url" value="${escapeHTML(item.multicast_url || '')}" placeholder="udp://239.1.2.3:5000" maxlength="80"></label>`:''}<label class="field">Wiedergabe<select aria-label="Wiedergabe" data-prop="camera_mode">${options({auto:'Automatisch',stream:'Livebild',snapshot:'Standbild mit Altersanzeige'},item.camera_mode || 'auto')}</select></label><label class="field"><span class="help-heading"><span>Kachel-Seitenverhältnis</span>${helpControl('Kachel-Seitenverhältnis','Bindet die Kachel an das Seitenverhältnis des Kamerabilds. Bei Klein, Mittel und Groß bleibt die gewählte Breite erhalten; die Höhe folgt dem Kameraformat. Ohne Bindung gilt 16:9. Innenabstand und Bildfläche werden berücksichtigt. Das erkannte Verhältnis wird gespeichert und beim Ziehen beibehalten. Solange kein Bild vorliegt, wird das zuletzt gespeicherte Verhältnis oder 16:9 verwendet. Beschriftungen liegen über dem Bild.')}</span><span class="toggle"><input type="checkbox" aria-label="Kachel an Kamera-Seitenverhältnis binden" data-prop="camera_lock_aspect" ${item.camera_lock_aspect?'checked':''}>An Kamera binden</span></label>${item.camera_lock_aspect?'':`<label class="field">Bildformat<select data-prop="camera_fit">${options({contain:'Vollständig einpassen',cover:'Fläche füllen'},item.camera_fit || 'contain')}</select></label>`}${field('camera_interval','Standbild-Abstand (s)',1,300,1)}${this.nativeLvgl&&item.camera_source==='local'?this.cropControls(item):''}`:''}${item.kind==='text'?`<label class="field">Text<textarea aria-label="Text" data-prop="text" maxlength="2000">${escapeHTML(item.text)}</textarea></label>`:''}${isSymbol(item)?`${this.symbolSettings(item)}`:''}${item.kind==='media'?`${this.mediaControlsSettings(item)}${helpHeading('Mediensteuerung',`Verknüpftes AV-System wählen. Bei laufendem TV-Ton wird Apple TV angezeigt, sonst Sonos. Lautstärke steuert das verknüpfte Soundsystem.`)}<div class="toggle"><label><input type="checkbox" data-prop="media_av_auto" ${item.media_av_auto||this.backendValues?.[item.entity_id]?.av_routed?'checked':''} ${this.backendValues?.[item.entity_id]?.av_routed?'disabled':''}>AV automatisch · Sonos / Apple TV</label></div><label class="field">Mediengestaltung<select data-prop="media_style">${options({compact:'Cover neben Text',poster:'Großes Cover',stage:'Vollbild · Cover & Titel'},item.media_style || 'compact')}</select></label>${[['show_cover','Cover anzeigen'],['show_progress','Fortschritt anzeigen'],['show_playback_icon','Play-/Pause-Symbol anzeigen'],['show_volume','Lautstärke anzeigen']].map(([key,label])=>`<div class="toggle"><label><input type="checkbox" data-prop="${key}" ${(key==='show_playback_icon'?item[key]===true:item[key]!==false)?'checked':''}>${label}</label></div>`).join('')}`:''}${item.style_override&&['media','status','control','entity','switch','button'].includes(item.kind)?`<label class="field">Akzentfarbe<input type="color" alpha colorspace="limited-srgb" data-prop="accent_color" value="${item.accent_color || '#79e5c0'}"></label>`:''}${item.kind==='status'?`<div class="toggle"><label><input type="checkbox" data-prop="status_coloring" ${item.status_coloring!==false?'checked':''}>Status farblich hervorheben</label></div>`:''}${item.kind==='weather'?`<label class="field">Wetteransicht<select data-prop="forecast_type">${options({current:'Nur aktuell',daily:'Tagesvorschau',hourly:'Stundenvorschau'},item.forecast_type)}</select></label><div class="form-grid">${field('forecast_count','Prognoseabschnitte',1,8)}<label>Gestaltung<select data-prop="weather_style">${options({glass:'Karte',sky:'Himmel nach Sonnenstand',minimal:'Transparent'},item.weather_style)}</select></label></div><div class="toggle"><label><input type="checkbox" data-prop="animate" ${item.animate?'checked':''}>Aktuelles Wettersymbol animieren</label></div>`:''}${['clock','logo'].includes(item.kind)||isAnimation(item)||isSymbol(item)?'':`<div class="toggle"><label><input type="checkbox" data-prop="show_label" ${item.show_label?'checked':''}>Beschriftung anzeigen</label></div>`}${helpHeading('Aussehen',item.style_override?'Individuelle Gestaltung nur für dieses Widget.':'Übernimmt die Gestaltung des Ansichts-Themes.')}<label class="styling-toggle"><input type="checkbox" data-element-styling ${item.style_override?'checked':''}>Eigenes Styling</label><div class="widget-appearance" ${item.style_override?'':'hidden'}><div class="form-grid"><label>Darstellung<select data-prop="card_style">${options({inherit:'Wie Ansicht',standard:'Studio',homekit:'Home · Apple Home'},item.card_style || 'inherit')}</select></label>${['clock','logo'].includes(item.kind)||isAnimation(item)||isSymbol(item)?'':field('font_size','Schriftgröße (%)',1,18,.1)}${field('radius','Rundung',0,80)}${item.kind==='logo'?'':`<label>${isAnimation(item)?'Animationsfarbe':'Textfarbe'}<input type="color" alpha colorspace="limited-srgb" data-prop="color" value="${isAnimation(item)?animationPart(item).color || item.color:item.color}"></label>`}<label>Flächenfarbe<input type="color" alpha colorspace="limited-srgb" data-prop="background" value="${item.background}"></label>${opacityField('data-prop="opacity"','Deckkraft der Fläche',item.opacity)}${!['logo','hdmi'].includes(item.kind)&&!isAnimation(item)?opacityField('data-prop="text_opacity"',isSymbol(item)?'Symboldeckkraft':'Schriftdeckkraft',item.text_opacity ?? 1):''}${isAnimation(item)||item.kind==='logo'||isSymbol(item)?'':`<label>Ausrichtung<select data-prop="align">${options({left:'Links',center:'Mittig',right:'Rechts'},item.align)}</select></label><label class="full">Schrift<select data-prop="font">${options(window.LGFontChoices,item.font)}</select></label>`}</div></div>`}${helpHeading('Rahmen & Inhalt','Zusätzlicher gleichmäßiger Rand auf allen Seiten, bezogen auf die kürzere Widgetseite. Die Grundfläche bleibt gleich.'+(item.kind==='text'?' Zeilenabstand als Faktor der Schriftgröße: 1 entspricht 100 %, 1,5 entspricht 150 %.':item.kind==='clock'?' Zeilenabstand in Prozent der inneren Widgethöhe. Beide Zeilen bleiben gemeinsam mittig.':''))}<div class="form-grid">${field('content_padding','Innenabstand (%)',0,25,.5)}${item.kind==='clock'&&item.parts?.time?.visible!==false&&item.parts?.date?.visible!==false?field('clock_gap','Zeilenabstand',0,40,.5):item.kind==='text'?field('text_line_height','Zeilenabstand',.8,3,.05):''}</div>${helpHeading('Wetter','Regen spritzt an den sichtbaren Widgetkanten, Schnee setzt sich ab und Hagel prallt zurück. Mit „Schnee und Hagel liegen lassen“ bleibt eine dünne Schicht auf den Oberkanten erhalten. Wirkt bei animiertem Wetterhintergrund; auch abgerundete Kanten werden berücksichtigt.')}<label class="field"><input type="checkbox" data-prop="weather_reactive" ${item.weather_reactive?'checked':''}>Auf Wetter reagieren</label>${this.touchProperties(item)}<div class="links"><button class="small delete" data-remove>Element entfernen</button></div>`;
    for(const key of ['media_style','weather_style','status_coloring','home_variant']){const control=root.querySelector(`[data-prop="${key}"]`);if(control)control.closest('label').hidden=!item.style_override;}
    if(isSymbol(item))this.bindSymbolSettings(root,item);
    this.PickerControls.enhanceEntityFields(root,this);
    this.PickerControls.enhanceActionFields(root);
    if(item.kind==='logo')this.bindGraphicSettings(root,item);
    if(isAnimation(item))this.bindAnimationSettings(root,item);
    bindHelp(root);
    this.bindCropControls(root,item);
    const edit=root.querySelector('[data-widget-edit]');if(edit)edit.onclick=()=>this.editWidget(item.id);
    root.querySelector('[data-remove]').onclick=()=>this.removeItem(item.id);
    root.querySelector('[data-element-styling]')?.addEventListener('change',e=>{this.checkpoint();this.elementStyling(item,e.target.checked);this.changed(true);});
    const homeSize=root.querySelector('[data-home-size]');if(homeSize)homeSize.onchange=()=>{this.checkpoint();if(homeSize.value==='custom'){item.manual_size=true;delete item.grid_size;}else this.standardSize(item,homeSize.value);this.changed(true);};
    this.bindMediaControls(root,item,()=>this.changed(true),()=>this.checkpoint());
    root.querySelectorAll('[data-prop]').forEach(input=>input.onchange=()=>{
      const item=this.item;if(!item)return;
      this.checkpoint();const key=input.dataset.prop,original=clone(item),contents=['font_size','width','height'].includes(key)?contentGeometry(item,this.renderer.nodes[item.id]):[];let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.type==='color'?colorValue(input.value):input.value;
      if(input.type==='number')value=Math.max(Number(input.min),Math.min(Number(input.max),Number.isFinite(value)?value:Number(input.min)));
      if(['color','background','accent_color'].includes(key))item.style_override=true;
      if(isAnimation(item)&&key==='color')delete animationPart(item).color;
      if(key==='tap_auto')item.tap_auto=value;
      else if(key==='tap_trigger')item.tap_trigger=value;
      else if(key.startsWith('hold_') && key!=='hold_ms') {
        item.hold_action={action:'none',entity_id:'',view:'',...(item.hold_action || {})};
        item.hold_action[key.slice(5)]=value;
        if(key==='hold_action'){item.hold_action.entity_id=['none','show_view'].includes(value)?'':item.entity_id || '';item.hold_action.view=value==='show_view'?(this.config.views.find(v=>this.supportsView(v.id)&&!CONTEXTS[v.id])?.id || ''):'';}
      }
      else if(key.startsWith('tap_')) {
        item.tap_action={action:'none',entity_id:'',view:'',...(item.tap_action || {})};
        item.tap_action[key.slice(4)]=value;
        item.tap_auto=false;
        if(key==='tap_action'){item.tap_action.entity_id=['none','show_view','camera_fullscreen'].includes(value)?'':item.entity_id || '';item.tap_action.view=value==='show_view'?(this.config.views.find(v=>this.supportsView(v.id)&&!CONTEXTS[v.id])?.id || ''):'';}
      } else item[key]=value;
      if(key==='symbol_button' && value && !item.opacity)item.opacity=.92;
      if(item.kind==='camera'){
        if(key==='lock_ratio'&&!value)item.camera_lock_aspect=false;
        if(key==='camera_lock_aspect'&&value){
          const preset=this.currentSize(original);if(preset==='grid'){item.manual_size=true;delete item.grid_size;}else if(preset.startsWith('camera_'))item.camera_size=preset;item.camera_aspect_ratio=this.cameraRatios?.get(this.cameraSourceKey(item))?.ratio||item.camera_aspect_ratio||16/9;
          item.camera_fit='contain';item.camera_zoom=100;item.camera_pan_x=item.camera_pan_y=0;
          if(item.parts?.picture)delete item.parts.picture.fit;
          void this.detectCameraAspect(item);
        }
        if(['camera_lock_aspect','width','height','content_padding','camera_source','entity_id','multicast_url'].includes(key))this.fitCamera(item,key);
      }
      if(item.kind==='control' && key==='tap_entity_id')item.entity_id=value;
      if(item.kind==='control' && key==='entity_id' && item.tap_action && !['none','show_view'].includes(item.tap_action.action))item.tap_action.entity_id=value;
      if(key==='camera_source'&&value==='local')item.entity_id='';
      if(item.kind==='camera'&&item.camera_lock_aspect&&['camera_source','entity_id','multicast_url'].includes(key))void this.detectCameraAspect(item);
      if(key==='x')item.x=Math.min(item.x,100-item.width);if(key==='y')item.y=Math.min(item.y,(this.scene.scroll_height || 100)-item.height);
      if(key==='width')item.width=Math.min(item.width,100-item.x);if(key==='height')item.height=Math.min(item.height,(this.scene.scroll_height || 100)-item.y);
      if(key==='font_size'){
        const ratio=value/original.font_size;
        if(this.currentSize(item)==='custom'){item.width=Math.min(100-item.x,original.width*ratio);item.height=Math.min((this.scene.scroll_height || 100)-item.y,original.height*ratio);}
        scaleContent(item,original,contents,ratio);
      }else if(['width','height'].includes(key))scaleContent(item,original,contents,item[key]/original[key]);
      if(item.kind==='clock'&&key==='font')this.fitClockHeight(item);
      if(['control_icon','entity_id','tap_auto'].includes(key))this.applySuggestedAction(item);
      if(item.kind==='media'&&key==='entity_id')void this.refreshValues();
      if(isSymbol(item)){item.label=controlName(item);item.show_label=false;if(['control_icon','symbol_button','symbol_button_shape','tap_action','tap_auto','entity_id'].includes(key)){const size=this.currentSize(original);if(size.startsWith('symbol_'))this.standardSize(item,size);}}if(!key.startsWith('tap_'))input.value=input.type==='number'?displayNumber(item[key]):item[key];this.changed();this.renderLayers();if(key==='symbol_state_coloring'||['media_controls','media_remote_view','media_av_auto'].includes(key)||key.startsWith('tap_')||key.startsWith('hold_')||key==='camera_lock_aspect'||key==='lock_ratio'||key==='camera_source'||key==='multicast_url'||key==='control_icon'||key==='symbol_button'||key==='symbol_button_shape'||key==='entity_id'||key==='home_variant'||key==='card_style'||['width','height','font_size','content_padding'].includes(key))this.renderProperties();
    });
    for(const key of ['opacity','text_opacity']){const input=root.querySelector(`[data-prop="${key}"]`);if(input)bindOpacity(input,()=>this.checkpoint(),value=>{item[key]=value;this.paint();this.queueLive();},()=>this.changed());}
  }
  symbolSettings(item) {
    return this.PickerControls.symbolField(item)+`<div class="toggle"><label><input type="checkbox" data-prop="symbol_button" ${item.symbol_button?'checked':''}>Button</label></div>${item.symbol_button?`<label class="field">Buttonform<select data-prop="symbol_button_shape">${options({round:'Rund',rounded:'Abgerundet'},item.symbol_button_shape || 'round')}</select></label>`:''}`+this.PickerControls.symbolStateFields(this,item);
  }
  bindSymbolStateColors(root,item,draft=false){
    const change=(state,value)=>{if(!draft)this.checkpoint();item.symbol_state_colors={...item.symbol_state_colors};if(value===null)delete item.symbol_state_colors[state];else item.symbol_state_colors={...item.symbol_state_colors,[state]:colorValue(value)};if(draft)this.elementPicker.configure(this.elementPicker.kind,false);else this.changed(true);};
    root.querySelectorAll('[data-state-color]').forEach(input=>input.onchange=()=>change(input.dataset.stateColor,input.value));
    root.querySelectorAll('[data-state-color-reset]').forEach(button=>button.onclick=()=>change(button.dataset.stateColorReset,null));
  }
  bindSymbolSettings(root,item) {
    this.bindSymbolStateColors(root,item);
    this.PickerControls.bindSymbolPicker(root,this,item,(key,art)=>{
      if(this.item!==item)return;
      this.checkpoint();const preset=this.currentSize(item);item.control_icon=key;
      if(art)item.symbol_art=clone(art);else delete item.symbol_art;
      this.applySuggestedAction(item);item.label=controlName(item);item.show_label=false;
      if(preset.startsWith('symbol_'))this.standardSize(item,preset);
      this.changed(true);
    },VERSION);
  }
  cropControls(item) {
    return `${helpHeading('Bildausschnitt',`Im Bearbeitungsmodus das Bild ziehen und mit Mausrad, Trackpad oder zwei Fingern zoomen. Speichern übernimmt den Ausschnitt für das ESP-Display.`)}<button type="button" class="small" data-crop-edit aria-pressed="${this.cropEditing===item.id}">${this.cropEditing===item.id?'Bildausschnitt fertig':'Bildausschnitt bearbeiten'}</button><div class="form-grid"><label>Kamera-Zoom (%)<input type="number" data-crop="camera_zoom" min="100" max="400" step="1" value="${item.camera_zoom??100}"></label><label>Horizontaler Ausschnitt (%)<input type="number" data-crop="camera_pan_x" min="-100" max="100" step="1" value="${item.camera_pan_x??0}"></label><label>Vertikaler Ausschnitt (%)<input type="number" data-crop="camera_pan_y" min="-100" max="100" step="1" value="${item.camera_pan_y??0}"></label></div><button type="button" class="small" data-crop-reset>Ausschnitt zurücksetzen</button>`;
  }
  bindCropControls(root,item,editor=null) {
    const edit=root.querySelector('[data-crop-edit]');if(!edit)return;
    const refresh=()=>{this.changed();this.renderProperties();editor?.refresh();};
    edit.onclick=()=>{this.cropEditing=this.cropEditing===item.id?null:item.id;refresh();};
    root.querySelector('[data-crop-reset]').onclick=()=>{this.checkpoint();Object.assign(item,{camera_zoom:100,camera_pan_x:0,camera_pan_y:0});refresh();};
    root.querySelectorAll('[data-crop]').forEach(input=>input.onchange=()=>{this.checkpoint();const value=Number(input.value);item[input.dataset.crop]=Math.max(+input.min,Math.min(+input.max,Number.isFinite(value)?value:+input.min));refresh();});
  }
  entityActionAllowed(action,entity) {
    const spec=window.LGEntityActions[action],domain=entity.split('.')[0];if(!spec)return action.startsWith('av_')&&domain==='media_player';
    if(!spec.domains.includes(domain))return false;
    const features=this.hass.states[entity]?.attributes?.supported_features,mask=spec.features?.[domain] || 0;
    return !mask || features===undefined || !!(features&mask);
  }
  suggestedAction(item) {
    const entity=item.entity_id || '',domain=entity.split('.')[0],state=this.hass.states[entity];
    if(!state)return 'none';
    const routed=this.backendValues?.[entity]?.av_routed || item.media_av_auto;
    let candidates;
    if(isSymbol(item))candidates=this.PickerControls.symbolActionCandidates(item.control_icon || 'play',routed);
    else candidates=({media_player:[routed?'av_play_pause':'media_play_pause'],cover:['open_cover'],light:['toggle'],switch:['toggle'],input_boolean:['toggle'],fan:['toggle'],climate:['turn_on'],scene:['activate'],script:['activate'],button:['press'],input_button:['press']})[domain] || [];
    return candidates.find(action=>{
      if(action.startsWith('av_')){
        const available=this.backendValues?.[entity]?.av_available_actions || state.attributes.av_available_actions;
        return domain==='media_player'&&Array.isArray(available)&&available.includes(action);
      }
      const mask=window.LGEntityActions[action]?.features?.[domain] || 0,features=state.attributes.supported_features || 0;
      // Combined power/play-pause icons must support both directions. A plain
      // Play or Pause may fall back to its single supported service instead.
      if(mask&&(isSymbol(item)?(features&mask)!==mask:!(features&mask)))return false;
      return this.entityActionAllowed(action,entity);
    }) || 'none';
  }

  applySuggestedAction(item) {
    if(!item.tap_auto)return;
    const action=this.suggestedAction(item);item.tap_action={action,entity_id:action==='none'?'':item.entity_id,view:''};
  }
  mediaControlViews(){return this.navigationViews.filter(v=>v.id!==this.viewId);}
  mediaControlAvailability(item){
    const data=this.backendValues?.[item.entity_id],routed=item.media_av_auto===true||data?.av_routed===true;
    const actions=routed?(data?.av_available_actions||[]):this.PickerControls.playerControls(this.hass.states[item.entity_id]).actions;
    const prefix=routed?'av_':'player_';
    const remoteState=routed?data?.av_remote_state:this.hass.states[item.entity_id]?.state;
    return new Set(window.LGMediaWidgetSpec.controls.filter(c=>c.key==='remote'?!['off','standby','unavailable','unknown'].includes(remoteState)&&this.mediaControlViews().some(v=>v.id===item.media_remote_view):actions.includes(prefix+c.key)).map(c=>c.key));
  }
  mediaControlHint(item,key){
    if(key!=='remote')return 'Von dieser Entität derzeit nicht unterstützt';
    const name=item.media_av_auto||this.backendValues?.[item.entity_id]?.av_routed?'Apple TV':'Player';
    return this.mediaControlViews().some(v=>v.id===item.media_remote_view)?`${name} ist ausgeschaltet oder nicht erreichbar`:'Zuerst eine Fernbedienungsansicht wählen';
  }
  mediaControlsSettings(item,attribute='data-prop') {
    const enabled=item.media_controls===true,available=this.mediaControlAvailability(item);
    return `<div class="toggle"><label><input type="checkbox" ${attribute}="media_controls" ${enabled?'checked':''}>Bedienelemente anzeigen</label></div>${enabled?`<div class="toggle media-controls-options">${window.LGMediaWidgetSpec.controls.map(c=>`<label title="${available.has(c.key)?'':this.mediaControlHint(item,c.key)}"><input type="checkbox" name="media-control-${c.key}" data-media-control="${c.key}" ${available.has(c.key)&&!(item.media_controls_hidden||[]).includes(c.key)&&item.parts?.['control_'+c.key]?.visible!==false?'checked':''} ${available.has(c.key)?'':'disabled'}>${escapeHTML(c.label)}</label>`).join('')}</div><label class="field">Fernbedienungsansicht<select ${attribute}="media_remote_view" aria-label="Fernbedienungsansicht"><option value="">Keine Ansicht gewählt</option>${this.mediaControlViews().map(v=>`<option value="${escapeHTML(v.id)}" ${item.media_remote_view===v.id?'selected':''}>${escapeHTML(v.name)}</option>`).join('')}</select></label>`:''}`;
  }
  refreshMediaControls(){
    const picker=this.elementPicker;
    if(picker?.kind==='media'){
      const item=picker.draft('media');
      picker.syncMediaControls(item);this.updateMediaControlFields(picker.root,item);
      picker.paint();
    }
    if(this.item?.kind==='media')this.updateMediaControlFields(this.shadowRoot.querySelector('.properties'),this.item);
  }
  updateMediaControlFields(root,item){
    const available=this.mediaControlAvailability(item);
    root?.querySelectorAll('[data-media-control]').forEach(input=>{
      const key=input.dataset.mediaControl;
      input.disabled=!available.has(key);
      input.checked=available.has(key)&&!(item.media_controls_hidden||[]).includes(key)&&item.parts?.['control_'+key]?.visible!==false;
      input.closest('label').title=available.has(key)?'':this.mediaControlHint(item,key);
    });
  }
  bindMediaControls(root,item,changed,before=()=>{}){
    root.querySelectorAll('[data-media-control]').forEach(input=>input.onchange=()=>{
      const key=input.dataset.mediaControl;
      if(input.disabled||!this.mediaControlAvailability(item).has(key))return;
      before();const hidden=new Set(item.media_controls_hidden||[]);
      if(input.checked)hidden.delete(key);else hidden.add(key);
      item.media_controls_hidden=[...hidden];
      if(input.checked&&item.parts?.['control_'+key])delete item.parts['control_'+key].visible;
      changed(key,input.checked);
    });
  }
  touchProperties(item) {
    const tap={action:item.kind==='switch'?'toggle':item.kind==='button'?'press':'none',entity_id:item.entity_id || '',view:'',...(item.tap_action || {})};
    let choices={none:'Keine',...Object.fromEntries(Object.entries(window.LGEntityActions).map(([key,spec])=>[key,spec.label])),show_view:'Seitenwechsel'};
    const avActions={av_power:'AV · System ein/aus',av_volume_set:'AV · Lautstärke-Slider',av_select_source:'AV · Quelle wählen',av_play_pause:'AV · Wiedergabe/Pause automatisch',av_previous:'AV · Vorheriger Titel',av_next:'AV · Nächster Titel',av_volume_down:'AV · Leiser',av_volume_up:'AV · Lauter',av_mute:'AV · Stumm umschalten'};
    for(const [command,label] of Object.entries({up:'Hoch',down:'Runter',left:'Links',right:'Rechts',select:'OK',menu:'Zurück',home:'Home',play_pause:'Wiedergabe/Pause',skip_backward:'Zurückspringen',skip_forward:'Vorspringen',wakeup:'Aufwecken',suspend:'Ruhezustand'}))avActions['av_remote_'+command]='Apple TV · '+label;
    Object.assign(choices,avActions);if(item.kind==='camera')choices.camera_fullscreen='Kamera im Vollbild öffnen';
    if(item.kind==='control'){
      if(item.control_type==='slider')choices={av_volume_set:avActions.av_volume_set};
      else if(item.control_type==='source')choices={av_select_source:avActions.av_select_source};
      else {delete choices.av_volume_set;delete choices.av_select_source;}
    }
    const domains={...Object.fromEntries(Object.entries(window.LGEntityActions).map(([key,spec])=>[key,spec.domains])),...Object.fromEntries(Object.keys(avActions).map(key=>[key,['media_player']]))};
    const holdChoices=Object.fromEntries(Object.entries(choices).filter(([key])=>!['av_volume_set','av_select_source','camera_fullscreen'].includes(key)));
    const entity=tap.entity_id || item.entity_id || '';
    if(entity&&!(item.kind==='control'&&!isSymbol(item)))choices=Object.fromEntries(Object.entries(choices).filter(([key])=>['none','show_view','camera_fullscreen',tap.action].includes(key)||this.entityActionAllowed(key,entity)));
    if(!(item.kind==='control'&&!isSymbol(item))){delete choices.av_volume_set;delete choices.av_select_source;}
    const suggested=this.suggestedAction(item),automatic=suggested!=='none'&&(isSymbol(item)||['entity','status','media','switch','button'].includes(item.kind));
    const suggestionName=window.LGEntityActions[suggested]?.label || avActions[suggested];
    const targets=Object.keys(this.hass.states).filter(id=>(domains[tap.action] || []).includes(id.split('.')[0]));
    const valueControl=item.kind==='control'&&item.control_type!=='icon';
    const hold={action:'none',entity_id:'',view:'',...(item.hold_action || {})};
    const holdTargets=Object.keys(this.hass.states).filter(id=>(domains[hold.action] || []).includes(id.split('.')[0]));
    const gestures=valueControl?'':`<label class="field">Auslösen<select aria-label="Auslösen" data-prop="tap_trigger">${options({press:'Beim Berühren',release:'Beim Loslassen'},item.tap_trigger || 'release')}</select></label><label class="field">Langes Tippen<select aria-label="Langes Tippen" data-prop="hold_action">${options(holdChoices,hold.action)}</select></label>${hold.action==='none'?'':`<label class="field">Haltedauer (ms)<input type="number" min="300" max="5000" step="50" data-prop="hold_ms" value="${item.hold_ms || 700}"></label>${hold.action==='show_view'?`<label class="field">Zielansicht bei langem Tippen<select data-prop="hold_view">${options(Object.fromEntries(this.navigationViews.map(v=>[v.id,v.name])),hold.view)}</select></label>`:`<label class="field">Zielentität bei langem Tippen<input data-prop="hold_entity_id" list="hold-targets" value="${escapeHTML(hold.entity_id)}"><datalist id="hold-targets">${holdTargets.map(id=>`<option value="${escapeHTML(id)}"></option>`).join('')}</datalist></label>`}`}`;
    return `${helpHeading('Touch-Aktion','Beim Berühren wird sofort ausgelöst, auch vor einer Wischbewegung. Beim Loslassen ersetzt langes Tippen die kurze Aktion. Bei sofortigem Auslösen kann die Halteaktion zusätzlich folgen, sofern die Ansicht bestehen bleibt. Wischen bricht langes Tippen ab. Slider und Auswahllisten behalten ihre eigene Bedienung. Die Editor-Vorschau schaltet keine Geräte.')}${gestures}${automatic?`<div class="toggle"><label><input type="checkbox" aria-label="Aktion automatisch vorschlagen" data-prop="tap_auto" ${item.tap_auto?'checked':''}>${helpLabel('Aktion automatisch vorschlagen',`${suggestionName?'Vorschlag: '+suggestionName:'Wähle eine passende Entität und Funktion.'} Eine manuelle Auswahl bleibt erhalten.`)}</label></div>`:''}<label class="field">Bei Berührung<select aria-label="Bei Berührung" data-prop="tap_action">${options(choices,tap.action)}</select></label>${tap.action==='show_view'?`<label class="field">Zielansicht<select data-prop="tap_view">${options(Object.fromEntries(this.navigationViews.map(v=>[v.id,v.name])),tap.view)}</select></label>`:!['none','camera_fullscreen'].includes(tap.action)?`<label class="field">Zielentität<input data-prop="tap_entity_id" list="touch-targets" value="${escapeHTML(tap.entity_id)}"><datalist id="touch-targets">${targets.map(id=>`<option value="${escapeHTML(id)}"></option>`).join('')}</datalist></label>`:''}`;
  }
  async action(action) {
    if(action==='devices')return this.showDevices();
    if(action==='interaction-preview'){this.interactionPreview=!this.interactionPreview;this.updateThemeControls();this.paint();this.flash(this.interactionPreview?'Bedienvorschau: Symbol löst die Aktion aus, Beschreibung öffnet die Feinjustierung. Geräte werden hier nicht geschaltet.':'Elemente können wieder bearbeitet werden.');return;}
    if(action==='weather-theme')return this.createTheme(true);
    if(action==='new-theme')return this.createTheme();
    if(action==='theme-use-view')return this.useThemeForView();
    if(action==='theme-follow')return this.followTheme(this.viewId);
    if(action==='theme-use')return this.useTheme(this.themeId);
    if(action==='all-follow-theme')return this.useTheme(this.config.active_theme || 'cinema',true);
    if(action==='new-view')return this.showCreator();
    if(action==='live')return this.toggleLive();
    if(action==='overview'&&this.designWorkspace){if(this.dirty){this.flash('Bitte zuerst Fertig oder Abbrechen wählen.',true);return;}await this.showDesigns(this.designWorkspace.type);return;}
    if(action==='overview'){await this.stopLive();this.editSession=null;this.page="overview";this.renderOverview();this.showPage();return;}
    if(action==='save')return this.save();
    if(action==='cancel-edit')return this.cancelEditing();
    if(action==='finish-edit')return this.finishEditing();
    if(action==='suggestions')return this.loadSuggestions(this.shadowRoot.querySelector('#suggestion-room').value);
    if(action==='undo' && this.history.length){this.future.push(this.draftSnapshot());this.restoreDraft(this.history.pop());this.selected=null;this.ensureView();this.changed(true);this.flash('Änderung zurückgenommen.');}
    if(action==='redo' && this.future.length){this.history.push(this.draftSnapshot());this.restoreDraft(this.future.pop());this.selected=null;this.ensureView();this.changed(true);this.flash('Änderung wiederhergestellt.');}
    if(action==='add')return this.showElementPicker();
    if(action==='export'){
      const blob=new Blob([JSON.stringify(this.config,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='display-studio-layout.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if(action==='upload-background')this.shadowRoot.querySelector('#bg-upload').click();
    if(action==='browser-link'){
      try {const result=await this.hass.callApi('GET',`display_studio/browser_link/${this.entryId}`);const root=this.shadowRoot.querySelector('.gallery-flash');if(result.substitutions){root.textContent='ESPHome substitutions / secrets.yaml: ';const code=document.createElement('pre');code.textContent=Object.entries(result.substitutions).filter(([key])=>key.startsWith('studio_')).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n');root.append(code);return;}root.textContent='Dieser private Link zeigt nur die ausgewählten Studio-Inhalte: ';const link=document.createElement('a');link.href=result.path;link.target='_blank';link.rel='noreferrer noopener';link.textContent='Anzeige öffnen';root.append(link);}catch(_){this.flash('Anzeigelink konnte nicht geladen werden.',true);}return;
    }
    if(action==='clean-backgrounds')return this.cleanBackgrounds();
    if(action==='reset-view')return this.resetView(this.viewId);
    if(action==='import')this.shadowRoot.querySelector('#layout-import').click();
    if(action==='test'){
      if(this.dirty){this.flash('Speichere zuerst, damit die Testmeldung dein aktuelles Layout verwendet.',true);return;}
      try {await this.hass.callService('display_studio','show_notification',{config_entry_id:this.entryId,title:'Home Assistant',message:this.shadowRoot.querySelector('#test-message').value.slice(0,2000),layout:this.shadowRoot.querySelector('#test-layout').value,duration:10});this.flash('Testmeldung an das Display gesendet.');
      }catch(_){this.flash('Testmeldung nicht möglich. Prüfe App-Verbindung und SI-Dauerbetrieb.',true);}
    }
  }
  removeItem(id) {this.checkpoint();this.scene.elements=this.scene.elements.filter(item=>item.id!==id);this.selected=null;this.changed(true);}
  releaseImages() {for(const url of Object.values(this.imageUrls || {}))if(url)URL.revokeObjectURL(url);this.imageUrls={};this.imagePending=new Set();for(const record of Object.values(this.coverUrls || {}))if(record.url)URL.revokeObjectURL(record.url);this.coverUrls={};for(const request of (this.coverPending || new Map()).values())request.controller.abort();this.coverPending=new Map();}
  imageUrl(id) {
    if(this.imageUrls[id]!==undefined)return this.imageUrls[id] || '';
    if(this.imagePending.has(id))return '';
    const generation=this._generation,entry=this.entryId;this.imagePending.add(id);
    this.hass.fetchWithAuth(`/api/display_studio/layout_background/${entry}/${id}`).then(async response=>{
      if(!response.ok)throw Error();const url=URL.createObjectURL(await response.blob());
      if(!this.isConnected||generation!==this._generation||entry!==this.entryId){URL.revokeObjectURL(url);return;}
      this.imageUrls[id]=url;this.paint();
    }).catch(()=>{if(entry===this.entryId&&generation===this._generation)this.imageUrls[id]=null;}).finally(()=>this.imagePending.delete(id));return '';
  }
  renderBackgrounds() {const select=this.shadowRoot.querySelector('#bg-image');if(!select)return;select.innerHTML='<option value="">Kein Bild</option>'+this.backgrounds.map((id,i)=>`<option value="${id}">Hintergrund ${i+1} · ${id.slice(0,6)}</option>`).join('');select.value=this.scene.image_id || '';}
  async uploadBackground(file) {
    if(!file||this.busy)return;
    if(file.size>20*1024*1024){this.flash('Das Bild darf höchstens 20 MiB groß sein.',true);return;}
    const entry=this.entryId,viewId=this.viewId,themeId=this.themeEditing?this.themeId:null,generation=this._generation;this.busy=true;this.updateStatus();
    try {const {uploadPhoto}=await import(`/display_studio/photo_upload.js?v=${VERSION}`);const data=await uploadPhoto(file,[3840,2160],async blob=>{const response=await this.hass.fetchWithAuth(`/api/display_studio/layout_background/${entry}/upload`,{method:'POST',body:blob});if(!response.ok)throw Error(await response.text());return response.json();});if(generation!==this._generation||entry!==this.entryId)return;
      if(!this.backgrounds.includes(data.image_id))this.backgrounds.push(data.image_id);if(this.imageUrls[data.image_id]===null)delete this.imageUrls[data.image_id];const view=this.config.views.find(v=>v.id===viewId),theme=this.config.themes.find(t=>t.id===themeId);if(!theme&&!view)return;this.checkpoint();const target=theme?theme.style:view.scene;if(view&&!theme)view.theme_override=true;target.image_id=data.image_id;target.background='image';if(theme&&this.themeEditing&&this.themeId===themeId)this.refreshThemePreview();this.changed(true);this.flash('Bild vorbereitet. Speichern überträgt den Hintergrund auf das Display.');
    }catch(error){this.flash(error.message || 'Bild konnte nicht importiert werden.',true);}finally{this.busy=false;this.updateStatus();const input=this.shadowRoot.querySelector('#bg-upload');if(input)input.value='';}
  }
  async cleanBackgrounds() {
    if(this.busy)return;this.busy=true;this.updateStatus();const entry=this.entryId,generation=this._generation;
    const used=new Set([this.config,this.saved,...this.history.map(s=>s.config),...this.future.map(s=>s.config)].flatMap(config=>[...Object.values(config.scenes),...(config.views || []).map(view=>view.scene),...(config.themes || []).map(theme=>theme.style)].map(scene=>scene.image_id)));
    try {for(const id of [...this.backgrounds])if(!used.has(id)){await this.hass.callApi('DELETE',`display_studio/layout_background/${entry}/${id}`);if(generation!==this._generation||entry!==this.entryId)return;URL.revokeObjectURL(this.imageUrls[id] || '');delete this.imageUrls[id];this.backgrounds=this.backgrounds.filter(value=>value!==id);}this.renderBackgrounds();this.flash('Unbenutzte Bilder entfernt. Gespeicherte Szenen und Rückgängig-Schritte bleiben erhalten.');}catch(_){this.flash('Ein Bild wird inzwischen verwendet oder konnte nicht entfernt werden.',true);}finally{this.busy=false;this.updateStatus();}
  }
  cardData(state) {
    const a=state.attributes, data={supported_features:a.supported_features || 0,supported_color_modes:a.supported_color_modes || [],temperature_unit:a.temperature_unit || '°C',domain:state.entity_id.split('.')[0],device_class:a.device_class || ''};
    for(const key of ['media_title','media_artist','media_album_name','app_name','source','media_position_updated_at','hvac_action'])data[key]=String(a[key] ?? '').slice(0,200);
    for(const key of ['media_duration','media_position','volume_level','brightness','current_temperature','temperature','current_position','percentage','min_temp','max_temp','target_temp_step'])data[key]=typeof a[key]==='number'&&Number.isFinite(a[key])?a[key]:null;
    data.is_volume_muted=a.is_volume_muted===true;
    if(state.entity_id.startsWith('media_player.')) {
      const controls=this.PickerControls.playerControls(state);
      data.av_sources=controls.sources;data.av_selected_source=a.source || '';
      data.player_available_actions=controls.actions;
    }
    data.artwork=a.entity_picture&&!['off','standby','unavailable','unknown'].includes(state.state)?JSON.stringify([a.entity_picture,a.media_content_id,a.media_title,a.media_artist,a.media_album_name,a.app_id,a.app_name]):null;
    return data;
  }
  mediaArtworkKey(entity){const data=this.backendValues?.[entity];return data?.av_routed?data.artwork:this.hass.states[entity]?this.cardData(this.hass.states[entity]).artwork:null;}
  mediaUrl(entity,key,size=640) {
    const cacheId=entity+"/"+size;
    const cached=this.coverUrls[cacheId];if(cached?.key===key && (cached.url || Date.now()-cached.at<30000))return cached.url || null;
    const previous=this.coverPending.get(cacheId);if(previous?.key===key)return '';
    if(previous)previous.controller.abort();
    const entry=this.entryId,generation=this._generation,pendingMap=this.coverPending;
    const request={key,controller:new AbortController()};pendingMap.set(cacheId,request);
    const timeout=setTimeout(()=>request.controller.abort(),12000);
    const current=()=>this.isConnected&&entry===this.entryId&&generation===this._generation&&pendingMap===this.coverPending&&pendingMap.get(cacheId)===request;
    this.hass.fetchWithAuth(`/api/display_studio/layout_media/${entry}/${encodeURIComponent(entity)}?v=${this.backendValues?.[entity]?.av_routed?encodeURIComponent(key):'preview'}&size=${size}`,{signal:request.controller.signal}).then(async response=>{
      if(!response.ok||response.status===204)throw Error();const url=URL.createObjectURL(await response.blob());
      const state=this.hass.states[entity];
      if(!current() || !state || this.mediaArtworkKey(entity)!==key){URL.revokeObjectURL(url);return;}
      if(this.coverUrls[cacheId]?.url)URL.revokeObjectURL(this.coverUrls[cacheId].url);this.coverUrls[cacheId]={key,url,at:Date.now()};const keys=Object.keys(this.coverUrls);if(keys.length>32){const old=keys.find(id=>id!==cacheId);if(this.coverUrls[old].url)URL.revokeObjectURL(this.coverUrls[old].url);delete this.coverUrls[old];}this.paint();
    }).catch(()=>{if(current()&&this.hass.states[entity]&&this.mediaArtworkKey(entity)===key){if(this.coverUrls[cacheId]?.url)URL.revokeObjectURL(this.coverUrls[cacheId].url);this.coverUrls[cacheId]={key,url:null,at:Date.now()};}}).finally(()=>{clearTimeout(timeout);if(pendingMap.get(cacheId)===request)pendingMap.delete(cacheId);if(this.isConnected&&entry===this.entryId&&generation===this._generation&&pendingMap===this.coverPending)this.paint();});return '';
  }

  async loadSuggestions(area) {
    const entry=this.entryId,generation=this._generation,request=this._suggestionRequest=(this._suggestionRequest || 0)+1;
    try {const data=await this.hass.callApi('GET',`display_studio/layout_suggestions/${entry}`+(area!==undefined?'?area_id='+encodeURIComponent(area):''));
      if(entry!==this.entryId||generation!==this._generation||request!==this._suggestionRequest||!this.isConnected)return;
      this.rooms=data.areas || [];this.suggestionArea=data.area_id || '';this.suggestions=data.suggestions || [];this.suggestionTotal=data.total || 0;
      const select=this.shadowRoot.querySelector('#suggestion-room');select.innerHTML='<option value="">Raum wählen</option>'+this.rooms.map(room=>`<option value="${escapeHTML(room.area_id)}">${escapeHTML(room.name)}</option>`).join('');select.value=this.suggestionArea;this.renderSuggestions();
    }catch(_){if(entry===this.entryId&&generation===this._generation)this.shadowRoot.querySelector('.room-hint').textContent='Raumvorschläge konnten nicht geladen werden.';}
  }
  renderSuggestions() {
    const list=this.shadowRoot.querySelector('.suggestions');if(!list)return;
    const selected=new Set(this.scene.elements.map(item=>item.entity_id));
    this.shadowRoot.querySelector('.room-hint').textContent=!this.suggestionArea?'Wähle einen Raum. Die Zuordnung des Displays wird automatisch vorgeschlagen.':this.suggestions?.length?'Passend zu deinem Raum. Anklicken fügt eine Karte zur aktuellen Ansicht hinzu.':'Keine passenden Entitäten. Prüfe die Raumzuordnung in Home Assistant.';
    list.innerHTML=(this.suggestions || []).map((card,index)=>{const state=this.hass.states[card.entity_id];const data=state?{...this.cardData(state),state:state.state,unit:state.attributes.unit_of_measurement || ''}:card;const value=window.LGCards.status(data);return `<button class="suggestion" data-suggestion="${index}" ${selected.has(card.entity_id)?'disabled':''}><span class="suggestion-type">${escapeHTML(KINDS[card.kind])}</span><strong>${escapeHTML(card.name)}</strong><span>${selected.has(card.entity_id)?'Bereits in dieser Ansicht':escapeHTML(value.value)}</span></button>`;}).join('');
    list.querySelectorAll('[data-suggestion]').forEach(button=>button.onclick=()=>{const card=this.suggestions[Number(button.dataset.suggestion)];this.insertCard(card.kind,card.entity_id,card.name);});
  }
  placeInGrid(item,cell){
    this.applyGridSize(item,cell);item.x=cell.x;item.y=cell.y;
  }
  async showElementPicker(index=null) {
    const scene=this.scene,viewId=this.viewId,cell=index===null?null:gridCells(this.view?.grid).find(c=>c.index===index);
    if((index!==null&&(!cell||gridOccupied(cell,this.scene.elements)))||this.elementPicker)return;
    try{this.widgetLibraryDoc=await this.hass.callApi('GET','display_studio/widget_library');}catch(_){this.widgetLibraryDoc||={widgets:[]};}
    if(this.elementPicker||scene!==this.scene||viewId!==this.viewId||this.page!=='editor')return;this.elementPicker=new this.ElementPicker(this,cell,index,VERSION);this.elementPicker.open();
  }
  freeElementPosition(item) {
    if(item.grid_size){const cell=gridCells(this.view?.grid).find(c=>Math.abs(c.width-item.width)<.01&&Math.abs(c.height-item.height)<.01&&!gridOccupied(c,this.scene.elements));if(cell)return {x:cell.x,y:cell.y};}
    for(let y=2;y+item.height<=(this.scene.scroll_height||100)-2;y+=2)for(let x=2;x+item.width<=98;x+=2)
      if(!this.scene.elements.some(i=>x<i.x+i.width+1&&x+item.width+1>i.x&&y<i.y+i.height+1&&y+item.height+1>i.y))return {x,y};
    return {x:Math.max(0,Math.min(item.x,100-item.width)),y:Math.max(0,Math.min(item.y,(this.scene.scroll_height||100)-item.height))};
  }
  gridDraft(kind,cell) {
    const item=this.newCard(kind);item.tile_surface=true;
    if(cell)this.placeInGrid(item,cell);else {const grid=this.gridSize();if(grid)this.applyGridSize(item,grid);Object.assign(item,this.freeElementPosition(item));}
    this.inheritElementStyle(item);
    if(isSymbol(item)||item.kind==='logo')item.content_padding=14;
    return item;
  }
  insertPreparedCard(kind,draft,index=null) {
    const cell=index===null?null:gridCells(this.view?.grid).find(c=>c.index===index);
    const error=this.insertionError(kind,draft.entity_id);
    if(error||(index!==null&&(!cell||gridOccupied(cell,this.scene.elements))))return error||'Das Rasterfeld ist inzwischen belegt.';
    const added=clone(draft);added.id=added.kind+'_'+Math.random().toString(36).slice(2,10);
    if(cell)Object.assign(added,{x:cell.x,y:cell.y,width:cell.width,height:cell.height});
    else Object.assign(added,this.freeElementPosition(added));
    this.checkpoint();this.scene.elements.push(added);if(!added.widget_template)this.elementStyling(added,false);
    this.gridSlot=null;this.selected=added.id;this.changed(true);
    if(added.kind==='camera')void this.detectCameraAspect(added);
    return '';
  }
  newCard(kind,entity='',label=KINDS[kind],id=null) {
    const controlType={control:'icon',slider:'slider',dropdown:'source'}[kind];
    if(controlType)kind='control';
    const defaults=kind==='clock'?clone(this.catalog.widget_defaults?.clock || {}):{};
    const created={kind,x:0,y:0,...(controlType?{control_type:controlType}:{})};created.card_style='inherit';
    let [width,height]=this.defaultSize(created);
    if(kind==='media'){width=Math.max(width,60);height=Math.max(height,50);}
    id ||= kind+'_'+Math.random().toString(36).slice(2,10);
    const added={id,kind,lock_ratio:true,...(controlType?{control_type:controlType,control_icon:'play'}:{}),x:5,y:5,width,height,label,text:kind==='text'?'Dein Text':'',entity_id:entity,font_size:defaultFontSize(kind),color:'#f2f6fa',background:'#142335',opacity:.92,radius:24,align:'left',font:'sans',show_label:true,forecast_type:'daily',forecast_count:4,animate:true,weather_style:'glass',media_style:'compact',show_cover:true,show_progress:true,show_playback_icon:false,show_volume:true,media_controls:kind==='media',media_remote_view:this.config.views.some(v=>v.id==='view_av_remote')?'view_av_remote':'',media_controls_hidden:[],status_coloring:true,tap_action:{action:controlType?{icon:'none',slider:'av_volume_set',source:'av_select_source'}[controlType]:kind==='switch'?'toggle':kind==='button'?'press':'none',entity_id:(controlType&&controlType!=='icon')||['switch','button'].includes(kind)?entity:'',view:''},camera_source:this.nativeLvgl&&!entity?'local':!this.hardwareVideo||entity.startsWith('camera.')?'entity':'test',camera_mode:'snapshot',camera_interval:5,camera_fit:'contain',camera_zoom:100,camera_pan_x:0,camera_pan_y:0,accent_color:this.scene.accent,...defaults,width,height,...(['logo','animation','spinner','progress'].includes(kind)?{label:kind==='animation'?'Animation · Spinner':label,animation_type:'spinner',animation_duration:1000,opacity:0,radius:0,show_label:false,align:'center',color:'#18bcf2',spinner_duration:1000,progress_value:60,progress_source:this.viewId==='startup'?'boot':'fixed'}:{})};
    if(kind==='camera'){added.camera_lock_aspect=true;added.camera_aspect_ratio=this.cameraRatios?.get(this.cameraSourceKey(added))?.ratio||16/9;this.standardSize(added,'camera_medium');}if(isSymbol(added)){added.tap_auto=true;this.applySuggestedAction(added);added.opacity=0;added.radius=0;this.standardSize(added,'symbol_medium');}if(kind==='logo'){added.graphic_id='esphome';this.standardSize(added,'graphic_medium');}
    this.inheritElementStyle(added);added.style_override=false;return added;
  }
  insertionError(kind,entity='') {
    if(!this.availableKinds[kind] || (this.startupView && entity))return 'Dieser Elementtyp ist in dieser Ansicht nicht verfügbar.';
    if((['hdmi','message'].includes(kind)||(kind==='camera'&&!this.nativeLvgl))&&this.scene.elements.some(item=>item.kind===kind))return 'Bereits in dieser Ansicht vorhanden.';
    if(kind==='camera'&&this.scene.elements.filter(i=>i.kind==='camera').length>=8)return 'Maximal acht Kamerakacheln pro Ansicht.';
    if(this.scene.elements.length>=64)return 'Maximal 64 Elemente pro Ansicht.';
    return '';
  }
  insertCard(kind,entity='',label=KINDS[kind]) {
    const error=this.insertionError(kind,entity);if(error){this.flash(error,true);return;}
    const added=this.newCard(kind,entity,label),grid=this.gridSize();let {width,height}=added;
    if(grid){width=grid.width;height=grid.height;}
    let spot=null;for(let y=4;y+height<=(this.scene.scroll_height || 100)-2&&!spot;y+=2)for(let x=4;x+width<=98;x+=2)if(!this.scene.elements.some(item=>x<item.x+item.width+1&&x+width+1>item.x&&y<item.y+item.height+1&&y+height+1>item.y)){spot={x,y};break;}
    const freeCells=gridCells(this.view?.grid).filter(c=>!gridOccupied(c,this.scene.elements)),gridCell=freeCells.find(c=>c.index===this.gridSlot)||freeCells[0];
    this.checkpoint();Object.assign(added,spot || {x:5,y:5});this.scene.elements.push(added);
    this.elementStyling(added,false);if(grid)this.placeInGrid(added,gridCell || {...grid,...spot});
    if(added.kind==='camera')void this.detectCameraAspect(added);
    this.gridSlot=null;this.selected=added.id;this.changed(true);this.shadowRoot.querySelector(`.selection[data-id="${added.id}"]`)?.scrollIntoView({block:'nearest'});
    this.flash(gridCell?'Element ins Raster eingefügt. Position und Größe lassen sich weiterhin anpassen.':spot?'Karte eingefügt. Du kannst sie frei gestalten und wieder entfernen.':'Karte eingefügt. Kein freier Platz: Verschiebe sie oder entferne andere Karten.');
  }
  updateLiveStatus(message) {
    const button=this.shadowRoot.querySelector('[data-action=live]'),status=this.shadowRoot.querySelector('.live-status');if(!button)return;
    button.setAttribute('aria-pressed',String(!!this.liveActive));button.disabled=this.busy;
    this.shadowRoot.querySelector('.message-test').hidden=!this.liveActive || this.page!=='editor' || this.startupView || this.themeEditing;
    status.textContent=message || (this.liveActive?'Live aktiv · Änderungen werden übertragen, aber erst mit Speichern gesichert.':'Entwurf auf dem Display ansehen · dauerhaft erst nach Speichern.');
  }
  async toggleLive() {
    if(this.templateSession)return;
    if(this.liveActive)return this.stopLive();
    if(this.busy)return;
    this.liveActive=true;this._liveSession=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');this._liveEntry=this.entryId;this._liveSent=null;
    this._liveView=this.themeEditing?(this.config.views.find(v=>v.id==='dashboard')?.id || this.config.views.find(v=>this.supportsView(v.id)&&!CONTEXTS[v.id])?.id || 'dashboard'):this.viewId;
    this.updateLiveStatus('Live-Verbindung wird hergestellt …');
    await this.sendLive();
    if(this.liveActive)this._liveHeartbeat=setInterval(()=>this.sendLive(),15000);
  }
  queueLive() {if(this.templateSession)return;
    if(!this.liveActive)return;
    if(!this._liveTimer)this._liveTimer=setTimeout(()=>{this._liveTimer=null;this.sendLive();},400);
  }
  async sendLive() {
    if(!this.liveActive || this.busy)return;
    if(this._liveJob){this._livePending=true;return this._liveJob;}
    this.compileViews();const config=clone(this.config);config.enabled=true;
    if(this.themeEditing){let view=config.views.find(v=>v.id===this._liveView);if(!view){view={id:this._liveView,name:'Theme-Vorschau'};config.views.push(view);}view.scene=clone(this.themeScene);view.theme_override=true;}
    const snapshot=JSON.stringify(config),session=this._liveSession,entry=this._liveEntry;
    const data={revision:this.revision,view:this._liveView,message:this.shadowRoot.querySelector('#test-message').value};
    if(snapshot!==this._liveSent)data.config=config;
    const job=(async()=>{
      try {
        await this.hass.callApi('POST',`display_studio/layout_live/${entry}/${session}`,data);
        if(this._liveSession===session&&this.liveActive){this._liveSent=snapshot;this.updateLiveStatus();}
      }catch(error){
        if(this._liveSession!==session)return;
        this.liveActive=false;clearInterval(this._liveHeartbeat);clearTimeout(this._liveTimer);this._liveTimer=null;
        this.updateLiveStatus(error?.status_code===409?'Live beendet: Eine andere Sitzung verwendet oder änderte die Anzeige.':'Live nicht verfügbar. Prüfe die Display-Verbindung und den Entwurf.');
        this.flash('Dein Entwurf bleibt erhalten. Live kann erneut aktiviert werden.',true);
        try{await this.hass.callApi('DELETE',`display_studio/layout_live/${entry}/${session}`);}catch(_){}
      }
    })();
    this._liveJob=job;await job;
    if(this._liveJob===job)this._liveJob=null;
    if(this._livePending){this._livePending=false;this.queueLive();}
  }
  async stopLive() {
    const session=this._liveSession,entry=this._liveEntry;
    this.liveActive=false;clearTimeout(this._liveTimer);this._liveTimer=null;clearInterval(this._liveHeartbeat);this._livePending=false;
    if(!session)return;
    this._liveSession=null;this.updateLiveStatus('Live wird beendet …');
    if(this._liveJob)await this._liveJob;
    try{await this.hass.callApi('DELETE',`display_studio/layout_live/${entry}/${session}`);this.updateLiveStatus();}
    catch(_){this.updateLiveStatus('Verbindung unterbrochen · Live endet automatisch spätestens nach 45 Sekunden.');}
  }
  captureEdit() {
    return {config:clone(this.config),saved:clone(this.saved),rotation:this.displayRendering?.rotation ?? null,savedRotation:this.deviceRendering?.rotation ?? null,history:clone(this.history),future:clone(this.future),
      page:this.page,viewId:this.viewId,sceneKey:this.sceneKey,themeId:this.themeId,selected:this.selected,parent:this.editSession};
  }
  async restoreEdit(snapshot) {
    if(!snapshot || this.busy)return false;
    // A nested widget's Fertig may already have saved. Cancelling the outer
    // editor must also restore that persisted state, guarded by its revision.
    if(JSON.stringify(this.saved)!==JSON.stringify(snapshot.saved) || snapshot.savedRotation!==(this.deviceRendering?.rotation ?? null)){
      this.busy=true;this.updateStatus();
      try{
        if(this._liveJob)await this._liveJob;
        const result=await this.hass.callApi('POST',`display_studio/layout_library/${this.entryId}`,{config:clone(snapshot.saved),revision:this.revision});
        this.saved=this.withViews(clone(result.config));this.revision=result.revision;this.startupStatus=result.startup_design;
        await this.persistRotation(snapshot.savedRotation);
      }catch(error){this.flash(error?.status_code===409?'Die gespeicherte Ansicht wurde zwischenzeitlich geändert. Abbrechen konnte sie nicht wiederherstellen.':'Änderungen konnten nicht verworfen werden. Bitte erneut versuchen; der Entwurf bleibt geöffnet.',true);return false;}
      finally{this.busy=false;this.updateStatus();}
    }
    this.restoreDraft(snapshot);this.history=clone(snapshot.history);this.future=clone(snapshot.future);
    for(const key of ['page','viewId','sceneKey','themeId','selected'])this[key]=snapshot[key];
    if(this.themeEditing)this.refreshThemePreview();
    this.changed(true);return true;
  }
  async cancelEditing() {
    if(this.templateSession){this.widgetEditor?.close();this.templateSession=null;this.dirty=false;await this.showDesigns('widgets');return;}
    const snapshot=this.editSession;if(!snapshot || this.busy)return;
    await this.stopLive();if(!await this.restoreEdit(snapshot))return;
    this.editSession=snapshot.parent;if(this.designWorkspace){this.dirty=false;await this.showDesigns(this.designWorkspace.type);return;}this.renderOverview();this.showPage();this.flash('Änderungen verworfen.');
  }
  async finishEditing() {
    if(!await this.save())return;
    if(this.designWorkspace){const type=this.designWorkspace.type;this.widgetEditor?.close();this.templateSession=null;this.dirty=false;await this.showDesigns(type);return;}
    await this.stopLive();const snapshot=this.editSession;this.editSession=snapshot?.parent;
    this.page=snapshot?.page==='editor'?'editor':'overview';
    if(this.page==='editor'){this.viewId=snapshot.viewId;this.sceneKey=snapshot.sceneKey;}
    this.selected=null;this.renderOverview();this.showPage();
  }
  async save() {
    if(this.templateSession)return this.saveWidgetTemplate();
    if(this.busy)return false;
    if(this._liveJob)await this._liveJob;
    if(this.busy)return false;
    for(const view of this.config.views){
      const camera=view.scene.elements.find(i=>i.kind==='camera'),hdmi=view.scene.elements.find(i=>i.kind==='hdmi');
      if(camera&&hdmi&&camera.x<hdmi.x+hdmi.width&&hdmi.x<camera.x+camera.width&&camera.y<hdmi.y+hdmi.height&&hdmi.y<camera.y+camera.height&&(camera.camera_source!=='entity'||camera.camera_mode==='stream')){
        this.flash('„'+view.name+'“: Kamerastream und HDMI dürfen sich nicht überlappen. HDMI verkleinern oder für eine HA-Kamera Automatisch / Nur Einzelbilder wählen.',true);return false;
      }
    }
    this.busy=true;this.updateStatus();
    this.config.enabled=true;this.compileViews();const sent=clone(this.config);
    try {
      const result=await this.hass.callApi('POST',`display_studio/layout_library/${this.entryId}`,{config:sent,revision:this.revision});
      this.revision=result.revision;this.startupStatus=result.startup_design;this.saved=this.withViews(clone(result.config));
      if(JSON.stringify(this.config)===JSON.stringify(sent))this.config=this.withViews(clone(result.config));
      // Save/revision validation must succeed before changing the real device.
      // Retain a failed orientation as an unsaved draft, even if the layout saved.
      if(this.rotationDirty){
        try{await this.persistRotation(this.displayRendering.rotation);}
        catch(_){this.dirty=this.draftDirty;this.flash('Ansichten gespeichert. Die Drehung konnte nicht gespeichert werden. Bitte erneut speichern; die gewählte Drehung bleibt im Entwurf.',true);return false;}
      }
      this.dirty=this.draftDirty;
      this.flash(this.displayOffline?'In Home Assistant gespeichert. Wird beim nächsten Verbinden auf das Display übertragen.':this.startupView?(this.nativeLvgl?'Startanzeige gespeichert. Der ESP bestätigt die lokale Speicherung.':'Startanzeige gespeichert. Die verbundene App speichert die Gestaltung lokal.'):'Gespeichert. Die verbundene App übernimmt das Layout automatisch.');return !this.dirty;
    }
    catch(error){this.flash(error?.status_code===409?'Eine andere Sitzung hat das Layout geändert. Exportiere deinen Entwurf und lade den Editor neu.':'Speichern fehlgeschlagen. Prüfe Entitäten, Feldwerte und Verbindung. Dein Entwurf bleibt erhalten.',true);return false;}
    finally{this.busy=false;this.updateStatus();if(this.page==="overview")this.renderOverview();else {this.refreshScene();this.widgetEditor?.refresh();}clearTimeout(this._dataSoon);this._dataSoon=setTimeout(()=>this.refreshValues(),2500);this.queueLive();}
  }
  async importFile(file) {
    if(!file)return;
    try {
      if(file.size>1048576)throw Error();const config=JSON.parse(await file.text());
      // Rendering imported CSS/text before server validation is deliberately avoided.
      const result=await this.hass.callApi('POST',`display_studio/layout_validate`,{config,entry_id:this.entryId});
      this.checkpoint();this.config=this.withViews(result.config);this.ensureView();this.selected=null;this.changed(true);this.flash('Layout als Entwurf importiert.');
    }catch(_){this.flash('Keine gültige Layout-Datei. Verwende einen Export aus Display Studio (maximal 1 MiB).',true);}
    finally{this.shadowRoot.querySelector('#layout-import').value='';}
  }
  isBuiltinTheme(id) {return this.catalog.presets.some(p=>p.id===id);}
  applyTheme(theme) {
    const style=theme.layout?themeStyle(theme.layout.scenes.dashboard):theme.style;
    this.checkpoint();this.markThemeOverride();
    if(this.themeEditing)Object.assign(this.theme.style,clone(style));
    applyThemeStyle(this.scene,style,this.startupView);
    this.changed(true);this.flash(theme.name+' mit festgelegtem Hintergrund übernommen. Inhalte und Anordnung bleiben erhalten.');
  }
  renderThemePicker() {
    const node=this.shadowRoot.querySelector('.presets');if(!node || this.themeEditing)return;
    const key=JSON.stringify([this.config.themes,this.themeEditing]);if(node.dataset.content===key)return;node.dataset.content=key;
    node.innerHTML=this.config.themes.map(theme=>`<div class="theme-option"><button class="preset theme" data-theme="${escapeHTML(theme.id)}"><div class="mini" data-theme-preview="${escapeHTML(theme.id)}" style="background:${window.LGLayoutBackground(theme.style,{sun:this.sun(),imageUrl:id=>this.imageUrl(id)})}"></div><strong>${escapeHTML(theme.name)}</strong></button>${!this.themeEditing&&!this.isBuiltinTheme(theme.id)?`<button class="theme-edit small" data-edit-theme="${escapeHTML(theme.id)}" aria-label="${escapeHTML(theme.name)} Theme bearbeiten">✎</button>`:''}</div>`).join('')+(this.themeEditing?'':this.newThemeTile());
    node.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>this.applyTheme(this.config.themes.find(t=>t.id===button.dataset.theme)));
    node.querySelectorAll('[data-edit-theme]').forEach(button=>button.onclick=()=>this.openTheme(button.dataset.editTheme,this.viewId));
    const add=node.querySelector('[data-new-theme]');if(add)add.onclick=()=>this.createTheme();
  }
  newThemeTile() {return `<button class="preset theme theme-add" data-new-theme aria-label="＋ Neues Theme" title="Eigenes Theme hinzufügen" ${this.config.themes.length>=25?'disabled':''}><span aria-hidden="true">+</span></button>`;}
  createTheme(weather=false) {
    if(this.config.themes.length>=25){this.flash('Maximal 20 eigene Themes.',true);return;}
    const viewId=this.page==='editor'?this.viewId:null;
    const style=viewId?themeStyle(this.scene):clone(this.config.themes.find(t=>t.id===(this.config.active_theme || 'cinema')).style);
    if(weather)Object.assign(style,{background:'weather',weather_entity:Object.keys(this.hass.states).find(id=>id.startsWith('weather.')) || '',weather_animate:true,glass:true,ink:'#f0f7ff',surface:'#40576c',card_accent:'#d9edff',surface_opacity:.45});
    const snapshot=this.captureEdit();this.checkpoint();const theme={id:'theme_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10),name:weather?'Wetter & Glas':'Mein Theme',style};
    this.config.themes.push(theme);this.changed();this.openTheme(theme.id,viewId,snapshot);
  }
  async useThemeForView() {
    const view=this.config.views.find(v=>v.id===this.themeReturnView);if(!this.themeEditing || !view)return;
    this.checkpoint();view.theme_override=true;applyThemeStyle(view.scene,this.theme.style,['startup','connecting','updating'].includes(view.id));this.changed();await this.openView(view.id);
  }
  refreshThemePreview() {
    if(!this.theme)return;
    this.themeScene=applyThemeStyle(clone((this.config.views.find(v=>v.id==='dashboard')?.scene || this.catalog.presets[0].layout.scenes.dashboard)),this.theme.style);
    this.themeScene.media_background_enabled=false;this.themeScene.media_background_entity='';
  }
  openTheme(id,returnView=null,snapshot=null) {
    if(this.isBuiltinTheme(id))return;
    this.themeReturnView=returnView;
    this.symbolPicker?.close();this.elementPicker?.close();void this.stopLive();this.widgetEditor?.close();
    if(!this.config.themes.some(t=>t.id===id))return;
    this.editSession=snapshot || this.captureEdit();this.themeId=id;this.themeTab='background';this.page='theme';this.selected=null;this.refreshThemePreview();this.showPage();this.updateStatus();this.shadowRoot.querySelector('header').scrollIntoView({block:'start'});
  }
  updateAppearancePanels() {
    const root=this.shadowRoot,editing=this.themeEditing,tab=this.themeTab || 'background',background=this.scene.background;
    root.querySelector('.theme-settings-tabs').hidden=!editing;
    root.querySelectorAll('[data-theme-tab]').forEach(button=>{const selected=button.dataset.themeTab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    root.querySelectorAll('[data-theme-panel]').forEach(panel=>{
      panel.hidden=editing?(panel.dataset.themePanel==='template' || panel.dataset.themePanel!==tab):panel.dataset.themePanel!=='template';
      if(editing){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','theme-tab-'+panel.dataset.themePanel);}
      else {panel.removeAttribute('role');panel.removeAttribute('aria-labelledby');}
    });
    root.querySelector('#scene-color').closest('label').hidden=['solar','weather'].includes(background) || (background==='image' && this.scene.image_background==='edges');
    root.querySelector('#scene-accent').closest('label').hidden=!['aurora','dawn','ocean','midnight','gradient'].includes(background);
    root.querySelector('#gradient-angle').closest('label').hidden=background!=='gradient';
    root.querySelector('#sun-entity').closest('label').hidden=!['solar','weather'].includes(background) || this.startupView;
    root.querySelector('.weather-background-settings').hidden=background!=='weather';
    root.querySelector('#glass-design').closest('label').hidden=this.startupView;
    root.querySelector('.background-tools').hidden=background!=='image';
    root.querySelector('.image-sizing').hidden=!this.scene.image_id;
    for(const id of ['image-background','image-fit','image-dim'])root.querySelector('#'+id).closest('label').hidden=!this.scene.image_id;
    const note=root.querySelector('.background-context');
    note.textContent=background==='weather'?'Lokales Live-Wetter mit Wolken, Nebel, Regen, Hagel und Schnee. Sonne und Mond folgen dem HA-Standort; die Himmelsrichtung wird von Norden aus über 360° auf die Bildschirmbreite abgebildet. Bei fehlenden Wetterdaten bleibt ein ruhiger Himmel.':background==='solar'?'Farben und Verlauf folgen automatisch dem aktuellen Sonnenstand.':background==='image'?(this.scene.image_background==='edges'?'Die Farben aus dem Bildrand füllen die freie Fläche. Schwarze Außenränder werden übersprungen.':'Die Grundfarbe füllt freie Bildränder und wird bis zum Laden des Bildes angezeigt.'):'';
    note.hidden=!note.textContent;
  }
  updateThemeControls() {
    const root=this.shadowRoot,editing=this.themeEditing;
    root.querySelector('.workspace').classList.toggle('theme-editing',editing);
    for(const selector of ['.inspector','.selection-layer','.main > .hint'])root.querySelector(selector).hidden=editing;
    root.querySelector('.selection-layer').hidden=editing || !!this.interactionPreview;
    root.querySelector('[data-action=interaction-preview]').setAttribute('aria-pressed',String(!!this.interactionPreview));
    root.querySelector('[data-action=interaction-preview]').hidden=editing;
    root.querySelector('#view-scroll').value=String(this.scene.scroll_height || 100);
    root.querySelector('.view-scroll-settings').hidden=editing || this.startupView || this.scene.elements.some(i=>i.kind==='hdmi');
    root.querySelector('.theme-id-field').hidden=!editing;
    root.querySelector('#theme-id').value=editing?this.theme.id:'';
    root.querySelector('[data-action=theme-use]').hidden=!editing;
    root.querySelector('[data-action=theme-use-view]').hidden=!editing || !this.config.views.some(v=>v.id===this.themeReturnView);
    this.updateAppearancePanels();
    this.renderThemePicker();
    const ownStyle=!!this.view?.theme_override;
    root.querySelector('[data-action=theme-follow]').hidden=editing || !ownStyle;
    root.querySelector('.styling-toggle').hidden=editing;
    root.querySelector('#own-styling').checked=ownStyle;
    root.querySelector('.appearance-controls').hidden=!editing && !ownStyle;
    const activeTheme=this.config.themes.find(t=>t.id===this.config.active_theme);
    root.querySelector('.styling-status').textContent=editing?'Gemeinsame Farben und Hintergründe dieses Themes bearbeiten.':ownStyle?'Eigenes Theme für diese Ansicht wählen. Der Hintergrund ist im Theme festgelegt. Ausschalten übernimmt wieder das Standard-Theme.':'Folgt '+(activeTheme?activeTheme.name+' · ':'dem Standard-Theme · ')+'Eigenes Styling einschalten, um ein anderes Theme mit festgelegtem Hintergrund zu wählen.';
    root.querySelector('#editor-name-label').textContent=editing?'Name des Themes':'Name der Ansicht';
    if(editing){
      root.querySelector('#view-name').disabled=false;root.querySelector('#view-name').value=this.theme.name;
      root.querySelector('#scene-title').textContent=this.theme.name+' · Theme-Vorschau';
      root.querySelector('.view-usage').textContent='Gemeinsame Farben und Hintergründe';
      root.querySelector('.context-hint').textContent='Dieses Theme gestaltet alle folgenden Ansichten. Widgets und Anordnung werden nicht verändert. Speichern übernimmt den Entwurf.';
      for(const selector of ['.room-suggestions','.message-test','.automation-help'])root.querySelector(selector).hidden=true;
    }else if(this.view){
      const theme=this.config.themes.find(t=>t.id===this.config.active_theme);
      root.querySelector('.view-usage').textContent=this.usage(this.viewId)+(this.view.theme_override?' · Eigene Theme-Abweichung':theme?' · Folgt '+theme.name:' · Folgt dem gewählten Theme');
    }
  }
  useTheme(id,all=false) {
    if(!this.config.themes.some(t=>t.id===id))return;
    this.checkpoint();this.config.active_theme=id;if(all)for(const view of this.config.views)view.theme_override=false;
    this.changed(true);this.flash('Standard-Theme gewählt. '+(all?'Alle Ansichten folgen wieder. ':'Eigene Abweichungen bleiben erhalten. ')+'Speichern übernimmt die Änderung.');
  }
  followTheme(id) {
    const view=this.config.views.find(v=>v.id===id);if(!view)return;this.checkpoint();view.theme_override=false;
    const theme=this.config.themes.find(t=>t.id===(this.config.active_theme || 'cinema'));
    applyThemeStyle(view.scene,theme.style,['startup','connecting','updating'].includes(id));this.changed(true);this.flash('Theme-Standard wiederhergestellt. Inhalte und Anordnung bleiben erhalten.');
  }
  duplicateTheme(id) {
    if(this.config.themes.length>=25){this.flash('Maximal 24 Themes.',true);return;}
    const source=this.config.themes.find(t=>t.id===id);if(!source)return;this.checkpoint();const copy=clone(source);copy.id='theme_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);copy.name=source.name.slice(0,68)+' · Kopie';this.config.themes.push(copy);this.changed();this.openTheme(copy.id);
  }
  deleteTheme(id) {
    if(this.catalog.presets.some(p=>p.id===id))return;
    this.checkpoint();for(const view of this.config.views)for(const item of view.scene.elements)if(item.element_theme===id){item.element_theme='';item.card_style='inherit';}this.config.themes=this.config.themes.filter(t=>t.id!==id);if(this.config.active_theme===id)this.config.active_theme='cinema';this.ensureView();this.changed(true);this.flash('Theme entfernt. Rückgängig stellt es wieder her.');
  }
  adaptEspView(view) {
    const scene=view.scene;
    let camera=scene.elements.find(item=>item.kind==='camera');
    scene.elements=scene.elements.filter(item=>{if(item.kind!=='hdmi')return true;if(camera)return false;Object.assign(item,{kind:'camera',camera_source:'local',entity_id:'',label:'Bordkamera',show_label:false,parts:{},tap_action:{action:'none',entity_id:'',view:''}});camera=item;return true;});

    if(['startup','connecting','updating'].includes(view.id) && JSON.stringify(scene.elements.map(i=>i.text))===JSON.stringify(['HOME ASSISTANT','Dein Display startet …','Einen Moment bitte.'])){
      const d=view.id==='connecting'?window.LGStartupDefault.connecting:window.LGStartupDefault;
      const item={...clone(scene.elements[0]),id:view.id,kind:view.id==='connecting'?'startup':'boot',x:0,y:0,width:100,height:100,text:d.text,font_size:d.font_size,color:d.color,opacity:0,radius:0,show_label:false,align:'center',parts:{}};
      Object.assign(scene,{background:'solid',color:d.background,accent:d.accent,image_id:'',elements:[item]});view.theme_override=true;
    }
    // Migrate legacy cards once. Active crop/drag handlers keep references to
    // ordinary elements, so do not clone those on every draft change.
    if(scene.elements.some(item=>['boot','startup'].includes(item.kind)))scene.elements=window.LGSplitStartupElements(scene.elements);
  }
  withViews(config) {
    if(!Array.isArray(config.views))config.views=Object.entries(TEMPLATE_CONTEXTS).filter(([id])=>config.scenes[id]).map(([id,name])=>({id,name,scene:clone(config.scenes[id])}));
    if(this.nativeLvgl && !config.views.some(v=>v.id==='connecting')){
      const boot=config.views.find(v=>v.id==='startup');
      if(boot){const connection={...clone(boot),id:'connecting',name:'Verbindungsaufbau'};
        for(const item of connection.scene.elements)if(item.kind==='startup' && item.text===window.LGStartupDefault.text)item.text=window.LGStartupDefault.connecting.text;
        for(const item of boot.scene.elements)if(item.kind==='startup'){item.kind='boot';if(item.parts)delete item.parts.spinner;}
        config.views.splice(config.views.indexOf(boot)+1,0,connection);
      }
    }
    if(this.nativeLvgl && !config.views.some(v=>v.id==='updating')){
      const d=window.LGStartupDefault.updating,base=clone(config.views.find(v=>v.id==='startup').scene);
      Object.assign(base,{background:'solid',color:d.background,accent:d.accent,image_id:'',media_background_enabled:false,media_background_entity:'',scroll_height:100});
      base.elements=d.parts.map(spec=>{
        const name=spec.id,kind=name==='progress'?'animation':['title','percent'].includes(name)?'text':name;
        const item={...clone(base.elements[0]),id:'updating_'+name,kind,x:spec.x,y:spec.y,width:spec.width,height:spec.height,text:'',label:'',parts:{},opacity:0,radius:0,show_label:false,align:'center',font_size:d.font_size,color:d.color,style_override:true,entity_id:'',tap_action:{action:'none',entity_id:'',view:''},hold_action:{action:'none',entity_id:'',view:''}};
        if(name==='progress')Object.assign(item,{animation_type:'progress',animation_duration:spec.duration,progress_source:'boot',progress_value:60,progress_highlight:'white',color:d.accent});
        else if(kind==='text')Object.assign(item,{text:name==='title'?d.text:'60 %',text_line_height:1.22,update_role:name==='title'?'status':'percent'});
        return item;
      });
      config.views.push({id:'updating',name:'Firmwareaktualisierung',theme_override:true,scene:base});
    }
    if(this.nativeLvgl){const boot=config.views.find(v=>v.id==='startup');if(boot)boot.name='Bootscreen';}
    config.library_version=4;delete config.assignments;
    if(!Array.isArray(config.themes))config.themes=this.catalog.presets.filter(p=>['cinema','aurora','morning','sand','homekit'].includes(p.id)).map(p=>({id:p.id,name:p.name,style:themeStyle(p.layout.scenes.dashboard)}));
    for(const view of config.views){for(const item of view.scene.elements){const selected=config.themes.find(t=>t.id===item.element_theme);if(selected&&item.style_override===undefined)Object.assign(item,{style_override:true,card_style:selected.style.card_style,color:selected.style.ink,background:selected.style.surface,accent_color:selected.style.card_accent});if(item.style_override!==undefined)delete item.element_theme;}view.scene={...IMAGE_DEFAULTS,...TEXT_DEFAULTS,...view.scene};if(this.nativeLvgl)this.adaptEspView(view);}
    for(const theme of config.themes)theme.style={...IMAGE_DEFAULTS,...TEXT_DEFAULTS,...theme.style};
    config.active_theme=config.active_theme || '';
    const theme=config.themes.find(t=>t.id===config.active_theme);
    for(const view of config.views){for(const item of view.scene.elements){const selected=config.themes.find(t=>t.id===item.element_theme);if(selected&&item.style_override===undefined)Object.assign(item,{style_override:true,card_style:selected.style.card_style,color:selected.style.ink,background:selected.style.surface,accent_color:selected.style.card_accent});if(item.style_override!==undefined)delete item.element_theme;}view.theme_override=view.theme_override===true;if(theme&&!view.theme_override)applyThemeStyle(view.scene,theme.style,['startup','connecting','updating'].includes(view.id));for(const item of view.scene.elements)if(item.style_override===false)this.inheritElementStyle(item,themeStyle(view.scene));}
    const base=this.catalog.presets[0].layout.scenes;
    config.scenes={signal:clone(config.scenes.signal || base.signal),no_signal:clone(config.scenes.no_signal || base.no_signal)};
    for(const view of config.views)config.scenes[view.id]=clone(view.scene);
    return config;
  }
  compileViews() {if(this.themeEditing && this.theme)for(const key of THEME_VISUAL_FIELDS)this.theme.style[key]=clone(this.themeScene[key]);this.withViews(this.config);}
  ensureView() {if(this.themeEditing){if(!this.config.themes.some(t=>t.id===this.themeId))this.page='overview';else this.refreshThemePreview();}if(!this.config.views.some(v=>v.id===this.viewId))this.viewId=this.config.views.find(v=>this.supportsView(v.id))?.id;if(!this.viewId)this.page='overview';this.showPage();}
  usage(id) {if(id==='updating')return 'Feste Updateansicht · lokal auf dem ESP';if(id==='connecting')return 'Feste Verbindungsansicht · offlinefähig';if(id==='startup')return 'Feste Startansicht · offlinefähig';if(id==='hdmi_full')return 'Feste Ansicht · HDMI 1 / 2 / 3';return CONTEXTS[id] ? (SOURCE_CONTEXTS.includes(id)?'Feste Ansicht · Quelle':'Feste Mitteilungsansicht') : 'Eigene Ansicht · Quelle';}
  showPage() {const overview=this.page==='overview';this.shadowRoot.querySelector('.overview').hidden=!overview;this.shadowRoot.querySelector('.workspace').hidden=overview;this.shadowRoot.querySelector('.editor-navigation').hidden=overview;if(overview)this.renderer?.clear();else this.refreshScene();}
  async openView(id,snapshot=null) {const edit=snapshot || this.captureEdit();this.interactionPreview=false;await this.stopLive();this.widgetEditor?.close();if(!this.config.views.some(v=>v.id===id))return;this.editSession=edit;this.viewId=id;this.sceneKey=CONTEXTS[id]?id:'dashboard';this.selected=null;this.gridSlot=null;this.page='editor';this.showPage();this.updateStatus();this.scrollTop=0;}
  transitionSelect(label) {if(!this.hardwareHdmi)return '';return `<select class="display-transition" aria-label="${escapeHTML(label)}" title="HDMI zwischen den gespeicherten Positionen und Größen bewegen">${options({none:'Direkt',smooth:'Animiert'},this.transitionMode)}</select>`;}
  bindTransitions() {
    this.shadowRoot.querySelectorAll('.display-transition').forEach(select=>{
      select.value=this.transitionMode;
      select.onchange=event=>{this.transitionMode=event.target.value;this.bindTransitions();};
    });
  }
  renderOverview() {
    const root=this.shadowRoot, gallery=root.querySelector('.primary-gallery');if(!gallery)return;
    const card=view=>`<article class="view-card"><button class="view-preview" data-open-view="${escapeHTML(view.id)}" aria-label="${escapeHTML(view.name)} bearbeiten"><div class="view-thumbnail" data-preview="${escapeHTML(view.id)}"></div></button><div class="view-card-body"><h3>${escapeHTML(view.name)}</h3><p>${escapeHTML(this.usage(view.id))}${this.nativeLvgl?' · <code>'+escapeHTML(view.id)+'</code>':''}</p><div class="view-actions"><button class="small" data-open-view="${escapeHTML(view.id)}">Bearbeiten</button>${SOURCE_CONTEXTS.includes(view.id)||!CONTEXTS[view.id]?`<span class="display-control"><button class="small" data-display-view="${escapeHTML(view.id)}">Anzeigen</button>${this.transitionSelect("Übergang für "+view.name)}</span>`:''}<button class="small" data-copy-view="${escapeHTML(view.id)}" aria-label="${escapeHTML(view.name)} duplizieren">Duplizieren</button>${CONTEXTS[view.id]?`<button class="small" data-reset-view="${view.id}" aria-label="${view.name} Standard wiederherstellen">Standard wiederherstellen</button>`:`<button class="small delete" data-delete-view="${escapeHTML(view.id)}" aria-label="${escapeHTML(view.name)} löschen">Löschen</button>`}</div></div></article>`;
    gallery.innerHTML=this.config.views.filter(view=>this.supportsView(view.id)&&!CONTEXTS[view.id]).map(card).join('');
    root.querySelector('.notification-gallery').innerHTML=this.config.views.filter(view=>this.supportsView(view.id)&&NOTIFICATION_CONTEXTS.includes(view.id)).map(card).join('');
    root.querySelector('.system-gallery').innerHTML=SYSTEM_CONTEXTS.map(id=>this.config.views.find(v=>v.id===id)).filter(view=>view&&this.supportsView(view.id)).map(card).join('');
    root.querySelector('.system-views').hidden=!root.querySelector('.system-gallery').children.length;
    root.querySelectorAll('[data-open-view]').forEach(b=>b.onclick=()=>this.openView(b.dataset.openView));
    root.querySelectorAll('[data-copy-view]').forEach(b=>b.onclick=()=>this.duplicateView(b.dataset.copyView));
    root.querySelectorAll('[data-delete-view]').forEach(b=>b.onclick=()=>this.deleteView(b.dataset.deleteView));
    root.querySelectorAll('[data-reset-view]').forEach(b=>b.onclick=()=>this.resetView(b.dataset.resetView));
    this.bindTransitions();
    root.querySelectorAll('[data-display-view]').forEach(b=>{b.disabled=this.busy;b.onclick=()=>this.activateView(b.dataset.displayView);});
    const active=this.config.themes.find(t=>t.id===this.config.active_theme);
    root.querySelector('.theme-manager-status').textContent=active?'Standard: '+active.name+' · '+this.config.views.filter(v=>!v.theme_override).length+' Ansichten folgen dem Theme':'Wähle ein Standard-Theme. Bis dahin bleiben die vorhandenen Gestaltungen erhalten.';
    root.querySelector('.template-options').innerHTML=this.config.themes.map(t=>this.isBuiltinTheme(t.id)?`<button class="preset theme builtin-theme" data-use-theme="${t.id}" aria-label="${escapeHTML(t.name)} als Standard-Theme" aria-pressed="${t.id===this.config.active_theme}"><div class="mini" data-theme-preview="${t.id}" style="background:${window.LGLayoutBackground(t.style,{sun:this.sun(),imageUrl:id=>this.imageUrl(id)})}"></div><strong>${escapeHTML(t.name)}</strong>${t.id==='homekit'?'<span>Gerätekacheln · Glasflächen · Himmel & Gold</span>':''}</button>`:`<article class="theme-card"><div class="mini" data-theme-preview="${escapeHTML(t.id)}" style="background:${window.LGLayoutBackground(t.style,{sun:this.sun(),imageUrl:id=>this.imageUrl(id)})}"></div><div class="view-card-body"><h3>${escapeHTML(t.name)}</h3><p>${t.id===this.config.active_theme?'Aktives Standard-Theme':'Eigenes Theme'} · <code>${escapeHTML(t.id)}</code></p><div class="view-actions"><button class="small" data-edit-theme="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.name)} Theme bearbeiten">Bearbeiten</button><button class="small" data-use-theme="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.name)} als Standard-Theme">Als Standard</button><button class="small" data-copy-theme="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.name)} Theme duplizieren">Duplizieren</button><button class="small delete" data-delete-theme="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.name)} Theme löschen">Löschen</button></div></div></article>`).join('')+this.newThemeTile();
    const homeTheme=root.querySelector('[data-use-theme=homekit]');if(homeTheme){const button=document.createElement('button');button.className='secondary';button.dataset.homeTemplate='';button.textContent='Home-Kachelvorlage anlegen';button.onclick=()=>this.showCreator('homekit');const group=document.createElement('div');group.className='home-theme-option';group.style.cssText='display:flex;flex-direction:column;gap:8px';homeTheme.replaceWith(group);group.append(homeTheme,button);}
    for(const [key,method] of [['edit','openTheme'],['use','useTheme'],['copy','duplicateTheme'],['delete','deleteTheme']])root.querySelector('.template-options').querySelectorAll('[data-'+key+'-theme]').forEach(b=>b.onclick=()=>this[method](b.getAttribute('data-'+key+'-theme')));
    root.querySelector('.template-options [data-new-theme]').onclick=()=>this.createTheme();
    this.paintGallery();
  }
  paintThemePreviews(scope) {
    for(const node of this.shadowRoot.querySelectorAll(scope+'[data-theme-preview]')){const theme=this.config.themes.find(t=>t.id===node.dataset.themePreview);if(theme)window.LGLayoutPaintBackground(node,theme.style,{sun:this.sun(),imageUrl:id=>this.imageUrl(id)});}
  }
  paintGallery() {
    this.paintThemePreviews('.template-options ');
    if(!this.config || !this.shadowRoot.querySelector('.view-gallery'))return;
    const sun=this.sun();this.shadowRoot.querySelectorAll('[data-preview]').forEach(node=>{const view=this.config.views.find(v=>v.id===node.dataset.preview);if(!view)return;window.LGLayoutPaintBackground(node,view.scene,{sun,imageUrl:id=>this.imageUrl(id)});if(node.dataset.layout!==JSON.stringify(view.scene)){node.dataset.layout=JSON.stringify(view.scene);node.innerHTML=view.scene.elements.filter(item=>this.hardwareHdmi||item.kind!=='hdmi').map(item=>`<div class="mini-widget" style="left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%;border-radius:${Math.min(item.radius,12)}px;background:${item.kind==='hdmi'?'#07131c':item.background};color:${item.color};opacity:${Math.max(.4,item.opacity)}">${escapeHTML(elementName(item))}</div>`).join('');}});
  }
  showCreator(template=null) {
    if(this.config.views.filter(view=>!CONTEXTS[view.id]).length>=27){this.flash('Maximal 27 eigene Ansichten. Entferne zuerst eine Ansicht.',true);return;}
    const root=this.shadowRoot.querySelector('.view-creator');if(root.open)return;
    const previousFocus=this.shadowRoot.activeElement;
    const active=this.config.themes.find(t=>t.id===this.config.active_theme),inherited=clone(active?.style || themeStyle(this.view?.scene || (this.config.views.find(v=>v.id==='dashboard')?.scene || this.catalog.presets[0].layout.scenes.dashboard)));
    const fallback=this.catalog.presets.find(p=>p.id==='morning') || this.catalog.presets[0];
    const templateGrid=template=>{
      return template.layout||template.columns?spacedGrid(template,this.displayRatio):null;
    };
    let mode=template?'content':'grid',chosen='four';
    const readGrid=()=>{
      if(chosen==='free')return null;
      if(chosen!=='custom')return templateGrid(GRID_TEMPLATES.find(p=>p.id===chosen));
      const values=Object.fromEntries([...root.querySelectorAll('[data-grid-value]')].map(el=>[el.dataset.gridValue,el.value===''?NaN:Number(el.value)]));
      if(!Number.isInteger(values.columns)||!Number.isInteger(values.rows)||values.columns<1||values.columns>8||values.rows<1||values.rows>8||!Number.isFinite(values.gap)||!Number.isFinite(values.margin)||values.gap<0||values.gap>6||values.margin<0||values.margin>10)return undefined;
      return spacedGrid(values,this.displayRatio,values.gap,values.margin);
    };
    const preview=(grid,scene=null)=>{
      const base={...clone(fallback.layout.scenes.dashboard),elements:[]};applyThemeStyle(base,inherited);
      const boxes=scene?scene.elements.map(i=>({x:i.x,y:i.y/(scene.scroll_height||100)*100,width:i.width,height:i.height/(scene.scroll_height||100)*100})):gridCells(grid);
      return `<span class="grid-mini" aria-hidden="true" style="--grid-ratio:${this.displayRatio};background:${escapeHTML(window.LGLayoutBackground(base,{sun:this.sun(),imageUrl:id=>this.imageUrl(id)}))};--grid-ink:${escapeHTML(inherited.ink)}">${boxes.map(c=>`<span style="left:${c.x}%;top:${c.y}%;width:${c.width}%;height:${c.height}%"></span>`).join('')}${!boxes.length?'<span class="grid-empty">Freie Fläche</span>':''}</span>`;
    };
    root.innerHTML=`<div class="creator-header"><div><p class="eyebrow">ANSICHT ANLEGEN</p><h2 id="new-view-title">Wie möchtest du starten?</h2></div><button type="button" class="secondary" data-cancel-view aria-label="Neue Ansicht schließen">×</button></div><label class="field creator-name">Name<input id="new-view-name" maxlength="80" required value="Meine Ansicht"></label><div class="creator-tabs" role="group" aria-label="Vorlagenart"><button type="button" data-creator-mode="grid">Rastervorlagen</button><button type="button" data-creator-mode="content">Vorhandene Inhalte</button></div><div data-creator-panel="grid"><div class="grid-template-list">${GRID_TEMPLATES.map(p=>`<button type="button" class="grid-template" data-grid-template="${p.id}" aria-pressed="false">${preview(templateGrid(p))}<strong>${p.name}</strong><small>${p.columns?`${p.columns} × ${p.rows}`:templateGrid(p)?`${gridCells(templateGrid(p)).length} Felder`:'Ohne Raster'}</small></button>`).join('')}</div><section class="custom-grid" hidden><div class="custom-grid-fields">${[['columns','Spalten',1,8,3,1],['rows','Zeilen',1,8,2,1],['gap','Abstand (%)',0,6,2,.5],['margin','Außenabstand (%)',0,10,2,.5]].map(([key,label,min,max,value,step])=>`<label>${['gap','margin'].includes(key)?helpLabel(label,'Prozent der kürzeren Displayseite. So sind die Abstände horizontal und vertikal gleich groß.'):label}<input type="number" data-grid-value="${key}" min="${min}" max="${max}" step="${step}" value="${value}" required></label>`).join('')}</div><div data-custom-preview aria-label="Vorschau eigenes Raster"></div></section></div><div data-creator-panel="content" hidden><div class="creator-fields"><label>Vorlage<select id="new-view-template" aria-label="Vorlage">${options(Object.fromEntries(this.catalog.presets.map(p=>[p.id,p.name])),template || fallback.id)}</select></label><label>Aufbau<select id="new-view-context" aria-label="Aufbau">${options(this.contexts,'dashboard')}</select></label></div><div data-content-preview></div></div><p class="creator-theme">Theme: <strong>${escapeHTML(active?.name || 'Aktuelle Gestaltung')}</strong> · Später über „Eigenes Styling“ anpassbar.</p><p class="creator-error" role="alert"></p><div class="creator-footer"><button type="button" class="secondary" data-cancel-view>Abbrechen</button><button type="button" class="primary" data-create-view>Ansicht anlegen</button></div>`;
    const close=()=>{root.close();this.PickerControls.unlockPopup(root);previousFocus?.focus({preventScroll:true});};
    const refresh=()=>{
      root.querySelectorAll('[data-creator-mode]').forEach(button=>button.setAttribute('aria-pressed',String(mode===button.dataset.creatorMode)));
      root.querySelectorAll('[data-creator-panel]').forEach(panel=>panel.hidden=mode!==panel.dataset.creatorPanel);
      root.querySelectorAll('[data-grid-template]').forEach(button=>button.setAttribute('aria-pressed',String(chosen===button.dataset.gridTemplate)));
      root.querySelector('.custom-grid').hidden=chosen!=='custom';
      const grid=readGrid(),valid=mode==='content'||grid!==undefined;
      root.querySelector('[data-create-view]').disabled=!valid||!root.querySelector('#new-view-name').value.trim();
      root.querySelector('.creator-error').textContent=valid?'':'Bitte 1–8 Spalten und Zeilen sowie gültige Abstände wählen.';
      if(grid!==undefined&&chosen==='custom'){
        root.querySelector('[data-custom-preview]').innerHTML=preview(grid);
        const card=root.querySelector('[data-grid-template="custom"]');card.querySelector('.grid-mini').outerHTML=preview(grid);card.querySelector('small').textContent=root.querySelector('[data-grid-value="columns"]').value+' × '+root.querySelector('[data-grid-value="rows"]').value;
      }
      const preset=this.catalog.presets.find(p=>p.id===root.querySelector('#new-view-template').value),context=root.querySelector('#new-view-context').value;
      root.querySelector('[data-content-preview]').innerHTML=preview(null,preset.layout.scenes[context==='connecting'?'startup':context] || preset.layout.scenes.dashboard);
    };
    root.querySelectorAll('[data-cancel-view]').forEach(button=>button.onclick=close);
    root.oncancel=e=>{e.preventDefault();close();};
    root.onclick=e=>{if(e.target===root){const r=root.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}};
    root.querySelectorAll('[data-creator-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.creatorMode;refresh();});
    root.querySelectorAll('[data-grid-template]').forEach(button=>button.onclick=()=>{chosen=button.dataset.gridTemplate;refresh();});
    root.querySelectorAll('[data-grid-value],#new-view-name').forEach(input=>input.oninput=refresh);
    root.querySelectorAll('#new-view-template,#new-view-context').forEach(select=>select.onchange=refresh);
    root.querySelector('[data-create-view]').onclick=()=>{
      const name=root.querySelector('#new-view-name').value.trim(),grid=readGrid();if(!name||(mode==='grid'&&grid===undefined))return;
      const preset=this.catalog.presets.find(p=>p.id===root.querySelector('#new-view-template').value),key=mode==='content'?root.querySelector('#new-view-context').value:'dashboard';
      const scene=clone((mode==='content'?preset:fallback).layout.scenes[key==='connecting'?'startup':key] || fallback.layout.scenes.dashboard);
      if(mode==='grid'){scene.elements=[];scene.scroll_height=100;scene.media_background_enabled=false;scene.media_background_entity='';}
      applyThemeStyle(scene,inherited);for(const item of scene.elements){item.style_override=false;this.inheritElementStyle(item,inherited);}
      const snapshot=this.captureEdit();this.checkpoint();
      const id='view_'+Date.now().toString(36)+Math.random().toString(36).slice(2,12),view={id,name,theme_override:false,scene};
      if(mode==='grid'&&grid)view.grid=clone(grid);
      this.config.views.push(view);this.gridSlot=null;close();this.changed();void this.openView(id,snapshot);this.sceneKey=key;
      this.flash('Ansicht angelegt. Elemente werden in freie Rasterfelder eingefügt und bleiben frei verschiebbar.');
    };
    root.querySelector('#new-view-name').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();root.querySelector('[data-create-view]').click();}};
    bindHelp(root);refresh();this.PickerControls.lockPopup(root);root.showModal();root.querySelector('#new-view-name').focus();root.querySelector('#new-view-name').select();
  }
  duplicateView(id) {if(this.config.views.filter(view=>!CONTEXTS[view.id]).length>=27){this.flash('Maximal 27 eigene Ansichten.',true);return;}const view=this.config.views.find(v=>v.id===id);if(!view)return;this.checkpoint();const copy=clone(view);copy.id='view_'+(Date.now().toString(36)+Math.random().toString(36).slice(2,12));copy.name=(copy.name.slice(0,70)+' · Kopie');this.config.views.push(copy);this.changed();this.flash('Unabhängige Kopie angelegt. Speichern übernimmt sie dauerhaft.');}
  deleteView(id) {
    if(this.busy || CONTEXTS[id] || !this.config.views.some(v=>v.id===id))return;
    this.checkpoint();this.config.views=this.config.views.filter(v=>v.id!==id);if(this.config.power?.screensaver_view===id)this.config.power.screensaver_view=this.config.views.find(v=>this.supportsView(v.id)&&!CONTEXTS[v.id])?.id || 'startup';this.ensureView();this.changed();
    this.flash('Eigene Ansicht entfernt. Speichern entfernt auch ihre Quelle. Eine aktive Ansicht wechselt zu einer verbleibenden Ansicht. Rückgängig ist möglich.');
  }
  resetView(id) {
    if(this.busy || !CONTEXTS[id])return;
    const view=this.config.views.find(v=>v.id===id);if(!view)return;
    this.checkpoint();view.theme_override=false;if(id==='updating'){this.config.views=this.config.views.filter(v=>v.id!=='updating');this.withViews(this.config);this.selected=null;this.changed(true);return;}view.scene=clone(this.catalog.presets[0].layout.scenes[id==='connecting'?'startup':id]);if(this.nativeLvgl)this.adaptEspView(view);this.selected=null;this.changed(true);
    this.flash(CONTEXTS[id]+' auf den Standard zurückgesetzt. Speichern übernimmt die Änderung; Rückgängig stellt deinen Entwurf wieder her.');
  }
  async activateView(id) {
    if(this.busy)return;if(this.dirty){this.flash('Speichere zuerst deine Ansichten.',true);return;}
    if(!this.config.views.some(v=>v.id===id))return;
    if(!this.config.enabled){this.checkpoint();this.config.enabled=true;this.changed();await this.save();if(this.dirty)return;}
    await this.selectSource(id);
  }
  async selectSource(id) {
    // Always select the saved stable ID; open drafts never change source routing.
    if(this.busy || this._sourceBusy || (CONTEXTS[id]&&!SOURCE_CONTEXTS.includes(id)))return;
    if(!this.saved.views.some(v=>v.id===id)){this.flash('Speichere die neue Ansicht zuerst.',true);return;}
    const transition=this.hardwareHdmi?this.transitionMode:'none';
    this._sourceBusy=true;
    try {
      await this.hass.callService('display_studio','show_view',{config_entry_id:this.entryId,view:id,transition});
      this.flash('Gespeicherte Ansicht angezeigt.'+(this.dirty?' Deine Änderungen bleiben im Entwurf.':''));
    }catch(_){this.flash('Quelle nicht erreichbar. Prüfe App-Verbindung, SI-Dauerbetrieb und Stromversorgung.',true);}finally{this._sourceBusy=false;}
  }
  flash(message,error=false) {for(const selector of ['.flash','.gallery-flash','.widget-feedback']){const node=this.shadowRoot.querySelector(selector);if(node){node.textContent=message;node.classList.toggle('error',error);}}}
}
if(!customElements.get('display-studio'))customElements.define('display-studio',DisplayStudio);

/* Browser-only editor; the LG receives just validated part overrides. */
class LGWidgetEditor {
  constructor(host,id) {
    this.host=host;this.id=id;this.viewId=host.viewId;this.partId=null;this.dragging=false;this.snapshot=host.captureEdit();
    this.root=document.createElement('section');this.root.className='widget-dialog';this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.setAttribute('aria-label','Widget bearbeiten');
    this.root.innerHTML=`<header class="widget-dialog-header"><div><div class="help-heading"><h2></h2>${helpControl('Widget bearbeiten','Einzelne Inhalte gestalten · Live zeigt Änderungen auch auf dem Display. Fertig speichert die Änderungen, Abbrechen verwirft sie.')}</div><p class="widget-feedback" role="status"></p></div><button class="secondary" data-undo title="Widget-Änderung rückgängig">↶</button><button class="secondary" data-redo title="Widget-Änderung wiederholen">↷</button><button class="secondary" data-reset>Inhalt-Layout zurücksetzen</button><button class="secondary" data-cancel>Abbrechen</button><button class="primary" data-close>Fertig</button></header><div class="widget-dialog-body"><main class="widget-workbench"><p class="widget-context"></p><div class="widget-frame"><div class="widget-preview"><div class="lg-hdmi-placeholder"></div></div><div class="widget-part-selection"></div></div><div class="widget-binding"></div></main><aside class="widget-inspector"><div class="widget-base-fields"></div><label>${helpLabel('Inhaltselement',`Ein Element wählen und ziehen; die Ecke skaliert bei Text auch die Schrift. Schriftgröße und Textrahmen ändern sich gemeinsam. Hilfslinien richten an der Gruppe und anderen Inhalten aus. Alt/⌥: ohne Einrasten. Entfernte Inhalte bleiben wiederherstellbar.`)}<select aria-label="Inhaltselement" data-part></select></label><div class="widget-part-fields"></div></aside></div>`;
    host.shadowRoot.append(this.root);this.previousFocus=host.shadowRoot.activeElement;host.PickerControls.lockPopup(this.root);
    this.root.querySelector('[data-close]').onclick=()=>this.finish();
    this.root.querySelector('[data-cancel]').onclick=()=>this.cancel();
    this.root.querySelector('[data-reset]').onclick=()=>this.reset();
    for(const action of ['undo','redo'])this.root.querySelector('[data-'+action+']').onclick=()=>{host.action(action);if(this.fullscreen)this.fullscreenItem=window.LGCamera.fullscreenItem(this.sourceItem);this.refresh();};
    this.root.querySelector('[data-part]').onchange=e=>{this.partId=e.target.value;this.refresh();};
    this.root.onkeydown=e=>{
      if(e.key==='Escape'){const help=this.root.querySelector('.help-overlay:popover-open');e.preventDefault();e.stopPropagation();if(help)help.hidePopover();else void this.cancel();}
      if(e.key==='Tab'){const items=[...this.root.querySelectorAll('button,input,select,textarea,.ha-native-control')].filter(n=>!n.disabled&&n.offsetParent!==null),first=items[0],last=items[items.length-1],active=host.shadowRoot.activeElement;if(e.shiftKey&&active===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}}
    };
    this.renderer=new window.LGLayoutRenderer(this.root.querySelector('.widget-preview'),this.root.querySelector('.lg-hdmi-placeholder'),true);
    this.root.querySelector('.widget-preview').onclick=e=>{const part=[...this.entries].reverse().find(p=>this.element(p)?.contains(e.target));if(part){this.partId=part.id;this.refresh();}};
    this.resize=new ResizeObserver(()=>{if(!this.dragging)this.paint();});this.resize.observe(this.root.querySelector('.widget-workbench'));
    this.refresh();this.root.querySelector('[data-close]').focus();
  }
  get sourceItem(){return this.host.viewId===this.viewId?this.host.scene.elements.find(i=>i.id===this.id):null;}
  get item(){return this.sourceItem?(this.fullscreen?this.fullscreenItem:this.sourceItem):null;}
  commitFullscreen(){if(this.fullscreen&&this.sourceItem){const i=this.fullscreenItem;this.sourceItem.camera_fullscreen={parts:clone({label:i.parts.label,picture:i.parts.picture}),camera_fit:i.camera_fit,camera_zoom:i.camera_zoom,camera_pan_x:i.camera_pan_x,camera_pan_y:i.camera_pan_y};}}
  cameraEditorMode(){
    let select=this.root.querySelector('[data-camera-editor-mode]');
    if(this.sourceItem?.kind!=='camera'){select?.parentElement.remove();return;}
    if(!select){const label=document.createElement('label');label.className='field';label.innerHTML='Ansicht bearbeiten<select aria-label="Kameraansicht bearbeiten" data-camera-editor-mode><option value="tile">Kachel</option><option value="fullscreen">Vollbild</option></select>';this.root.querySelector('.widget-workbench').prepend(label);select=label.querySelector('select');select.onchange=()=>{this.commitFullscreen();this.fullscreen=select.value==='fullscreen';this.fullscreenItem=this.fullscreen?window.LGCamera.fullscreenItem(this.sourceItem):null;this.partId='picture';this.renderer.clear();this.refresh();};}
    select.value=this.fullscreen?'fullscreen':'tile';
  }
  get entries(){return window.LGWidgetParts.catalog(this.item).filter(part=>(!part.control||this.item.media_controls)&&(!this.fullscreen||['label','picture'].includes(part.id))&&(this.item.kind!=='clock'||part.id!=='label'));}
  get part(){return this.entries.find(p=>p.id===this.partId);}
  get config(){return this.item.parts?.[this.partId] || {};}
  enabled(part){if(part.control)return this.item.media_controls===true&&!(this.item.media_controls_hidden || []).includes(part.control)&&this.item.parts?.[part.id]?.visible!==false;const flag={label:'show_label',cover:'show_cover',progress:'show_progress',playback:'show_playback_icon',volume:'show_volume'}[part.id];return this.item.parts?.[part.id]?.visible!==false&&(!flag||(flag==='show_playback_icon'?this.item[flag]===true:this.item[flag]!==false));}
  get node(){return this.renderer.nodes[this.id];}
  element(part=this.part){return this.node&&part?window.LGWidgetParts.find(this.node,part):null;}
  parent(part=this.part){if(part?.control)return this.node?._frame || this.node;return part?.parent?this.element(this.entries.find(p=>p.id===part.parent)):this.node;}
  label(part){const parent=this.entries.find(p=>p.id===part.parent);return (parent?parent.name+' / ':'')+part.name;}
  async finish(){this.commitFullscreen();if(this.host.designWorkspace){await this.host.finishEditing();return;}if(await this.host.save())this.close();}
  async cancel(){this.fullscreen=false;if(this.host.templateSession){await this.host.cancelEditing();return;}if(await this.host.restoreEdit(this.snapshot)){this.close();if(this.host.designWorkspace){this.host.dirty=false;await this.host.showDesigns(this.host.designWorkspace.type);return;}this.host.flash('Widget-Änderungen verworfen.');}}
  close(){this.resize?.disconnect();this.renderer?.clear();this.host.PickerControls.unlockPopup(this.root);this.root.remove();if(this.host.widgetEditor===this)this.host.widgetEditor=null;this.host.updateStatus();this.previousFocus?.focus({preventScroll:true});queueMicrotask(()=>{if(this.host.isConnected && this.host.page!=="overview")this.host.paint();});}
  changed(){this.commitFullscreen();if(!this.fullscreen)this.host.fitCamera(this.item);this.host.changed();this.host.renderProperties();this.refresh();}
  clockPart(part=this.part){return this.item?.kind==='clock'&&['time','date'].includes(part?.id);}
  anchor(box){return {anchor_x:Math.max(0,Math.min(100,box.x/Math.max(.001,100-box.width)*100)),anchor_y:Math.max(0,Math.min(100,box.y/Math.max(.001,100-box.height)*100))};}
  resizeClock(conf,ink,font,key,value){
    if(key==='font_size'){delete conf.frame_width;delete conf.frame_height;conf.font_size=Math.max(1,Math.min(100,value));return;}
    const ratio=Math.max(.01,value/Math.max(.01,ink[key]));
    conf['frame_'+key]=value;
    if(this.item.lock_ratio!==false){const other=key==='width'?'height':'width';conf['frame_'+other]=Math.max(1,Math.min(100,ink[other]*value/ink[key]));conf.font_size=Math.max(1,Math.min(100,font*ratio));}
  }
  update(key,value){
    const item=this.item;if(!item)return;this.host.checkpoint();item.parts ||= {};
    const box=this.box(),ink=this.inkBox(),font=this.fontSize();
    if(['x','y','width','height','font_size'].includes(key))this.arrange(this.part.parent);
    const conf=item.parts[this.partId] ||= {};
    if(this.part.control && key==='visible'){
      const hidden=new Set(item.media_controls_hidden || []);if(value)hidden.delete(this.part.control);else hidden.add(this.part.control);item.media_controls_hidden=[...hidden];
    }
    if(this.clockPart()&&['x','y','width','height','font_size'].includes(key)){
      if(key==='x'||key==='y')Object.assign(conf,this.anchor({...ink,[key]:Math.max(0,value)}));
      else this.resizeClock(conf,ink,font,key,value);
      this.changed();return;
    }
    if(value===null)delete conf[key];else conf[key]=this.part.text&&['x','y'].includes(key)?box[key]+value-ink[key]:value;
    if(['color','font','font_weight','align','opacity'].includes(key))item.style_override=true;
    if(['x','y','width','height'].includes(key)){
      conf.x=Math.max(0,Math.min(conf.x,100-conf.width));conf.y=Math.max(0,Math.min(conf.y,100-conf.height));
      if(key==='width')conf.width=Math.min(value,100-conf.x);if(key==='height')conf.height=Math.min(value,100-conf.y);
    }
    if(this.part.text && (key==='font_size'||this.item.lock_ratio!==false&&['width','height'].includes(key))){
      const ratio=key==='font_size'?value/font:value/ink[key];
      Object.assign(conf,scaleTextBox(box,font,ratio,this.item.kind==='text'?10000:100,ink));
    }
    if(key==='visible'&&value){const flag={label:'show_label',cover:'show_cover',progress:'show_progress',playback:'show_playback_icon',volume:'show_volume'}[this.partId];if(flag)item[flag]=true;}
    if(this.item.kind==='clock'&&['visible','font','font_weight'].includes(key))this.host.fitClockHeight(this.item);
    this.changed();
  }
  fontSize(){const el=this.element(),parent=this.parent();return this.config.font_size ?? (parseFloat(el?getComputedStyle(el).fontSize:'16')/(parent?.getBoundingClientRect().height || 200)*100);}
  inkRect(part=this.part){const el=this.element(part);if(el?._clockFrame){const p=this.parent(part).getBoundingClientRect(),f=el._clockFrame;return {left:p.left+f.x,top:p.top+f.y,width:f.width,height:f.height};}return part?.text?textInkRect(el):el?.getBoundingClientRect();}
  inkBox(part=this.part){
    const rect=this.inkRect(part),parent=this.parent(part)?.getBoundingClientRect();
    if(!rect?.width||!rect.height||!parent?.width||!parent.height)return this.box(part);
    return {x:(rect.left-parent.left)/parent.width*100,y:(rect.top-parent.top)/parent.height*100,width:rect.width/parent.width*100,height:rect.height/parent.height*100};
  }
  box(part=this.part){
    const conf=this.item.parts?.[part.id];if(!part.control&&conf?.x!==undefined)return {x:conf.x,y:conf.y,width:conf.width,height:conf.height};
    if(part.control){const control=window.LGMediaWidgetLayout(this.item).controls.find(c=>c.key===part.control)||window.LGMediaWidgetSpec.controls.find(c=>c.key===part.control);return {x:control.x,y:control.y,width:control.width,height:control.height};}
    const el=this.element(part),parent=this.parent(part);let bounds=parent?.getBoundingClientRect();const rect=el?.getBoundingClientRect();
    if(bounds&&this.item.kind==='weather'){
      // Absolute percentages use the parent's padding box, excluding its border.
      const css=getComputedStyle(parent),left=parseFloat(css.borderLeftWidth)||0,top=parseFloat(css.borderTopWidth)||0;
      bounds={left:bounds.left+left,top:bounds.top+top,width:bounds.width-left-(parseFloat(css.borderRightWidth)||0),height:bounds.height-top-(parseFloat(css.borderBottomWidth)||0)};
    }
    if(!bounds?.width||!bounds.height||!rect?.width||!rect.height)return {x:5,y:5,width:90,height:20};
    const x=Math.max(0,Math.min(99,(rect.left-bounds.left)/bounds.width*100)),y=Math.max(0,Math.min(99,(rect.top-bounds.top)/bounds.height*100));
    return {x,y,width:Math.max(1,Math.min(100-x,rect.width/bounds.width*100)),height:Math.max(1,Math.min(100-y,rect.height/bounds.height*100))};
  }
  arrange(parentId){
    if(this.part?.control){const conf=this.item.parts[this.partId] ||= {};if(conf.x===undefined)Object.assign(conf,this.box());return;}
    // Weather forecasts contain nested flex groups. Capture their children in
    // the same pass, before positioning a group removes its flow/padding.
    const siblings=this.entries.filter(p=>!p.control&&(this.item.kind==='weather'||p.parent===parentId)),boxes=siblings.map(p=>[p,this.box(p),this.clockPart(p)?this.inkBox(p):null,this.element(p)?parseFloat(getComputedStyle(this.element(p)).fontSize)/this.parent(p).getBoundingClientRect().height*100:null]);
    // Freeze siblings before removing any from normal flow, avoiding layout jumps.
    for(const [part,box,ink,font] of boxes){const el=this.element(part),rect=el?.getBoundingClientRect();if((rect?.width&&(this.item.kind!=='weather'||rect.height)) || part.id===this.partId){const conf=this.item.parts[part.id] ||= {};if(ink){if(conf.anchor_x===undefined)Object.assign(conf,this.anchor(ink),{x:0,y:0,width:100,height:100,font_size:conf.font_size??font});}else if(conf.x===undefined)Object.assign(conf,box);}}
  }
  reset(){
    if(this.fullscreen){this.host.checkpoint();delete this.sourceItem.camera_fullscreen;this.fullscreenItem=window.LGCamera.fullscreenItem(this.sourceItem);this.partId='picture';this.changed();return;}
    const grid=this.host.currentSize(this.item)==='grid'?{x:this.item.x,y:this.item.y,cell:this.host.gridSize(this.item)}:null;
    this.host.checkpoint();delete this.item.parts;delete this.item.clock_time_format;delete this.item.clock_date_format;delete this.item.clock_seconds;delete this.item.clock_blink;delete this.item.clock_gap;delete this.item.content_padding;
    Object.assign(this.item,{show_label:true,show_cover:true,show_progress:true,show_volume:true,show_playback_icon:false});
    if(this.item.kind==='media')this.item.media_controls_hidden=[];
    if(this.item.kind==='clock'&&this.host.catalog.widget_defaults?.clock){Object.assign(this.item,clone(this.host.catalog.widget_defaults.clock));}
    [this.item.width,this.item.height]=this.host.defaultSize(this.item);this.item.x=Math.min(this.item.x,100-this.item.width);this.item.y=Math.min(this.item.y,(this.host.scene.scroll_height||100)-this.item.height);this.item.lock_ratio=true;delete this.item.manual_size;delete this.item.clock_size;delete this.item.clock_base_height;
    if(grid){this.host.applyGridSize(this.item,grid.cell);Object.assign(this.item,{x:grid.x,y:grid.y});}else delete this.item.grid_size;
    this.partId=null;this.changed();
  }
  refresh(){
    if(!this.item){this.close();return;}
    this.cameraEditorMode();
    this.root.querySelector('h2').textContent=elementName(this.item)+' · Widget bearbeiten';
    const entries=this.entries;
    if(!entries.some(p=>p.id===this.partId))this.partId=entries.find(p=>p.id!=='label'&&this.enabled(p))?.id || entries.find(p=>p.id!=='label')?.id || entries[0]?.id || null;
    this.root.querySelector('[data-part]').innerHTML=entries.map(p=>`<option value="${p.id}" ${p.id===this.partId?'selected':''}>${escapeHTML(this.label(p))}${!this.enabled(p)?' · ausgeblendet':''}</option>`).join('');
    this.root.querySelector('[data-part]').disabled=!entries.length;
    this.root.querySelector('[data-undo]').disabled=!this.host.history.length;this.root.querySelector('[data-redo]').disabled=!this.host.future.length;
    this.paint();this.fields();this.binding();this.baseFields();bindHelp(this.root);
  }
  paint(){
    if(!this.item||!this.renderer)return;
    this.commitFullscreen();
    const frame=this.root.querySelector('.widget-frame'),area=this.root.querySelector('.widget-workbench'),ratio=this.item.width/this.item.height*this.host.displayRatio;
    const width=Math.min(Math.max(120,area.clientWidth-40),Math.max(130,this.root.clientHeight-240)*ratio);
    frame.style.width=width+'px';frame.style.height=width/ratio+'px';
    const scene=clone(this.host.scene),item=clone(this.item);Object.assign(item,{x:0,y:0,width:100,height:100});if(item.clock_base_height!==undefined)item.clock_base_height*=100/this.item.height;scene.elements=[item];scene.scroll_height=100;scene.media_background_enabled=false;
    const values=this.host.values();
    if(item.kind==='media'&&item.media_controls){
      // The design editor must expose every control for placement, even without
      // an attached player. Runtime capability filtering remains unchanged.
      const entity=item.entity_id||'preview.media_design',data=values[entity]||{};
      item.entity_id=entity;item.media_remote_view||='preview_remote';
      values[entity]={...data,state:['off','standby','unknown','unavailable'].includes(data.state)||!data.state?'paused':data.state,av_remote_state:'on',player_available_actions:window.LGMediaWidgetSpec.controls.map(c=>'player_'+c.key),av_available_actions:window.LGMediaWidgetSpec.controls.map(c=>'av_'+c.key)};
    }
    this.renderer.render(scene,values,{...this.host.cameraPreviewOptions(),contentScale:100/this.item.height,timezone:this.host.timezone,sun:this.host.sun(),mediaUrl:(...args)=>this.host.mediaUrl(...args),imageUrl:id=>this.host.imageUrl(id),now:new Date(),message:{title:'Home Assistant',message:this.host.shadowRoot.querySelector('#test-message')?.value || 'Deine Mitteilung'}});
    for(const part of this.entries)if(part.control)this.element(part)?.querySelectorAll('input,select').forEach(el=>el.style.pointerEvents='none');
    let close=frame.querySelector('.camera-close-preview');
    if(this.fullscreen&&!close){close=document.createElement('span');close.className='camera-close-preview';close.textContent='×';close.style.cssText='position:absolute;top:1.33%;left:1%;width:4%;aspect-ratio:1;border-radius:50%;background:#444;color:white;display:grid;place-items:center;z-index:200;pointer-events:none';frame.append(close);}else if(!this.fullscreen)close?.remove();
    if(!this.dragging){this.selection();this.syncInkFields();}
  }
  tick(now){
    this.renderer?.tick(now);
    // Keep time/date handles live without replacing a focused input or drag target.
    if(!this.dragging){const target=this.root.querySelector('.part-outline');if(target)this.positionOutline(target);this.syncInkFields();}
  }
  syncInkFields(){
    if(!this.part?.text)return;const box=this.inkBox();
    for(const key of ['x','y','width','height']){const input=this.root.querySelector('[data-field="'+key+'"]');if(input&&input!==this.host.shadowRoot.activeElement&&input._nativeControl!==this.host.shadowRoot.activeElement)input.value=displayNumber(box[key]);}
  }
  positionOutline(target){const rect=this.inkRect(),frame=this.root.querySelector('.widget-frame').getBoundingClientRect();if(rect)Object.assign(target.style,{left:rect.left-frame.left+'px',top:rect.top-frame.top+'px',width:rect.width+'px',height:rect.height+'px'});}

  selection(){
    const layer=this.root.querySelector('.widget-part-selection');layer.innerHTML='';
    const part=this.part;if(!part)return;
    const el=this.element(),parent=this.parent(),frame=this.root.querySelector('.widget-frame').getBoundingClientRect();
    const rect=this.inkRect();const visible=rect?.width&&rect.height&&getComputedStyle(el).display!=='none';
    this.root.querySelector('.widget-context').textContent=this.label(part)+' · '+(part.parent?'Relativ zu '+this.entries.find(p=>p.id===part.parent).name:'Relativ zum Widget')+(visible?'':' · derzeit ohne sichtbaren Inhalt');
    if(!visible||!parent||this.config.visible===false)return;
    const manual=!!this.part?.control||this.host.currentSize(this.item)==='custom';
    const target=document.createElement('div');target.className='part-outline';target.dataset.movable=String(manual);target.tabIndex=0;target.setAttribute('role','button');target.setAttribute('aria-label',part.name+' im Widget'+(manual?' verschieben':''));
    Object.assign(target.style,{left:rect.left-frame.left+'px',top:rect.top-frame.top+'px',width:rect.width+'px',height:rect.height+'px'});
    target.innerHTML=`<span class="part-tag">${escapeHTML(part.name)}</span>${manual?'<span class="part-resize" title="Inhaltsgröße ändern"></span>':''}`;
    target.onpointerdown=e=>{if(manual)this.pointer(e,target);};target.onkeydown=e=>{
      if(!manual)return;
      if(['Delete','Backspace'].includes(e.key)){e.preventDefault();this.update('visible',false);return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const box=this.inkBox(),step=e.shiftKey?.1:1;
      const key=['ArrowLeft','ArrowRight'].includes(e.key)?'x':'y',change=['ArrowLeft','ArrowUp'].includes(e.key)?-step:step;this.update(key,Math.max(0,Math.min(100-box[key==='x'?'width':'height'],box[key]+change)));
    };
    if(part.id==='picture' && this.item.camera_source==='local' && this.host.cropEditing===this.item.id) {
      target.querySelector('.part-resize')?.remove();
      this.host.bindCameraCrop(target,this.item,el,{checkpoint:()=>this.host.checkpoint(),paint:()=>{this.dragging=true;this.paint();this.host.queueLive();},commit:()=>{this.dragging=true;this.host.changed(false,true);this.host.renderProperties();this.fields();this.dragging=false;}});
    }
    layer.append(target);
  }
  pointer(event,target){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    const resizing=event.target.classList.contains('part-resize'),startX=event.clientX,startY=event.clientY,parent=this.parent(),rect=parent.getBoundingClientRect();
    if(!rect.width||!rect.height)return;this.host.checkpoint();this.item.parts ||= {};this.arrange(this.part.parent);const original=clone(this.config),ink=this.inkBox(),font=this.fontSize();
    const visible={x:ink.x*rect.width/100,y:ink.y*rect.height/100,width:ink.width*rect.width/100,height:ink.height*rect.height/100};
    const area={x:0,y:0,width:rect.width,height:rect.height},layer=this.root.querySelector('.widget-part-selection'),layerRect=layer.getBoundingClientRect();
    const peers=this.entries.filter(p=>p.id!==this.partId&&p.parent===this.part.parent&&this.enabled(p)).map(p=>this.inkRect(p)).filter(r=>r?.width&&r.height).map(r=>relativeRect(r,rect));
    const limits=this.clockPart()?{x:[0,Math.max(0,rect.width-visible.width)],y:[0,Math.max(0,rect.height-visible.height)]}:{x:[visible.x-original.x*rect.width/100,visible.x+(100-original.width-original.x)*rect.width/100],y:[visible.y-original.y*rect.height/100,visible.y+(100-original.height-original.y)*rect.height/100]};
    const guides=new AlignmentGuides(layer,{x:rect.left-layerRect.left,y:rect.top-layerRect.top});
    const locked=this.item.lock_ratio!==false,clock=this.clockPart();
    const resizeBox=!locked&&this.part.text&&!clock?{x:original.x*rect.width/100,y:original.y*rect.height/100,width:original.width*rect.width/100,height:original.height*rect.height/100}:visible;
    const resizeLimits={width:[rect.width/100,rect.width-resizeBox.x],height:[rect.height/100,rect.height-resizeBox.y]};
    if(locked&&this.part.text&&!clock){
      const min=1/font,max=Math.min((this.item.kind==='text'?10000:100)/font,(100-original.x)/original.width,(100-original.y)/original.height,(100-ink.x)/ink.width,(100-ink.y)/ink.height);
      resizeLimits.width=[resizeBox.width*min,resizeBox.width*max];resizeLimits.height=[resizeBox.height*min,resizeBox.height*max];
    }
    this.dragging=true;target.setPointerCapture(event.pointerId);
    target.onpointermove=e=>{
      const current=parent.getBoundingClientRect();let dx=(e.clientX-startX+rect.left-current.left)/rect.width*100,dy=(e.clientY-startY+rect.top-current.top)/rect.height*100;const conf=this.config;
      if(!resizing){const aligned=alignMove({...visible,x:visible.x+dx*rect.width/100,y:visible.y+dy*rect.height/100},area,peers,limits,e.altKey);dx=(aligned.box.x-visible.x)/rect.width*100;dy=(aligned.box.y-visible.y)/rect.height*100;guides.show(aligned.lines);}
      if(resizing){
        const aligned=alignResize(resizeBox,resizeBox.width+dx*rect.width/100,resizeBox.height+dy*rect.height/100,area,peers,resizeLimits,locked,e.altKey),ratio=aligned.box.width/resizeBox.width;
        if(clock){
          conf.frame_width=aligned.box.width/rect.width*100;conf.frame_height=aligned.box.height/rect.height*100;
          if(locked)conf.font_size=Math.max(1,Math.min(100,font*ratio));
          Object.assign(conf,this.anchor({...ink,width:conf.frame_width,height:conf.frame_height}));
        }else if(locked&&this.part.text)Object.assign(conf,scaleTextBox(original,font,ratio,this.item.kind==='text'?10000:100,ink));
        else{conf.width=aligned.box.width/rect.width*100;conf.height=aligned.box.height/rect.height*100;}
      }else if(clock)Object.assign(conf,this.anchor({...ink,x:ink.x+dx,y:ink.y+dy}));
      else{conf.x=Math.max(0,Math.min(100-original.width,original.x+dx));conf.y=Math.max(0,Math.min(100-original.height,original.y+dy));}
      this.paint();this.host.queueLive();this.positionOutline(target);
      if(resizing){const actual=!locked&&this.part.text&&!clock?this.element().getBoundingClientRect():this.inkRect();guides.show(e.altKey?[]:resizeLines(relativeRect(actual,parent.getBoundingClientRect()),area,peers));}
    };
    const end=()=>{target.onpointermove=target.onpointerup=target.onpointercancel=target.onlostpointercapture=null;guides?.close();if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);this.dragging=false;this.changed();};target.onpointerup=target.onpointercancel=target.onlostpointercapture=end;
  }
  fields(){
    const root=this.root.querySelector('.widget-part-fields'),part=this.part;
    if(!part){root.innerHTML=helpHeading('HDMI','HDMI ist ein einzelnes Bildelement. Seine Position und Größe bearbeitest du im Ansichts-Editor.');bindHelp(root);return;}
    const manual=!!this.part?.control||this.host.currentSize(this.item)==='custom';
    const conf=this.config,box=this.inkBox(),el=this.element(),style=el?getComputedStyle(el):null,parent=this.parent();
    const field=(key,label,value,min,max,step=.1)=>`<label>${label}<input data-field="${key}" type="number" value="${displayNumber(value)}" min="${min}" max="${max}" step="${step}"></label>`;
    const size=conf.font_size ?? Math.max(1,Math.min(100,(parseFloat(style?.fontSize)||16)/(parent?.getBoundingClientRect().height||200)*100));
    root.innerHTML=`<div class="toggle"><label><input data-visible type="checkbox" ${this.enabled(part)?'checked':''}>Element anzeigen</label></div>${manual?`<h3>Position & Größe</h3><div class="form-grid">${field('x','Inhalt links (%)',box.x,0,99)}${field('y','Inhalt oben (%)',box.y,0,99)}${field('width','Inhalt Breite (%)',box.width,1,100)}${field('height','Inhalt Höhe (%)',box.height,1,100)}</div>`:''}${part.text?`<h3>Text & Schrift</h3>${this.clockPart()?'':`<label class="field">Textquelle<select data-text-mode>${options({live:'Original / Live-Inhalt',custom:'Eigener Text'},conf.text===undefined?'live':'custom')}</select></label>${conf.text!==undefined?`<label class="field">Eigener Inhalt<textarea data-text maxlength="2000">${escapeHTML(conf.text)}</textarea></label>`:''}`}<div class="form-grid" ${this.item.style_override?'':'hidden'}>${manual?field('font_size','Inhalt Schriftgröße (%)',size,1,this.item.kind==='text'?10000:100):''}<label>Schrift<select aria-label="Inhalt Schrift" data-choice="font">${options({'':'Vom Widget',...window.LGFontChoices},conf.font || '')}</select></label><label>Schriftschnitt<select data-choice="font_weight">${options({'':'Vom Widget',400:'Normal',500:'Medium',600:'Halbfett',700:'Fett'},String(conf.font_weight || ''))}</select></label><label>Textausrichtung<select aria-label="Textausrichtung" data-choice="align">${options({'':'Vom Widget',left:'Links',center:'Mittig',right:'Rechts'},conf.align || '')}</select></label><label>Inhalt Textfarbe<input data-color type="color" alpha colorspace="limited-srgb" value="${conf.color || this.item.color}"></label><button class="small" data-theme-color>Widget-Farbe verwenden</button></div>`:''}<h3>Darstellung</h3><div class="form-grid">${this.item.style_override?opacityField('data-field="opacity"','Inhalt Deckkraft',conf.opacity ?? 1):''}${this.item.kind!=='clock'||manual?field('z_index','Inhalt Ebene',conf.z_index ?? 2,0,30,1):''}${manual&&this.item.style_override&&!part.control?field('radius','Inhalt Rundung (%)',conf.radius ?? 0,0,50,1):''}${['cover','picture'].includes(part.id)&&!(this.item.kind==='camera'&&this.item.camera_lock_aspect)?`<label>Bild einpassen<select data-choice="fit">${options({'':'Vom Widget',contain:'Vollständig',cover:'Ausfüllen',...(this.item.kind==='camera'?{}:{fill:'Strecken'})},conf.fit || '')}</select></label>`:''}</div><div class="links">${this.item.kind==='clock'?'':'<button class="small delete" data-delete-part>Inhalt entfernen</button>'}<button class="small" data-reset-part>Element zurücksetzen</button></div>`;
    if(part.id==='picture'&&(this.fullscreen||this.item.camera_source==='local'&&this.host.nativeLvgl)){root.insertAdjacentHTML('beforeend',this.host.cropControls(this.item));this.host.bindCropControls(root,this.item,this);}
    root.querySelector('[data-visible]').onchange=e=>this.update('visible',e.target.checked);
    const remove=root.querySelector('[data-delete-part]');if(remove)remove.onclick=()=>this.update('visible',false);
    root.querySelector('[data-reset-part]').onclick=()=>{this.host.checkpoint();if(this.item.parts)delete this.item.parts[this.partId];if(this.part.control)this.item.media_controls_hidden=(this.item.media_controls_hidden || []).filter(key=>key!==this.part.control);const flag={label:'show_label',cover:'show_cover',progress:'show_progress',playback:'show_playback_icon',volume:'show_volume'}[this.partId];if(flag)this.item[flag]=flag!=='show_playback_icon';this.host.fitClockHeight(this.item);this.changed();};
    root.querySelectorAll('[data-field]').forEach(input=>input.onchange=()=>this.update(input.dataset.field,Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)||Number(input.min)))));
    root.querySelectorAll('[data-choice]').forEach(input=>input.onchange=()=>this.update(input.dataset.choice,input.value===''?null:input.dataset.choice==='font_weight'?Number(input.value):input.value));
    if(part.text){const mode=root.querySelector('[data-text-mode]');if(mode)mode.onchange=e=>this.update('text',e.target.value==='custom'?(el?.textContent || ''):null);const text=root.querySelector('[data-text]');if(text)text.onchange=()=>this.update('text',text.value);root.querySelector('[data-color]').onchange=e=>this.update('color',colorValue(e.target.value));root.querySelector('[data-theme-color]').onclick=()=>this.update('color',null);}
    const opacity=root.querySelector('[data-field="opacity"]');
    if(opacity)bindOpacity(opacity,()=>this.host.checkpoint(),value=>{this.item.parts ||= {};const conf=this.item.parts[this.partId] ||= {};conf.opacity=value;this.paint();this.host.queueLive();},()=>this.changed());
  }
  baseFields(){
    const root=this.root.querySelector('.widget-base-fields'),item=this.item;
    if(this.fullscreen){root.innerHTML='<h3>Vollbild</h3><p>Bildfläche und Beschriftung sind unabhängig von der Kachel. Schließen bleibt oben links erreichbar.</p><label>Bildformat<select data-full-fit><option value="contain">Vollständig einpassen</option><option value="cover">Fläche füllen</option></select></label>';const fit=root.querySelector('[data-full-fit]');fit.value=item.camera_fit;fit.onchange=()=>{this.host.checkpoint();item.camera_fit=fit.value;if(item.parts.picture)delete item.parts.picture.fit;this.changed();};return;}
    const manual=this.host.currentSize(item)==='custom';
    root.innerHTML=`${helpHeading('Widget-Grundfläche',`Größe des gesamten Widgets. Die Schriftgröße bleibt dabei erhalten; Textrahmen passen sich dem sichtbaren Inhalt an.`)}<label>Größe<select data-widget-size>${options(this.host.sizeChoices(false,item),this.host.currentSize(item))}</select></label>${manual?`<div class="toggle"><label><input type="checkbox" data-lock-ratio ${item.lock_ratio!==false?'checked':''}>Seitenverhältnis beibehalten</label></div><div class="form-grid">${[['width','Breite'],['height','Höhe']].map(([key,label])=>`<label>Grundfläche ${label} (%)<input data-base="${key}" type="number" min="0.01" max="${key==='width'?100-item.x:(this.host.scene.scroll_height||100)-item.y}" step="0.1" value="${displayNumber(item[key])}"></label>`).join('')}</div>`:''}`;
    root.insertAdjacentHTML('beforeend',`<label class="styling-toggle"><input data-widget-styling type="checkbox" ${item.style_override?'checked':''}>Eigenes Styling</label>`);
    root.querySelector('[data-widget-styling]').onchange=e=>{this.host.checkpoint();this.host.elementStyling(item,e.target.checked);this.changed();};
    root.insertAdjacentHTML('beforeend',`<label class="field">Innenabstand (%)<input data-widget-inset type="number" min="0" max="25" step="0.5" value="${displayNumber(item.content_padding || 0)}"></label>`);
    root.querySelector('[data-widget-inset]').onchange=e=>{this.host.checkpoint();item.content_padding=Math.max(0,Math.min(25,Number(e.target.value)||0));this.changed();};
    if(item.kind==='text'){
      root.insertAdjacentHTML('beforeend',`<label class="field">Zeilenabstand<input data-text-line-height type="number" min="0.8" max="3" step="0.05" value="${displayNumber(item.text_line_height ?? 1.35)}"></label>`);
      root.querySelector('[data-text-line-height]').onchange=e=>{this.host.checkpoint();item.text_line_height=Math.max(.8,Math.min(3,Number(e.target.value)||1.35));this.changed();};
    }
    root.querySelector('[data-widget-size]').onchange=e=>{this.host.checkpoint();if(e.target.value==='custom'){item.manual_size=true;delete item.grid_size;}else this.host.standardSize(item,e.target.value);this.changed();};
    const lock=root.querySelector('[data-lock-ratio]');if(lock)lock.onchange=e=>{this.host.checkpoint();item.lock_ratio=e.target.checked;this.changed();};
    root.querySelectorAll('[data-base]').forEach(input=>input.onchange=()=>{
      const value=Number(input.value);if(!Number.isFinite(value)||value<=0){this.baseFields();return;}
      this.host.checkpoint();const original=clone(item),contents=contentGeometry(item,this.host.renderer.nodes[item.id]);
      item[input.dataset.base]=Math.max(.01,Math.min(Number(input.max),value));delete item.clock_base_height;delete item.clock_size;
      // Explicit percentages must be rebased so changing the surface does not
      // accidentally enlarge time/date or nested text. Font edits remain separate.
      scaleContent(item,original,contents,1);this.changed();
    });
  }
  binding(){
    const root=this.root.querySelector('.widget-binding');
    if(isAnimation(this.item)){root.innerHTML='';
    }else if(this.item.kind==='clock'){
      root.innerHTML=`<div class="form-grid"><label>Uhr-Anzeige<select data-clock-view>${options({both:'Uhrzeit und Datum',time:'Nur Uhrzeit',date:'Nur Datum',none:'Beides ausgeblendet'},this.item.parts?.time?.visible===false?(this.item.parts?.date?.visible===false?'none':'date'):this.item.parts?.date?.visible===false?'time':'both')}</select></label><label>Zeitformat<select data-clock="clock_time_format">${options({'24h':'24 Stunden','12h':'12 Stunden'},this.item.clock_time_format || '24h')}</select></label><label>Datumsformat<select data-clock="clock_date_format">${options({long:'Dienstag, 6. Oktober',short:'06.10.2026',weekday:'Dienstag',iso:'2026-10-06'},this.item.clock_date_format || 'long')}</select></label></div>`;
      root.insertAdjacentHTML('beforeend',`<div class="toggle"><label><input type="checkbox" data-clock-option="clock_seconds" ${this.item.clock_seconds?'checked':''}>Sekunden anzeigen</label></div><div class="toggle"><label><input type="checkbox" data-clock-option="clock_blink" ${this.item.clock_blink?'checked':''}>Trennpunkte im Sekundentakt blinken</label></div>`);
      if(this.item.parts?.time?.visible!==false&&this.item.parts?.date?.visible!==false){
        root.insertAdjacentHTML('beforeend',`<label class="field">${helpLabel('Zeilenabstand',`Anteil der inneren Widgethöhe, begrenzt durch die verfügbare Fläche. Beide Zeilen bleiben gemeinsam mittig.`)}<input aria-label="Zeilenabstand" data-clock-gap type="number" min="0" max="40" step="0.5" value="${displayNumber(this.item.clock_gap ?? 4)}"></label>`);
        root.querySelector('[data-clock-gap]').onchange=e=>{this.host.checkpoint();this.item.clock_gap=Math.max(0,Math.min(40,Number(e.target.value)||0));this.changed();};
      }
      root.querySelectorAll('[data-clock-option]').forEach(input=>input.onchange=()=>{this.host.checkpoint();this.item[input.dataset.clockOption]=input.checked;this.host.fitClockHeight(this.item);this.changed();});
      root.querySelector('[data-clock-view]').onchange=e=>{this.host.checkpoint();this.item.parts ||= {};for(const id of ['time','date']){this.item.parts[id] ||= {};this.item.parts[id].visible=e.target.value==='both'||e.target.value===id;}if(['time','date'].includes(e.target.value))this.partId=e.target.value;this.host.fitClockHeight(this.item);this.changed();};
      root.querySelectorAll('[data-clock]').forEach(input=>input.onchange=()=>{this.host.checkpoint();this.item[input.dataset.clock]=input.value;this.host.fitClockHeight(this.item);this.changed();});
    }else root.innerHTML=`${helpHeading('Widget-Einstellungen',`${this.item.entity_id?'Verbunden mit '+this.item.entity_id+'. ':''}Die Entität und allgemeinen Widget-Einstellungen bleiben im Ansichts-Editor verfügbar. „Inhalt-Layout zurücksetzen“ stellt die Elemente des gewählten Widget-Stils wieder her; Entität, äußere Position und Größe bleiben erhalten.`)}`;
  }
}
