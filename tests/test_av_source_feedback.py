"""Display source feedback must remain independent of the sound player's state."""
from unittest.mock import patch
import pytest
from homeassistant.core import HomeAssistant
from homeassistant.components.media_player import MediaPlayerEntityFeature as Feature
from custom_components.display_studio import av_controls as av
from custom_components.display_studio.av_view import create_views, MEDIA_VIEW
from custom_components.display_studio.lvgl import compile_scene

AV='media_player.av';SONOS='media_player.sonos';APPLE='media_player.apple'

@pytest.mark.parametrize('selected_source', ['Dashboard','HDMI 1','Dashboard PiP','Mediaplayer'])
@pytest.mark.parametrize('state,pending', [('off',True),('on',False),('idle',False)])
@pytest.mark.parametrize('sound_state,sound_source', [('idle',None),('playing','Jazz'),('paused','TV'),('unavailable',None)])
async def test_av_source_is_selected_during_boot_and_afterward(tmp_path,state,pending,sound_state,sound_source,selected_source):
    hass=HomeAssistant(str(tmp_path));binding=av.Binding(SONOS,APPLE,'',av=AV)
    hass.states.async_set(AV,state,{'source':selected_source,'source_selection_pending':pending,'source_list':['HDMI 1','Dashboard','Dashboard PiP','Mediaplayer'],'supported_features':int(Feature.SELECT_SOURCE)})
    hass.states.async_set(SONOS,sound_state,{'source':sound_source,'source_list':['TV','Jazz'],'supported_features':int(Feature.SELECT_SOURCE)})
    try:
        with patch.object(av,'resolve',return_value=binding):
            attrs=av.display_state(hass,AV).attributes
        assert attrs['av_selected_source']=='av:'+selected_source
        views=create_views(AV)
        scene,_,_=compile_scene({'view':MEDIA_VIEW,'layout':{'config':{'scenes':{v['id']:v['scene'] for v in views}},'values':{AV:dict(attrs)}}},1024,600)
        control=next(w for w in scene['widgets'] if w['id']==MEDIA_VIEW+'/source')
        assert control['options'][control['value']]=='TV · '+selected_source
    finally: await hass.async_stop(force=True)

@pytest.mark.parametrize('source,expected', [('Jazz','sonos:Jazz'),('Missing','')])
async def test_sonos_source_when_display_is_off_must_be_in_choices(tmp_path,source,expected):
    hass=HomeAssistant(str(tmp_path));binding=av.Binding(SONOS,APPLE,'',av=AV)
    hass.states.async_set(AV,'off',{'source_list':['Dashboard'],'supported_features':int(Feature.SELECT_SOURCE)})
    hass.states.async_set(SONOS,'playing',{'source':source,'source_list':['Jazz'],'supported_features':int(Feature.SELECT_SOURCE)})
    try:
        with patch.object(av,'resolve',return_value=binding): assert av.display_state(hass,AV).attributes['av_selected_source']==expected
    finally: await hass.async_stop(force=True)

@pytest.mark.parametrize('action', ['av_select_source', 'av_power'])
async def test_accepted_startup_survives_disconnected_touch_client(tmp_path,action):
    import asyncio
    hass=HomeAssistant(str(tmp_path));binding=av.Binding(SONOS,APPLE,'',av=AV)
    hass.states.async_set(AV,'off',{'source_list':['Dashboard'],'supported_features':int(Feature.SELECT_SOURCE|Feature.TURN_ON)})
    started=asyncio.Event();finish=asyncio.Event();completed=asyncio.Event();cancelled=[]
    async def slow_start(call):
        started.set()
        try:
            await finish.wait()
            hass.states.async_set(AV,'on',{'source':'Dashboard'})
            completed.set()
        except asyncio.CancelledError:
            cancelled.append(True);raise
    hass.services.async_register('media_player','select_source' if action=='av_select_source' else 'turn_on',slow_start)
    try:
        with patch.object(av,'resolve',return_value=binding):
            request=asyncio.create_task(av.async_execute(hass,AV,action,'av:Dashboard' if action=='av_select_source' else None))
            await asyncio.wait_for(started.wait(),1)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):await request
            assert not cancelled,'Disconnect must not cancel an accepted hardware operation'
            finish.set()
            await asyncio.wait_for(completed.wait(),1)
            assert hass.states.get(AV).attributes['source']=='Dashboard'
    finally:
        finish.set();await hass.async_stop(force=True)

async def test_connected_client_still_receives_source_failure(tmp_path):
    from homeassistant.exceptions import HomeAssistantError
    hass=HomeAssistant(str(tmp_path));binding=av.Binding(SONOS,APPLE,'',av=AV)
    hass.states.async_set(AV,'off',{'source_list':['Dashboard'],'supported_features':int(Feature.SELECT_SOURCE)})
    async def fail(call):raise HomeAssistantError('Display did not become ready')
    hass.services.async_register('media_player','select_source',fail)
    try:
        with patch.object(av,'resolve',return_value=binding),pytest.raises(HomeAssistantError,match='did not become ready'):
            await av.async_execute(hass,AV,'av_select_source','av:Dashboard')
    finally:await hass.async_stop(force=True)
