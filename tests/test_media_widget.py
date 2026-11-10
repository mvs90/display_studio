"""One media card: saved intent, native controls and live HA authorization."""
from datetime import timedelta
from pathlib import Path
import json
import re
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from homeassistant.core import HomeAssistant, State
from homeassistant.components.media_player import MediaPlayerEntityFeature as F
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
from custom_components.display_studio import player_controls as player, av_controls as av
from custom_components.display_studio.media_widget import SPEC, expand
from custom_components.display_studio.layout_config import element, make_layout, validate_layout
from custom_components.display_studio.layout_cards import card_metadata
from custom_components.display_studio.layout_library import from_config
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.layouts import DisplayLayouts
from custom_components.display_studio.providers import BrowserProvider

ENTITY='media_player.test'
FEATURES=int(F.PLAY|F.PAUSE|F.SEEK|F.PREVIOUS_TRACK|F.NEXT_TRACK|F.VOLUME_SET|F.VOLUME_MUTE|F.SELECT_SOURCE)

def media():
    item=element('media',5,5,90,85)
    item.update(id='player',entity_id=ENTITY,media_remote_view='media_view',show_label=False)
    return item

def attributes():
    return {'supported_features':FEATURES,'media_title':'Testtitel','media_artist':'Interpret','media_position':30,'media_duration':120,'volume_level':.5,'source':'TV','source_list':['TV','Musik']}

@pytest.fixture
async def env(tmp_path):
    hass=HomeAssistant(str(tmp_path))
    hass.states.async_set(ENTITY,'paused',attributes())
    calls=[]
    async def record(call):calls.append((call.service,dict(call.data)))
    for service in {s[0] for s in player.SERVICES.values()}:hass.services.async_register('media_player',service,record)
    with patch.object(av,"resolve",return_value=None):
        yield hass,calls
    await hass.async_stop(force=True)

def test_spec_and_native_contract():
    js=(Path(__file__).parents[1]/'custom_components/display_studio/www/runtime/layout.js').read_text()
    assert json.loads(re.search(r'/\* MEDIA_WIDGET_BEGIN \*/(.*?)/\* MEDIA_WIDGET_END \*/',js).group(1))==SPEC
    config=make_layout();config['scenes']['dashboard']['elements']=[media()]
    normalized=validate_layout(config)
    assert normalized['scenes']['dashboard']['elements'][0]['media_controls']
    data={'state':'paused',**card_metadata(State(ENTITY,'paused',attributes()))}
    native,actions,_=compile_scene({'view':'dashboard','layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    children=[w for w in native['widgets'] if '/media/' in w['id']]
    assert len(children)==11
    assert {a['action'] for a in actions.values()}==player.PLAYER_ACTIONS|{'show_view'}
    slider=next(w for w in children if w['type']=='slider');assert slider['value']==50
    source=next(w for w in children if w['type']=='select');assert source['options']==['Quelle wählen','TV','Musik']
    mute=next(w for w in children if w['id'].endswith('/mute'));assert mute['feedback']['next']==1
    assert len(config['scenes']['dashboard']['elements'])==1  # Expansion never persists children.
    assert expand(expand(config['scenes']['dashboard']))==expand(config['scenes']['dashboard'])
    # Disabling/hiding a control removes its authorization, not just its pixels.
    config['scenes']['dashboard']['elements'][0]['media_controls_hidden']=['seek_back']
    _,actions,_=compile_scene({'layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    assert not any(k.endswith('/seek_back') for k in actions)

@pytest.mark.parametrize('key,service,extra',[
 ('play_pause','media_play_pause',{}),('previous','media_previous_track',{}),('next','media_next_track',{}),
 ('seek_back','media_seek',{'seek_position':20}),('seek_forward','media_seek',{'seek_position':40}),
 ('volume_up','volume_set',{'volume_level':.55}),('volume_down','volume_set',{'volume_level':.45}),
 ('mute','volume_mute',{'is_volume_muted':True}),('volume_set','volume_set',{'volume_level':.75}),
 ('select_source','select_source',{'source':'Musik'})])
async def test_all_controls(env,key,service,extra):
    hass,calls=env
    await player.async_execute(hass,ENTITY,'player_'+key,75 if key=='volume_set' else 'Musik' if key=='select_source' else None)
    assert calls==[(service,{'entity_id':ENTITY,**extra})]

@pytest.mark.parametrize('attrs,state,delta,expected',[
 ({'media_position':3,'media_duration':60},'paused',-10,0),
 ({'media_position':58,'media_duration':60},'paused',10,60),
 ({'media_position':20,'media_duration':60},'playing',10,35)])
def test_seek_clamps_and_running_position(attrs,state,delta,expected):
    now=dt_util.utcnow();attrs['media_position_updated_at']=now-timedelta(seconds=5)
    assert player.seek_position(State(ENTITY,state,attrs),delta,now)==expected

@pytest.mark.parametrize('value',[float('nan'),float('inf'),None,-1,'30',True])
async def test_invalid_seek_is_disabled(env,value):
    hass,calls=env;hass.states.async_set(ENTITY,'playing',{**attributes(),'media_position':value})
    assert 'player_seek_forward' not in player.available(hass.states.get(ENTITY))
    with pytest.raises(HomeAssistantError):await player.async_execute(hass,ENTITY,'player_seek_forward')
    assert not calls

async def test_unsupported_stale_and_invalid_values(env):
    hass,calls=env
    for action,value in [('player_select_source','Injected'),('player_volume_set',101),('player_volume_set',True),('player_next',123)]:
        with pytest.raises(HomeAssistantError):await player.async_execute(hass,ENTITY,action,value)
    hass.states.async_set(ENTITY,'paused',{'supported_features':0})
    with pytest.raises(HomeAssistantError):await player.async_execute(hass,ENTITY,'player_play_pause')
    assert not calls

async def test_av_seek_uses_current_playback_route(env):
    hass,calls=env;sonos='media_player.sonos';apple='media_player.apple'
    hass.states.async_set(sonos,'playing',{**attributes(),'source':'Music'})
    hass.states.async_set(apple,'paused',{**attributes(),'media_position':70})
    with patch.object(av,'resolve',return_value=av.Binding(sonos,apple,'')):
        assert 'av_seek_forward' not in av.display_state(hass,ENTITY).attributes['av_available_actions']
        with pytest.raises(HomeAssistantError):
            await av.async_execute(hass,ENTITY,'av_seek_forward')
        assert calls==[]
        hass.states.async_set(sonos,'playing',{**attributes(),'source':'TV'})
        await av.async_execute(hass,ENTITY,'av_seek_back');assert calls[-1][1]=={'entity_id':apple,'seek_position':60}

async def test_browser_virtual_child_authorization_and_replay(env):
    hass,calls=env;layouts=DisplayLayouts(hass,SimpleNamespace(entry_id='media-test'))
    config=make_layout();config['enabled']=True;config['scenes']['dashboard']['elements']=[media()];layouts.config=config
    # Dashboard is now a deletable library view, not an implicit browser source.
    layouts.library=from_config(config)
    provider=BrowserProvider(hass,SimpleNamespace(entry_id='media-test'),layouts)
    request={'revision':provider.state()['touch_revision'],'element':'player/media/volume_set','scene':'dashboard','session':'a'*32,'sequence':1,'value':75}
    await provider.async_browser_touch(request)
    assert calls[-1]==('volume_set',{'entity_id':ENTITY,'volume_level':.75})
    request['revision']=provider.state()['touch_revision']
    assert (await provider.async_browser_touch(request))['duplicate']
    assert len(calls)==1
    config['scenes']['dashboard']['elements'][0]['media_controls_hidden']=['volume_set']
    request.update(sequence=2,revision=provider.state()['touch_revision'])
    with pytest.raises(ValueError,match='Unknown kiosk element'):await provider.async_browser_touch(request)


@pytest.mark.parametrize("style", ["compact", "poster", "stage"])
def test_controls_keep_cover_inside_declared_frame(style):
    config=make_layout();item=media();item.update(media_style=style)
    config['scenes']['dashboard']['elements']=[item]
    data={'state':'playing',**card_metadata(State(ENTITY,'playing',attributes())),'artwork':'test-cover'}
    native,_,_=compile_scene({'layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    cover=next(w for w in native['widgets'] if w['id']=='dashboard/player/cover')
    source=next(w for w in native['widgets'] if w['id']=='dashboard/player/media/select_source')
    assert cover['x']>51 and cover['width']<300
    assert cover['y']+cover['height']<source['y']

def test_media_glass_stays_below_cover_and_text_layer_is_clear():
    config=make_layout();config['scenes']['dashboard'].update(glass=True,elements=[media()])
    data={'state':'playing',**card_metadata(State(ENTITY,'playing',attributes())),'artwork':'test-cover'}
    native,_,_=compile_scene({'layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    widgets=native['widgets'];surface=next(w for w in widgets if w['id']=='dashboard/player/surface')
    cover=next(w for w in widgets if w['id']=='dashboard/player/cover')
    text=next(w for w in widgets if w['id']=='dashboard/player')
    assert surface['glass'] and surface['opacity']>0
    assert widgets.index(surface)<widgets.index(cover)<widgets.index(text)
    assert not text.get('glass') and text['opacity']==0
    assert not cover.get('glass') and cover['opacity']==255

@pytest.mark.parametrize('key', [c['key'] for c in SPEC['controls']])
def test_control_geometry_survives_validation_and_native_compilation(key):
    config=make_layout();item=media()
    item['parts']={'control_'+key:{'x':12,'y':23,'width':18,'height':16,'opacity':.8}}
    config['scenes']['dashboard']['elements']=[item]
    config=validate_layout(config)
    box=config['scenes']['dashboard']['elements'][0]['parts']['control_'+key]
    assert box==item['parts']['control_'+key]
    expanded=expand(config['scenes']['dashboard'])
    child=next(e for e in expanded['elements'] if e['id']=='player/media/'+key)
    assert child['x']==pytest.approx(15.8)
    assert child['y']==pytest.approx(24.55)
    assert child['width']==pytest.approx(16.2)
    assert child['height']==pytest.approx(13.6)
    assert child['text_opacity']==pytest.approx(.8)
    assert not any(k.startswith('control_') for k in expanded['elements'][0]['parts'])
    data={'state':'paused',**card_metadata(State(ENTITY,'paused',attributes()))}
    native,actions,_=compile_scene({'view':'dashboard','layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    widget=next(w for w in native['widgets'] if w['id']=='dashboard/player/media/'+key)
    assert abs(widget['x']-child['x']*10.24)<=1
    assert abs(widget['y']-child['y']*6)<=1
    assert abs(widget['width']-child['width']*10.24)<=1
    assert abs(widget['height']-child['height']*6)<=1
    assert widget['id'] in actions


def test_control_visibility_and_disabled_media_preserve_saved_layout():
    scene={'elements':[media()]};item=scene['elements'][0]
    item['parts']={'control_next':{'visible':False},'control_mute':{'x':0,'y':0,'width':10,'height':10}}
    assert not any(e['id'].endswith('/next') for e in expand(scene)['elements'])
    item['media_controls']=False
    assert expand(scene)['elements']==[item]
    item['media_controls']=True
    assert next(e for e in expand(scene)['elements'] if e['id'].endswith('/mute'))['x']==item['x']

@pytest.mark.parametrize('box', [dict(x=95,y=0,width=10,height=10),dict(x=10,y=5,width=12),dict(x=0,y=-1,width=10,height=10)])
def test_invalid_control_bounds_rejected(box):
    config=make_layout();item=media();item['parts']={'control_play_pause':box}
    config['scenes']['dashboard']['elements']=[item]
    with pytest.raises(ValueError):validate_layout(config)


def test_hidden_controls_reflow_and_reclaim_rows_without_changing_the_player():
    from custom_components.display_studio.media_widget import layout
    item=media();initial=layout(item)
    item['media_controls_hidden']=['select_source']
    changed=layout(item)
    slider=next(c for c in changed['controls'] if c['key']=='volume_set')
    assert slider['width']>35
    assert next(c for c in changed['controls'] if c['key']=='volume_down')['x']==4
    item['media_controls_hidden']=SPEC['layout']['rows'][0]
    assert layout(item)['parts']['cover']['height']>initial['parts']['cover']['height']
    item['media_controls_hidden']=[c['key'] for c in SPEC['controls']]
    assert not layout(item)['controls']
    assert layout(item)['parts']['cover']['y']+layout(item)['parts']['cover']['height']==95
    assert (item['x'],item['y'],item['width'],item['height'])==(5,5,90,85)
    item['media_controls_hidden']=[]
    assert layout(item)==initial


def test_reflow_preserves_manual_frames_and_reclaims_hidden_cover():
    from custom_components.display_studio.media_widget import layout
    item=media();item['media_controls_hidden']=['seek_back','next']
    box={'x':42,'y':59,'width':14,'height':19}
    item['parts']={'control_play_pause':box,'title':{'x':4,'y':1,'width':90,'height':12}}
    arranged=layout(item)
    assert {k:next(c for c in arranged['controls'] if c['key']=='play_pause')[k] for k in box}==box
    assert arranged['parts']['title']['y']==1
    for c in arranged['controls']:
        if c['key'] in SPEC['layout']['rows'][0] and c['key']!='play_pause':
            assert c['x']+c['width']<=42 or c['x']>=56
    item['show_cover']=False;del item['parts']['title']
    assert layout(item)['parts']['title']['x']==4
    assert layout(item)['parts']['title']['width']==93


def test_every_control_visibility_combination_has_bounded_nonoverlapping_auto_frames():
    from custom_components.display_studio.media_widget import layout
    item=media()
    for mask in range(1 << len(SPEC['controls'])):
        item['media_controls_hidden']=[c['key'] for i,c in enumerate(SPEC['controls']) if mask & (1 << i)]
        result=layout(item)
        for i,a in enumerate(result['controls']):
            assert a['x']>=0 and a['y']>=0 and a['width']>0 and a['height']>0
            assert a['x']+a['width']<=100.001 and a['y']+a['height']<=100.001
            for b in result['controls'][i+1:]:
                assert a['x']+a['width']<=b['x']+.001 or b['x']+b['width']<=a['x']+.001 or a['y']+a['height']<=b['y']+.001 or b['y']+b['height']<=a['y']+.001


def test_older_saved_default_frames_can_reflow_and_fullscreen_is_preserved():
    from custom_components.display_studio.media_widget import layout
    item=media();item.update(x=0,y=0,width=100,height=100,manual_size=False)
    item['parts']={'control_'+c['key']:{k:c[k] for k in ('x','y','width','height')} for c in SPEC['controls']}
    item['media_controls_hidden']=['select_source']
    assert next(c for c in layout(item)['controls'] if c['key']=='volume_set')['width']>35
    config=make_layout();config['scenes']['dashboard']['elements']=[item]
    saved=validate_layout(config)['scenes']['dashboard']['elements'][0]
    assert saved['width']==saved['height']==100 and saved['manual_size'] is False

@pytest.mark.parametrize('ratio',[1,16/9,2/3])
def test_cover_intrinsic_ratio_without_black_padding_or_distortion(ratio):
    config=make_layout();config['scenes']['dashboard']['elements']=[media()]
    data={'state':'paused',**attributes(),'artwork':'cover','artwork_ratio':ratio}
    scene,_,assets=compile_scene({'view':'dashboard','layout':{'config':config,'values':{ENTITY:data}}},1024,600)
    cover=next(w for w in scene['widgets'] if w['id']=='dashboard/player/cover')
    assert abs(cover['width']/cover['height']-ratio)<.015
    asset=next(a for a in assets.values() if a['resource']=='cover.jpg')
    assert asset['fit']=='cover'

def test_media_progress_and_title_update_without_layout_rebuild():
    from datetime import datetime, timezone
    config=make_layout();config['scenes']['dashboard']['elements']=[media()]
    data={'state':'playing',**attributes(),'media_position_updated_at':'2026-11-01T15:00:00+00:00'}
    payload={'view':'dashboard','layout':{'config':config,'values':{ENTITY:data}}}
    now=datetime(2026,11,1,15,0,10,tzinfo=timezone.utc)
    payload['layout']['now']=now.isoformat()
    scene,_,_=compile_scene(payload,1024,600)
    widget=next(w for w in scene['widgets'] if w['id']=='dashboard/player')
    parts={p['id']:p for p in widget['parts']}
    assert widget['media_timeline']['position']==40 and widget['media_timeline']['playing']
    payload['layout']['now']=(now+timedelta(seconds=5)).isoformat()
    ticked,_,_=compile_scene(payload,1024,600)
    assert ticked['revision']==scene['revision']
    assert parts['progress_bar']['value']==333 and parts['progress_bar']['range_max']==1000
    assert parts['elapsed']['font_size']==parts['album']['font_size']
    assert parts['elapsed']['opacity']==parts['album']['opacity']
    assert parts['title']['marquee'] and parts['title']['nowrap']
    data.update(media_title='A completely new long title',media_position=50)
    newer,_,_=compile_scene(payload,1024,600)
    assert newer['layout_id']==scene['layout_id'] and newer['revision']!=scene['revision']
