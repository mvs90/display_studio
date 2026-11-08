"""Studio's content boxes and typography for native text/vector widgets.

Coordinates of explicit parts stay relative to their parent group, matching
LGWidgetParts. Defaults mirror the shared CSS and are checked against its DOM.
"""
from functools import lru_cache
import math
from pathlib import Path
from PIL import ImageFont
from .fonts import font_path


@lru_cache(maxsize=192)
def font(size, family='sans', weight=400):
    return ImageFont.truetype(str(font_path(family,weight)), size)


def pixels(value):
    return math.floor(value + .5)


def text_height(text, size, width, line_height, spacing=0, nowrap=False, family="sans", weight=400):
    if not text:
        return 0
    if nowrap:
        return line_height
    face=font(max(4,pixels(size)),family,weight)
    lines=0
    for paragraph in str(text).split('\n'):
        current='';lines+=1
        for word in paragraph.split(' '):
            attempt=current+(' ' if current else '')+word
            if current and face.getlength(attempt)+max(0,len(attempt)-1)*spacing>width:
                lines+=1;current=word
            else:current=attempt
            # CSS word-wrap: break-word (only words that cannot fit a line).
            while current and face.getlength(current)+max(0,len(current)-1)*spacing>width:
                cut=1
                while cut<len(current) and face.getlength(current[:cut+1])+cut*spacing<=width:cut+=1
                current=current[cut:]
                if current:lines+=1
    return lines*line_height


def arrange(item, scene, width, height, screen_height, texts, icons=None, forecast_count=0):
    """Return bounded native part boxes in physical pixels, not equal-height rows."""
    base=screen_height*item['font_size']/100*scene.get('text_scale',100)/100
    padding_x=0 if item["kind"] in {"text","clock"} else screen_height*.026
    padding_y=0 if item["kind"] in {"text","clock"} else screen_height*.018
    inner_width=max(1,width-2*padding_x);inner_height=max(1,height-2*padding_y)
    overrides=item.get('parts',{});kind=item['kind'];result=[];boxes={}
    theme_opacity=scene.get('text_opacity',1)*item.get('text_opacity',1)
    icons=icons or {}

    def rectangle(name, default, parent=(0,0,width,height)):
        override=overrides.get(name,{})
        if not override.get('visible',True):return None
        if 'x' in override:
            px,py,pw,ph=parent
            return (px+pw*override['x']/100, py+ph*override['y']/100,
                    pw*override['width']/100, ph*override['height']/100)
        return default

    def style(name, size, line=1.22, opacity=1, parent_height=height, nowrap=False):
        override=overrides.get(name,{})
        size=parent_height*override['font_size']/100*(item.get('clock_base_height',item['height'])/item['height'] if kind=='clock' else 1) if 'font_size' in override else size
        size=max(4,min(384,size))
        text=str(override.get('text',texts.get(name,'')))[:2000]
        if name=='label':text=text.upper()
        return dict(id=name,text=text,font_size=pixels(size),line_height=pixels(size*line),
                    letter_space=pixels(size*(.02 if kind=='camera' else .12)) if name=='label' else 0,
                    color=override.get('color',item['color']),
                    font=override.get('font',scene.get('text_font') if not item.get('style_override') and scene.get('text_font','auto')!='auto' else item.get('font','sans')),
                    align=override.get('align',item['align']),
                    opacity=theme_opacity*opacity*override.get('opacity',1),
                    nowrap=nowrap,font_weight=override.get('font_weight',max(600,scene.get('text_weight') if isinstance(scene.get('text_weight'),int) else 400) if kind=='camera' and name=='label' else scene.get('text_weight','auto')),
                    underline=scene.get('text_underline',False))

    def emit(name, rect, size=base, line=1.22, opacity=1, parent=(0,0,width,height), nowrap=False):
        box=rectangle(name,rect,parent)
        if box is None:return None
        boxes[name]=box
        part=style(name,size,line,opacity,parent[3],nowrap)
        if kind=='camera' and name=='label':part['ellipsis']=True
        x,y,w,h=box
        part.update(units='px',x=pixels(x),y=pixels(y),width=max(1,pixels(w)),height=max(1,pixels(h)))
        if name in icons:part.update(icon=icons[name],opacity=scene.get('card_accent_opacity',1)*overrides.get(name,{}).get('opacity',1))
        if kind == "clock" and name in {"time", "date"}:
            override=overrides.get(name,{})
            part["clock_ink"] = dict(x=override.get("anchor_x",x), y=override.get("anchor_y",y),
                                     relative="anchor_x" in override, width=width, height=height)
            for field in ("frame_width", "frame_height"):
                if field in override:
                    part["clock_ink"][field] = min(100,override[field]*item.get("clock_base_height",item["height"])/item["height"]) if field=="frame_height" else override[field]
            if item.get("clock_base_height") and sum(overrides.get(key,{}).get("visible",True) for key in ("time","date")) == 1:
                # Single-row clocks keep the same typography in a compact,
                # vertically centered frame, just like the browser runtime.
                ink=part["clock_ink"]
                if not ink["relative"]:
                    ink["x"]=0
                ink.update(y=50,relative=True)
            part["clock_live"] = "text" not in override
            # Matches the fonts embedded in the ESP (regular and semibold).
            if part["font_weight"] == "auto":part["font_weight"]=400
        result.append(part)
        return box

    def flow(name,size,line=1.22,opacity=1,before=0,after=0,max_width=None,nowrap=False,include_empty=False):
        if (name not in texts and not include_empty) or not overrides.get(name,{}).get('visible',True):return None
        part=style(name,size,line,opacity,nowrap=nowrap)
        w=inner_width if max_width is None else max_width
        h=text_height(part['text'],part['font_size'],w,part['line_height'],part['letter_space'],nowrap,part['font'],part['font_weight'])
        return dict(name=name,size=size,line=line,opacity=opacity,before=before,after=after,w=w,h=h,nowrap=nowrap)

    label_size=screen_height*.014*scene.get('text_scale',100)/100
    if kind=='camera':
        # Shared with layout.js; screen-relative bounds keep the editor zoom
        # consistent while tile width controls the size between those bounds.
        label_size=max(16*screen_height/600,min(22*screen_height/600,width*.055))*scene.get('text_scale',100)/100
    if kind in {'startup','boot'}:
        from .startup_layout import design
        for spec in design('startup' if kind=='boot' else 'connecting')['parts']:
            rect=(width*spec['x']/100,height*spec['y']/100,width*spec['width']/100,height*spec['height']/100)
            emit(spec['id'],rect,base)
            if result and result[-1]['id']==spec['id']:
                for key in ('duration','arc','stroke','scale'):
                    if key in spec:result[-1][key]=spec[key]
            if result and result[-1]['id']==spec['id'] and 'align' not in overrides.get(spec['id'],{}):result[-1]['align']='center'
        return sorted(result,key=lambda p:overrides.get(p['id'],{}).get('z_index',0))
    if kind in {'logo','animation','spinner','progress'}:
        animation = item.get('animation_type', 'spinner') if kind == 'animation' else kind
        emit(kind,(0,0,width,height),base)
        if result and animation=='spinner':
            from .startup_layout import design
            spec=next(p for p in design('connecting')['parts'] if p['id']=='spinner')
            result[-1].update({key:spec[key] for key in ('duration','arc','stroke','scale')})
            result[-1]['duration']=pixels(item.get('spinner_duration',spec['duration']))
        if result and kind=='animation':
            result[-1].update(duration=pixels(item.get('animation_duration',1000)),activity=True)
        if result and kind!='logo':result[-1]['accent']=result[-1]['color']
        if result and animation=='progress':
            if item.get('progress_highlight') in {'white','black'}:result[-1]['highlight']='#ffffff' if item['progress_highlight']=='white' else '#000000'
            result[-1].update(value=pixels(item.get('progress_value',60)),boot=item.get('progress_source','fixed' if kind=='animation' else 'boot')=='boot')
        return result
    flows=[]
    if 'label' in texts:flows.append(flow('label',label_size,opacity=1 if kind=='camera' else .7,after=label_size*.8,nowrap=True))
    if kind=='weather':
        flows.extend([flow('temperature',base,1.13,before=base*.18),
                      flow('detail',base*.33,1.55,.76,before=base*.33*.35,max_width=inner_width*.7)])
    elif kind=='clock':
        flows.extend([flow('time',base,1.13),flow('date',base*.33,1.55,.76,before=base*.33*.75)])
    elif kind=='message':
        flows.extend([flow('title',base*1.18,1.13),flow('body',base*.78,1.4,.9,before=base*.78*.75)])
    elif kind=='text':flows.append(flow('text',base,item.get('text_line_height',1.35)))
    elif kind=='calendar':
        flows.extend([flow('empty',base*.58,1.13,.65),flow('detail',base*.33,1.55,.76)])
    elif kind=='camera':flows.append(flow('detail',base*.33,1.55,.76))
    elif kind not in {'status','media'}:
        # Studio keeps the detail block's margin even for a plain on/off state.
        flows.extend([flow('value',base,1.13),flow('detail',base*.33,1.55,.76,before=base*.33*.75,include_empty=True)])
    flows=[f for f in flows if f]
    total=sum(f['h']+f['before']+f['after'] for f in flows if 'x' not in overrides.get(f['name'],{}))
    if kind not in {'weather','calendar','camera','media','status'}:
        total+=base*.58*.4  # Empty .lg-list still has its CSS top margin.
        if kind=='text':total+=base*.33*.75  # Empty detail margin also participates.
    y=padding_y if kind in {'weather','calendar','camera','text','clock'} else padding_y+(inner_height-total)/2
    for f in flows:
        explicit='x' in overrides.get(f['name'],{})
        emit(f['name'],(padding_x,y+f['before'],f['w'],max(1,f['h'])),f['size'],f['line'],f['opacity'],nowrap=f['nowrap'])
        if not explicit:y+=f['before']+f['h']+f['after']

    if kind=='weather':
        if 'icon' in icons:emit('icon',(width*.71,height*.06,width*.24,height*.35))
        from .weather_metrics import native_metrics
        badges,reserved=native_metrics(item,scene,width,height,base,padding_x,padding_y,texts)
        result.extend(badges)
        if forecast_count and overrides.get('forecast',{}).get('visible',True):
            unit=base*.32
            # CSS gap/borders participate in flex sizing; absolutely positioned
            # or hidden periods are removed from the normal row flow.
            names=[f'forecast_{i+1}' for i in range(forecast_count)]
            active=[name for name in names if overrides.get(name,{}).get('visible',True)]
            flowing=[name for name in active if 'x' not in overrides.get(name,{})]
            def metrics(name, parent_height):
                entries=[]
                for suffix,size,line,opacity,before,after in (
                    ('time',.88*unit,1.25,.8,0,0),
                    ('icon',unit,1.25,1,.5*unit,.5*unit),
                    ('high',1.3*unit,1.25,1,0,0),
                    ('low',unit,1.25,.6,.2*unit,0),
                    ('rain',.75*unit,1.25,.8,.45*unit,0)):
                    ident=name+'_'+suffix;conf=overrides.get(ident,{})
                    if not conf.get('visible',True):continue
                    size=parent_height*conf['font_size']/100 if 'font_size' in conf else size
                    content=conf.get('text',texts.get(ident,''))
                    h=3.7*unit if suffix=='icon' else size*line if content else 0
                    entries.append((ident,suffix,size,line,opacity,before,after,h))
                return entries
            def positions(entries):
                # Empty blocks collapse their top/bottom margins with the next
                # sibling too (hourly forecasts commonly have no low value).
                at=0;pending=0;placed={}
                for e in entries:
                    ident,_,_,_,_,before,after,h=e
                    if 'x' in overrides.get(ident,{}):
                        placed[ident]=at+max(pending,before);continue
                    pending=max(pending,before)
                    if not h:
                        placed[ident]=at+pending;pending=max(pending,after);continue
                    at+=pending
                    placed[ident]=at;at+=h;pending=after
                at+=pending
                return placed,at
            row_height=max((positions(metrics(name,0))[1] for name in flowing),default=0)
            row_height=min(row_height,max(1,height-padding_y-y-unit-reserved))
            group=rectangle('forecast',(padding_x,height-padding_y-row_height-unit-reserved,inner_width,row_height+unit))
            if group:
                gx,gy,gw,gh=group
                group_padding=0 if 'x' in overrides.get('forecast',{}) else unit
                borders=sum(name!=names[0] for name in flowing)
                content_width=max(1,(gw-unit*max(0,len(flowing)-1)-.6*unit*len(flowing)-borders)/max(1,len(flowing)))
                next_x=gx
                for name in active:
                    border=0 if name==names[0] else 1
                    cell_width=content_width+.6*unit+border
                    cell=rectangle(name,(next_x,gy+group_padding,cell_width,max(1,gh-group_padding)),group)
                    explicit='x' in overrides.get(name,{})
                    if not explicit:next_x+=cell_width+unit
                    if cell is None:continue
                    cx,cy,cw,ch=cell
                    padding=0 if explicit else .3*unit
                    parent=(cx+border,cy,max(1,cw-border),ch)
                    text_x=cx+border+padding;text_width=max(1,cw-border-2*padding)
                    entries=metrics(name,ch);offsets,_=positions(entries)
                    for ident,suffix,size,line,opacity,before,after,child_h in entries:
                        if suffix=='icon':
                            icon_width=min(text_width,4.4*unit)
                            rect=(text_x+(text_width-icon_width)/2,cy+offsets[ident],icon_width,child_h)
                        else:rect=(text_x,cy+offsets[ident],text_width,max(1,child_h))
                        if ident in texts or ident in icons:
                            emit(ident,rect,size,line,opacity,parent=parent,nowrap=True)
                            if result and result[-1]['id']==ident and 'align' not in overrides.get(ident,{}):result[-1]['align']='center'
    elif kind=='status':
        for name,top,size,line,opacity in [('label',height*.43,label_size,1.22,.7),('value',height*.83-base*1.15*1.13,base*1.15,1.13,1),('detail',height*.95-base*.32*1.55,base*.32,1.55,.76)]:
            if name=='label':result[:]=[p for p in result if p['id']!='label']
            if name in texts:emit(name,(width*.07,top,width*.86,size*line),size,line,opacity,nowrap=True)
    elif kind=='media':
        result.clear();style_name=item.get('media_style','compact');left=.42 if item.get('show_cover',True) else .07;right=.05
        if style_name=='poster':left=right=.07
        if style_name=='stage':left=.53 if item.get('show_cover',True) else .05;right=0 if item.get('show_cover',True) else .05
        for name,top,scale,line,opacity in [('label',.12 if style_name=='stage' else .08,0,1.22,.7),('title',.32 if style_name=='stage' else .30,.8 if style_name=='stage' else .85,1.14,1),('artist',.61 if style_name=='stage' else .54,.29 if style_name=='stage' else .38,1.2,.76),('album',.69 if style_name=='stage' else .64,.18 if style_name=='stage' else .27,1.22,.55),('volume',.94,.16 if style_name=='stage' else .22,1.22,.65)]:
            size=label_size if name=='label' else base*scale
            if name in texts:
                box=emit(name,(width*left,height*top,width*(1-left-right),size*line*(2 if name=='title' else 1)),size,line,opacity,nowrap=name=='title')
                if name=='title' and box is not None:result[-1]['marquee']=True
        if 'elapsed' in texts:
            group_height=height*(.07 if style_name in {'stage','poster'} else .12)
            bottom=height*(.07 if style_name=='poster' else .09 if style_name=='stage' else .10)
            group=rectangle('progress',(width*left,height-bottom-group_height,width*(1-left-right),group_height))
            if group:
                gx,gy,gw,gh=group
                bar_height=max(2,pixels(min(gh*.12,screen_height*.007)))
                result.append({'id':'progress_bar','text':'','icon':'boot_progress','units':'px',
                    'x':pixels(gx),'y':pixels(gy),'width':max(1,pixels(gw)),'height':bar_height,
                    'font_size':14,'boot':False,'activity':False,'range_max':1000,'value':0,
                    'opacity':theme_opacity,'accent':item.get('accent_color',scene.get('accent','#79e5c0'))})
                for name,align in (('elapsed','left'),('duration','right')):
                    album_style=next((p for p in result if p['id']=='album'),style('album',base*(.18 if style_name=='stage' else .27),1.22,.55))
                    size=album_style['font_size']
                    emit(name,(gx,gy+max(0,gh-size*1.22),gw,size*1.22),size,1.22,.55,parent=group)
                    if result and result[-1]['id']==name:
                        for field in ('font_size','line_height','opacity','font','font_weight'):
                            result[-1][field]=album_style[field]
                    if result and result[-1]['id']==name and 'align' not in overrides.get(name,{}):result[-1]['align']=align
    # Calendar/list group children retain their own parent coordinates.
    if kind in {'calendar','message'}:
        count=sum(f'row_{i}_value' in texts for i in range(1,7))
        if count:
            unit=base*(.8 if kind=='calendar' else .58)
            group=rectangle('list',(padding_x,y+.4*unit,inner_width,max(1,height-padding_y-y-.4*unit)))
            if group:
                gx,gy,gw,gh=group;row_y=gy
                for i in range(1,count+1):
                    name=f'row_{i}';label_h=unit*.7*1.45;value_h=text_height(texts[name+'_value'],unit,gw,unit*1.45)
                    cell=rectangle(name,(gx,row_y+.45*unit,gw,label_h+.18*unit*.7+value_h+.45*unit),group)
                    row_y+=label_h+.18*unit*.7+value_h+1.35*unit
                    if cell:
                        cx,cy,cw,ch=cell
                        emit(name+'_label',(cx,cy,cw,label_h),unit*.7,1.45,.64,parent=cell)
                        emit(name+'_value',(cx,cy+label_h+.18*unit*.7,cw,value_h),unit,1.45,parent=cell)
    return sorted(result,key=lambda p:overrides.get(p['id'],{}).get('z_index',0))


def camera_tile_size(item, display_ratio, max_height):
    """Same camera/inset geometry as LGCameraTileSize in the web renderer."""
    picture = item.get("parts", {}).get("picture", {})
    ratio = item.get("camera_aspect_ratio", 16/9) * picture.get("height", 100) / picture.get("width", 100)
    inset = max(0, min(.25, item.get("content_padding", 0)/100))
    outer = ratio*(1-2*inset)+2*inset if ratio >= 1 else 1/((1/ratio)*(1-2*inset)+2*inset)
    width = item["width"]
    height = width*display_ratio/outer
    scale = min(1, max(.01, 100-item["x"])/width, max(.01, min(100, max_height))/height)
    return {"width": width*scale, "height": height*scale}
