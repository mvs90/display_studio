"""Home-style tiles: bounded shared artwork, state formatting and native geometry."""
from copy import deepcopy
import math

from .home_spec import SPEC

KINDS = set(SPEC['kinds'])
VARIANTS = ('compact', 'large', 'scene', 'chip')


def enabled(scene, item):
    return (scene.get('card_style') if item.get('card_style', 'inherit') == 'inherit' else item['card_style']) == 'homekit' and item['kind'] in KINDS


def primary_action(item, value):
    configured = item.get('tap_action', {'action':'none','entity_id':'','view':''})
    if configured.get('action') != 'none':
        result=deepcopy(configured)
        if result.get("action") != "show_view":result["entity_id"]=result.get("entity_id") or item.get("entity_id", "")
        return result
    entity = item.get('entity_id', '')
    domain = entity.split('.')[0]
    action = {'light':'toggle', 'switch':'toggle', 'input_boolean':'toggle',
              'cover':'home_primary', 'fan':'home_primary', 'climate':'home_primary',
              'media_player':'media_play_pause', 'scene':'activate', 'script':'activate',
              'button':'press', 'input_button':'press'}.get(domain, 'none')
    return {'action':action, 'entity_id':entity if action!='none' else '', 'view':''}


def _number(value):
    return type(value) in (int,float) and math.isfinite(value)


def _round(value, digits=0):
    scale=10**digits
    result=math.floor(float(value)*scale+.5)
    return result/scale if digits else result


def _fmt(value):
    return str(_round(float(value), 1)).removesuffix('.0').replace('.', ',')


def model(item, data):
    entity = item.get('entity_id','')
    domain = data.get('domain') or entity.split('.')[0]
    state = data.get('state')
    available = bool(entity) and state not in (None,'unavailable') and (state!='unknown' or domain in ('button','input_button','scene','script'))
    icon = item.get('home_icon', 'auto')
    if icon == 'auto':
        icon = {'light':'light','switch':'outlet','input_boolean':'outlet','cover':'blinds',
                'climate':'temperature','media_player':'tv','fan':'fan','lock':'lock',
                'scene':'scene','script':'scene','person':'person'}.get(domain,
                {'temperature':'temperature','humidity':'water','moisture':'water','door':'lock','window':'window','motion':'person'}.get(data.get('device_class'),'home'))
    active = available and state in ('on','open','opening','playing','heat','cool','auto','heat_cool','home')
    if domain == 'sensor' and available: active=True
    names={'on':'Ein','off':'Aus','open':'Geöffnet','closed':'Geschlossen','opening':'Öffnet','closing':'Schließt',
           'playing':'Wiedergabe','paused':'Pausiert','idle':'Keine Wiedergabe','standby':'Standby',
           'home':'Zuhause','not_home':'Unterwegs','locked':'Verriegelt','unlocked':'Entriegelt',
           'heat':'Heizen','cool':'Kühlen','auto':'Automatik','heat_cool':'Automatik'}
    label = item.get('label') or data.get('name') or 'Gerät'
    detail = 'Entität auswählen' if not entity else 'Keine Antwort' if not available else names.get(state,str(state))
    number = data.get('current_temperature') if domain=='climate' else state
    if domain=='climate' and available and state!='off':
        detail = 'Heizung: '+_fmt(data['temperature'])+'°' if _number(data.get('temperature')) else detail
    elif domain=='light' and state=='on' and _number(data.get('brightness')): detail=str(_round(data['brightness']/255*100))+' %'
    elif domain=='cover' and available and _number(data.get('current_position')): detail=str(_round(data['current_position']))+' % geöffnet' if 0<data['current_position']<100 else 'Geöffnet' if data['current_position'] else 'Geschlossen'
    elif domain=='sensor' and available: detail=str(state).replace('.',',')+(' '+data['unit'] if data.get('unit') else '')
    elif domain in ('scene','script') and available: detail='Ausführen'
    large = (str(number).replace('.',',')+('°' if domain=='climate' or data.get('device_class')=='temperature' else ' '+str(data.get('unit','')))).strip() if available and number is not None else '–'
    features=int(data.get('supported_features') or 0)
    control=None
    if available:
        if domain=='light' and any(mode not in ('onoff','unknown') for mode in data.get('supported_color_modes',[])):
            control=('Helligkeit', 0,100,1,_round((data.get('brightness') or 0)/255*100) if state=='on' else 0,'%')
        elif domain=='cover' and features&4 and _number(data.get('current_position')): control=('Position',0,100,1,data['current_position'],'%')
        elif domain=='fan' and features&1 and _number(data.get('percentage')): control=('Geschwindigkeit',0,100,1,data['percentage'],'%')
        elif domain=='media_player' and features&4 and _number(data.get('volume_level')): control=('Lautstärke',0,100,1,_round(data['volume_level']*100),'%')
        elif domain=='climate' and features&1 and all(_number(data.get(k)) for k in ('min_temp','max_temp','temperature')) and data['min_temp']<data['max_temp']:
            control=('Temperatur',data['min_temp'],data['max_temp'],data.get('target_temp_step') or .5,data['temperature'],data.get('temperature_unit') or '°C')
    popup={'icon_paths':SPEC['icons'][icon],'icon_fill_mask':SPEC['fills'].get(icon,0),'reverse':domain=='cover','title':label,'state':detail,'accent':SPEC['colors'][icon], 'available':available, 'adjust':bool(control), 'value':0,'minimum':0,'maximum':100,'step':1,'unit':'%','control_label':''}
    if control:
        title,low,high,step,value,unit=control
        popup.update(control_label=title,minimum=low,maximum=high,step=step,unit=unit,value=max(0,min(100,_round((value-low)/(high-low)*100))))
    return dict(icon=icon,active=active,available=available,label=label,detail=detail,large=large,popup=popup)


def appearance(item, data, w, h, screen_h, scene):
    m=model(item,data); variant=item.get('home_variant','compact'); colors=SPEC['colors']
    scale=screen_h/600; ink=colors['ink'] if m['active'] else '#ffffff'; muted=colors['muted'] if m['active'] else '#e3e5e5'
    size=min(h*.62,36*scale); pad=9*scale; iy=(h-size)/2; text_x=pad+size+9*scale
    label_y=h/2-16*scale; value_y=h/2+2*scale; label_size=14*scale; value_size=13*scale
    if variant=='chip': size=min(h*.6,22*scale);iy=(h-size)/2;text_x=pad+size+6*scale;label_size=12*scale;value_size=11*scale;label_y=h/2-14*scale;value_y=h/2
    if variant=='scene':label_y=h/2-19*scale
    if variant=='large':size=34*scale;iy=12*scale;label_y=h-42*scale;value_y=h-23*scale;text_x=pad
    parts=[]
    def part(name,text,x,y,width,height,font,color,**extra):
        parts.append(dict(id=name,text=text,units='px',x=_round(x),y=_round(y),width=max(1,_round(width)),height=max(1,_round(height)),font_size=max(4,_round(font)),font_weight=600 if font<=14*scale else 400,color=color,opacity=scene.get('text_opacity',1),align='left',nowrap=True,ellipsis=True,line_height=max(1,_round(font*1.2)),**extra))
    numeric=(data.get('domain') or item.get('entity_id','').split('.')[0]) in ('climate','sensor') or item.get('home_icon')=='temperature'
    if variant!='large' or not numeric:
        part('badge','',pad,iy,size,size,20,colors[m['icon']] if m['active'] else '#111b19',icon='control',paths=[],disc=True)
        parts[-1]['opacity']=0 if variant in ('scene','chip') else 1 if m['active'] else .18
        inset=size*.10
        part('icon','',pad+inset,iy+inset,size-2*inset,size-2*inset,20,'#ffffff' if m['active'] and variant not in ('scene','chip') else colors[m['icon']],icon='control',paths=SPEC['icons'][m['icon']],fill_mask=SPEC['fills'].get(m['icon'],0))
    else:
        part('value',m['large'],pad,12*scale,w-2*pad,50*scale,36*scale,ink)
    part('label',m['label'] if item.get('show_label',True) else '',text_x,label_y,max(1,w-text_x-pad),20*scale,label_size,ink)
    part('detail' if variant=='large' else 'value',m['detail'] if variant!='scene' else '',text_x,value_y,max(1,w-text_x-pad),20*scale,value_size,muted)
    if variant=='scene':
        label=next(p for p in parts if p['id']=='label');label.update(height=_round(38*scale),nowrap=False,vertical_align='center')
    for p in parts:
        override=item.get('parts',{}).get(p['id'],{})
        if 'x' in override:
            p.pop('vertical_align',None)
            for key,dim in (('x',w),('y',h),('width',w),('height',h)):p[key]=max(1,_round(override[key]*dim/100)) if key in ('width','height') else _round(override[key]*dim/100)
        p['font']=override.get('font',scene.get('text_font') if not item.get('style_override') and scene.get('text_font','auto')!='auto' else item.get('font','sans'))
        for key in ('color','opacity','align','text'):
            if key in override:p[key]=override[key]
        if not p.get('icon'):p['opacity']*=item.get('text_opacity',1)
        if 'font_size' in override:p['font_size']=max(4,_round(override['font_size']*h/100))
        p['line_height']=max(1,_round(p['font_size']*1.2))
    parts=[p for p in parts if item.get('parts',{}).get(p['id'],{}).get('visible') is not False]
    popup={**m['popup'],'primary_width':_round(min(w*.34,70*scale))}
    return dict(parts=parts,background=colors['on'] if m['active'] else colors['off'],opacity=_round(255*(1 if m['active'] else .38)*scene.get('surface_opacity',1)),radius=_round((19 if variant=='chip' else 16)*scale),home=popup),m


def home_layout(base):
    """Room-oriented, scrollable six-column template on a 1024 × 600 viewport."""
    from .layout_config import element, scene
    def tile(key,label,x,y,variant='compact',icon='auto'):
        w,h=SPEC['sizes'][variant]
        e=element('status',x/1024*100,y/600*100,w/1024*100,h/600*100)
        e.update(id=key,label=label,font_size=2.2,home_variant=variant,home_icon=icon,radius=28,background='#202823',accent_color='#ffcc00',opacity=.38)
        return e
    def heading(key,text,y,size=2.6):
        e=element('text',20/1024*100,y/600*100,80,5)
        e.update(id=key,text=text,font_size=size,opacity=0,radius=0,show_label=False,parts={'text':{'x':0,'y':0,'width':100,'height':100}})
        return e
    items=[heading('home_title','Mein Zuhause',18,3.2)]
    for i,(key,label,icon) in enumerate((('climate_chip','Klima','fan'),('light_chip','Lichtquellen','light'),('security_chip','Sicherheit','lock'),('media_chip','TV & Lautsprecher','tv'),('water_chip','Wasser','water'),('energy_chip','Strom','energy'))):
        items.append(tile(key,label,20+138*i,65,'chip',icon))
    items.append(heading('camera_title','Kameras  ›',124))
    camera=element('camera',20/1024*100,155/600*100,318/1024*100,168/600*100)
    camera.update(id='home_camera',label='Bordkamera',camera_source='local',camera_mode='snapshot',camera_interval=5,camera_fit='cover',radius=28,opacity=1,show_label=False)
    items.append(camera)
    items.append(heading('scenes_title','Szenen  ›',359))
    for i,(key,label,icon) in enumerate((('cozy','Gemütlich','sofa'),('morning','Guten Morgen','sun'),('leave','Zuhause verlassen','person'),('arrive','Zuhause ankommen','home'),('night','Gute Nacht','moon'))):
        items.append(tile(key,label,20+166*i,392,'scene',icon))
    items.append(heading('room_title','Wohnzimmer  ›',484))
    rows=((('blind','Fenster','window'),('room_blind','Jalousie','blinds'),('room_light','Hauptlicht','light'),('outlet','Steckdosen','outlet'),('room_media','Fernsehen','tv')),
          (('room_speaker','Sonos','speaker'),('room_sofa','Licht Couch','light'),('room_middle','Licht Mitte','light'),('room_outlet','Steckdosen TV','outlet'),('room_floor','Stehlampe','light')))
    for row,entries in enumerate(rows):
        for i,(key,label,icon) in enumerate(entries):items.append(tile(key,label,20+166*i,516+68*row,icon=icon))
    items.append(tile('temperature','Heizung',850,516,'large','temperature'))
    items.append(heading('kitchen_title','Küche  ›',698))
    for i,(key,label,icon) in enumerate((('kitchen_light','Hauptlicht','light'),('kitchen_dining','Esstisch','light'),('kitchen_outlet','Geschirrspüler','outlet'),('kitchen_temp','Heizung','temperature'),('kitchen_blind','Jalousie','blinds'),('kitchen_speaker','Sonos','speaker'))):
        items.append(tile(key,label,20+166*i,730,'large' if icon=='temperature' else 'compact',icon))
    items.append(heading('entry_title','Eingang  ›',902))
    for i,(key,label) in enumerate((('entry_lock','Eingangstür'),('entry_nfc','NFC Schloss'),('entry_buzzer','Summer'))):items.append(tile(key,label,20+166*i,934,'large','lock'))
    page=scene('homekit',items,'#8bafc4','#d7a052');page.update(card_style='homekit',scroll_height=200)
    for key in ('dashboard','no_signal','pip_view'):base['scenes'][key]=deepcopy(page)
    return base
