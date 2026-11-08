"""Adapt the shared saved layout to ESP hardware, preserving custom geometry."""
from copy import deepcopy
from .layout_config import element, scene
from .startup_layout import DEFAULT, MAX_STARTUP_BYTES, split_elements


def default_update_scene():
    """Independent offline elements; match the firmware's update defaults."""
    defaults=DEFAULT['updating']; items=[]
    for spec in defaults['parts']:
        name=spec['id']; kind='animation' if name=='progress' else 'text' if name in ('title','percent') else name
        item=element(kind,spec['x'],spec['y'],spec['width'],spec['height'])
        item.update(id='updating_'+name,opacity=0,radius=0,show_label=False,align='center',color=defaults['color'],font_size=defaults['font_size'])
        if name=='progress':item.update(animation_type='progress',animation_duration=spec['duration'],progress_source='boot',progress_highlight='white',color=defaults['accent'])
        elif kind=='text':item.update(text=defaults['text'] if name=='title' else '60 %',text_line_height=1.22,update_role='status' if name=='title' else 'percent')
        items.append(item)
    return scene('solid',items,defaults['background'],defaults['accent'])


def adapt(config, library, *, migrate=False):
    config,library=deepcopy(config),deepcopy(library)
    scenes=list(config['scenes'].values())+[v['scene'] for v in library['views']]
    for scene in scenes:
        camera=next((item for item in scene['elements'] if item['kind']=='camera'),None)
        result=[]
        for item in scene['elements']:
            if item['kind']=='hdmi':
                if camera:continue
                item.update(kind='camera',camera_source='local',entity_id='',label='Bordkamera',show_label=False,
                            parts={},tap_action={'action':'none','entity_id':'','view':''})
                camera=item
            result.append(item)
        scene['elements']=result
    # Split the legacy single start screen once. Preserve edited geometry and
    # text, and keep the previous spinner design as the connection view.
    boot=next(v for v in library['views'] if v['id']=='startup')
    if 'connecting' not in config['scenes']:
        old=deepcopy(boot['scene'])
        legacy=[i.get('text') for i in old['elements']]==['HOME ASSISTANT','Dein Display startet …','Einen Moment bitte.']
        for phase,kind,scene in [('startup','boot',boot['scene']),('connecting','startup',old)]:
            defaults=DEFAULT if phase=='startup' else DEFAULT['connecting']
            if legacy:
                item=element(kind,0,0,100,100)
                item.update(id=phase,text=defaults['text'],font_size=defaults['font_size'],color=defaults['color'],opacity=0,radius=0,show_label=False,align='center')
                scene.update(background='solid',color=defaults['background'],accent=defaults['accent'],image_id='',elements=[item])
                boot['theme_override']=True
            for item in scene['elements']:
                if item['kind']=='startup':
                    item['kind']=kind
                    if phase=='startup':
                        # Spinner geometry is square; use the shared bar geometry.
                        item.get('parts',{}).pop('spinner',None)
                    elif item.get('text')==DEFAULT['text']:item['text']=defaults['text']
            config['scenes'][phase]=deepcopy(scene)
        library['views'].insert(library['views'].index(boot)+1,{'id':'connecting','name':'Verbindungsaufbau','theme_override':boot.get('theme_override',False),'scene':old})
    if 'updating' not in config['scenes']:
        update=default_update_scene()
        config['scenes']['updating']=deepcopy(update)
        library['views'].insert(library['views'].index(boot)+2,{'id':'updating','name':'Firmwareaktualisierung','theme_override':True,'scene':update})
    boot['name']='Bootscreen'
    for scene in list(config['scenes'].values())+[v['scene'] for v in library['views']]:
        scene['elements']=split_elements(scene['elements'])
    return config,library


def validate_native_startup(config):
    # NVS stores declarative geometry and vectors. External image buffers are not
    # available before networking, so never claim such a design was cached.
    from .lvgl import compile_scene
    import json
    total=0
    for phase in ('startup','connecting','updating'):
        scene=config['scenes'].get(phase)
        if scene is None:continue  # Older saved libraries are migrated on load.
        if scene['background']=='image':
            raise ValueError('ESP-Startansichten: Bitte einen lokalen Farbverlauf oder eine Grundfarbe wählen')
        compiled,_,assets=compile_scene({'view':phase,'layout':{'config':config}},1024,600)
        size=len(json.dumps(compiled,ensure_ascii=False).encode())
        total+=size
        if assets or size>MAX_STARTUP_BYTES//2-256:
            raise ValueError('ESP-Startansicht ist zu groß für den lokalen Speicher (16 KiB je Ansicht)')

    if total+256>MAX_STARTUP_BYTES:
        raise ValueError('ESP-Start- und Updateansichten sind zusammen zu groß (32 KiB)')
