/* Local ES5 weather artwork. Only the current symbol animates; forecasts stay still. */
(function () {
  "use strict";
  var SVG='<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
  var SUN='<g class="wx-rays" stroke="#f9cb65" stroke-width="3" stroke-linecap="round"><path d="M40 9v7m0 48v7M9 40h7m48 0h7M18 18l5 5m34 34l5 5M18 62l5-5m34-34l5-5"/></g><circle cx="40" cy="40" r="16" fill="#ffd77d"/>';
  // Low-precision solar/lunar ecliptic coordinates (J2000). Phase is UTC,
  // independent of the weather provider's often stale clear-night string.
  function moon(date) {
    var d=(new Date(date || Date.now()).getTime()/86400000)-10957.5,r=Math.PI/180;
    if(!isFinite(d))d=Date.now()/86400000-10957.5;
    var m=(357.5291+.98560028*d)*r;
    var sun=(280.46646+.98564736*d+1.9148*Math.sin(m)+.0200*Math.sin(2*m)+.0003*Math.sin(3*m))*r;
    var mm=(134.963+13.064993*d)*r,dm=(297.8502+12.19074912*d)*r,f=(93.272+13.229350*d)*r;
    var lon=(218.316+13.176396*d+6.289*Math.sin(mm)+1.274*Math.sin(2*dm-mm)+.658*Math.sin(2*dm)+.214*Math.sin(2*mm)-.186*Math.sin(m)-.114*Math.sin(2*f))*r;
    var lat=5.128*Math.sin(f)*r,phase=((lon-sun)/(2*Math.PI)%1+1)%1;
    return {phase:phase,fraction:(1-Math.cos(lon-sun)*Math.cos(lat))/2};
  }
  function moonArt(value) {
    var fraction=Math.max(0,Math.min(1,value.fraction)),edge=1-2*fraction;
    var disk='<circle cx="40" cy="40" r="26" fill="#23334d"/>';
    if(fraction<.0001)return disk;
    var path='M40 14 A26 26 0 0 1 40 66 '+(Math.abs(edge)<.0001?'L40 14':'A'+Math.abs(edge*26)+' 26 0 0 '+(edge>=0?0:1)+' 40 14')+'Z';
    return disk+'<path d="'+path+'" fill="#d4e7ff"'+(value.phase>.5?' transform="translate(80 0) scale(-1 1)"':'')+'/>';
  }
  var CLOUD='<path class="wx-cloud" d="M20 58h40a13 13 0 0 0 1-26 21 21 0 0 0-39-3 15 15 0 0 0-2 29Z" fill="#ecf4fc" stroke="#93aabd" stroke-width="1.5"/>';
  var DROP='<g class="wx-drops" stroke="#79bfff" stroke-width="3" stroke-linecap="round"><path d="m25 64-3 7m19-7-3 7m19-7-3 7"/></g>';
  var SNOW='<g class="wx-drops" fill="#d8eeff"><circle cx="25" cy="67" r="2.7"/><circle cx="40" cy="72" r="2.7"/><circle cx="55" cy="67" r="2.7"/></g>';
  var TYPES={sun:SUN,moon:"",cloud:CLOUD,partly:SUN+CLOUD,nightcloud:CLOUD,rain:CLOUD+DROP,snow:CLOUD+SNOW,hail:CLOUD+SNOW,storm:CLOUD+'<path d="m43 46-13 18h10l-4 13 16-21H41l6-10" fill="#ffc45c"/>',fog:CLOUD+'<path d="M13 66h53M20 73h40" stroke="#b9cedb" stroke-width="3" stroke-linecap="round"/>',wind:'<g stroke="#b1d6e8" stroke-width="4" fill="none" stroke-linecap="round"><path d="M9 31h43c18 0 18-22 3-22M9 43h58c11 0 11 15 1 15M18 56h23c13 0 13 16 0 16"/></g>'};
  var CONDITIONS=/* CONDITIONS_BEGIN */{"sunny":"Sonnig","clear":"Klar","clear-night":"Klare Nacht","cloudy":"Bewölkt","partlycloudy":"Wolkig","rainy":"Regen","pouring":"Starker Regen","snowy":"Schnee","snowy-rainy":"Schneeregen","fog":"Nebel","windy":"Windig","windy-variant":"Windig","lightning":"Gewitter","lightning-rainy":"Gewitter","hail":"Hagel","exceptional":"Ungewöhnliches Wetter"}/* CONDITIONS_END */;
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
  function icon(node,condition,day,animated,date) {
    var key=type(condition,day),value=moon(date),lunar=key==='moon'||key==='nightcloud',cache=key+(lunar?':'+value.phase.toFixed(4)+':'+value.fraction.toFixed(4):'');
    if (node._wxType !== cache) {node.innerHTML=SVG+(lunar?moonArt(value)+(key==='nightcloud'?CLOUD:''):TYPES[key])+'</svg>';node._wxType=cache;}
    if(lunar){node.dataset.moonPhase=value.phase.toFixed(4);node.dataset.moonIllumination=value.fraction.toFixed(4);}else {delete node.dataset.moonPhase;delete node.dataset.moonIllumination;}
    var cls="lg-weather-icon"+(animated ? " wx-animated" : "");if (node.className !== cls) {node.className=cls;}
  }
  function mix(a,b,t) {return "rgb("+a.map(function(v,i){return Math.round(v+(b[i]-v)*t);}).join(",")+")";}
  var skyPalette=/* SKY_PALETTE_BEGIN */{"levels":[-18,-6,0,12,40],"tops":[[8,16,38],[25,31,66],{"rising":[58,69,105],"setting":[66,43,92]},[38,104,151],[36,126,176]],"bottoms":[[21,35,61],[79,58,91],{"rising":[226,153,123],"setting":[201,119,135]},[159,197,210],[168,216,226]]}/* SKY_PALETTE_END */;
  function sky(sun) {
    sun=sun || {};var e=typeof sun.elevation === "number" ? sun.elevation : (sun.is_daytime ? 30 : -18),r=sun.rising;
    function palette(values){return values.map(function(value){return Array.isArray(value)?value:value[r?'rising':'setting'];});}
    var stops=skyPalette.levels,tops=palette(skyPalette.tops),bottoms=palette(skyPalette.bottoms),i=0;
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
  var METRICS=/* WEATHER_METRICS_BEGIN */{"scale":0.22,"gap":0.7,"margin":0.7,"padding_x":0.9,"padding_y":0.65,"radius":1.8,"border":1,"background":"#b5cee2","background_opacity":0.15,"border_color":"#e6f5ff","border_opacity":0.25,"icon_size":1.8,"icon_gap":0.5,"stroke_width":1.6,"value_size":1.25,"label_size":0.7,"line_height":1.22,"label_opacity":0.8,"icons":{"wind":[[[10.0,26.6667],[53.3333,26.6667],[56.8132,26.4062],[59.7656,25.6771],[62.2103,24.5573],[64.1667,23.125],[65.6543,21.4583],[66.6927,19.6354],[67.3014,17.7344],[67.5,15.8333],[67.3079,14.0104],[66.7448,12.3438],[65.8301,10.9115],[64.5833,9.7917],[63.0241,9.0625],[61.1719,8.8021],[59.0462,9.0885],[56.6667,10.0]],[[10.0,40.0],[66.6667,40.0]],[[10.0,53.3333],[46.6667,53.3333],[50.1465,53.5938],[53.099,54.3229],[55.5436,55.4427],[57.5,56.875],[58.9876,58.5417],[60.026,60.3646],[60.6348,62.2656],[60.8333,64.1667],[60.6413,65.9896],[60.0781,67.6562],[59.1634,69.0885],[57.9167,70.2083],[56.3574,70.9375],[54.5052,71.1979],[52.3796,70.9115],[50.0,70.0]]],"uv":[[[66.6667,40.0],[66.4373,43.49],[65.7532,46.9199],[64.626,50.2308],[63.0753,53.3657],[61.1276,56.2707],[58.8165,58.8958],[56.1817,61.1958],[53.2686,63.1313],[50.1272,64.6688],[46.8116,65.782],[43.3788,66.4517],[39.8879,66.6664],[36.3989,66.4224],[32.9719,65.7239],[29.6658,64.5828],[26.5374,63.0189],[23.6407,61.059],[21.0253,58.7369],[18.7363,56.0925],[16.8131,53.1712],[15.2888,50.0234],[14.1896,46.7031],[13.5343,43.2676],[13.3343,39.7758],[13.593,36.2879],[14.3059,32.8638],[15.4608,29.5625],[17.0379,26.4408],[19.0099,23.5523],[21.343,20.9467],[23.9971,18.6689],[26.9264,16.758],[30.0806,15.2469],[33.4054,14.1616],[36.8437,13.5208],[40.3363,13.3355],[43.8231,13.6088],[47.2441,14.3361],[50.5405,15.5049],[53.6556,17.0951]],[[50.0,40.0],[49.6593,42.5882],[48.6603,45.0],[47.0711,47.0711],[45.0,48.6603],[42.5882,49.6593],[40.0,50.0],[37.4118,49.6593],[35.0,48.6603],[32.9289,47.0711],[31.3397,45.0],[30.3407,42.5882],[30.0,40.0],[30.3407,37.4118],[31.3397,35.0],[32.9289,32.9289],[35.0,31.3397],[37.4118,30.3407],[40.0,30.0],[42.5882,30.3407],[45.0,31.3397],[47.0711,32.9289],[48.6603,35.0],[49.6593,37.4118],[50.0,40.0]]]}}/* WEATHER_METRICS_END */;
  function metricNumber(value){return (typeof value==="number" || typeof value==="string" && value.trim()!=="") && isFinite(Number(value));}
  function metricIcon(key){return '<svg viewBox="0 0 80 80" aria-hidden="true">'+METRICS.icons[key].map(function(points){return '<polyline points="'+points.map(function(p){return p.join(',');}).join(' ')+'"/>';}).join('')+'</svg>';}
  function render(node,item,data,options){
    if(!node._weatherIcon){node._weatherIcon=child(node,"lg-weather-icon");}
    if(!node._metrics){node._metrics=child(node,"lg-weather-metrics");}
    var metrics=node._metrics;metrics.style.display=options.glass&&data&&["unknown","unavailable"].indexOf(data.state)<0?"flex":"none";
    if(options.glass){
      if(!metrics.firstChild){
        var wind=child(metrics,"lg-weather-metric"),uv=child(metrics,"lg-weather-metric");
        wind.dataset.metric='wind';wind.innerHTML=metricIcon('wind')+'<span><strong></strong><small>Wind</small></span>';
        uv.dataset.metric='uv';uv.innerHTML=metricIcon('uv')+'<span><strong></strong><small>UV-Index</small></span>';
      }
      var speed=data&&data.wind_speed,index=data&&data.uv_index;
      metrics.children[0].style.display=metricNumber(speed)?"flex":"none";
      metrics.children[1].style.display=metricNumber(index)?"flex":"none";
      set(metrics.children[0].querySelector('strong'),String(Number(speed))+((data&&data.wind_speed_unit)?' '+data.wind_speed_unit:''));
      set(metrics.children[1].querySelector('strong'),Number(index));
    }
    var valid=data && data.state!=="unknown" && data.state!=="unavailable",sun=options.sun,day=sun?sun.is_daytime:data && data.state!=="clear-night";
    node._weatherIcon.style.display=valid?"block":"none";
    if(!valid){while(node._list.firstChild){node._list.removeChild(node._list.firstChild);}return;}
    icon(node._weatherIcon,data.state,day,item.animate!==false,options.now);
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
      icon(row.children[1],entry.condition,mode==="daily"?true:entry.is_daytime,false,entry.datetime);
      set(row.children[2],entry.temperature!=="" && entry.temperature!=null ? entry.temperature+"°" : "–");
      set(row.children[3],mode==="daily" && entry.templow!=="" && entry.templow!=null ? entry.templow+"°" : "");
      set(row.children[4],entry.precipitation_probability!=="" && entry.precipitation_probability!=null ? entry.precipitation_probability+" %" : "");
    }
    while(list.children.length>entries.length){list.removeChild(list.lastChild);}
    if(mode!=="current" && !entries.length){set(node._detail,(CONDITIONS[data.state] || data.state)+" · "+(mode==="hourly"?"Stundenprognose":"Tagesprognose")+" nicht verfügbar");}
  }
  window.LGWeather={moon:moon,moonArt:moonArt,sky:sky,render:render,icon:icon,type:type,conditions:CONDITIONS,metrics:METRICS};
}());

/* Bounded decorative weather sky. CSS moves a fixed set of layers; no frame loop. */
(function () {
  "use strict";
  var EFFECTS=/* SKY_EFFECTS_BEGIN */{"night_brightness":0.64,"day_layers":[0.85,0.55,0.55],"night_layers":[1.05,0.8,0.65],"star_opacity":0.65,"period":12000,"flash":[[0,0],[6000,0],[6080,1],[6300,1],[6410,0.25],[6530,0.9],[6730,0.9],[7300,0],[12000,0]],"bolt":[[68,1],[66.221,4.353],[62,9],[62.642,10.222],[63,11],[61.276,14.373],[58,18],[59.699,18.677],[61,20],[55.532,28.191],[51,32],[52.21,33.998],[53,35],[51.097,40.108],[48,44],[48.799,44.943],[50,46],[44.931,52.154],[42,56],[42.202,57.008],[43,58],[40.468,63.123],[39,67],[37.262,70.113],[33,74],[33.288,75.892],[34,77],[31.053,80.551],[29,84],[26.114,91.612],[25,96]],"branch":[[51,32],[56.353,35.682],[66,39],[65.581,40.74],[65,42],[69.407,45.988],[73,49],[72.433,49.979],[71,51],[75.041,56.167],[82,64]],"strokes":[[2,0.12],[0.9,0.34],[0.32,1]],"viewport":[12,2,64,85],"branch2":[[42,56],[36.56,59.042],[32,61],[33.208,62.859],[34,64],[29.773,65.155],[24,68],[25.1,69.601],[26,71],[17.817,76.393],[12,80]],"ink":"#e5f0ff","meteor":{"delay":[25000,65000],"duration":950,"travel_x":[14,22],"travel_y":[7,13],"tail":5.5,"opacity":0.8,"segments":8},"precipitation":[[1400,2300,1.1,2.1,11,22,0.42,0.78,520,9,8],[6500,11000,4,9.5,0,0,0.6,0.9,1000,0,0],[1500,2400,2.2,4.2,0,0,0.52,0.82,650,8,10]],"transition":{"duration":240000,"precipitation_start":0.55,"precipitation_end":0.95}}/* SKY_EFFECTS_END */;
  var texture=null;
  function atmosphere(night,coverage){
    var darkness=Number(night);
    coverage=clamp(coverage,0,1);var layers=EFFECTS.day_layers.map(function(v,i){return v+(EFFECTS.night_layers[i]-v)*darkness;});
    return {brightness:1+(EFFECTS.night_brightness-1)*darkness,clouds:layers.map(function(value){return clamp(coverage*value,0,1);}),stars:darkness*EFFECTS.star_opacity*Math.pow(1-coverage,2)};
  }
  function lightningArt(){
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round">'+EFFECTS.strokes.map(function(stroke,i){
      var lines='';[EFFECTS.bolt,EFFECTS.branch,EFFECTS.branch2].forEach(function(points,path){
        for(var n=1;n<points.length;n++){var a=points[n-1],b=points[n],taper=(path ? .5 : 1)*(1-.45*(n-1)/(points.length-1));
          lines+='<path d="M'+a.join(' ')+'L'+b.join(' ')+'" stroke-width="'+(stroke[0]*taper)+'"/>';
        }
      });
      return '<g stroke="'+EFFECTS.ink+'" opacity="'+stroke[1]+'">'+lines+'</g>';
    }).join('')+'</g></svg>';
  }
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
  function condition(data){var state=data&&data.state;return typeof state==='string'&&state.trim()&&['unknown','unavailable'].indexOf(state)<0?state:'unavailable';}
  function mode(state){return state==='hail'?'hail':state==='snowy'?'snow':state==='snowy-rainy'?'sleet':/rain|pouring/.test(state)?'rain':'none';}
  function resolveWeather(scene,values,now){
    var source=values[scene.weather_entity]||{},data={},key;
    for(key in source)if(Object.prototype.hasOwnProperty.call(source,key))data[key]=source[key];
    if(scene.weather_condition && scene.weather_condition!=='auto'){data.state=scene.weather_condition;delete data.cloud_coverage;}
    var mode=scene.weather_precipitation_mode,rate=null,value,unit,row,at,neighbor,other,i;
    source=values[scene.weather_precipitation_entity||scene.weather_entity]||{};
    if(mode==='sensor'){
      unit=source.unit||source.unit_of_measurement;value=number(source.state,-1);
      if(typeof source.state!=='boolean' && value>=0 && (unit==='mm/h'||unit==='in/h'))rate=value*(unit==='in/h'?25.4:1);
    }else if(mode==='hourly' && !source.stale && source.state!=='unknown' && source.state!=='unavailable'){
      unit=source.precipitation_unit;var rows=(source.forecasts||{}).hourly||[];now=now==null?Date.now()/1000:now;
      if(unit==='mm'||unit==='in')for(i=0;i<rows.length;i++){
        row=rows[i];at=typeof row.datetime==='string'&&/(Z|[+-]\d\d:\d\d)$/i.test(row.datetime)?Date.parse(row.datetime)/1000:NaN;
        if(!(at<=now && now<at+3600))continue;
        other=rows[i+1]||rows[i-1];neighbor=other&&typeof other.datetime==='string'&&/(Z|[+-]\d\d:\d\d)$/i.test(other.datetime)?Date.parse(other.datetime)/1000:NaN;
        value=number(row.precipitation,-1);
        if(typeof row.precipitation!=='boolean' && isFinite(neighbor) && Math.abs(Math.abs(neighbor-at)-3600)<=1 && value>=0)rate=value*(unit==='in'?25.4:1);
        break;
      }
    }
    if(rate!==null){data.rain_rate=Math.round(Math.min(500,rate)*10000)/10000;data.rain_rate_source=mode;}
    return data;
  }
  function weatherLook(data,sun){
    var state=condition(data),day=sun?sun.is_daytime:state!=='clear-night';
    var kind=state==='lightning-rainy'||state==='drizzle'?'rain':mode(state),rate=data&&data.rain_rate;
    var intensity=state==='drizzle'?.28:state==='pouring'?1.35:1;
    if(rate!=null)intensity=rate===0?0:clamp(Math.log(1+rate)/Math.log(5),.18,1.5);
    var drizzle=state==='drizzle'||(kind==='rain'&&rate>0&&rate<=.5);
    var darkness=clamp((6-number(sun&&sun.elevation,day?30:-18))/18,0,1);
    var wet=state.indexOf('lightning')===0?.32:state==='pouring'?.26:drizzle?.09:kind!=='none'?.18:0;
    var temp=data&&typeof data.temperature==='boolean'?NaN:number(data&&data.temperature,NaN),unit=data&&data.temperature_unit;if(unit==='°F')temp=(temp-32)*5/9;else if(unit!=='°C')temp=NaN;
    return {kind:kind,intensity:intensity,drizzle:drizzle,darkness:darkness,wetness:wet,temperature:isFinite(temp)&&temp>=-120&&temp<=80?temp:null};
  }
  function skyBackground(sun,data){
    var state=condition(data),e=sun&&sun.elevation,day=sun?sun.is_daytime:state!=='clear-night';
    if(state==='unavailable'){return window.LGWeather.sky(sun);}
    if(['cloudy','drizzle','rainy','pouring','hail','snowy','snowy-rainy','fog','lightning','lightning-rainy'].indexOf(state)>=0){
      var look=weatherLook(data,sun),d=look.darkness,wet=look.wetness;
      function mix(a,b){return '#'+a.map(function(v,i){var hex=Math.round((v*(1-d)+b[i]*d)*(1-wet)).toString(16);return hex.length<2?'0'+hex:hex;}).join('');}
      return 'linear-gradient('+(175-5*d)+'deg,'+mix([169,186,201],[40,56,75])+' 0%,'+mix([99,120,135],[20,35,51])+' '+((.36+.14*d)*100)+'%,'+mix([41,60,76],[8,15,30])+' 100%)';
    }
    return window.LGWeather.sky(sun || {is_daytime:day,elevation:day?35:-20});
  }
  // Shared with weather_precipitation.h; tested numerically across runtimes.
  // Rounded-edge contacts are prepared on layout/scroll changes, never per frame.
  function contact(ax,ay,bx,by,b){
    var hit={t:2,x:0,y:0,nx:0,ny:-1},dx=bx-ax,dy=by-ay,r=Math.max(0,Math.min(b.r,b.w/2,b.h/2));
    if(Math.max(ax,bx)<b.x||Math.min(ax,bx)>b.x+b.w||Math.max(ay,by)<b.y||Math.min(ay,by)>b.y+b.h)return hit;
    function accept(t,nx,ny){if(t>=0&&t<=1&&t<hit.t&&dx*nx+dy*ny<0)hit={t:t,x:ax+dx*t,y:ay+dy*t,nx:nx,ny:ny};}
    var side,t,x,y,sx,sy,cx,cy,ox,oy,a,bb,c,disc,px,py;
    if(b.profile&&b.profile.length){
      var step=b.w/Math.max(1,b.profile.length-1),first=Math.max(0,Math.floor((Math.min(ax,bx)-b.x)/step)),last=Math.min(b.profile.length-2,Math.ceil((Math.max(ax,bx)-b.x)/step));
      for(var i=first;i<=last;i++){if(b.profile[i]<0||b.profile[i+1]<0)continue;var rise=b.profile[i+1]-b.profile[i],den=dy*step-dx*rise;if(den<=.00001)continue;
        var t=((b.y+b.profile[i]-ay)*step-(b.x+i*step-ax)*rise)/den,u=(ax+dx*t-b.x-i*step)/step;
        if(u>=0&&u<=1){var len=Math.sqrt(rise*rise+step*step);accept(t,rise/len,-step/len);}}
      return hit;
    }
    if(Math.abs(dy)>.00001)for(side=0;side<2;side++){t=(b.y+side*b.h-ay)/dy;x=ax+dx*t;if(x>=b.x+r&&x<=b.x+b.w-r)accept(t,0,side?1:-1);}
    if(Math.abs(dx)>.00001)for(side=0;side<2;side++){t=(b.x+side*b.w-ax)/dx;y=ay+dy*t;if(y>=b.y+r&&y<=b.y+b.h-r)accept(t,side?1:-1,0);}
    if(r>0)for(sx=-1;sx<=1;sx+=2)for(sy=-1;sy<=1;sy+=2){
      cx=b.x+(sx<0?r:b.w-r);cy=b.y+(sy<0?r:b.h-r);ox=ax-cx;oy=ay-cy;
      a=dx*dx+dy*dy;bb=2*(ox*dx+oy*dy);c=ox*ox+oy*oy-r*r;disc=bb*bb-4*a*c;
      if(a<=0||disc<0)continue;t=(-bb-Math.sqrt(disc))/(2*a);px=ax+dx*t-cx;py=ay+dy*t-cy;
      if(px*sx>=-.001&&py*sy>=-.001)accept(t,px/r,py/r);
    }
    return hit;
  }
  function Particle(i,type,w,h,wind,obstacles,floor,cycle,strength,drizzle){
    var s=EFFECTS.precipitation[type],depth=((i*37+11)%97)/96;
    this.kind=type;this.index=i;this.height=h;this.scale=Math.min(w/1024,h/600);
    this.size=Math.max(.65,(s[2]+(s[3]-s[2])*depth)*this.scale);
    this.length=type===0?(s[4]+(s[5]-s[4])*depth)*this.scale:this.size;
    this.alpha=s[6]+(s[7]-s[6])*depth;this.fall_ms=s[0]+(s[1]-s[0])*(1-depth);
    strength=strength==null?1:strength;this.snowStrength=strength;
    this.alpha*=clamp(.7+.3*strength,.7,1.15);
    this.fine=type===0&&drizzle;if(this.fine){this.size*=.7;this.length*=.28;this.fall_ms*=2.8;this.alpha=.72+.22*depth;}
    this.impact_ms=s[8];this.spread=(s[9]+depth*5)*this.scale;this.bounce=(s[10]+depth*8)*this.scale;
    this.x0=(4+(i*61+17)%92)*w/100;this.drift=wind*w/1024*(.65+depth*.35);
    {var generation=cycle||0,seed=((i+1)*48271+(generation+1)*69621)%2147483646+1;seed=seed*16807%2147483647;this.x0=((i*5+generation*7)%12+.1+.8*seed/2147483647)*w/12-this.drift*.5;}
    this.behind_widgets=this.fine||(type!==2&&((i*7+(cycle||0)*11)%20)<7);
    this.companions=[];if(type===1||this.fine){
      for(var k=0;k<8;k++){var seed=((i+1)*48271+((cycle||0)+1)*69621+(k+1)*7919)%2147483646+1;seed=seed*16807%2147483647;seed=seed*48271%2147483647;var a=seed/2147483647;seed=seed*48271%2147483647;var b=seed/2147483647;this.companions.push([(a-.5)*40*this.scale,(b-.5)*56*this.scale,.6+.3*a]);}
    }
    this.sway=(8+depth*18)*this.scale;this.phase=i*1.73;this.land=1;this.hit=false;
    var previous=this.path(0),next,near,candidate,t,step,j;
    for(step=1;step<=24&&!this.hit;step++){
      next=this.path(step/24);near={t:2};
      for(j=0;!this.behind_widgets&&j<obstacles.length;j++){candidate=contact(previous[0],previous[1],next[0],next[1],obstacles[j]);if(candidate.t<near.t)near=candidate;}
      if(floor&&previous[1]<h-1&&next[1]>=h-1){t=(h-1-previous[1])/(next[1]-previous[1]);if(t<near.t)near={t:t,x:previous[0]+(next[0]-previous[0])*t,y:h-1,nx:0,ny:-1};}
      if(near.t<=1){this.hit=true;this.land=(step-1+near.t)/24;this.contact=near;}
      previous=next;
    }
    this.duration=this.fall_ms+this.impact_ms;this.impact_at=this.hit?this.fall_ms*this.land/this.duration:1;
  }
  Particle.prototype.path=function(f){return [this.x0+this.drift*f+(this.kind===1?this.sway*(Math.sin(f*6.2831853+this.phase)-Math.sin(this.phase)):0),-this.length+(this.height+this.length*3)*(this.kind===2?.65*f+.35*f*f:f)];};
  Particle.prototype.marks=function(p){
    var out=[],i;for(i=0;i<9;i++)out.push({x:0,y:0,w:1,h:1,angle:0,alpha:0});var time=p*this.duration,flight=this.fall_ms*this.land,j,x,y,angle,sx,cy,along;
    if(!this.hit||time<flight){
      var point=this.path(time/this.fall_ms);x=point[0];y=point[1];
      if(this.fine){for(j=0;j<9;j++){var dx=j?this.companions[j-1][0]:0,dy=j?this.companions[j-1][1]:0,depth=j?this.companions[j-1][2]:1;
        out[j]={x:x+dx,y:y+dy,w:this.size*(.85+.15*depth),h:Math.max(this.size,this.length*.65)*depth,angle:-Math.atan2(this.drift,this.height),alpha:this.alpha*(.7+.3*depth)};}}
      else if(this.kind===0){angle=-Math.atan2(this.drift,this.height+this.length*3);sx=Math.sin(angle);cy=Math.cos(angle);
        for(j=0;j<3;j++){along=this.length*(j+.5)/3;out[j]={x:x+sx*along,y:y-cy*along,w:this.size*(1-.2*j),h:this.length/3+1,angle:angle,alpha:this.alpha*(1-.3*j)};}
        out[3]={x:x,y:y,w:this.size*1.25,h:this.size*2.1,angle:angle,alpha:this.alpha};
      }else if(this.kind===1){out[0]={x:x,y:y,w:this.size,h:this.size,angle:0,alpha:this.alpha};
        for(j=0;j<(this.snowStrength<.4?3:this.snowStrength<1.2?5:8);j++){var c=this.companions[j],diameter=Math.max(.9,this.size*c[2]);out[j+1]={x:x+c[0],y:y+c[1],w:diameter,h:diameter,angle:0,alpha:this.alpha*(.8+.2*c[2])};}
      }else{out[0]={x:x,y:y,w:this.size,h:this.size,angle:0,alpha:this.alpha};out[1]={x:x-this.size*.12,y:y-this.size*.15,w:this.size*.55,h:this.size*.55,angle:0,alpha:this.alpha};}
      return out;
    }
    if(this.fine)return out;
    var q=Math.max(0,Math.min(1,(time-flight)/this.impact_ms)),c=this.contact,tx=-c.ny,ty=c.nx,self=this;
    function mark(i,a,n,w,h,opacity){out[i]={x:c.x+tx*a+c.nx*n,y:c.y+ty*a+c.ny*n,w:w,h:h,angle:Math.atan2(ty,tx),alpha:self.alpha*opacity};}
    if(this.kind===0)for(j=0;j<3;j++){var variation=.65+.7*((this.index*17+j*31)%41)/40,direction=j-1;mark(j,direction*this.spread*q*variation,1+this.bounce*(1-.2*Math.abs(direction))*variation*4*q*(1-q),Math.max(1.4*this.scale,this.size),Math.max(1.8*this.scale,this.size*1.4),Math.min(1,(1-q)*1.8));}
    else if(this.kind===1)mark(0,0,this.size*.26*(1-q),this.size*(1+.7*q),Math.max(.6,this.size*(.5-.3*q)),(1-q)*.65);
    else{var v=q<.64?q/.64:(q-.64)/.36,arc=this.bounce*(q<.64?1:.32)*4*v*(1-v);mark(0,(this.index%2?1:-1)*this.spread*q,this.size*.5+arc,this.size,this.size,Math.min(1,(1-q)*4));out[1]={x:out[0].x-this.size*.12,y:out[0].y-this.size*.15,w:this.size*.45,h:this.size*.45,angle:out[0].angle,alpha:out[0].alpha*.55};}
    return out;
  };
  function Accumulation(){this.deposits=[];}
  Accumulation.prototype.configure=function(enabled,floor,width,height,obstacles){
    if(!enabled&&!this.enabled)return false;
    var key=JSON.stringify([enabled,floor,width,height,obstacles]);if(key===this.key)return false;
    var kept=[],old=this.obstacles||[];
    if(enabled&&this.enabled&&width===this.width&&height===this.height)this.deposits.forEach(function(p){
      if(p.surface<0){if(floor)kept.push(p);return;}var before=old[p.surface];if(!before)return;
      for(var i=0;i<obstacles.length;i++){var b=obstacles[i];if(JSON.stringify(before)===JSON.stringify(b)||(before.key&&before.key===b.key)){p.surface=i;Accumulation.shape(p,b,width,height);kept.push(p);break;}}
    });
    this.key=key;this.enabled=enabled;this.floor=floor;this.width=width;this.height=height;this.obstacles=obstacles;this.deposits=kept;this.textPrepared=false;return true;
  };
  Accumulation.prototype.prepareText=function(){
    if(!this.enabled||this.textPrepared)return;this.textPrepared=true;
    for(var i=0;i<this.obstacles.length;i++){var b=this.obstacles[i];if(!b.profile||!b.profile.length)continue;var valid=0,open=0;
      for(var sample=0;sample<32;sample++){var x=(sample+.5)*b.w/32,top=edgeTop(b,x);if(top<0)continue;valid++;var covered=false;
        for(var j=0;j<this.obstacles.length;j++)if(j!==i){var upper=this.obstacles[j];if(upper.y>=b.y+top)continue;if(contact(b.x+x,-1,b.x+x,b.y+top-.5,upper).t<=1){covered=true;break;}}
        if(!covered)open++;
      }
      var exposure=valid?open/valid:0,at=0;for(;at<this.deposits.length;at++)if(this.deposits[at].surface===i)break;
      if(at===this.deposits.length){if(exposure<=0||this.deposits.length>=65)continue;var bumps=[];for(var k=0;k<32;k++)bumps.push(0);var p={surface:i,kind:1,amount:0,runoff:0,runoff_events:0,bumps:bumps};Accumulation.shape(p,b,this.width,this.height);this.deposits.push(p);}
      this.deposits[at].exposure=exposure;
    }
  };
  Accumulation.settleText=function(p,intensity,seconds){
    if(!p.profile||!p.profile.length||intensity<=0||seconds<=0||!(p.exposure>0))return false;
    var before=p.amount;p.amount=Math.min(1,p.amount+(.004+.012*Math.min(1.5,intensity))*Math.sqrt(p.exposure)*Math.min(seconds,30));p.kind=1;return p.amount!==before;
  };
  function edgeTop(b,at){if(!b.profile||!b.profile.length)return 0;var q=clamp(at,0,b.w)*(b.profile.length-1)/Math.max(1,b.w),i=Math.min(b.profile.length-1,Math.floor(q)),j=Math.min(b.profile.length-1,i+1);return b.profile[i]<0||b.profile[j]<0?-1:b.profile[i]+(b.profile[j]-b.profile[i])*(q-i);}
  Accumulation.shape=function(p,b,width,height){var scale=Math.max(.25,Math.min(width/1024,height/600));p.corner=b.r;p.profile=b.profile||[];p.x=b.x+b.w/2;p.y=b.y;p.w=b.w-b.r*.36;p.lip=p.profile.length?Math.max.apply(null,p.profile):b.r*(1-Math.sqrt(1-.82*.82));p.h=20*(p.profile.length?Math.min(scale,Math.max(.15,b.h/70)):scale)+p.lip;};
  Accumulation.prototype.land=function(c,kind,scroll){
    if(!this.enabled||kind===0||c.ny>-.35)return -1;
    var surface=-2,left=0,right=this.width,y=c.y+scroll,corner=0,i,b;
    if(this.floor&&Math.abs(c.y-(this.height-1))<1){surface=-1;y=this.height-1;}
    else for(i=0;i<this.obstacles.length;i++){b=this.obstacles[i];var offset=Math.min(c.x-b.x,b.x+b.w-c.x),r=b.r;
      if(offset<0)continue;var sag=b.profile&&b.profile.length?edgeTop(b,c.x-b.x):offset<r?r-Math.sqrt(Math.max(0,r*r-(r-offset)*(r-offset))):0;if(sag<0)continue;
      if(Math.abs(y-b.y-sag)<1.5){surface=i;corner=r;left=b.x+r*.18;right=b.x+b.w-r*.18;y=b.y;break;}}
    if(surface===-2||right-left<2)return -1;
    var index=0;for(;index<this.deposits.length;index++)if(this.deposits[index].surface===surface)break;
    if(index===this.deposits.length){
      if(index>=65)return -1;var scale=Math.max(.25,Math.min(this.width/1024,this.height/600)),bumps=[];for(i=0;i<32;i++)bumps.push(0);
      var lip=corner*(1-Math.sqrt(1-.82*.82));this.deposits.push({x:(left+right)/2,y:y,w:right-left,h:20*scale+lip,surface:surface,kind:kind,amount:0,bumps:bumps,corner:corner,lip:lip,runoff_events:0});if(surface>=0)Accumulation.shape(this.deposits[index],this.obstacles[surface],this.width,this.height);
    }
    var p=this.deposits[index],before=p.amount;p.amount=Math.min(1,p.amount+clamp(24/p.w,.018,.09));if(kind===1)p.kind=1;
    var cell=clamp(Math.floor((c.x-left)/p.w*31),0,31),changed=before!==p.amount;
    for(i=Math.max(0,cell-2);i<=Math.min(31,cell+2);i++){var old=p.bumps[i];p.bumps[i]=Math.min(1,old+.16*(3-Math.abs(i-cell)));changed=changed||old!==p.bumps[i];}
    return changed?index:-1;
  };
  Accumulation.melt=function(p,temp,seconds){
    if(temp==null||!isFinite(temp)||temp<=0||p.amount<=0||seconds<=0)return false;
    var old=p.amount,loss=Math.min(.02,temp*.001)*Math.min(seconds,30);p.amount=Math.max(0,old-loss);
    var scale=old>0?p.amount/old:0;p.bumps=p.bumps.map(function(v){return v*scale;});return p.amount!==old;
  };
  Accumulation.drift=function(x){
    var i=Math.floor(x),f=x-i,t=f*f*(3-2*f);
    function sample(n){var h=((n+4096)*1597334677)>>>0;h^=h>>>16;return (h&65535)/65535;}
    return sample(i)+(sample(i+1)-sample(i))*t;
  };
  Accumulation.column=function(p,x){
    var u=x/127,cell=u*31,i=Math.min(30,Math.floor(cell)),f=cell-i,t=f*f*(3-2*f),local=p.bumps[i]+(p.bumps[i+1]-p.bumps[i])*t;
    var scale=(p.h-p.lip)/20,q=u*p.w/scale,phase=p.surface*7.31,edge=clamp(Math.min(q,p.w/scale-q)/7,0,1),taper=p.surface<0?1:Math.sqrt(edge*(2-edge));
    var cap=Math.pow(p.amount,p.profile&&p.profile.length?.45:.65)*(4.5+5*Accumulation.drift(q/52+phase)+2.5*Accumulation.drift(q/19+phase*1.7)+2.3*local)*taper;return p.profile&&p.profile.length?Math.min(18.5,cap*1.3):cap;
  };
  Accumulation.baseline=function(p,x){
    if(p.profile&&p.profile.length){var q=x/127*(p.profile.length-1),i=Math.min(p.profile.length-1,Math.floor(q)),j=Math.min(p.profile.length-1,i+1);if(p.profile[i]<0||p.profile[j]<0)return -1;return 20+(p.profile[i]+(p.profile[j]-p.profile[i])*(q-i))/((p.h-p.lip)/20);}

    var offset=Math.min(x/127,1-x/127)*p.w+p.corner*.18,r=p.corner,sag=offset<r?r-Math.sqrt(Math.max(0,r*r-(r-offset)*(r-offset))):0;
    return 20+sag/((p.h-p.lip)/20);
  };
  Accumulation.random=function(seed){var h=(seed*1597334677)>>>0;h^=h>>>16;return (h&65535)/65535;};
  Accumulation.runoffLimit=function(p){return .009+.024*Accumulation.random(p.runoff_events+(p.surface+2)*257);};
  Accumulation.runoffLeft=function(p){return Accumulation.random(p.runoff_events+(p.surface+2)*719)>.5;};
  Accumulation.runoffDuration=function(p){return 1400+Math.floor(500*Accumulation.random(p.runoff_events+(p.surface+2)*1201));};
  Accumulation.pixel=function(p,x,y,depth,base){
    if(base==null)base=Accumulation.baseline(p,x);if(base<0)return [0,0,0,0];
    var alpha=clamp(y+.5-(base-depth),0,1)*clamp(base-y+.5,0,1)*Math.min(1,p.amount*(p.profile&&p.profile.length?10:5)),shade=clamp((y-(base-depth))/Math.max(1,depth),0,1);
    var grain=p.kind===2?.55+.45*Math.abs(Math.sin(x*1.6+y*2.1)):1;
    return [Math.round(251-18*shade*shade),Math.round(252-15*shade*shade),Math.round(255-9*shade*shade),Math.round(alpha*grain*255)];
  };
  Accumulation.meltPixel=function(x,y,roundness){
    var covered=0;for(var sy=0;sy<4;sy++)for(var sx=0;sx<4;sx++){
      var px=x+(sx+.5)/4-4.5,py=y+(sy+.5)/4,radius=0;
      if(py>=1&&py<=10.3)radius=3.8*Math.pow((py-1)/9.3,1.4);
      else if(py>10.3&&py<15)radius=3.8*Math.sqrt(Math.max(0,1-Math.pow((py-10.3)/4.7,2)));
      var round=3.8*Math.sqrt(Math.max(0,1-Math.pow((py-8)/7,2)));radius+=clamp(roundness||0,0,1)*(round-radius);
      if(Math.abs(px)<radius)covered++;
    }
    var shine=Math.max(0,1-Math.pow((x-3)/1.6,2)-Math.pow((y-9)/3,2));
    return [Math.round(178+70*shine),Math.round(218+34*shine),Math.round(241+14*shine),Math.round(covered*255/16)];
  };
  Sky.prototype.paintDeposit=function(index){
    var p=this.accumulation.deposits[index],node=this.depositNodes[index];
    if(p.amount<=0){if(node&&node.parentNode)node.parentNode.removeChild(node);this.depositNodes[index]=null;return;}
    if(!node){node=document.createElement('canvas');node.className='lg-weather-deposit';node.width=Math.ceil(p.w);node.height=Math.ceil(p.h);(p.surface<0?this.settled:this.settledWorld).appendChild(node);this.depositNodes[index]=node;node._pixels=node.getContext('2d').createImageData(node.width,node.height);}
    var drawKey=JSON.stringify([p.x,p.y,p.w,p.h,p.kind,p.amount,p.bumps,p.corner,p.lip,p.profile]);if(node._depositKey===drawKey)return;node._depositKey=drawKey;
    var s=node.style;s.position='absolute';s.pointerEvents='none';s.left=(p.x-p.w/2)+'px';s.top=(p.y-p.h+p.lip)+'px';s.width=p.w+'px';s.height=p.h+'px';
    for(var x=0;x<node.width;x++){var tx=x*127/Math.max(1,node.width-1),depth=Accumulation.column(p,tx),base=Accumulation.baseline(p,tx);for(var y=0;y<node.height;y++){var ty=(y+.5)*20/(p.h-p.lip)-.5,c=Accumulation.pixel(p,tx,ty,depth,base),offset=(y*node.width+x)*4;for(var k=0;k<4;k++)node._pixels.data[offset+k]=c[k];}}
    node.getContext('2d').putImageData(node._pixels,0,0);
  };
  function Runoff(b,surface,left,height,obstacles){
    this.left=left;this.r=Math.min(b.r,b.w/2,b.h/2);this.cx=left?b.x+this.r:b.x+b.w-this.r;this.cy=b.y+this.r;
    this.x=left?b.x-4:b.x+b.w+4;this.y=this.cy+7;
    if(b.profile&&b.profile.length){var top=edgeTop(b,left?b.w*.18:b.w*.82);this.x=b.x+(left?b.w*.18:b.w*.82);this.y=b.y+Math.max(0,top)+7;this.cx=this.x;this.cy=this.y-7;this.r=0;}
    this.x=this.cx+(left?-1:1)*(this.r+2);this.y=this.cy+3;
    this.hit={t:1,x:this.x,y:height-1,nx:0,ny:-1};
    for(var i=0;i<obstacles.length;i++)if(i!==surface){var c=contact(this.x,this.y,this.x,height-1,obstacles[i]);if(c.t<this.hit.t)this.hit=c;}
    this.travel=Math.max(0,this.hit.y-this.y);
  }
  Runoff.form=function(p){return p<.3?0:Math.min(3,1+Math.floor((p-.3)/.06));};
  Runoff.prototype.marks=function(p){var out=[{x:0,y:0,w:1,h:1,angle:0,alpha:0},{x:0,y:0,w:1,h:1,angle:0,alpha:0},{x:0,y:0,w:1,h:1,angle:0,alpha:0}],t,angle;
    if(p<.3){t=p/.3;angle=-1.570796327+(this.left?-1:1)*t*1.570796327;out[0]={x:this.cx+(this.r+2)*Math.cos(angle),y:this.cy+(this.r+2)*Math.sin(angle)+3,w:5+3*t,h:3+11*t,angle:0,alpha:.85+.1*t};}
    else if(p<.82){t=(p-.3)/.52;var settle=Math.min(1,t*4);out[0]={x:this.x,y:this.y+this.travel*t*t,w:8+1.5*settle,h:14-4*settle,angle:0,alpha:.95};}
    else{t=clamp((p-.82)/.18,0,1);for(var i=0;i<3;i++){var side=i-1;out[i]={x:this.hit.x+side*(4+13*t),y:this.hit.y-2-Math.max(0,18-4*Math.abs(side))*4*t*(1-t),w:2.5,h:3.5,angle:0,alpha:(1-t)*.8};}}
    return out;
  };
  var runoffSerial=0;
  Sky.prototype.meltDrop=function(p){
    if(p.surface<0||!this.obstacles[p.surface]||this.settledWorld.querySelectorAll('.lg-snow-melt-drop').length>=4)return;
    var scroll=this.scroll||0,world=this.obstacles.map(function(b){return Object.assign({},b,{y:b.y+scroll});}),path=new Runoff(world[p.surface],p.surface,Accumulation.runoffLeft(p),this.root.clientHeight+scroll,world);
    var group=child(this.settledWorld,'lg-runoff'),sheet=document.createElement('style'),css='',serial=++runoffSerial,duration=Accumulation.runoffDuration(p);
    for(var k=0;k<3;k++)for(var form=k?3:0;form<4;form++){
      var node=document.createElement('canvas');node.className=k?'lg-snow-melt-splash':form?'lg-snow-melt-form':'lg-snow-melt-drop';node.width=9;node.height=16;group.appendChild(node);
      if(!this.meltPixels)this.meltPixels=[];if(!this.meltPixels[form]){this.meltPixels[form]=node.getContext('2d').createImageData(9,16);for(var py=0;py<16;py++)for(var px=0;px<9;px++){var c=Accumulation.meltPixel(px,py,form/3);for(var j=0;j<4;j++)this.meltPixels[form].data[(py*9+px)*4+j]=c[j];}}
      node.getContext('2d').putImageData(this.meltPixels[form],0,0);node.style.cssText='position:absolute;left:0;top:0;width:9px;height:16px;pointer-events:none;transform-origin:0 0';
      var name='lg-runoff-'+serial+'-'+k+'-'+form;css+='@keyframes '+name+'{';
      var phases=[];for(var step=0;step<=50;step++)phases.push(step/50);phases.push(.29999,.3,.35999,.36,.41999,.42,.81999,.82);phases.sort(function(a,b){return a-b;});
      for(var j=0;j<phases.length;j++){var f=phases[j],m=path.marks(f)[k];if(!k&&Runoff.form(f)!==form)m.alpha=0;css+=(f*100).toFixed(4)+'%{opacity:'+m.alpha.toFixed(3)+';transform:translate('+(m.x-m.w/2).toFixed(2)+'px,'+(m.y-m.h/2).toFixed(2)+'px) scale('+(m.w/9).toFixed(3)+','+(m.h/16).toFixed(3)+')}';}css+='}';
      node.style.animation=name+' '+duration+'ms linear both';
      if(k===0&&form===0)node.addEventListener('animationend',function(){if(group.parentNode)group.parentNode.removeChild(group);});
    }
    sheet.textContent=css;group.appendChild(sheet);
  };
  Sky.prototype.setAccumulation=function(){
    var self=this,scroll=this.scroll||0,world=this.obstacles.map(function(b){return {x:b.x,y:b.y+scroll,w:b.w,h:b.h,r:b.r,profile:b.profile||[],key:b.key||""};});
    if(this.accumulation.configure(this.accumulate===true,this.edgeImpact===true,this.root.clientWidth,this.root.clientHeight,world)){this.settled.textContent='';this.settledWorld.textContent='';this.depositNodes=[];}
    if(this.collectingText())this.accumulation.prepareText();
    this.accumulation.deposits.forEach(function(p,i){self.paintDeposit(i);});
    var active=this.accumulate&&this.motion&&(this.falling.some(function(p){return p.particle.kind>0;})||(this.temperature>0&&this.accumulation.deposits.some(function(p){return p.amount>0;})));
    if(!active){clearInterval(this.depositTimer);this.depositTimer=null;return;}
    if(this.depositTimer)return;
    this.depositAt=Date.now();this.depositTimer=setInterval(function(){
      var now=Date.now(),elapsed=Math.min(500,now-self.depositAt);self.depositAt=now;
      if(document.hidden||self.precip.classList.contains('lg-sky-paused')||(self.reduced&&self.reduced.matches)){self.accumulation.deposits.forEach(function(p){p.meltAt=now;});return;}
      self.falling.forEach(function(row){var p=row.particle;row.elapsed+=elapsed;var time=row.elapsed/p.duration,cycle=Math.floor(time),phase=time-cycle;
        if(p.kind===0||!p.hit||row.deposited===cycle||phase<p.impact_at||(self.precipitationOnset&&Number(self.precip.style.opacity)===0))return;
        row.deposited=cycle;var index=self.accumulation.land(p.contact,p.kind,self.scroll||0);if(index>=0)self.paintDeposit(index);
      });
      var banks=self.accumulation.deposits;
      if(banks.length){var p=banks[self.meltIndex++%banks.length],seconds=p.meltAt?(now-p.meltAt)/1000:0;p.meltAt=now;
        var grew=self.collectingText()&&Accumulation.settleText(p,self.intensity,seconds),before=p.amount,melted=Accumulation.melt(p,self.temperature,seconds);
        if(grew||melted)self.paintDeposit((self.meltIndex-1)%banks.length);
        if(melted){p.runoff=(p.runoff||0)+before-p.amount;var limit=Accumulation.runoffLimit(p);if(p.runoff>=limit){p.runoff-=limit;p.runoff_events++;self.meltDrop(p);}}
      }
      if(!self.falling.some(function(p){return p.particle.kind>0;})&&!banks.some(function(p){return p.amount>0;})){clearInterval(self.depositTimer);self.depositTimer=null;}
    },250);
  };
  Sky.prototype.collectingText=function(){return this.accumulate&&this.motion&&(this.kind==='snow'||this.kind==='sleet')&&this.intensity>0&&(!this.precipitationOnset||Number(this.precip.style.opacity)>0);};
  var skySerial=0;
  function Sky(root){
    this.accumulation=new Accumulation();this.depositNodes=[];this.meltIndex=0;this.falling=[];this.scroll=0;this.serial=++skySerial;this.obstacles=[];this.root=root;this.node=child(root,'lg-weather-sky');this.node.setAttribute('aria-hidden','true');
    this.stars=child(this.node,'lg-sky-stars');this.sun=child(this.node,'lg-sky-sun');this.moon=child(this.node,'lg-sky-moon');this.moonShade=child(this.moon,'lg-sky-moon-shade');
    this.meteor=child(this.node,'lg-sky-meteor');this.meteorEnabled=false;this.meteorTimer=null;
    this.clouds=[];for(var i=0;i<3;i++){this.clouds.push(child(this.node,'lg-sky-cloud lg-sky-cloud-'+i));this.clouds[i].style.backgroundImage='url("'+cloudTexture()+'")';}
    this.lightning=child(this.node,'lg-sky-lightning');this.lightning.innerHTML=lightningArt();this.lightning.style.animationDuration=EFFECTS.period+'ms';
    var boltStyle=this.lightning.style;boltStyle.left=EFFECTS.viewport[0]+'%';boltStyle.top=EFFECTS.viewport[1]+'%';boltStyle.width=EFFECTS.viewport[2]+'%';boltStyle.height=EFFECTS.viewport[3]+'%';
    this.fog=child(this.node,'lg-sky-fog');this.precip=child(this.node,'lg-weather-precipitation');this.precip.setAttribute('aria-hidden','true');this.settled=child(this.node,'lg-weather-settled');this.settled.style.pointerEvents='none';this.settled.style.position='absolute';this.settled.style.left='0';this.settled.style.top='0';this.settledWorld=child(this.node,'lg-weather-settled-world');this.settledWorld.style.cssText='position:absolute;left:0;top:0;pointer-events:none';
    var self=this;this.visibility=function(){self.node.classList.toggle('lg-sky-paused',document.hidden);self.precip.classList.toggle('lg-sky-paused',document.hidden);self.scheduleMeteor();};
    this.meteor.addEventListener('animationend',function(){self.meteor.classList.remove('lg-sky-meteor-active');self.scheduleMeteor();});
    this.reduced=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
    if(this.reduced){if(this.reduced.addEventListener){this.reduced.addEventListener('change',this.visibility);}else if(this.reduced.addListener){this.reduced.addListener(this.visibility);}}
    document.addEventListener('visibilitychange',this.visibility);this.visibility();
  }
  Sky.prototype.scheduleMeteor=function(){
    var self=this,m=EFFECTS.meteor;
    if(!this.meteorEnabled||document.hidden||(this.reduced&&this.reduced.matches)){
      if(this.meteorTimer!==null){clearTimeout(this.meteorTimer);this.meteorTimer=null;}
      this.meteor.classList.remove('lg-sky-meteor-active');return;
    }
    if(this.meteorTimer!==null||this.meteor.classList.contains('lg-sky-meteor-active')){return;}
    this.meteorTimer=setTimeout(function(){self.meteorTimer=null;self.launchMeteor();},m.delay[0]+Math.random()*(m.delay[1]-m.delay[0]));
  };
  Sky.prototype.launchMeteor=function(){
    var m=EFFECTS.meteor,w=this.node.clientWidth,h=this.node.clientHeight,sign=Math.random()<.5?-1:1;
    var dx=sign*(m.travel_x[0]+Math.random()*(m.travel_x[1]-m.travel_x[0]))*w/100,dy=(m.travel_y[0]+Math.random()*(m.travel_y[1]-m.travel_y[0]))*h/100;
    var tx=sign*m.tail*w/100,ty=Math.abs(tx/dx)*dy;
    this.meteor.style.left=(sign<0?76-Math.random()*30:24+Math.random()*30)+'%';this.meteor.style.top=(8+Math.random()*18)+'%';
    this.meteor.style.setProperty('--meteor-dx',dx+'px');this.meteor.style.setProperty('--meteor-dy',dy+'px');
    this.meteor.style.animationDuration=m.duration+'ms';
    var paths='',i,a,b;
    for(i=0;i<m.segments;i++){
      a=i/m.segments;b=(i+1)/m.segments;
      var coords=' x1="'+(-tx*(1-a))+'" y1="'+(-ty*(1-a))+'" x2="'+(-tx*(1-b))+'" y2="'+(-ty*(1-b))+'"';
      paths+='<line'+coords+' stroke="#a9cfff" stroke-width="3" opacity="'+m.opacity*(a+b)/2*38/255+'"/><line'+coords+' stroke="#ecf3ff" stroke-width="1" opacity="'+m.opacity*(a+b)/2+'"/>';
    }
    this.meteor.innerHTML='<svg width="1" height="1" style="overflow:visible" xmlns="http://www.w3.org/2000/svg" stroke-linecap="round">'+paths+'</svg>';
    this.meteor.classList.add('lg-sky-meteor-active');
  };
  Sky.prototype.scrollDeposits=function(scroll){this.settledWorld.style.transform='translateY('+(-scroll)+'px)';};
  Sky.prototype.setObstacles=function(obstacles,scroll){this.obstacles=obstacles;this.scroll=scroll||0;this.scrollDeposits(this.scroll);this.precipitation();this.setAccumulation();};
  function precipitationFrames(particle){
    var frames,j;
      // Rain travels linearly; only curved snow/hail paths need intermediate
      // samples. Use all visible flakes and omit unused hail marks.
      var fallSteps=particle.kind===0?1:8;
      frames=[];for(j=0;j<=fallSteps;j++)frames.push(particle.impact_at*j/fallSteps);
      if(particle.hit){
        frames[frames.length-1]=Math.max(0,particle.impact_at-.00001);frames.push(particle.impact_at);
        // Sample the actual impact interval, not the invisible remainder of
        // the cycle. Early widget contacts must keep their spray/bounce detail.
        var impactSpan=particle.impact_ms/particle.duration;
        for(j=1;j<=10;j++)frames.push(Math.min(1,particle.impact_at+impactSpan*j/10));
        if(particle.kind===2)for(j=0;j<3;j++)frames.push(Math.min(1,particle.impact_at+impactSpan*[.32,.64,.82][j]));
        frames.push(1);frames.sort(function(a,b){return a-b;});
      }
    return frames;
  }
  function snowCoverage(x,y,variant){
    var angle=variant*.71,c=Math.cos(angle),s=Math.sin(angle),u=(x*c-y*s)*(variant%2?1.08:.96),v=(x*s+y*c)*(variant%2?.94:1.04);
    var radius=Math.sqrt(u*u+v*v),theta=Math.atan2(v,u)+variant*.83,edge=variant===0?.9:.79+.12*Math.cos(6*theta)+.055*Math.cos(3*theta+.5)+.035*Math.sin(5*theta),a=clamp((edge-radius)/.22,0,1);
    return a*a*(3-2*a);
  }
  var snowTextures=[];
  function snowTexture(variant){
    if(snowTextures[variant])return snowTextures[variant];
    var canvas=document.createElement('canvas');canvas.width=canvas.height=16;
    var ctx=canvas.getContext('2d'),pixels=ctx.createImageData(16,16),x,y,sx,sy,a,i;
    for(y=0;y<16;y++)for(x=0;x<16;x++){a=0;
      for(sy=0;sy<4;sy++)for(sx=0;sx<4;sx++)a+=snowCoverage((x+(sx+.5)/4)/8-1,(y+(sy+.5)/4)/8-1,variant);
      i=(y*16+x)*4;pixels.data[i]=241;pixels.data[i+1]=247;pixels.data[i+2]=252;pixels.data[i+3]=Math.round(a/16*255);
    }
    ctx.putImageData(pixels,0,0);return snowTextures[variant]=canvas.toDataURL();
  }
  function markTransform(particle,mark){
    var base=particle.kind===1?16:1;
    return 'translate('+mark.x.toFixed(2)+'px,'+mark.y.toFixed(2)+'px) rotate('+mark.angle.toFixed(5)+'rad) scale('+(mark.w/base).toFixed(5)+','+(mark.h/base).toFixed(5)+') translate('+(-base/2)+'px,'+(-base/2)+'px)';
  }
  function precipitationRule(name,particle,k){
    var frames=precipitationFrames(particle),css="@keyframes "+name+"{",j,p,mark;
    for(j=0;j<frames.length;j++){p=frames[j];mark=particle.marks(p)[k];css+=(p*100).toFixed(5)+'%{opacity:'+mark.alpha.toFixed(3)+';transform:'+markTransform(particle,mark)+'}';}
    return css+"}";
  }
  Sky.prototype.precipitation=function(){
    var kind=this.kind||'none',w=this.root.clientWidth,h=this.root.clientHeight,impact=this.edgeImpact===true;
    var key=JSON.stringify([kind,w,h,this.wind,impact,this.obstacles,this.intensity,this.drizzle]);if(key===this.precipKey)return;this.precipKey=key;
    var structure=JSON.stringify([kind,w,h,this.wind,impact,this.intensity,this.drizzle]);
    if(structure===this.precipStructure&&this.precipSheet&&this.precipSheet.sheet){
      var sheet=this.precipSheet.sheet,start=0,self=this;
      this.falling.forEach(function(row,index){var old=row.particle,cycle=row.cycle||0,next=new Particle(index,old.kind,w,h,self.wind||0,self.obstacles,impact,cycle,self.intensity,self.drizzle),count=old.fine?9:old.kind===0?4:old.kind===1?(old.snowStrength<.4?4:old.snowStrength<1.2?6:9):2;
        if(next.hit!==old.hit||next.land!==old.land||JSON.stringify(next.contact)!==JSON.stringify(old.contact))for(var k=0;k<count;k++){var name='lg-precip-'+self.serial+'-'+index+'-'+k;sheet.deleteRule(start+k);sheet.insertRule(precipitationRule(name,next,k),start+k);}
        row.particle=next;var node=self.precip.children[index];if(node)node.setAttribute('data-impact',next.hit?'true':'false');start+=count;
      });this.setAccumulation();return;
    }
    this.precipStructure=structure;this.precipSheet=null;
    while(this.precip.firstChild)this.precip.removeChild(this.precip.firstChild);this.falling=[];
    var strength=this.intensity==null?1:this.intensity,snowDensity=strength<=0?0:.25+.75*Math.min(1,strength/1.5);
    var count=Math.round(kind==='snow'?64*snowDensity:(kind==='none'?0:kind==='hail'?48:64)*(this.drizzle?(strength<=0?0:.7+.3*Math.min(1,strength)):Math.min(1,strength))),css='',i,k,mark,particle,name,node,span,ruleIndex=0,sheet;
    for(i=0;i<count;i++){
      particle=new Particle(i,kind==='snow'||(kind==='sleet'&&i%3===2)?1:kind==='hail'?2:0,w,h,this.wind||0,this.obstacles,impact,0,this.intensity,this.drizzle);
      this.falling.push({particle:particle,elapsed:(i*731%10000)/10000*particle.duration,deposited:-1});
      node=child(this.precip,'lg-sky-drop');node.setAttribute('data-impact',particle.hit?'true':'false');
      for(k=0;k<(particle.fine?9:particle.kind===0?4:particle.kind===1?(particle.snowStrength<.4?4:particle.snowStrength<1.2?6:9):2);k++){
        span=child(node,'lg-sky-mark');if(particle.kind===1){span.classList.add('lg-sky-snow');span.style.width=span.style.height='16px';span.style.borderRadius='0';span.style.background='url("'+snowTexture((i+k)%4)+'") center / 100% 100% no-repeat';}name='lg-precip-'+this.serial+'-'+i+'-'+k;css+=precipitationRule(name,particle,k);++ruleIndex;
        span.style.animation=name+' '+particle.duration.toFixed(1)+'ms linear infinite';span.style.animationDelay=(-(i*731%10000)/10000*particle.duration).toFixed(1)+'ms';
        // Static weather keeps a representative frame, rather than placing
        // every particle at the default origin when animation is disabled.
        mark=particle.marks((i*731%10000)/10000)[k];span.style.opacity=String(mark.alpha);span.style.transform=markTransform(particle,mark);
      }
      node.setAttribute('data-cycle','0');
      (function(sky,index,drop,startRule,type,markCount){
        var cycle=0,first=drop.firstChild;
        first.addEventListener('animationiteration',function(event){
          if(event.target!==first || !sheet || !sheet.sheet)return;
          var next=new Particle(index,type,w,h,sky.wind||0,sky.obstacles,impact,++cycle,sky.intensity,sky.drizzle),k,name;
          // Replace the same bounded set of rules. No growing stylesheet, timer or
          // per-frame JS work; collision geometry is renewed between falls.
          for(k=0;k<markCount;k++){name='lg-precip-'+sky.serial+'-'+index+'-'+k;sheet.sheet.deleteRule(startRule+k);sheet.sheet.insertRule(precipitationRule(name,next,k),startRule+k);}
          sky.falling[index].particle=next;sky.falling[index].cycle=cycle;drop.setAttribute('data-cycle',String(cycle));drop.setAttribute('data-impact',next.hit?'true':'false');
        });
      })(this,i,node,ruleIndex-(particle.fine?9:particle.kind===0?4:particle.kind===1?(particle.snowStrength<.4?4:particle.snowStrength<1.2?6:9):2),particle.kind,particle.fine?9:particle.kind===0?4:particle.kind===1?(particle.snowStrength<.4?4:particle.snowStrength<1.2?6:9):2);
    }
    if(css){sheet=document.createElement('style');sheet.textContent=css;this.precip.appendChild(sheet);this.precipSheet=sheet;}
  };
  // Uniform gradual colour changes, not a full-screen composited fade layer.
  // One cheap gradient update per second; the browser retains the latest sky
  // through repeated HA state updates and retargets from its visible colours.
  function skyRecipe(data,sun){
    var css=skyBackground(sun,data),colors=[],match,re=/#([0-9a-f]{6})|rgb\(([^)]+)\)/g;
    while((match=re.exec(css)))colors.push(match[1]?[parseInt(match[1].slice(0,2),16),parseInt(match[1].slice(2,4),16),parseInt(match[1].slice(4,6),16)]:match[2].split(',').map(Number));
    var look=weatherLook(data,sun),dark=look.darkness;
    if(colors.length===2)colors.splice(1,0,colors[0].map(function(v,i){return (v+colors[1][i])/2;}));
    return {colors:colors,angle:colors.length===3 && css.indexOf('radial')<0?175-5*dark:160,mid:css.indexOf('radial')<0?.36+.14*dark:.5,css:css};
  }
  function blendRecipe(a,b,t){return {colors:b.colors.map(function(row,i){return row.map(function(v,j){return a.colors[i][j]+(v-a.colors[i][j])*t;});}),angle:a.angle+(b.angle-a.angle)*t,mid:a.mid+(b.mid-a.mid)*t};}
  function recipeCSS(r){return 'linear-gradient('+r.angle+'deg,'+r.colors.map(function(c,i){return 'rgb('+c.map(Math.round).join(',')+') '+([0,r.mid*100,100][i])+'%';}).join(',')+')';}
  Sky.prototype.background=function(scene,data,sun){
    var self=this,target=skyRecipe(data,sun),key=JSON.stringify(target),now=Date.now();
    if(key===this.backgroundKey)return;
    this.backgroundKey=key;this.root._weatherSky=this;
    if(!this.currentRecipe || scene.weather_animate===false){
      clearInterval(this.backgroundTimer);this.backgroundTimer=null;this.currentRecipe=target;
      this.root.style.background=target.css;this.backgroundDone=now;return;
    }
    if(this.precipitationOnset)this.precipitationFloor=Number(this.precip.style.opacity)||0;
    this.backgroundFrom=this.currentRecipe;this.backgroundTarget=target;
    this.backgroundAt=now;this.backgroundDone=this.backgroundDone>now?this.backgroundDone:now+EFFECTS.transition.duration;
    if(this.backgroundTimer)return;
    this.backgroundTimer=setInterval(function(){
      if(document.hidden || self.closed)return;
      var t=clamp((Date.now()-self.backgroundAt)/(self.backgroundDone-self.backgroundAt),0,1);t=t*t*(3-2*t);
      self.currentRecipe=blendRecipe(self.backgroundFrom,self.backgroundTarget,t);
      self.root.style.background=recipeCSS(self.currentRecipe);self.updatePrecipitationOnset();
      if(t===1){self.root.style.background=self.backgroundTarget.css;clearInterval(self.backgroundTimer);self.backgroundTimer=null;self.activateStorm();}
    },250);
  };
  function precipitationGain(progress){var t=clamp((progress-EFFECTS.transition.precipitation_start)/(EFFECTS.transition.precipitation_end-EFFECTS.transition.precipitation_start),0,1);return t*t*(3-2*t);}
  Sky.prototype.updatePrecipitationOnset=function(){
    var progress=this.backgroundDone>Date.now()?clamp((Date.now()-this.backgroundAt)/(this.backgroundDone-this.backgroundAt),0,1):1;
    this.precip.style.opacity=String(this.precipitationOnset?Math.max(this.precipitationFloor||0,precipitationGain(progress)):1);
    if(progress>=1)this.precipitationOnset=false;
  };
  Sky.prototype.activateStorm=function(){
    var ready=this.node.getAttribute('data-storm')==='true'||Date.now()>=this.backgroundDone;this.node.setAttribute('data-storm',this.stormWanted&&ready?'true':'false');
  };
  Sky.prototype.update=function(scene,data,sun){
    this.background(scene,data,sun);
    var state=condition(data),day=sun?sun.is_daytime:state!=='clear-night',motion=scene.weather_animate!==false;
    this.node.setAttribute('data-motion',motion?'on':'off');this.precip.setAttribute('data-motion',motion?'on':'off');this.node.setAttribute('data-condition',state);
    var cloudy=['cloudy','drizzle','rainy','pouring','hail','snowy','snowy-rainy','fog','lightning','lightning-rainy'].indexOf(state)>=0;
    var coverage=number(data&&data.cloud_coverage,state==='partlycloudy'?48:cloudy?96:state==='unavailable'?0:10)/100;
    this.meteorEnabled=!day&&motion&&state!=='fog'&&coverage<.85;this.scheduleMeteor();
    var weather=weatherLook(data,sun),look=atmosphere(weather.darkness,coverage);look.brightness*=1-weather.wetness;
    for(var i=0;i<3;i++){this.clouds[i].style.transitionDuration=this.appearanceReady&&motion?(EFFECTS.transition.duration/1000)+'s':'0s';this.clouds[i].style.opacity=String(look.clouds[i]);this.clouds[i].style.filter='brightness('+look.brightness+')';}
    this.stars.style.transitionDuration=this.appearanceReady&&motion?(EFFECTS.transition.duration/1000)+'s':'0s';this.appearanceReady=true;this.node.setAttribute('data-night',day?'false':'true');this.stars.style.opacity=String(state==='fog'?0:look.stars);
    if(this.stormState!==state)this.node.setAttribute('data-storm','false');this.stormState=state;this.stormWanted=motion&&(state==='lightning'||state==='lightning-rainy');this.activateStorm();
    var drizzleVeil=weather.drizzle&&weather.intensity>0;this.fog.style.opacity=state==='fog'?'.85':drizzleVeil?String((32-14*weather.darkness)/255):'0';
    this.fog.style.background=drizzleVeil?'rgb(185,195,204)':'';this.fog.style.animation=drizzleVeil?'none':'';
    function position(node,body,visible){
      node.style.display=visible&&body&&number(body.elevation,-90)>-.833?'block':'none';
      if(body){node.style.left=clamp(number(body.azimuth,180)/360*100,4,96)+'%';node.style.top=clamp(82-number(body.elevation,0)*.82,7,90)+'%';}
    }
    position(this.sun,sun,day&&!cloudy&&state!=='unavailable');
    var moon=sun&&sun.moon;position(this.moon,moon,!day&&!cloudy&&state!=='unavailable');
    var phase=clamp(number(moon&&moon.phase,.5),0,1),light=(1-Math.cos(phase*Math.PI*2))/2;
    this.moon.style.opacity=String(clamp(light,.06,1));this.moonShade.style.transform='translateX('+((phase<.5?-1:1)*light*100)+'%)';
    if(!motion||weather.kind==='none'||weather.intensity<=0)this.precipitationOnset=false;
    else if(this.kind!==undefined&&(this.kind==='none'||this.intensity<=0)){this.precipitationOnset=this.backgroundDone>Date.now();this.precipitationFloor=0;}
    this.updatePrecipitationOnset();
    this.kind=weather.kind;this.intensity=weather.intensity;this.drizzle=weather.drizzle;this.precip.setAttribute('data-kind',this.kind);
    this.wind=Math.round(-Math.sin(number(data&&data.wind_bearing,180)*Math.PI/180)*140);this.edgeImpact=scene.weather_impact===true;this.accumulate=scene.weather_accumulation===true;if(!(this.temperature>0)&&weather.temperature>0)this.accumulation.deposits.forEach(function(p){p.meltAt=Date.now();});this.temperature=weather.temperature;this.motion=motion;this.precipitation();this.setAccumulation();
  };
  Sky.prototype.close=function(){this.closed=true;clearInterval(this.depositTimer);clearInterval(this.backgroundTimer);delete this.root._weatherSky;this.meteorEnabled=false;this.scheduleMeteor();document.removeEventListener('visibilitychange',this.visibility);if(this.reduced){if(this.reduced.removeEventListener){this.reduced.removeEventListener('change',this.visibility);}else if(this.reduced.removeListener){this.reduced.removeListener(this.visibility);}}this.node.parentNode.removeChild(this.node);};
  window.LGWeather.precipitationGain=precipitationGain;window.LGWeather.Accumulation=Accumulation;window.LGWeather.Runoff=Runoff;window.LGWeather.resolve=resolveWeather;window.LGWeather.look=weatherLook;window.LGWeather.Particle=Particle;window.LGWeather.snowCoverage=snowCoverage;window.LGWeather.contact=contact;window.LGWeather.atmosphere=atmosphere;window.LGWeather.effects=EFFECTS;window.LGWeather.background=skyBackground;window.LGWeather.Sky=Sky;
}());
