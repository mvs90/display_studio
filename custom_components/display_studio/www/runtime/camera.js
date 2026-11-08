/* ES5, one additional decoder. Work exists only while its widget is visible. */
(function () {
  "use strict";
  function Camera(node, item, urls) {
    this.node=node; this.item=item; this.urls=urls; this.timers=[]; this.closed=false;
    this.box=document.createElement("div"); this.box.className="lg-camera-picture";
    node.appendChild(this.box);
    var self=this;
    if(window.ResizeObserver){this.resize=new ResizeObserver(function(){self.applyCrop();});this.resize.observe(this.box);}
    this.visibility=function () {self.stop();if(!document.hidden){self.start();}};
    document.addEventListener("visibilitychange",this.visibility);
    if(!document.hidden){this.start();}
  }
  Camera.prototype.later=function (fn, delay) {
    var self=this, timer=window.setTimeout(function () {
      var index=self.timers.indexOf(timer);if(index!==-1){self.timers.splice(index,1);}
      if(!self.closed && !document.hidden){fn();}
    },delay);this.timers.push(timer);return timer;
  };
  Camera.prototype.stop=function () {
    this.generation=(this.generation || 0)+1;
    this.timers.forEach(function (timer) {window.clearTimeout(timer);});this.timers=[];
    if(this.xhr){this.xhr.abort();this.xhr=null;}
    if(this.image){this.image.onload=this.image.onerror=null;this.image.removeAttribute("src");this.image=null;}
    if(this.video){this.video.onerror=this.video.onloadeddata=null;this.video.pause();this.video.removeAttribute("src");this.video.load();this.video=null;}
    if(this.pendingImage){this.pendingImage.onload=this.pendingImage.onerror=null;this.pendingImage.removeAttribute("src");this.pendingImage=null;}
    this.age=null;this.capturedAt=0;
    while(this.box.firstChild){this.box.removeChild(this.box.firstChild);}
  };
  Camera.prototype.close=function () {
    this.closed=true;if(this.resize)this.resize.disconnect();this.stop();document.removeEventListener("visibilitychange",this.visibility);
    this.node.removeChild(this.box);
  };
  Camera.prototype.applyCrop=function() {
    var media=this.video || this.image;if(!media)return;
    var sw=media.videoWidth || media.naturalWidth,sh=media.videoHeight || media.naturalHeight,w=this.box.clientWidth,h=this.box.clientHeight;if(!sw || !sh || !w || !h)return;
    var fit=(this.item.parts || {}).picture || {},scale=(fit.fit || this.item.camera_fit)==='cover'?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh);
    scale*=Math.max(100,Math.min(400,this.item.camera_zoom || 100))/100;
    var width=sw*scale,height=sh*scale;
    media.style.width=width+'px';media.style.height=height+'px';media.style.maxWidth='none';media.style.maxHeight='none';
    media.style.left=((w-width)/2+Math.max(0,(width-w)/2)*(this.item.camera_pan_x || 0)/100)+'px';
    media.style.top=((h-height)/2+Math.max(0,(height-h)/2)*(this.item.camera_pan_y || 0)/100)+'px';
  };
  Camera.prototype.status=function (value) {this.node._detail.textContent=value;};
  Camera.prototype.badge=function(value) {
    if(!this.age){this.age=document.createElement("span");this.age.className="lg-camera-age";this.age.style.cssText="position:absolute;left:10px;bottom:10px;padding:3px 6px;border-radius:6px;color:white;background:#0008;font:600 14px sans-serif;pointer-events:none;z-index:2";this.box.appendChild(this.age);}
    if(this.age.textContent!==value)this.age.textContent=value;
  };
  Camera.prototype.start=function () {
    var self=this, generation=this.generation;
    if(this.suspended){return;}
    this.status("Verbinden …");
    if(this.item.camera_source === "local"){this.status("Bordkamera auf dem ESP");return;}


    if(this.item.camera_source === "entity" && !this.item.entity_id){this.status("Kamera auswählen");return;}
    if(this.item.camera_mode === "snapshot"){this.snapshots();return;}
    var xhr=this.xhr=new XMLHttpRequest();xhr.open("GET",this.urls.info,true);xhr.timeout=12000;
    function complete() {
      if(self.closed || generation!==self.generation){return;}self.xhr=null;
      var data;try{data=JSON.parse(xhr.responseText);}catch(_){data={};}
      if(xhr.status===200 && typeof data.stream === "string" && /^\/api\/camera_proxy_stream\/camera\.[a-z0-9_]+\?token=[a-z0-9_-]+$/i.test(data.stream)){self.mjpeg(data.stream);}
      else if(xhr.status===200 && typeof data.stream === "string" && (data.stream.indexOf("/api/hls/")===0 || self.item.camera_source==="test" && data.stream==="/display_studio/runtime/test-stream.m3u8")){self.stream(data.stream);}
      else{self.fallback();}
    }
    xhr.onload=complete;xhr.onerror=complete;xhr.ontimeout=complete;xhr.send();
  };
  Camera.prototype.fallback=function () {
    var self=this;this.stop();
    if(this.closed || document.hidden){return;}
    if(this.item.camera_mode!=="stream"){this.snapshots();}
    else{this.status("Stream nicht verfügbar");}
    // One retry per minute, no repeated decoder construction on HA state polls.
    this.later(function () {self.stop();self.start();},60000);
  };
  Camera.prototype.stream=function (url) {
    var self=this, video=this.video=document.createElement("video"), generation=this.generation;
    video.autoplay=true;video.muted=true;video.loop=true;video.setAttribute("muted","");video.setAttribute("playsinline","");
    video.style.objectFit=this.item.camera_fit || "contain";this.box.appendChild(video);
    video.onloadeddata=function () {if(generation===self.generation){self.status("");self.applyCrop();self.badge("Live");}};
    video.onerror=function () {if(generation===self.generation){self.fallback();}};
    video.src=url;var promise=video.play();if(promise && promise.catch){promise.catch(function () {if(generation===self.generation){self.fallback();}});}
    var last=-1, stalled=0;
    function check() {
      if(generation!==self.generation){return;}
      if(video.currentTime===last || video.readyState<2){stalled+=5;}else{stalled=0;last=video.currentTime;}
      if(stalled>=15){self.fallback();return;}self.later(check,5000);
    }
    this.later(check,5000);
  };
  Camera.prototype.mjpeg=function(url) {
    var self=this,generation=this.generation,image=this.image=document.createElement('img');
    image.alt='Livebild';image.style.objectFit=this.item.camera_fit || 'contain';this.box.appendChild(image);
    image.onload=function(){if(generation===self.generation){self.applyCrop();self.status('');self.badge('Live');}};
    image.onerror=function(){if(generation===self.generation)self.fallback();};image.src=url;
  };
  Camera.prototype.snapshots=function () {
    var self=this, generation=this.generation, waiting=false, watchdog;
    this.status("Einzelbild wird geladen …");
    function age() {
      if(generation!==self.generation){return;}
      if(self.capturedAt){var seconds=Math.floor((performance.now()-self.capturedAt)/1000);self.age.textContent=seconds<60?seconds+" s":Math.floor(seconds/60)+" min";}
      self.later(age,1000);
    }
    function load() {
      if(waiting){return;}waiting=true;
      var image=self.pendingImage=document.createElement("img");image.alt="Kamerabild";image.style.objectFit=self.item.camera_fit || "contain";
      function done(ok) {
        if(generation!==self.generation || !waiting){return;}waiting=false;window.clearTimeout(watchdog);
        var index=self.timers.indexOf(watchdog);if(index!==-1)self.timers.splice(index,1);
        image.onload=image.onerror=null;self.pendingImage=null;
        if(ok && image.naturalWidth){
          if(self.image)self.image.remove();self.image=image;self.box.insertBefore(image,self.box.firstChild);self.capturedAt=performance.now();self.applyCrop();
          self.badge("0 s");self.status("");
        }else{image.removeAttribute("src");self.status("Kamera nicht erreichbar · letztes Bild");}
        self.later(load,ok?Math.max(1,Math.min(300,self.item.camera_interval || 5))*1000:5000);
      }
      image.onload=function(){done(true);};image.onerror=function(){done(false);};
      watchdog=self.later(function(){done(false);},12000);image.src=self.urls.image+"&t="+Date.now();
    }
    age();load();
  };
  Camera.closeFullscreen=function(renderer,resume) {
    var pop=renderer.cameraFullscreen;if(!pop)return;renderer.cameraFullscreen=null;
    pop.camera.close();pop.node.remove();pop.source.suspended=false;
    if(resume!==false && !pop.source.closed){pop.source.stop();pop.source.start();}
    if(pop.focus && pop.focus.isConnected)pop.focus.focus({preventScroll:true});
  };
  Camera.fullscreenItem=function(item) {
    var spec=item.camera_fullscreen || {},parts=spec.parts || {};
    return Object.assign({},item,{x:0,y:0,width:100,height:100,manual_size:true,lock_ratio:false,
      camera_lock_aspect:false,camera_mode:'stream',camera_fit:spec.camera_fit || 'contain',
      camera_zoom:spec.camera_zoom || 100,camera_pan_x:spec.camera_pan_x || 0,camera_pan_y:spec.camera_pan_y || 0,
      background:'#101010',opacity:1,radius:0,content_padding:0,style_override:true,show_label:true,
      tap_action:{action:'none',entity_id:'',view:''},parts:{
        label:Object.assign({x:6.25,y:2.33,width:90,height:5,font_size:3,font_weight:600,color:'#ffffff'},parts.label || {}),
        picture:Object.assign({x:0,y:9,width:100,height:91},parts.picture || {}),detail:{visible:false}}});
  };
  Camera.openFullscreen=function(renderer,node,item) {
    var source=node._previewCamera || node._camera;if(!source)return;
    Camera.closeFullscreen(renderer);source.suspended=true;source.stop();
    var modal=document.createElement('div');modal.className='lg-camera-fullscreen';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',item.label || 'Kamera');
    modal.style.cssText='position:absolute;top:0;right:0;bottom:0;left:0;background:#101010;color:white;z-index:100;overflow:hidden;';
    renderer.root.appendChild(modal);
    var live=Camera.fullscreenItem(item),camera=new window.LGLayoutRenderer(modal,null,renderer.preview);
    camera.render(Object.assign({},renderer.scene,{elements:[live],scroll_height:100,background:'solid',color:'#101010',media_background_enabled:false}),renderer.data,Object.assign({},renderer.options,{onTap:null,onValue:null,contentScale:1}));
    var close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Kamera schließen');close.style.cssText='position:absolute;top:8px;left:10px;width:40px;height:40px;border:0;border-radius:50%;background:#444;color:white;font:30px sans-serif;z-index:200;';modal.appendChild(close);
    renderer.cameraFullscreen={id:item.id,node:modal,camera:{close:function(){camera.clear();}},source:source,focus:document.activeElement};
    close.onclick=function(e){e.stopPropagation();Camera.closeFullscreen(renderer);};
    modal.onclick=function(e){e.stopPropagation();};modal.onkeydown=function(e){if(e.key==='Escape'){e.stopPropagation();Camera.closeFullscreen(renderer);}if(e.key==='Tab'){e.preventDefault();close.focus();}};close.focus({preventScroll:true});
  };
  window.LGCamera=Camera;
}());
