const bounded=(value,min,max,fallback=0)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
export function cameraGeometry(sw,sh,w,h,item) {
  const scale=(item.parts?.picture?.fit || item.camera_fit)==='cover'?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh);
  const zoom=bounded(item.camera_zoom,100,400,100)/100,width=sw*scale*zoom,height=sh*scale*zoom;
  const travelX=Math.max(0,(width-w)/2),travelY=Math.max(0,(height-h)/2);
  return {width,height,travelX,travelY,x:(w-width)/2+travelX*bounded(item.camera_pan_x,-100,100)/100,y:(h-height)/2+travelY*bounded(item.camera_pan_y,-100,100)/100};
}
// Gesture surface is separate from the widget's move/resize surface. A gesture
// makes one undo entry; video and its decoder stay alive throughout editing.
export function bindCameraCrop(node,item,box,{checkpoint,paint,commit}) {
  node.classList.add('camera-crop-handle');node.setAttribute('aria-label','Bildausschnitt ziehen und zoomen');
  node.style.touchAction='none';node.style.cursor='grab';
  const points=new Map();let initial,geometry,distance=0,zoom=100;
  const view=()=>{const media=box.querySelector('video,img'),r=box.getBoundingClientRect();return cameraGeometry(media?.videoWidth||media?.naturalWidth||1280,media?.videoHeight||media?.naturalHeight||720,r.width,r.height,item);};
  node.onpointerdown=e=>{
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();node.focus({preventScroll:true});node.setPointerCapture(e.pointerId);
    if(!points.size)checkpoint();points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    initial={x:e.clientX,y:e.clientY,panX:item.camera_pan_x||0,panY:item.camera_pan_y||0};geometry=view();
    if(points.size===2){const [a,b]=[...points.values()];distance=Math.hypot(a.x-b.x,a.y-b.y);zoom=item.camera_zoom||100;}
  };
  node.onpointermove=e=>{
    if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.size===2){const [a,b]=[...points.values()];item.camera_zoom=bounded(zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,distance),100,400,100);}
    else {item.camera_pan_x=bounded(initial.panX+(e.clientX-initial.x)*100/(geometry.travelX||Infinity),-100,100);item.camera_pan_y=bounded(initial.panY+(e.clientY-initial.y)*100/(geometry.travelY||Infinity),-100,100);}
    paint();
  };
  node.onpointerup=node.onpointercancel=e=>{if(!points.delete(e.pointerId))return;if(!points.size)commit();else{const [p]=points.values();initial={...p,panX:item.camera_pan_x||0,panY:item.camera_pan_y||0};geometry=view();}};
  node.onwheel=e=>{e.preventDefault();e.stopPropagation();checkpoint();item.camera_zoom=bounded((item.camera_zoom||100)*Math.exp(-bounded(e.deltaY,-100,100)*.002),100,400,100);paint();commit();};
  node.onkeydown=e=>{
    const movement={ArrowLeft:['camera_pan_x',-5],ArrowRight:['camera_pan_x',5],ArrowUp:['camera_pan_y',-5],ArrowDown:['camera_pan_y',5]};
    if(!movement[e.key]&&!['+','-','='].includes(e.key))return;e.preventDefault();e.stopPropagation();checkpoint();
    if(movement[e.key]){const [key,delta]=movement[e.key];item[key]=bounded((item[key]||0)+delta,-100,100);}
    else item.camera_zoom=bounded((item.camera_zoom||100)+(e.key==='-'?-10:10),100,400,100);
    paint();commit();
  };
}

/* Admin-only preview. The ESP still renders its camera locally; never change
 * the saved camera source or open a second direct connection to the board. */
const entityId = value => /^camera\.[a-z0-9_]+$/.test(value || '') ? value : '';
let hlsModule;
const loadHls = () => hlsModule ||= import('./vendor/hls-1.7.3.light.min.mjs').catch(error => {hlsModule=null;throw error;});
let directModule;
const version=encodeURIComponent(new URL(import.meta.url).searchParams.get('v') || 'development');
const loadDirect=()=>directModule ||= import(`./camera_direct.js?v=${version}`).catch(error=>{directModule=null;throw error;});

// The LG endpoint can send its length-delimited JPEG parts as binary data.
// Safari rejects multipart fetch responses and does not reliably load an
// indefinitely open multipart <img>. Decode complete frames explicitly instead.
export async function* jpegFrames(response) {
  if(!response.ok || !/^application\/octet-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '') || !response.body)throw Error('Invalid JPEG stream');
  const reader=response.body.getReader();let buffer=new Uint8Array(),length=null;
  try {
    while(true){
      const {value,done}=await reader.read();if(done)throw Error('JPEG stream ended');
      if(buffer.length+value.length>6*1024*1024)throw Error('JPEG stream too large');
      const joined=new Uint8Array(buffer.length+value.length);joined.set(buffer);joined.set(value,buffer.length);buffer=joined;
      while(true){
        if(length===null){
          let end=-1;
          for(let i=0;i+3<buffer.length;i++)if(buffer[i]===13 && buffer[i+1]===10 && buffer[i+2]===13 && buffer[i+3]===10){end=i;break;}
          if(end>8192 || end<0 && buffer.length>8192)throw Error('Invalid JPEG headers');
          if(end<0)break;
          const headers=new TextDecoder().decode(buffer.subarray(0,end)),match=/(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(headers);
          length=match?Number(match[1]):0;
          if(!/(?:^|\r\n)Content-Type:\s*image\/jpeg\s*(?:\r\n|$)/i.test(headers) || length<1 || length>5*1024*1024)throw Error('Invalid JPEG frame');
          buffer=buffer.subarray(end+4);
        }
        if(buffer.length<length)break;
        const frame=buffer.slice(0,length);buffer=buffer.subarray(length);length=null;
        yield frame;
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export class CameraPreview {
  constructor(box, detail, onDimensions) {
    this.onDimensions=onDimensions;
    this.box=box;this.detail=detail;this.box.style.overflow="hidden";
    this.resize=new ResizeObserver(()=>this.applyCrop());this.resize.observe(box);this.generation=0;this.closed=false;
    this.visibility=()=>{this.stop();if(!document.hidden)this.start();else this.message('Kameravorschau pausiert');};
    document.addEventListener('visibilitychange',this.visibility);
  }
  update(hass, descriptor, item) {
    this.hass=hass;this.item=item;this.fit=(item.parts?.picture?.fit || item.camera_fit)==='cover'?'cover':'contain';
    for(const media of this.box.querySelectorAll('video,img'))media.style.objectFit=this.fit;
    this.applyCrop();
    if(['test','multicast'].includes(item.camera_source))descriptor={preview_path:descriptor?.preview_path};
    if(item.camera_source==='entity')descriptor={preview_path:descriptor?.preview_path,stream_entity_id:item.entity_id,snapshot_entity_id:item.entity_id};
    const lgPreview=item.camera_source==='entity' && hass.states?.[item.entity_id]?.attributes?.integration_domain==='lg_rs232_ip';
    const stream=entityId(descriptor?.stream_entity_id),snapshot=entityId(descriptor?.snapshot_entity_id);
    const path=descriptor?.live_stream_path,livePath=typeof path==='string' && /^\/api\/esphome_display\/camera\/[a-z0-9_-]+\/preview\.mp4$/i.test(path)?path:null;
    const external=(lgPreview || ['test','multicast'].includes(item.camera_source))?descriptor?.preview_path:null;
    const offline=!external&&descriptor?.connected===false;
    const key=JSON.stringify([stream,snapshot,livePath,external,item.multicast_url,offline,item.camera_mode,item.camera_interval]);
    if(key===this.key)return;
    this.key=key;this.offline=offline;this.stream=stream;this.snapshot=snapshot;this.external=external;this.livePath=livePath;this.stop();this.start();
  }
  applyCrop() {
    for(const media of this.box.querySelectorAll('video,img')) {
      const sw=media.videoWidth || media.naturalWidth,sh=media.videoHeight || media.naturalHeight;
      if(!sw || !sh || !this.item)return;
      const g=cameraGeometry(sw,sh,this.box.clientWidth,this.box.clientHeight,this.item);
      Object.assign(media.style,{width:g.width+'px',height:g.height+'px',left:g.x+'px',top:g.y+'px',maxWidth:'none',maxHeight:'none'});
    }
  }
  message(value) {this.detail.textContent=value;}
  current(generation) {return !this.closed && !document.hidden && generation===this.generation;}
  media(tag) {
    const media=document.createElement(tag);media.style.objectFit=this.fit;media.style.objectPosition='center';
    media.style.pointerEvents='none';media.setAttribute('aria-label','Live-Vorschau der Kamera');
    media.onloadedmetadata=media.onload=()=>{
      this.applyCrop();
      const width=media.videoWidth || media.naturalWidth,height=media.videoHeight || media.naturalHeight;
      if(!this.closed && width>1 && height>1)this.onDimensions?.(this.item,width,height,tag==='img');
    };
    this.box.append(media);return media;
  }
  async start() {
    if(this.closed || this.suspended || document.hidden)return;
    if(this.offline){this.box.dataset.previewState='offline';this.message('Kamera offline · Position und Größe bleiben bearbeitbar');return;}
    const generation=this.generation;
    if(this.item?.camera_mode==='snapshot' && (this.snapshot || this.external)){this.box.dataset.previewState='still';void this.still(generation);return;}
    if(!this.stream && !this.external){this.message(this.snapshot?'Kamera wird geladen …':'Keine Kamera in Home Assistant verfügbar');if(this.snapshot)void this.still(generation);return;}
    this.box.dataset.previewState='connecting';this.message('Kamera verbindet …');
    if(this.snapshot || this.external)this.posterTimer=setTimeout(()=>this.still(generation),800);
    // Covers a lost WS response, a stalled playlist and blocked media loading.
    this.watchdog=setTimeout(()=>this.fallback(generation),15000);
    try {
      this.directAttempt=Boolean(this.livePath && window.MediaSource && Date.now()>=(this.directRetryAfter||0));
      let url;
      if(!this.directAttempt){
        const result=this.external?{url:(await (await this.sourceRequest('stream')).json()).stream}:await this.hass.callWS({type:'camera/stream',entity_id:this.stream,format:'hls'});
        if(!this.current(generation))return;
        url=new URL(result.url,location.origin);
        if(url.origin===location.origin && !url.username && !url.password && /^\/api\/camera_proxy_stream\/camera\.[a-z0-9_]+$/i.test(url.pathname) && /^\?token=[a-z0-9_-]+$/i.test(url.search)){this.mjpeg(generation,url.href);return;}
        if(url.origin!==location.origin || url.username || url.password || !(url.pathname.startsWith('/api/hls/') || this.item.camera_source==='test' && url.pathname==='/display_studio/runtime/test-stream.m3u8'))throw Error('Invalid HA stream');
      }
      const video=this.media('video');this.video=video;
      video.loop=this.item.camera_source==='test';video.muted=true;video.autoplay=true;video.playsInline=true;video.controls=false;
      let played=false;
      const playing=()=>{played=true;if(this.current(generation)){
        this.box.dataset.previewState='playing';clearTimeout(this.watchdog);clearTimeout(this.posterTimer);clearTimeout(this.snapshotTimer);
        this.request?.abort();this.request=null;this.image?.remove();this.image=null;
        if(this.imageUrl)URL.revokeObjectURL(this.imageUrl);this.imageUrl=null;
        clearInterval(this.ageTimer);this.ageTimer=null;this.showBadge('Live');
        delete this.box.dataset.previewError;this.message('');this.applyCrop();
      }};
      video.onplaying=playing;
      video.onerror=()=>{if(!this.hls)this.fallback(generation,'media_'+video.error?.code);};
      if(this.directAttempt){
        const {DirectCamera}=await loadDirect();if(!this.current(generation))return;
        this.direct=new DirectCamera(video,this.hass,this.livePath);this.box.dataset.previewTransport='direct';
        void this.direct.run().catch(()=>this.fallback(generation,'direct'));
      }else{
      this.box.dataset.previewTransport='hls';
      // Chromium can advertise native HLS while rejecting HA's live playlists.
      // Prefer MSE when available; use native HLS on engines without it.
      const {default:Hls}=await loadHls();
      if(!this.current(generation))return;
      if(Hls.isSupported()) {
        this.hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:6,maxBufferLength:10,maxLiveSyncPlaybackRate:1.25,
          startFragPrefetch:true,
          fragLoadingTimeOut:10000,manifestLoadingTimeOut:10000,levelLoadingTimeOut:10000});
        let mediaRecoveries=0,networkRecoveries=0;
        this.hls.on(Hls.Events.ERROR,(_,data)=>{
          if(!data.fatal || !this.current(generation))return;
          // HA live playlists may jump across an encoder reconnect. Give MSE a
          // bounded recovery before replacing this video with the still fallback.
          if(data.type===Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++<2)this.hls.recoverMediaError();
          else if(data.type===Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries++<1)this.hls.startLoad();
          else this.fallback(generation,data.details);
        });
        this.hls.loadSource(url.href);this.hls.attachMedia(video);
      } else if(video.canPlayType('application/vnd.apple.mpegurl')) video.src=url.href;
      else throw Error('HLS unsupported');
      video.play().catch(()=>{if(this.current(generation))this.message('Kameravorschau lädt …');});
      }
      // Keep the last decoded frame during brief buffering; recover a dead stream.
      let previous=-1,stalls=0;
      this.health=setInterval(()=>{
        if(!this.current(generation))return;
        if(!played)return;
        stalls=video.currentTime===previous?stalls+1:0;previous=video.currentTime;
        if(stalls>=5)this.fallback(generation,'stalled');
      },1000);
    } catch (error) {this.fallback(generation,error.code || error.name);}
  }
  async mjpeg(generation,url) {
    clearTimeout(this.posterTimer);clearTimeout(this.snapshotTimer);
    clearInterval(this.ageTimer);this.ageTimer=null;
    this.request?.abort();this.request=null;this.image?.remove();
    const image=this.image=this.media('img'),controller=this.mjpegRequest=new AbortController();
    this.box.dataset.previewTransport='mjpeg';
    try {
      const source=new URL(url);source.searchParams.set('lg_preview','frames');
      const response=await fetch(source.href,{signal:controller.signal,cache:'no-store',credentials:'same-origin'});
      for await(const bytes of jpegFrames(response)){
        if(!this.current(generation))break;
        const frame=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),decoded=new Image();let installed=false;
        try {
          decoded.src=frame;await decoded.decode();
          if(!this.current(generation))break;
          const previous=this.imageUrl;this.imageUrl=frame;image.src=frame;installed=true;
          if(previous)URL.revokeObjectURL(previous);
          clearTimeout(this.watchdog);this.watchdog=setTimeout(()=>this.fallback(generation,'stalled'),15000);
          this.box.dataset.previewState='playing';delete this.box.dataset.previewError;this.message('');this.showBadge('Live');
        }finally{if(!installed)URL.revokeObjectURL(frame);}
      }
    }catch(_){if(!controller.signal.aborted)this.fallback(generation,'mjpeg');}
    finally{controller.abort();if(this.mjpegRequest===controller)this.mjpegRequest=null;}
  }
  fallback(generation,reason='timeout') {
    if(!this.current(generation))return;
    if(this.directAttempt){
      this.directRetryAfter=Date.now()+60000;this.stop();void this.start();return;
    }
    this.box.dataset.previewError=/^[a-z0-9_]+$/i.test(reason)?reason:'stream';
    this.stop();this.box.dataset.previewState='still';const next=this.generation;
    const fallback=this.item?.camera_mode!=='stream';
    this.message(fallback&&(this.snapshot || this.external)?'Stream lädt neu · Einzelbildvorschau':'Kamera nicht erreichbar · erneuter Versuch …');
    if(fallback&&(this.snapshot || this.external))void this.still(next);
    this.retry=setTimeout(()=>{if(this.current(next)){this.stop();void this.start();}},6000);
  }
  sourceRequest(kind,signal) {
    return this.hass.fetchWithAuth(this.external,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({camera_source:this.item.camera_source,entity_id:this.item.entity_id || '',multicast_url:this.item.multicast_url || '',kind})});
  }
  async still(generation) {
    if(!this.current(generation))return;
    const controller=new AbortController();this.request=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    let delay=this.item?.camera_mode==='snapshot'?Math.max(1,Math.min(300,Number(this.item.camera_interval)||5))*1000:1000;
    try {
      const response=this.external?await this.sourceRequest('image',controller.signal):await this.hass.fetchWithAuth('/api/camera_proxy/'+this.snapshot,{signal:controller.signal});
      if(!response.ok)throw Error('Snapshot unavailable');
      const blob=await response.blob();
      if(!this.current(generation))return;
      const url=URL.createObjectURL(blob),image=new Image();
      try {image.src=url;await image.decode();}catch(error){URL.revokeObjectURL(url);throw error;}
      if(!this.current(generation) || this.box.dataset.previewState==='playing'){URL.revokeObjectURL(url);return;}
      if(!this.image)this.image=this.media('img');
      const old=this.imageUrl;this.imageUrl=url;this.image.src=url;if(old)URL.revokeObjectURL(old);this.applyCrop();
      this.capturedAt=performance.now();this.updateAge();
      if(!this.ageTimer)this.ageTimer=setInterval(()=>this.updateAge(),1000);
      this.message('');
    } catch (_) {delay=5000;if(this.current(generation) && this.box.dataset.previewState!=='playing')this.message('Kamera nicht erreichbar · erneuter Versuch …');}
    finally {clearTimeout(timeout);if(this.request===controller)this.request=null;}
    if(this.current(generation) && this.box.dataset.previewState!=='playing')this.snapshotTimer=setTimeout(()=>this.still(generation),delay);
  }
  updateAge() {
    if(!this.image)return;
    const seconds=Math.floor((performance.now()-this.capturedAt)/1000);
    this.showBadge(seconds<60?seconds+' s':Math.floor(seconds/60)+' min');
  }
  showBadge(value) {
    if(!this.age){this.age=document.createElement('span');this.age.className='lg-camera-age';this.age.style.cssText='position:absolute;left:10px;bottom:10px;padding:3px 6px;border-radius:6px;color:white;background:#0008;font:600 14px sans-serif;pointer-events:none;z-index:2';this.box.append(this.age);}
    if(this.age.textContent!==value)this.age.textContent=value;
  }
  stop() {
    clearInterval(this.ageTimer);this.ageTimer=null;this.age?.remove();this.age=null;
    this.generation++;delete this.box.dataset.previewState;clearTimeout(this.posterTimer);clearTimeout(this.watchdog);clearTimeout(this.retry);clearTimeout(this.snapshotTimer);clearInterval(this.health);
    this.request?.abort();this.request=null;this.hls?.destroy();this.hls=null;
    this.mjpegRequest?.abort();this.mjpegRequest=null;
    this.direct?.close();this.direct=null;this.directAttempt=false;delete this.box.dataset.previewTransport;
    if(this.video){this.video.onplaying=null;this.video.onerror=null;this.video.pause();this.video.removeAttribute('src');this.video.load();this.video.remove();this.video=null;}
    if(this.image){this.image.onload=this.image.onerror=null;this.image.removeAttribute('src');this.image.remove();this.image=null;}if(this.imageUrl)URL.revokeObjectURL(this.imageUrl);this.imageUrl=null;
  }
  close() {this.resize.disconnect();this.closed=true;this.stop();document.removeEventListener('visibilitychange',this.visibility);}
}
