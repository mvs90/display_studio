/* One long poll, one local clock; no native HDMI or LG service assumptions. */
(function () {
  "use strict";
  var root=document.getElementById("studio-scene"), overlay=document.getElementById("studio-message");
  var renderer=new window.LGLayoutRenderer(root,null,false), messageRenderer=new window.LGLayoutRenderer(overlay,null,false);
  var data=null, revision=null, last=0, xhr=null, timer=null, stopped=false, offset=0;
  function status(text){document.getElementById("studio-status").textContent=text;}
  function options(key,message){return {hideHdmi:true,message:message,timezone:data.layout.timezone,sun:data.layout.sun,now:new Date(Date.now()+offset),imageUrl:function(id){return "background.jpg?id="+encodeURIComponent(id);},mediaUrl:function(entity,id,size){return "cover.jpg?entity="+encodeURIComponent(entity)+"&v="+encodeURIComponent(id)+"&size="+(size||640);},cameraUrls:function(item){var query="?view="+encodeURIComponent(key)+"&id="+encodeURIComponent(item.id);return {info:"camera.json"+query,image:"camera.jpg"+query,test:"test-stream.m3u8"};}};}
  function paint(){
    if(document.hidden||!data){return;}
    if(Date.now()-last>30000){renderer.clear();messageRenderer.clear();status("Home Assistant nicht erreichbar. Verbindung wird wiederhergestellt …");return;}
    if(!data.layout){renderer.clear();messageRenderer.clear();status("Display Studio: Layout im Editor aktivieren und speichern.");return;}
    status("");var scenes=data.layout.config.scenes,key=data.view, notification=data.message;
    if(notification&&notification.layout==="fullscreen"){key="fullscreen";}
    if(scenes[key])renderer.render(scenes[key],data.layout.values,options(key,notification));
    if(notification&&notification.layout==="overlay"&&scenes.overlay){messageRenderer.render(scenes.overlay,data.layout.values,options("overlay",notification));overlay.style.background="transparent";}
    else{messageRenderer.clear();}
  }
  function poll(){
    if(stopped||document.hidden||xhr){return;}
    xhr=new XMLHttpRequest();xhr.open("GET","state"+(revision===null?"":"?since="+revision),true);xhr.timeout=30000;
    xhr.onload=function(){var request=xhr;xhr=null;if(request.status===200){try{data=JSON.parse(request.responseText);revision=data.revision;last=Date.now();if(data.layout&&data.layout.now)offset=new Date(data.layout.now).getTime()-last;paint();}catch(e){status("Ungültige Display-Daten.");}}else{status(request.status===404?"Anzeigelink ungültig. Neuen Link im Display Studio öffnen.":"Home Assistant nicht erreichbar.");}timer=setTimeout(poll,request.status===200?50:3000);};
    xhr.onerror=xhr.ontimeout=function(){xhr=null;status("Home Assistant nicht erreichbar. Neuer Versuch …");timer=setTimeout(poll,3000);};xhr.send();
  }
  function pause(){clearTimeout(timer);timer=null;if(xhr){xhr.onload=xhr.onerror=xhr.ontimeout=null;xhr.abort();xhr=null;}renderer.clear();messageRenderer.clear();}
  document.addEventListener("visibilitychange",function(){if(document.hidden){pause();}else{revision=null;poll();}});
  window.addEventListener("pagehide",function(){stopped=true;pause();clearInterval(clock);});
  window.addEventListener("resize",paint);var clock=setInterval(paint,1000);poll();
}());
