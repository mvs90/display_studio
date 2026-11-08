"""Native scene geometry and complete weather values, without a renderer service."""
from copy import deepcopy
import json
from pathlib import Path
from custom_components.display_studio.layout_config import presets
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.widget_parts import validate_parts


def test_weather_editor_resize_preserves_other_native_parts_after_save():
    # Captured through real pointer/input edits in both browser engines. The
    # compiler must retain those sibling frames after resizing/moving the label.
    cases=json.loads((Path(__file__).parent/'fixtures/weather-part-resize.json').read_text())
    for case in cases:
        outputs=[]
        for name in ('resized','edited'):
            state=case[name]
            item=state['layout']['config']['scenes']['dashboard']['elements'][0]
            assert validate_parts(item['parts'],'weather')==item['parts']
            widget=next(w for w in compile_scene(state,1024,600)[0]['widgets'] if w['id'].endswith('/'+item['id']))
            outputs.append({p['id']:p for p in widget['parts']})
        assert outputs[0].pop('label')!=outputs[1].pop('label')
        assert outputs[0]==outputs[1],case['mode']
        assert {'temperature','detail','icon','wind_value','uv_value'}<=outputs[0].keys()


def weather_state():
    scene=deepcopy(presets()[0]['layout']['scenes']['no_signal'])
    item=next(w for w in scene['elements'] if w['kind']=='weather')
    item.update(x=0,y=0,width=100,height=100,entity_id='weather.test',font_size=10,forecast_count=8,forecast_type='daily')
    scene['elements']=[item]
    value={'state':'rainy','temperature':0,'temperature_unit':'°C','humidity':0,'forecasts':{'daily':[
        {'datetime':f'2026-10-{11+i}T00:00:00Z','condition':'sunny','temperature':0,'templow':0,'precipitation_probability':0}
        for i in range(8)]}}
    state={'view':'dashboard','layout':{'config':{'scenes':{'dashboard':scene}},'values':{'weather.test':value},'timezone':'Europe/Berlin','now':'2026-10-11T12:00:00+00:00','sun':{'is_daytime':False}}}
    return state,item,value


def test_weather_has_all_eight_native_forecasts_and_zero_values():
    state,item,value=weather_state()
    payload,_,assets=compile_scene(state,1024,600)
    assert payload['schema']==6 and not assets
    widget=next(w for w in payload['widgets'] if w['id']=='dashboard/weather')
    parts={p['id']:p for p in widget['parts']}
    assert parts['temperature']['text']=='0 °C' and parts['detail']['text']=='Regen · 0 %'
    assert parts['icon']['icon']=='rain'
    assert len([p for p in parts if p.endswith('_icon')])==8
    assert parts['forecast_8_high']['text']=='0°' and parts['forecast_8_low']['text']=='0°'
    assert parts['forecast_8_rain']['text']=='0 %'
    assert all(p['units']=='px' for p in parts.values())
    item['forecast_type']='hourly'
    value['forecasts']['hourly']=[{'datetime':'2026-10-11T22:30:00Z','condition':'clear-night','temperature':1,'is_daytime':False}]
    parts={p['id']:p for p in compile_scene(state,1024,600)[0]['widgets'][-1]['parts']}
    assert parts['forecast_1_time']['text']=='00:30' and parts['forecast_1_icon']['icon']=='moon'
    assert parts['forecast_1_low']['text']=='' and 'forecast_2_time' not in parts


def test_part_group_visibility_and_explicit_font_dimensions_are_preserved():
    state,item,value=weather_state()
    item['parts']={'temperature':{'x':10,'y':20,'width':40,'height':30,'font_size':15},'forecast':{'visible':False}}
    scene=compile_scene(state,1024,600)[0]
    parts={p['id']:p for p in scene['widgets'][-1]['parts']}
    assert not any(p.startswith('forecast_') for p in parts)
    assert parts['temperature']['font_size']==90  # Formerly rounded down to 48.
    assert [parts['temperature'][k] for k in ('x','y','width','height')]==[102,120,410,180]
    value['state']='unavailable'
    parts={p['id']:p for p in compile_scene(state,1024,600)[0]['widgets'][-1]['parts']}
    assert parts['temperature']['text']=='–' and parts['detail']['text']=='Nicht verfügbar'
    assert 'icon' not in parts


def test_icon_state_push_retains_geometry_and_layout_id():
    state,item,value=weather_state();value['forecasts']={};item['forecast_type']='current'
    old=compile_scene(state,1024,600)[0]
    value['state']='sunny'
    new=compile_scene(state,1024,600)[0]
    assert old['layout_id']==new['layout_id'] and old['revision']!=new['revision']
    assert next(p for p in new['widgets'][-1]['parts'] if p['id']=='icon')['icon']=='moon'


def test_text_and_clock_start_at_the_top_without_widget_padding():
    from custom_components.display_studio.layout_config import element,make_layout,validate_layout
    config=make_layout()
    for kind,first in [('text','text'),('clock','time')]:
        item=element(kind,5,5,40,35)
        item.update(show_label=False,text='Erste Zeile\nZweite Zeile',font_size=4)
        config['scenes']['dashboard']['elements']=[item]
        config=validate_layout(config)
        payload=compile_scene({'view':'dashboard','layout':{'config':config}},1024,600)[0]
        widget=next(w for w in payload['widgets'] if w['id']=='dashboard/'+item['id'])
        part=next(p for p in widget['parts'] if p['id']==first)
        assert part['x']==part['y']==0
        assert part['font_size']==24


def test_home_scene_explicit_text_frame_is_top_aligned_and_keeps_scaled_line_spacing():
    from custom_components.display_studio.home_theme import appearance
    from custom_components.display_studio.layout_config import element
    item=element('status',0,0,40,20)
    item.update(home_variant='scene',label='Guten Morgen',parts={'label':dict(x=30,y=5,width=65,height=80,font_size=25)})
    widget,_=appearance(item,{'state':'off'},400,120,600,{})
    label=next(p for p in widget['parts'] if p['id']=='label')
    assert 'vertical_align' not in label
    assert label['y']==6 and label['font_size']==30 and label['line_height']==36


def test_resized_date_frame_survives_validation_and_native_compilation():
    from custom_components.display_studio.layout_config import element,make_layout,validate_layout
    config=make_layout();item=element('clock',0,0,50,40)
    item.update(parts={'date':dict(x=5,y=50,width=52.5,height=22.5,font_size=12)})
    config['scenes']['dashboard']['elements']=[item]
    config=validate_layout(config)
    payload=compile_scene({'view':'dashboard','layout':{'config':config}},1024,600)[0]
    widget=next(w for w in payload['widgets'] if w['id']=='dashboard/'+item['id'])
    date=next(p for p in widget['parts'] if p['id']=='date')
    assert (date['x'],date['y'],date['width'],date['height'],date['font_size'])==(26,120,269,54,29)


def test_live_clock_options_and_pixel_anchor_contract():
    from custom_components.display_studio.layout_config import element,make_layout,validate_layout
    config=make_layout();item=element('clock',0,0,50,40)
    item.update(clock_seconds=True,clock_blink=True,clock_time_format='12h',clock_date_format='iso',parts={'time':dict(anchor_x=100,anchor_y=0,font_size=25),'date':dict(anchor_x=0,anchor_y=100,text='Eigenes Datum')})
    config['scenes']['dashboard']['elements']=[item]
    payload=compile_scene({'view':'dashboard','layout':{'config':validate_layout(config),'now':'2026-10-16T00:03:09Z','timezone':'UTC'}},1024,600)[0]
    widget=next(w for w in payload['widgets'] if w['id']=='dashboard/'+item['id'])
    time,date=[next(p for p in widget['parts'] if p['id']==k) for k in ['time','date']]
    assert widget['clock_seconds'] and widget['clock_blink'] and widget['clock_12h']
    assert time['text']=='12:03:09 AM' and time['clock_live']
    assert time['clock_ink']==dict(x=100,y=0,relative=True,width=512,height=240)
    assert not date['clock_live'] and date['text']=='Eigenes Datum'


def test_local_clock_ticks_do_not_change_native_scene_revision():
    from custom_components.display_studio.layout_config import element,make_layout
    config=make_layout();item=element('clock',0,0,50,40)
    item.update(clock_seconds=True,clock_blink=True)
    config['scenes']['dashboard']['elements']=[item]
    state={'view':'dashboard','layout':{'config':config,'timezone':'Europe/Berlin','now':'2026-10-16T21:59:59Z'}}
    before=compile_scene(state,1024,600)[0]
    state['layout']['now']='2026-10-16T22:00:01Z'
    after=compile_scene(state,1024,600)[0]
    assert before['revision']==after['revision'] and before['layout_id']==after['layout_id']
    assert before['epoch']!=after['epoch']


def test_widget_font_override_matches_the_preview_inheritance_rule():
    from custom_components.display_studio.layout_config import make_layout, element
    config=make_layout();scene=config['scenes']['dashboard'];scene['text_font']='serif'
    item=element('text',5,5,40,20);item.update(text='Theme & Widget',font='mono',style_override=True);scene['elements']=[item]
    def render():return compile_scene({'view':'dashboard','layout':{'config':config,'values':{}}},1024,600)[0]['widgets'][-1]
    custom=render();assert custom['font']=='mono'
    assert all(p.get('font','mono')=='mono' for p in custom['parts'] if p.get('text'))
    item['style_override']=False
    inherited=render();assert inherited['font']=='serif'
    assert all(p.get('font','serif')=='serif' for p in inherited['parts'] if p.get('text'))


def test_multiline_text_line_spacing_survives_validation_and_native_compilation():
    from custom_components.display_studio.layout_config import element, make_layout, validate_layout
    config = make_layout()
    item = element('text', 5, 5, 80, 50)
    item.update(show_label=False, text='Freitag\nZweite Zeile\nDritte Zeile', font_size=4)
    config['scenes']['dashboard']['elements'] = [item]
    for spacing, expected in [(1.35, 32), (1.8, 43), (3, 72)]:
        item['text_line_height'] = spacing
        checked = validate_layout(config)
        assert checked['scenes']['dashboard']['elements'][0]['text_line_height'] == spacing
        payload = compile_scene({'view':'dashboard', 'layout':{'config':checked}}, 1024, 600)[0]
        widget = next(w for w in payload['widgets'] if w['id']=='dashboard/'+item['id'])
        part = next(p for p in widget['parts'] if p['id']=='text')
        assert part['font_size'] == 24
        assert part['line_height'] == expected
        assert part['height'] == 3 * expected
        assert part['text'] == item['text']


def test_idle_media_does_not_cover_weather_background():
    state,_,_=weather_state()
    scene=state['layout']['config']['scenes']['dashboard']
    scene.update(media_background_enabled=True,media_background_entity='media_player.av',media_background_fit='colors')
    data={'state':'idle','artwork':'previous-art'}
    state['layout']['values']['media_player.av']=data
    for status,artwork,expected in [('idle','old',False),('off','old',False),('playing','',False),('playing','new',True),('buffering','new',True)]:
        data.update(state=status,artwork=artwork)
        payload,_,assets=compile_scene(state,1024,600)
        assert any(w['id']=='dashboard/media_background' for w in payload['widgets']) is expected
        assert any(a['resource']=='cover.jpg' for a in assets.values()) is expected
