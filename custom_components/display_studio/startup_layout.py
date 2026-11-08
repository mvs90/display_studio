"""Shared bounded offline default; copied to firmware and checked byte-for-byte."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

_BASE=Path(__file__).parent
DEFAULT=json.loads((_BASE/'startup.json' if (_BASE/'startup.json').exists() else _BASE/'www/runtime/startup.json').read_text())
MAX_STARTUP_BYTES=32768

def design(phase="startup"):
    return DEFAULT[phase] if phase in ("connecting", "updating") else DEFAULT

def pixel(value):return math.floor(value+.5)

def parts(width,height,font_size=None,color=None,text=None,phase="startup"):
    defaults=design(phase)
    size=max(4,min(384,pixel(font_size if font_size is not None else height*defaults['font_size']/100)))
    result=[]
    for spec in defaults['parts']:
        part={'id':spec['id'],'units':'px','text':(defaults['text'] if text is None else text) if spec['id']=='title' else '',
              'x':pixel(width*spec['x']/100),'y':pixel(height*spec['y']/100),'width':max(1,pixel(width*spec['width']/100)),
              'height':max(1,pixel(height*spec['height']/100)),'font_size':size,'line_height':pixel(size*1.22),
              'letter_space':0,'font':'sans','color':color or defaults['color'],'align':'center','opacity':1,'nowrap':False,'font_weight':'auto','underline':False}
        if 'icon' in spec:part['icon']=spec['icon']
        for key in ('duration','arc','stroke','scale','activity','highlight'):
            if key in spec:part[key]=spec[key]
        result.append(part)
    return result

def split_elements(elements):
    """Upgrade old composed cards to independently movable content elements.

    Keep the enclosing surface when it was visible. Part geometry becomes screen
    geometry; local text overrides remain attached to the new text element.
    This function is mirrored in the browser and tested with the same fixtures.
    """
    used={item['id'] for item in elements}
    result=[]
    def identifier(base, suffix):
        stem=base[:max(1,39-len(suffix))]+'_'+suffix
        candidate=stem;serial=2
        while candidate in used:
            tail='_'+str(serial);candidate=stem[:40-len(tail)]+tail;serial+=1
        used.add(candidate)
        return candidate
    for item in elements:
        if item['kind'] not in ('boot','startup'):
            result.append(deepcopy(item));continue
        defaults=design('startup' if item['kind']=='boot' else 'connecting')
        if item.get('opacity',0)>0:
            surface=deepcopy(item)
            surface.update(kind='text',text='',show_label=False,parts={})
            result.append(surface)
        specs=sorted(defaults['parts'],key=lambda spec:item.get('parts',{}).get(spec['id'],{}).get('z_index',0))
        for spec in specs:
            name=spec['id'];override=deepcopy(item.get('parts',{}).get(name,{}))
            box={key:override.get(key,spec[key]) for key in ('x','y','width','height')}
            kind='text' if name=='title' else name
            part_name='text' if kind=='text' else name
            child=deepcopy(item)
            child.update(id=identifier(item['id'],name),kind=kind,
                         x=item['x']+item['width']*box['x']/100,
                         y=item['y']+item['height']*box['y']/100,
                         width=item['width']*box['width']/100,
                         height=item['height']*box['height']/100,
                         opacity=0,radius=0,show_label=False,label='',
                         align=override.get('align','center'),parts={})
            if kind=='text':
                child['text']=override.pop('text',item.get('text') or defaults['text'])
                child['text_line_height']=1.22
                if 'font_size' in override:
                    override['font_size']=override['font_size']*100/box['height']
            else:
                child['text']=''
                # The legacy bars and rings always used the ESPHome accent.
                child['color']=defaults['accent'] if kind!='logo' else item['color']
                override.pop('font_size',None)
            for key in ('x','y','width','height','z_index'):override.pop(key,None)
            override.update(x=0,y=0,width=100,height=100)
            child['parts']={part_name:override}
            result.append(child)
    return result


def default_scene(width,height,phase="startup"):
    defaults=design(phase)
    widgets=[]
    for part in parts(width,height,phase=phase):
        name=part['id'];kind='text' if name=='title' else name
        spec=next(p for p in defaults['parts'] if p['id']==name)
        # Match the compiler's element rounding, then use the complete local box.
        x,y=round(width*spec['x']/100),round(height*spec['y']/100)
        w,h=max(1,round(width*spec['width']/100)),max(1,round(height*spec['height']/100))
        part.update(id=kind,x=0,y=0,width=w,height=h)
        if kind in ('spinner','progress'):part.update(color=defaults['accent'],accent=defaults['accent'])
        if kind=='progress':part.update(value=60,boot=True)
        if phase=='updating' and name in ('title','percent'):
            part['update_role']='status' if name=='title' else 'percent'
            if name=='percent':part['text']='60 %'
        widgets.append({'id':phase+'/'+phase+'_'+name,'type':'card','x':x,'y':y,'width':w,'height':h,
                        'background':defaults['background'],'opacity':0,'radius':0,'clickable':False,'parts':[part]})
    scene={'protocol':2,'schema':6,'width':width,'height':height,'view':phase,'background':defaults['background'],'widgets':widgets}
    digest=hashlib.sha256(json.dumps(scene,sort_keys=True).encode()).hexdigest()
    scene.update(revision=digest,layout_id=digest)
    return scene
