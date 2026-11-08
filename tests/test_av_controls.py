"""AV source decisions, current-target authorization and shared native views."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.components.media_player import MediaPlayerEntityFeature as Feature
from homeassistant.exceptions import HomeAssistantError
from custom_components.display_studio import av_controls as av
from custom_components.display_studio.av_view import create_views, MEDIA_VIEW, REMOTE_VIEW
from custom_components.display_studio.layout_config import make_layout, validate_tap_action
from custom_components.display_studio.layout_library import from_config, validate_library
from custom_components.display_studio.layouts import DisplayLayouts
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.providers import BrowserProvider

AV = "media_player.living_av"
SONOS = "media_player.sonos"
APPLE = "media_player.apple"
REMOTE = "remote.apple"
FEATURES = int(Feature.PLAY | Feature.PAUSE | Feature.NEXT_TRACK | Feature.PREVIOUS_TRACK | Feature.VOLUME_SET | Feature.VOLUME_MUTE)


@pytest.fixture
async def environment(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    binding = av.Binding(SONOS, APPLE, REMOTE)
    hass.states.async_set(AV, "on")
    hass.states.async_set(SONOS, "playing", {"source": "Music", "media_title": "Song", "supported_features": FEATURES, "volume_level": .3})
    hass.states.async_set(APPLE, "playing", {"media_title": "Movie", "supported_features": FEATURES})
    hass.states.async_set(REMOTE, "off")
    with patch.object(av, "resolve", side_effect=lambda h, entity: binding if entity == AV else None):
        yield hass, binding
    await hass.async_stop(force=True)


@pytest.mark.parametrize("state,attrs,expected", [
    ("playing", {"source": "TV"}, APPLE),
    ("playing", {"source": "tv"}, APPLE),
    ("playing", {"media_content_id": "x-sonos-htastream:device:spdif"}, APPLE),
    ("paused", {"source": "TV"}, APPLE),
    ("idle", {"source": "TV"}, APPLE),
    ("playing", {"source": "Music", "media_title": "TV"}, SONOS),
    ("unavailable", {"source": "TV"}, ""),
])
async def test_source_decision(environment, state, attrs, expected):
    hass, binding = environment
    hass.states.async_set(SONOS, state, attrs)
    assert binding.playback(hass) == expected


async def test_actions_resolve_at_press_time_and_volume_stays_on_sonos(environment):
    hass, binding = environment
    calls = []
    for domain, service in (("media_player", "media_play_pause"), ("media_player", "volume_set"),
                            ("media_player", "volume_mute"), ("remote", "send_command")):
        async def record(call):
            calls.append((call.domain, call.service, dict(call.data)))
        hass.services.async_register(domain, service, record)
    await av.async_execute(hass, AV, "av_play_pause")
    assert calls[-1][2]["entity_id"] == SONOS
    hass.states.async_set(SONOS, "playing", {"source": "TV", "supported_features": FEATURES, "volume_level": .98})
    await av.async_execute(hass, AV, "av_play_pause")
    assert calls[-1][2]["entity_id"] == APPLE
    await av.async_execute(hass, AV, "av_volume_up")
    assert calls[-1] == ("media_player", "volume_set", {"entity_id": SONOS, "volume_level": 1})
    await av.async_execute(hass, AV, "av_mute")
    assert calls[-1][2] == {"entity_id": SONOS, "is_volume_muted": True}
    await av.async_execute(hass, AV, "av_remote_select")
    assert calls[-1] == ("remote", "send_command", {"entity_id": REMOTE, "command": "select"})
    hass.states.async_set(SONOS, "unavailable")
    with pytest.raises(HomeAssistantError):
        await av.async_execute(hass, AV, "av_play_pause")
    await av.async_execute(hass, AV, "av_remote_wakeup")  # Independent of sound-system availability.
    for entity, action in ((APPLE, "av_play_pause"), (AV, "av_remote_injected")):
        with pytest.raises(HomeAssistantError):
            await av.async_execute(hass, entity, action)


async def test_current_metadata_native_clicks_and_dependency_push(environment):
    hass, _ = environment
    layouts = DisplayLayouts(hass, SimpleNamespace(entry_id="avtest"))
    config = make_layout(); config["enabled"] = True
    library = from_config(config); library["views"].extend(create_views(AV))
    layouts.config, layouts.library = validate_library(library, config)
    provider = BrowserProvider(hass, SimpleNamespace(entry_id="avtest"), layouts)
    await provider.async_start()
    layouts.changed = Mock()
    layouts.state_publish_delay = 0
    layouts._subscribe()
    try:
        assert av.dependencies(hass, layouts.config) == {SONOS, APPLE, REMOTE}
        values = layouts.values()
        assert values[AV]["media_title"] == "Song"
        assert values[AV]["name"] == "Sonos · Musik"
        assert layouts._media_target(AV) == SONOS
        hass.states.async_set(SONOS, "playing", {"source": "TV", "supported_features": FEATURES, "volume_level": .27})
        await hass.async_block_till_done()
        await asyncio.sleep(.02)
        assert layouts.changed.called
        values = layouts.values()
        assert values[AV]["media_title"] == "Movie"
        assert values[AV]["volume_level"] == .27
        assert layouts._media_target(AV) == APPLE
        for view in (MEDIA_VIEW, REMOTE_VIEW):
            compiled, actions, _ = compile_scene({"view": view, "layout": {"config": layouts.config, "values": values}}, 1024, 600)
            assert not compiled["warnings"]
            assert actions
            assert all(a["entity_id"] in (AV, "") for a in actions.values())
        with patch.object(av, "async_execute", new_callable=AsyncMock) as execute:
            await provider.async_touch({"action": "av_next", "entity_id": AV})
            execute.assert_awaited_once_with(hass, AV, "av_next", None)
        hass.states.async_set(SONOS, "unavailable")
        values = layouts.values()
        _, actions, _ = compile_scene({"view": REMOTE_VIEW, "layout": {"config": layouts.config, "values": values}}, 1024, 600)
        assert REMOTE_VIEW + "/select" in actions
        assert REMOTE_VIEW + "/louder" not in actions
    finally:
        await provider.async_close()
        await layouts.async_close()


def test_actions_are_bounded_and_layout_roundtrips():
    for action in av.AV_ACTIONS:
        assert validate_tap_action({"action": action, "entity_id": AV})["entity_id"] == AV
    for action in ({"action": "av_remote_select", "entity_id": "remote.other"},
                   {"action": "av_remote_select", "entity_id": AV, "command": "injected"}):
        with pytest.raises(ValueError):
            validate_tap_action(action)
    config = make_layout(); library = from_config(config)
    library["views"].extend(create_views(AV))
    runtime, normalized = validate_library(library, config)
    assert next(e for e in runtime["scenes"][MEDIA_VIEW]["elements"] if e["id"]=="now_playing")["media_av_auto"]
    assert validate_library(normalized, runtime) == (runtime, normalized)


async def test_remote_is_resolved_only_on_the_linked_apple_device(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    options = {"linked_volume_media_player_entity_id": SONOS, "linked_media_player_entity_id": APPLE}
    registry = Mock()
    registry.async_get.side_effect = lambda entity: {
        AV: SimpleNamespace(config_entry_id="av"),
        APPLE: SimpleNamespace(platform="apple_tv", device_id="linked-device"),
    }.get(entity)
    entry = SimpleNamespace(domain="av_companion", options=options)
    hass.config_entries = SimpleNamespace(async_get_entry=Mock(return_value=entry))
    remote = SimpleNamespace(entity_id=REMOTE, domain="remote", platform="apple_tv", disabled_by=None)
    try:
        with patch.object(av.er, "async_get", return_value=registry), patch.object(av.er, "async_entries_for_device", return_value=[remote]) as entries, patch.object(hass.config_entries, "async_get_entry", return_value=entry):
            assert av.resolve(hass, AV).remote == REMOTE
            entries.assert_called_once_with(registry, "linked-device")
            entries.return_value = [remote, remote]
            assert not av.resolve(hass, AV).remote
            options["linked_remote_entity_id"] = "remote.explicit"
            assert av.resolve(hass, AV).remote == "remote.explicit"
    finally:
        await hass.async_stop(force=True)


async def test_audio_format_gap_keeps_selected_tv_route(environment):
    hass, _ = environment
    binding = av.Binding(SONOS, APPLE, REMOTE, audio_format="sensor.audio_format")
    hass.states.async_set(SONOS, "playing", {"source": "TV"})
    hass.states.async_set("sensor.audio_format", "No input")
    assert binding.playback(hass) == APPLE
    hass.states.async_set("sensor.audio_format", "Dolby Digital 5.1")
    assert binding.playback(hass) == APPLE
    hass.states.async_set(SONOS, "playing", {"source": "Music"})
    assert binding.playback(hass) == SONOS  # Stale format is never enough on its own.


def test_media_cover_is_positioned_under_touch_and_progress_uses_group_font():
    views = create_views(AV)
    config = {'scenes': {v['id']: v['scene'] for v in views}}
    values = {AV: {'state': 'playing', 'artwork': 'cover-key', 'media_duration': 215, 'media_position': 47,
                   'volume_level': .27, 'av_available_actions': ['av_play_pause']}}
    scene, actions, assets = compile_scene({'view': MEDIA_VIEW, 'layout': {'config': config, 'values': values}}, 1024, 600)
    widgets = {w['id']: w for w in scene['widgets']}
    key = MEDIA_VIEW + '/now_playing'
    assert list(widgets).index(key+'/surface') < list(widgets).index(key+'/cover') < list(widgets).index(key)
    assert widgets[key]['opacity'] == 0 and widgets[key]['clickable']
    cover = widgets[key+'/cover']
    assert cover['x'] > widgets[key]['x'] and cover['width'] < widgets[key]['width'] / 2
    assert next(iter(assets.values()))['query']['entity'] == AV
    parts = {p['id']:p for p in widgets[key]['parts']}
    assert parts['elapsed']['text'] == '0:47' and parts['duration']['text'] == '−2:48 / 3:35'
    # Even when the album is hidden, time inherits its default compact size.
    assert parts['elapsed']['font_size'] == round(600 * 4.3 / 100 * .27)
    assert parts['elapsed']['opacity']==.55
    assert parts['elapsed']['height'] >= parts['elapsed']['line_height']
    assert parts['volume']['text'] == 'Lautstärke: 27 %'

async def test_modern_value_controls_are_scoped_and_bounded(environment):
    hass, _ = environment
    binding = av.Binding(SONOS, APPLE, REMOTE, av=AV)
    calls=[]
    async def record(call): calls.append((call.service, dict(call.data)))
    for service in ('volume_set','select_source','turn_on','turn_off'):
        hass.services.async_register('media_player',service,record)
    hass.states.async_set(AV,'on',{'source':'HDMI 1','source_list':['HDMI 1','Dashboard'], 'supported_features':int(Feature.SELECT_SOURCE|Feature.TURN_ON|Feature.TURN_OFF)})
    hass.states.async_set(SONOS,'playing',{'source':'Music','source_list':['TV','My playlist'],'volume_level':.31,'supported_features':FEATURES|int(Feature.SELECT_SOURCE)})
    with patch.object(av,'resolve',return_value=binding):
        provider=BrowserProvider(hass,SimpleNamespace(entry_id='values'),DisplayLayouts(hass,SimpleNamespace(entry_id='values')))
        await provider.async_touch({'action':'av_volume_set','entity_id':AV},42)
        assert calls[-1]==('volume_set',{'entity_id':SONOS,'volume_level':.42})
        for value in (-1,101,True,.4,'42'):
            with pytest.raises(HomeAssistantError): await provider.async_touch({'action':'av_volume_set','entity_id':AV},value)
        await provider.async_touch({'action':'av_select_source','entity_id':AV,'_options':['','av:HDMI 1','sonos:My playlist']},2)
        assert calls[-1]==('select_source',{'entity_id':SONOS,'source':'My playlist'})
        await provider.async_touch({'action':'av_select_source','entity_id':AV},'av:HDMI 1')
        assert calls[-1]==('select_source',{'entity_id':AV,'source':'HDMI 1'})
        for value in ('av:injected',True,None,'other:TV'):
            with pytest.raises(HomeAssistantError): await provider.async_touch({'action':'av_select_source','entity_id':AV},value)
        await provider.async_touch({'action':'av_power','entity_id':AV})
        assert calls[-1]==('turn_off',{'entity_id':AV})
        hass.states.async_set(AV,'off',{'supported_features':int(Feature.TURN_ON)})
        await provider.async_touch({'action':'av_power','entity_id':AV})
        assert calls[-1]==('turn_on',{'entity_id':AV})
        with pytest.raises(HomeAssistantError): await provider.async_touch({'action':'av_select_source','entity_id':AV},'av:HDMI 1')
        with pytest.raises(ValueError): await provider.async_touch({'action':'av_play_pause','entity_id':AV},42)


def test_native_control_updates_preserve_structure_and_snapshot_sources():
    views=create_views(AV)
    state={'view':MEDIA_VIEW,'layout':{'config':{'scenes':{v['id']:v['scene'] for v in views}},'values':{AV:{'state':'playing','volume_level':.37,'av_power':'on','av_sources':[{'value':'av:HDMI 1','label':'TV · HDMI 1'}],'av_selected_source':'av:HDMI 1','av_available_actions':sorted(av.AV_ACTIONS)}}}}
    first,actions,_=compile_scene(state,1024,600)
    widgets={w['id']:w for w in first['widgets']}
    assert widgets[MEDIA_VIEW+'/volume']['value']==37
    assert widgets[MEDIA_VIEW+'/source']['options']==['Quelle wählen','TV · HDMI 1']
    assert actions[MEDIA_VIEW+'/source']['_options']==['','av:HDMI 1']
    state['layout']['values'][AV].update(state='paused',volume_level=.58,av_power='off')
    second,_,_=compile_scene(state,1024,600)
    assert first['layout_id']==second['layout_id'] and first['revision']!=second['revision']

async def test_auto_media_routing_reflows_controls_without_losing_preferences(environment):
    from custom_components.display_studio.layout_config import element
    from custom_components.display_studio.media_widget import expand
    hass, _ = environment
    manager = DisplayLayouts(hass, SimpleNamespace(entry_id='automatic-av'))
    item = element('media', 2, 2, 96, 96)
    item.update(id='player', entity_id=AV, media_controls_hidden=['next'])
    config = make_layout();config['enabled']=True;config['scenes']['dashboard']['elements']=[item]
    manager.config=config;manager.library=from_config(config)
    # No media_av_auto flag: a linked AV player must still route correctly.
    assert AV in av.routed_entities(hass, config)
    assert av.dependencies(hass, config) >= {SONOS, APPLE, REMOTE}
    calls=[]
    async def record(call):calls.append((call.service,dict(call.data)))
    for service in ('media_play_pause','media_seek','volume_set','volume_mute'):
        hass.services.async_register('media_player',service,record)
    try:
        for sound_source,expected,seek in [('Music',SONOS,False),('TV',APPLE,True),('Music',SONOS,False)]:
            hass.states.async_set(SONOS,'playing',{'source':sound_source,'supported_features':FEATURES,'volume_level':.31})
            hass.states.async_set(APPLE,'playing',{'supported_features':int(Feature.PLAY|Feature.PAUSE|Feature.SEEK),'media_position':20,'media_duration':180})
            values=manager.values();assert values[AV]['av_source']==expected
            children=expand(config['scenes']['dashboard'],values)['elements'][1:]
            keys={c['id'].split('/media/')[1] for c in children}
            assert ('seek_forward' in keys)==seek and 'next' not in keys
            native,actions,_=compile_scene({'view':'dashboard','layout':{'config':config,'values':values}},1024,600)
            assert ('dashboard/player/media/seek_forward' in actions)==seek
            await av.async_execute(hass,AV,'av_play_pause');assert calls[-1][1]['entity_id']==expected
            if seek:
                await av.async_execute(hass,AV,'av_seek_forward');assert calls[-1]==('media_seek',{'entity_id':APPLE,'seek_position':30})
            await av.async_execute(hass,AV,'av_volume_set',63);assert calls[-1]==('volume_set',{'entity_id':SONOS,'volume_level':.63})
            await av.async_execute(hass,AV,'av_mute');assert calls[-1][1]['entity_id']==SONOS
            assert item['media_controls_hidden']==['next']
        hass.states.async_set(SONOS,'playing',{'source':'TV','supported_features':int(Feature.VOLUME_SET)})
        assert 'av_volume_up' not in manager.values()[AV]['av_available_actions']
    finally:
        await manager.async_close()


async def test_av_cover_fallback_cache_and_late_response_follow_active_app(environment):
    from io import BytesIO
    from PIL import Image
    hass, _ = environment
    manager=DisplayLayouts(hass,SimpleNamespace(entry_id='av-covers'))
    from custom_components.display_studio.layout_config import element
    item=element('media',2,2,96,96);item.update(id='player',entity_id=AV)
    manager.config=make_layout();manager.config['enabled']=True;manager.config['scenes']['dashboard']['elements']=[item]
    manager.library=from_config(manager.config)
    hass.data['display_studio']={'av-covers':{'layouts':manager}}
    def picture(color):
        out=BytesIO();Image.new('RGB',(64,64),color).save(out,format='PNG');return out.getvalue()
    logo=SimpleNamespace(async_get_media_image=AsyncMock(return_value=(picture('red'),'image/png')))
    cover=SimpleNamespace(async_get_media_image=AsyncMock(return_value=(picture('blue'),'image/png')))
    hass.data['media_player']=SimpleNamespace(get_entity=lambda entity:{AV:logo,APPLE:cover,SONOS:cover}.get(entity))
    hass.states.async_set(SONOS,'playing',{'source':'TV','volume_level':.23,'supported_features':FEATURES})
    def app(name):
        hass.states.async_set(APPLE,'idle',{'app_id':'app.'+name,'app_name':name,'supported_features':int(Feature.PLAY)})
        hass.states.async_set(AV,'idle',{'app_id':'app.'+name,'app_name':name,'entity_picture':'/api/media_player_proxy/av?token=PRIVATE'})
    try:
        app('Netflix')
        info=manager.preview_media_value(AV)
        assert info['artwork'] is None  # Do not publish a static ESP asset before bytes exist.
        await manager.media.async_image(AV,manager.media.key(AV))
        info=manager.preview_media_value(AV)
        assert info['media_title']=='Netflix' and info['av_routed'] and info['artwork']
        assert manager._media_target(AV)==AV
        first=info['artwork'];raw=await manager.media.async_image(AV,first)
        assert raw[:2]==b'\xff\xd8';logo.async_get_media_image.assert_awaited_once();cover.async_get_media_image.assert_not_awaited()
        assert 'PRIVATE' not in str(info)
        # The scoped device route and authenticated Studio route return the same logo.
        device=await manager.async_resource('cover.jpg',{'entity':AV,'v':first,'size':'640'}, {})
        assert device.status==200 and device.body==raw
        from custom_components.display_studio.layout_api import LayoutMediaView
        request=SimpleNamespace(query={'v':first},get=lambda key:SimpleNamespace(is_admin=True) if key=='hass_user' else None)
        preview=await LayoutMediaView(hass).get(request,'av-covers',AV)
        assert preview.status==200 and preview.body==device.body
        native,_,assets=compile_scene({'view':'dashboard','layout':{'config':manager.config,'values':manager.values()}},1024,600)
        assert any(w['id'].endswith('/cover') for w in native['widgets'])
        assert next(a for a in assets.values() if a['resource']=='cover.jpg')['query']['v']==first

        # A real cover takes priority as soon as it appears.
        hass.states.async_set(APPLE,'playing',{**hass.states.get(APPLE).attributes,'entity_picture':'/real-cover','media_title':'Movie'})
        assert manager._media_target(AV)==APPLE
        assert manager.preview_media_value(AV)['media_title']=='Movie'
        raw=await manager.media.async_image(APPLE,manager.media.key(APPLE));assert raw[:2]==b'\xff\xd8'
        # Old app logo must not survive app/source changes, including in-flight fetches.
        app('YouTube');assert manager.preview_media_value(AV)['artwork'] is None
        second=manager.media.key(AV);assert second!=first
        started=asyncio.Event();release=asyncio.Event()
        async def delayed():started.set();await release.wait();return picture('green'),'image/png'
        logo.async_get_media_image.side_effect=delayed
        task=asyncio.create_task(manager.media.async_image(AV,second));await started.wait()
        app('Music');release.set();assert await task is None
        hass.states.async_set(APPLE,'idle',{'app_id':'different.app','app_name':'Different'})
        assert manager._media_target(AV)==APPLE and manager.preview_media_value(AV)['artwork'] is None
        hass.states.async_set(SONOS,'playing',{'source':'Music','entity_picture':'/song-cover','media_title':'Song','supported_features':FEATURES})
        assert manager._media_target(AV)==SONOS and manager.preview_media_value(AV)['media_title']=='Song'
    finally:
        await manager.async_close()
