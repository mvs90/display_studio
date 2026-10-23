/* Local ES5 weather artwork. Only the current symbol animates; forecasts stay still. */
(function () {
  "use strict";
  var SVG='<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  var SUN='<g class="wx-rays" stroke="#f9cb65" stroke-width="3" stroke-linecap="round"><path d="M40 9v7m0 48v7M9 40h7m48 0h7M18 18l5 5m34 34l5 5M18 62l5-5m34-34l5-5"/></g><circle cx="40" cy="40" r="16" fill="#ffd77d"/>';
  var MOON='<path d="M53 12A28 28 0 1 0 69 54 27 27 0 0 1 53 12" fill="#d4e7ff"/><circle cx="61" cy="23" r="2" fill="#f7eccb"/><circle cx="69" cy="34" r="1.5" fill="#f7eccb"/>';
  var CLOUD='<path class="wx-cloud" d="M20 58h40a13 13 0 0 0 1-26 21 21 0 0 0-39-3 15 15 0 0 0-2 29Z" fill="#ecf4fc" stroke="#93aabd" stroke-width="1.5"/>';
  var DROP='<g class="wx-drops" stroke="#79bfff" stroke-width="3" stroke-linecap="round"><path d="m25 64-3 7m19-7-3 7m19-7-3 7"/></g>';
  var SNOW='<g class="wx-drops" fill="#d8eeff"><circle cx="25" cy="67" r="2.7"/><circle cx="40" cy="72" r="2.7"/><circle cx="55" cy="67" r="2.7"/></g>';
  var TYPES={sun:SUN,moon:MOON,cloud:CLOUD,partly:SUN+CLOUD,nightcloud:MOON+CLOUD,rain:CLOUD+DROP,snow:CLOUD+SNOW,hail:CLOUD+'<g class="wx-drops" fill="#e4efff"><circle cx="24" cy="68" r="2"/><circle cx="39" cy="73" r="2"/><circle cx="55" cy="67" r="2"/></g>',storm:CLOUD+'<path d="m43 46-13 18h10l-4 13 16-21H41l6-10" fill="#ffc45c"/>',fog:CLOUD+'<path d="M13 66h53M20 73h40" stroke="#b9cedb" stroke-width="3" stroke-linecap="round"/>',wind:'<g stroke="#b1d6e8" stroke-width="4" fill="none" stroke-linecap="round"><path d="M9 31h43c18 0 18-22 3-22M9 43h58c11 0 11 15 1 15M18 56h23c13 0 13 16 0 16"/></g>'};
  var CONDITIONS={sunny:"Sonnig",clear:"Klar","clear-night":"Klare Nacht",cloudy:"Bewölkt",partlycloudy:"Wolkig",rainy:"Regen",pouring:"Starker Regen",snowy:"Schnee","snowy-rainy":"Schneeregen",fog:"Nebel",windy:"Windig","windy-variant":"Windig",lightning:"Gewitter","lightning-rainy":"Gewitter",hail:"Hagel",exceptional:"Ungewöhnliches Wetter"};
  function type(condition,day) {
    if (condition === "sunny" || condition === "clear" || condition === "clear-night") {return day === false ? "moon" : "sun";}
    if (condition === "partlycloudy") {return day === false ? "nightcloud" : "partly";}
    if (condition === "rainy" || condition === "pouring") {return "rain";}
    if (condition === "hail") {return "hail";}
    if (condition === "snowy" || condition === "snowy-rainy") {return "snow";}
    if (condition === "lightning" || condition === "lightning-rainy") {return "storm";}
    if (condition === "fog") {return "fog";}
    if (condition === "windy" || condition === "windy-variant") {return "wind";}
    return "cloud";
  }
  function icon(node,condition,day,animated) {
    var key=type(condition,day);
    if (node._wxType !== key) {node.innerHTML=SVG+TYPES[key]+'</svg>';node._wxType=key;}
    var cls="lg-weather-icon"+(animated ? " wx-animated" : "");if (node.className !== cls) {node.className=cls;}
  }
  function mix(a,b,t) {return "rgb("+a.map(function(v,i){return Math.round(v+(b[i]-v)*t);}).join(",")+")";}
  function sky(sun) {
    sun=sun || {};var e=typeof sun.elevation === "number" ? sun.elevation : (sun.is_daytime ? 30 : -18),r=sun.rising;
    var stops=[-18,-6,0,12,40],tops=[[8,16,38],[25,31,66],r?[58,69,105]:[66,43,92],[38,104,151],[36,126,176]],bottoms=[[21,35,61],[79,58,91],r?[226,153,123]:[201,119,135],[159,197,210],[168,216,226]],i=0;
    while(i<stops.length-2 && e>stops[i+1]){i++;}
    var t=Math.max(0,Math.min(1,(e-stops[i])/(stops[i+1]-stops[i]))),x=typeof sun.azimuth === "number" ? Math.round(sun.azimuth/360*80+10) : 65;
    return "radial-gradient(ellipse at "+x+"% "+Math.round(Math.max(15,75-e))+"%,rgba(255,205,155,"+Math.round((Math.max(0,1-Math.abs(e-3)/22)*.2+(e>0?.06:0))*1000)/1000+"),transparent 65%),linear-gradient(160deg,"+mix(tops[i],tops[i+1],t)+","+mix(bottoms[i],bottoms[i+1],t)+")";
  }
  function set(node,value){value=String(value==null?"":value);if(node.textContent!==value){node.textContent=value;}}
  function child(parent,cls){var el=document.createElement("div");el.className=cls;parent.appendChild(el);return el;}
  function period(value,hourly,timezone){
    var date=new Date(value);if(isNaN(date.getTime())){return "";}
    try{return hourly?date.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",timeZone:timezone}):date.toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",timeZone:timezone});}catch(_){return "";}
  }
  function render(node,item,data,options){
    if(!node._weatherIcon){node._weatherIcon=child(node,"lg-weather-icon");}
    if(!node._metrics){node._metrics=child(node,"lg-weather-metrics");}
    var metrics=node._metrics;metrics.style.display=options.glass&&data&&["unknown","unavailable"].indexOf(data.state)<0?"flex":"none";
    if(options.glass){
      if(!metrics.firstChild){
        var wind=child(metrics,"lg-weather-metric"),uv=child(metrics,"lg-weather-metric");
        wind.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h13c6 0 5-7 1-5M3 12h17M3 16h11c6 0 5 7 1 5"/></svg><span><strong></strong><small>Wind</small></span>';
        uv.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="42 9"/><circle cx="12" cy="12" r="3"/></svg><span><strong></strong><small>UV-Index</small></span>';
      }
      var speed=data&&data.wind_speed,index=data&&data.uv_index;
      metrics.children[0].style.display=speed!==undefined&&speed!==''&&isFinite(Number(speed))?"flex":"none";
      metrics.children[1].style.display=index!==undefined&&index!==''&&isFinite(Number(index))?"flex":"none";
      set(metrics.children[0].querySelector('strong'),speed+' '+(data&&data.wind_speed_unit || ''));
      set(metrics.children[1].querySelector('strong'),index);
    }
    var valid=data && data.state!=="unknown" && data.state!=="unavailable",sun=options.sun,day=sun?sun.is_daytime:data && data.state!=="clear-night";
    node._weatherIcon.style.display=valid?"block":"none";
    if(!valid){while(node._list.firstChild){node._list.removeChild(node._list.firstChild);}return;}
    icon(node._weatherIcon,data.state,day,item.animate!==false);
    var mode=item.forecast_type || "daily", forecasts=data.forecasts || {}, entries=(forecasts[mode] || (mode==="daily"?data.forecast:[]) || []).slice(0,item.forecast_count || 4);
    if(mode==="current"){entries=[];}
    var list=node._list;
    for(var i=0;i<entries.length;i++){
      var row=list.children[i],entry=entries[i];
      if(!row || row.className!=="lg-forecast-period"){
        if(row){list.removeChild(row);}
        row=document.createElement("div");row.className="lg-forecast-period";list.insertBefore(row,list.children[i] || null);
        child(row,"lg-period-time");child(row,"lg-weather-icon");child(row,"lg-period-temp");child(row,"lg-period-low");child(row,"lg-period-rain");
      }
      set(row.children[0],period(entry.datetime,mode==="hourly",options.timezone));
      icon(row.children[1],entry.condition,mode==="daily"?true:entry.is_daytime,false);
      set(row.children[2],entry.temperature ? entry.temperature+"°" : "–");
      set(row.children[3],mode==="daily" && entry.templow ? entry.templow+"°" : "");
      set(row.children[4],entry.precipitation_probability!=="" && entry.precipitation_probability!=null ? entry.precipitation_probability+" %" : "");
    }
    while(list.children.length>entries.length){list.removeChild(list.lastChild);}
    if(mode!=="current" && !entries.length){set(node._detail,(CONDITIONS[data.state] || data.state)+" · "+(mode==="hourly"?"Stundenprognose":"Tagesprognose")+" nicht verfügbar");}
  }
  window.LGWeather={sky:sky,render:render,icon:icon};
}());

/* Bounded decorative weather sky. CSS moves a fixed set of layers; no frame loop. */
(function () {
  "use strict";
  var texture=null;
  function cloudTexture(){
    if(texture){return texture;}
    var canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
    var ctx=canvas.getContext('2d');if(!ctx){return '';}
    var image=ctx.createImageData(256,128),grids=[],seed=617,i,x,y,o;
    function random(){seed=(seed*16807)%2147483647;return seed/2147483647;}
    for(o=0;o<5;o++){var n=Math.pow(2,o+2),grid=[];for(i=0;i<(n+1)*(n+1);i++){grid.push(random());}grids.push({n:n,values:grid});}
    for(y=0;y<128;y++){for(x=0;x<256;x++){
      var value=0,weight=0;
      for(o=0;o<5;o++){var g=grids[o],gx=x/256*g.n,gy=y/128*g.n,ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy;
        fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);var p=iy*(g.n+1)+ix,v=g.values,a=Math.pow(.52,o);
        value+=((v[p]*(1-fx)+v[p+1]*fx)*(1-fy)+(v[p+g.n+1]*(1-fx)+v[p+g.n+2]*fx)*fy)*a;weight+=a;
      }
      value/=weight;i=(y*256+x)*4;var shade=Math.round(70+value*145);
      image.data[i]=shade;image.data[i+1]=Math.min(255,shade+7);image.data[i+2]=Math.min(255,shade+14);
      image.data[i+3]=Math.round(Math.max(0,Math.min(1,(value-.29)*3))*Math.max(0,Math.min(1,(1-y/128)*3))*255);
    }}
    ctx.putImageData(image,0,0);texture=canvas.toDataURL('image/png');return texture;
  }
  function child(parent,cls){var node=document.createElement('div');node.className=cls;parent.appendChild(node);return node;}
  function number(value,fallback){var n=Number(value);return value!==''&&value!==null&&value!==undefined&&isFinite(n)?n:fallback;}
  function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
  function condition(data){return data&&['unknown','unavailable'].indexOf(data.state)<0?data.state:'unavailable';}
  function mode(state){return state==='hail'?'hail':state==='snowy'?'snow':state==='snowy-rainy'?'sleet':/rain|pouring/.test(state)?'rain':'none';}
  function skyBackground(sun,data){
    var state=condition(data),e=sun&&sun.elevation,day=sun?sun.is_daytime:state!=='clear-night';
    if(state==='unavailable'){return window.LGWeather.sky(sun);}
    if(['cloudy','rainy','pouring','hail','snowy','snowy-rainy','fog','lightning','lightning-rainy'].indexOf(state)>=0){
      return day?'linear-gradient(175deg,#a9bac9 0%,#637887 36%,#293c4c 100%)':'linear-gradient(170deg,#28384b,#142333 50%,#080f1e)';
    }
    return window.LGWeather.sky(sun || {is_daytime:day,elevation:day?35:-20});
  }
  function Sky(root){
    this.root=root;this.node=child(root,'lg-weather-sky');this.node.setAttribute('aria-hidden','true');
    this.stars=child(this.node,'lg-sky-stars');this.sun=child(this.node,'lg-sky-sun');this.moon=child(this.node,'lg-sky-moon');this.moonShade=child(this.moon,'lg-sky-moon-shade');
    this.clouds=[];for(var i=0;i<3;i++){this.clouds.push(child(this.node,'lg-sky-cloud lg-sky-cloud-'+i));this.clouds[i].style.backgroundImage='url("'+cloudTexture()+'")';}
    this.fog=child(this.node,'lg-sky-fog');this.precip=child(root,'lg-weather-precipitation');this.precip.setAttribute('aria-hidden','true');
    var self=this;this.visibility=function(){self.node.classList.toggle('lg-sky-paused',document.hidden);self.precip.classList.toggle('lg-sky-paused',document.hidden);};
    document.addEventListener('visibilitychange',this.visibility);this.visibility();
  }
  Sky.prototype.update=function(scene,data,sun){
    var state=condition(data),day=sun?sun.is_daytime:state!=='clear-night',motion=scene.weather_animate!==false;
    this.node.setAttribute('data-motion',motion?'on':'off');this.precip.setAttribute('data-motion',motion?'on':'off');this.node.setAttribute('data-condition',state);
    var cloudy=['cloudy','rainy','pouring','hail','snowy','snowy-rainy','fog','lightning','lightning-rainy'].indexOf(state)>=0;
    var coverage=number(data&&data.cloud_coverage,state==='partlycloudy'?48:cloudy?96:state==='unavailable'?0:10)/100;
    for(var i=0;i<3;i++){this.clouds[i].style.opacity=String(clamp(coverage*(i===0?.85:.55),0,1));}
    this.node.setAttribute('data-night',day?'false':'true');this.stars.style.opacity=String(day?0:clamp(1-coverage,0,.85));
    this.fog.style.opacity=state==='fog'?'.85':'0';
    function position(node,body,visible){
      node.style.display=visible&&body&&number(body.elevation,-90)>-.833?'block':'none';
      if(body){node.style.left=clamp(number(body.azimuth,180)/360*100,4,96)+'%';node.style.top=clamp(82-number(body.elevation,0)*.82,7,90)+'%';}
    }
    position(this.sun,sun,day&&!cloudy&&state!=='unavailable');
    var moon=sun&&sun.moon;position(this.moon,moon,!day&&!cloudy&&state!=='unavailable');
    var phase=clamp(number(moon&&moon.phase,.5),0,1),light=(1-Math.cos(phase*Math.PI*2))/2;
    this.moon.style.opacity=String(clamp(light,.06,1));this.moonShade.style.transform='translateX('+((phase<.5?-1:1)*light*100)+'%)';
    var kind=state==='lightning-rainy'?'rain':mode(state),count=kind==='none'?0:kind==='snow'?40:kind==='hail'?48:64;
    if(this.kind!==kind){while(this.precip.firstChild){this.precip.removeChild(this.precip.firstChild);}this.kind=kind;
      for(i=0;i<count;i++){var drop=document.createElement('span');drop.className='lg-sky-drop';var duration=kind==='snow'?8+i%7:kind==='hail'?1.3+(i%7)*.13:1.1+(i%9)*.09;
        drop.style.left=((i*37.17)%100)+'%';drop.style.top=(-20+(i*13.13)%110)+'%';drop.style.animationDuration=duration+'s';drop.style.animationDelay=(-i*.73)+'s';drop.style.opacity=String(.2+(i%7)*.08);this.precip.appendChild(drop);
      }
    }
    this.precip.setAttribute('data-kind',kind);
    var bearing=number(data&&data.wind_bearing,180);this.precip.style.setProperty('--weather-drift',Math.round(-Math.sin(bearing*Math.PI/180)*140)+'px');
  };
  Sky.prototype.close=function(){document.removeEventListener('visibilitychange',this.visibility);this.node.parentNode.removeChild(this.node);this.precip.parentNode.removeChild(this.precip);};
  window.LGWeather.background=skyBackground;window.LGWeather.Sky=Sky;
}());
