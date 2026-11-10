/* Local capability hints and conservative adaptation. No fingerprint or HA commands. */
(function(root){
  'use strict';
  var names=['economy','balanced','quality'];
  function create(nav,search){
    var query={},parts=String(search||'').replace(/^\?/,'').split('&');
    parts.forEach(function(part){var pair=part.split('=');try{query[decodeURIComponent(pair[0])]=decodeURIComponent(pair[1]||'');}catch(e){}});
    var device=['cisco-navigator-gen1','cisco-navigator-gen2'].indexOf(query.device)>=0?query.device:'auto';
    var manual=names.indexOf(query.performance)>=0,level=manual?names.indexOf(query.performance):1;
    var memory=Number(nav.deviceMemory)||0,cores=Number(nav.hardwareConcurrency)||0;
    if(!manual){
      if(device==='cisco-navigator-gen1'||(memory&&memory<=2)||(cores&&cores<=2))level=0;
      else if(device==='cisco-navigator-gen2')level=1;
      else if(memory>=8&&cores>=8)level=2;
      else if(/Cisco|RoomOS/i.test(nav.userAgent||''))level=0;
    }
    var samples=[],slow=0,last=0;
    return {
      interval:function(){return [750,300,100][level];},
      sample:function(ms){
        if(!isFinite(ms)||ms<0)return;
        samples.push(ms);if(samples.length>12)samples.shift();
        last=ms;
        // Only downgrade automatically. Avoid oscillation and kiosk-wide benchmarks.
        if(!manual&&samples.length>=4){var avg=samples.reduce(function(a,b){return a+b;},0)/samples.length;slow=avg>[100,70,45][level]?slow+1:0;if(slow>=3&&level>0){level--;slow=0;samples=[];}}
      },
      scene:function(scene){
        if(level===2)return scene;
        var copy={};Object.keys(scene).forEach(function(key){copy[key]=scene[key];});
        copy.weather_impact=false;copy.weather_accumulation=false;
        if(level===0)copy.weather_animate=false;
        return copy;
      },
      apply:function(body){body.setAttribute('data-performance',names[level]);},
      report:function(){return {profile:names[level],device:device,automatic:!manual,render_ms:Math.min(10000,Math.round(last)),memory:Math.max(0,Math.min(10000,memory)),cores:Math.max(0,Math.min(10000,cores))};}
    };
  }
  root.LGPerformance={create:create};
}(window));
