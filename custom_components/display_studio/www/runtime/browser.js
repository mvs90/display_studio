/* One long poll, one local clock; no native HDMI or LG service assumptions. */
(function () {
  "use strict";
  var root=document.getElementById("studio-scene"), overlay=document.getElementById("studio-message");
  var renderer=new window.LGLayoutRenderer(root,null,false), messageRenderer=new window.LGLayoutRenderer(overlay,null,false);
  var data=null, revision=null, last=0, xhr=null, timer=null, stopped=false, paintTimer=null, lastPaint=0;
  var performanceProfile=window.LGPerformance.create(window.navigator,window.location.search);
  performanceProfile.apply(document.body);
  function telemetry(){var request=new XMLHttpRequest();request.open('POST','telemetry',true);request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify(performanceProfile.report()));}
  function refresh(){if(xhr){xhr.onload=xhr.onerror=xhr.ontimeout=null;xhr.abort();xhr=null;}clearTimeout(timer);revision=null;poll();}
  function schedulePaint(){if(paintTimer)return;paintTimer=setTimeout(function(){paintTimer=null;lastPaint=Date.now();paint();},Math.max(0,performanceProfile.interval()-(Date.now()-lastPaint)));}
  function status(text){document.getElementById("studio-status").textContent=text;}
  var bytes=new Uint8Array(16),session='',sequence=0;
  window.crypto.getRandomValues(bytes);for(var b=0;b<bytes.length;b++)session+=('0'+bytes[b].toString(16)).slice(-2);
  function touch(scene,element,value){
    if(!data || Date.now()-last>30000)return;
    var request=new XMLHttpRequest();request.open('POST','action',true);request.timeout=5000;request.setRequestHeader('Content-Type','application/json');
    request.onload=function(){if(request.status!==200)status('Touch-Aktion nicht verfügbar oder Ansicht geändert.');refresh();};
    request.onerror=request.ontimeout=function(){status('Touch-Aktion konnte nicht bestätigt werden.');};
    request.send(JSON.stringify({revision:data.touch_revision,scene:scene,element:element,session:session,sequence:++sequence,value:value}));
  }
  function options(key,message){return {onValue:function(item,value){touch(key,item.id,value);},onTap:function(item){touch(key,item.id);},hideHdmi:true,cameraSnapshots:data.camera_snapshots===true,message:message,timezone:data.layout.timezone,sun:data.layout.sun,now:new Date(),imageUrl:function(id){return "background.jpg?id="+encodeURIComponent(id);},mediaUrl:function(entity,id,size){return "cover.jpg?entity="+encodeURIComponent(entity)+"&v="+encodeURIComponent(id)+"&size="+Math.min(size||640,performanceProfile.report().profile==='economy'?320:640);},cameraUrls:function(item){var query="?view="+encodeURIComponent(key)+"&id="+encodeURIComponent(item.id);return {info:"camera.json"+query,image:"camera.jpg"+query,test:"test-stream.m3u8"};}};}
  function paint(){
    if(document.hidden||!data){return;}
    var offline=Date.now()-last>30000;
    if(offline){messageRenderer.clear();status("Home Assistant nicht erreichbar. Uhr läuft lokal weiter …");}
    if(!data.layout){renderer.clear();messageRenderer.clear();status("Display Studio: Layout im Editor aktivieren und speichern.");return;}
    if(!offline)status("");var scenes=data.layout.config.scenes,key=data.view, notification=data.message;
    if(notification&&notification.layout==="fullscreen"){key="fullscreen";}
    var started=Date.now();
    if(scenes[key]){var scene=performanceProfile.scene(scenes[key]);if(offline){scene=JSON.parse(JSON.stringify(scene));scene.elements=scene.elements.filter(function(item){return item.kind==="clock";});scene.media_background_enabled=false;}renderer.render(scene,offline?{}:data.layout.values,options(key,offline?null:notification));}else{renderer.clear();}
    if(!offline&&notification&&notification.layout==="overlay"&&scenes.overlay){messageRenderer.render(scenes.overlay,data.layout.values,options("overlay",notification));overlay.style.background="transparent";}
    else{messageRenderer.clear();}
    performanceProfile.sample(Date.now()-started);performanceProfile.apply(document.body);
    window.displayStudioRenderReady=true;
  }
  function poll(){
    if(stopped||document.hidden||xhr){return;}
    xhr=new XMLHttpRequest();xhr.open("GET","state"+(revision===null?"":"?since="+revision),true);xhr.timeout=30000;
    xhr.onload=function(){var request=xhr;xhr=null;if(request.status===200){try{data=JSON.parse(request.responseText);revision=data.revision;last=Date.now();schedulePaint();}catch(e){status("Ungültige Display-Daten.");}}else{if(request.status===404){data=null;revision=null;renderer.clear();messageRenderer.clear();}status(request.status===404?"Anzeigelink ungültig. Neuen Link im Display Studio öffnen.":"Home Assistant nicht erreichbar.");}timer=setTimeout(poll,request.status===200?50:3000);};
    xhr.onerror=xhr.ontimeout=function(){xhr=null;status("Home Assistant nicht erreichbar. Neuer Versuch …");timer=setTimeout(poll,3000);};xhr.send();
  }
  function pause(){clearTimeout(paintTimer);paintTimer=null;clearTimeout(timer);timer=null;if(xhr){xhr.onload=xhr.onerror=xhr.ontimeout=null;xhr.abort();xhr=null;}renderer.clear();messageRenderer.clear();}
  document.addEventListener("visibilitychange",function(){if(document.hidden){pause();}else{revision=null;poll();}});
  window.addEventListener("pagehide",function(){stopped=true;pause();clearInterval(clock);clearInterval(reportTimer);});
  function tick(){if(Date.now()-last>30000){paint();return;}renderer.tick(new Date());messageRenderer.tick(new Date());}
  window.addEventListener("pageshow",function(){if(stopped){stopped=false;revision=null;clock=setInterval(tick,1000);reportTimer=setInterval(telemetry,30000);poll();}});
  window.addEventListener("resize",schedulePaint);var clock=setInterval(tick,1000),reportTimer=setInterval(telemetry,30000);telemetry();poll();
}());
