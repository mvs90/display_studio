"""Apple TV relative commands, live availability and native/browser intent."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from pyatv.const import FeatureName, FeatureState
from pyatv.exceptions import NotSupportedError
from homeassistant.core import HomeAssistant
from homeassistant.components.media_player import MediaPlayerEntityFeature as Feature
from homeassistant.exceptions import HomeAssistantError
from custom_components.display_studio import apple_tv_controls as apple, av_controls as av
from custom_components.display_studio.layout_config import element, make_layout
from custom_components.display_studio.layouts import DisplayLayouts
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.media_widget import expand

PLAYER, SONOS, AV, REMOTE = ('media_player.apple', 'media_player.sonos', 'media_player.av', 'remote.apple')


@pytest.fixture
async def connected(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    hass.states.async_set(PLAYER, 'playing', {'app_name': 'Netflix'})
    hass.states.async_set(SONOS, 'playing', {'source': 'TV', 'volume_level': .4})
    hass.states.async_set(REMOTE, 'on')
    states = {feature: FeatureState.Available for feature in (FeatureName.SkipForward, FeatureName.SkipBackward)}
    states.update({FeatureName.Next: FeatureState.Unavailable, FeatureName.Previous: FeatureState.Unavailable})
    remote = SimpleNamespace(skip_forward=AsyncMock(), skip_backward=AsyncMock(), next=AsyncMock(), previous=AsyncMock())
    atv = SimpleNamespace(remote_control=remote, features=SimpleNamespace(
        get_feature=lambda feature: SimpleNamespace(state=states[feature])))
    entry = SimpleNamespace(domain='apple_tv', runtime_data=SimpleNamespace(atv=atv))
    registry = Mock()
    registry.async_get.side_effect = lambda entity: SimpleNamespace(platform='apple_tv', domain='media_player', config_entry_id='apple') if entity == PLAYER else None
    with patch.object(apple.er, 'async_get', return_value=registry), patch.object(hass, 'config_entries', SimpleNamespace(async_get_entry=lambda _: entry)), patch.object(av, 'resolve', return_value=av.Binding(SONOS, PLAYER, REMOTE)):
        yield hass, states, remote, entry
    await hass.async_stop(force=True)


async def test_tracks_require_current_app_capabilities_not_static_ha_features(connected):
    hass, states, remote, _ = connected
    attrs = {"app_name": "Netflix", "supported_features": int(Feature.NEXT_TRACK | Feature.PREVIOUS_TRACK)}
    hass.states.async_set(PLAYER, 'playing', attrs)
    binding = av.resolve(hass, AV)
    assert not {'av_next', 'av_previous'} & set(binding.available(hass))
    assert {'av_seek_forward', 'av_seek_back'} <= set(binding.available(hass))
    calls = []
    async def record(call): calls.append((call.service, call.data['entity_id']))
    hass.services.async_register('media_player', 'media_next_track', record)
    hass.services.async_register('media_player', 'media_previous_track', record)
    for action in ('av_next', 'av_previous'):
        with pytest.raises(HomeAssistantError): await av.async_execute(hass, AV, action)
    for feature, action, service in ((FeatureName.Next, 'av_next', 'media_next_track'),
                                     (FeatureName.Previous, 'av_previous', 'media_previous_track')):
        states[feature] = FeatureState.Available
        assert action in binding.available(hass)
        await av.async_execute(hass, AV, action)
        assert calls[-1] == (service, PLAYER)
        for unavailable in (FeatureState.Unknown, FeatureState.Unavailable, FeatureState.Unsupported):
            states[feature] = unavailable
            assert action not in binding.available(hass)
    hass.states.async_set(SONOS, 'playing', {**attrs, 'source': 'Music'})
    assert {'av_next', 'av_previous'} <= set(binding.available(hass))
    await av.async_execute(hass, AV, 'av_next')
    assert calls[-1] == ('media_next_track', SONOS)
    hass.states.async_set(SONOS, 'playing', {'source': 'TV'})
    states[FeatureName.Next] = FeatureState.Available
    hass.states.async_set(PLAYER, 'off', attrs)
    assert 'av_next' not in binding.available(hass)


async def test_capability_only_change_pushes_once_and_timer_is_cleaned_up(connected):
    hass, states, _, _ = connected
    manager = DisplayLayouts(hass, SimpleNamespace(entry_id='capabilities'))
    manager.config['enabled'] = True
    manager.config['scenes']['dashboard']['elements'] = [
        {**element('media', 5, 5, 90, 90), 'entity_id': AV, 'media_av_auto': True}]
    manager.changed = Mock()
    manager.state_publish_delay = 0
    manager._subscribe()
    # Cancel unrelated forecast work. Drive the scheduled capability callback
    # without changing HA state/title: exactly the Companion-only update case.
    manager._timer(); manager._timer = None
    try:
        def tick():
            manager._av_capability_timer()
            manager._av_capability_tick(None)
        tick()
        await __import__('asyncio').sleep(.02)
        manager.changed.assert_not_called()
        states[FeatureName.Next] = FeatureState.Available
        tick()
        await __import__('asyncio').sleep(.02)
        manager.changed.assert_called_once()
        assert 'av_next' in manager.values()[AV]['av_available_actions']
        tick()
        await __import__('asyncio').sleep(.02)
        manager.changed.assert_called_once()
    finally:
        await manager.async_close()
    assert manager._av_capability_timer is None
    manager._av_capability_tick(None)
    assert manager._av_capability_timer is None


async def test_relative_ten_seconds_without_absolute_position(connected):
    hass, states, remote, _ = connected
    binding = av.resolve(hass, AV)
    assert {'av_seek_forward', 'av_seek_back'} <= set(binding.available(hass))
    await av.async_execute(hass, AV, 'av_seek_forward')
    await av.async_execute(hass, AV, 'av_seek_back')
    remote.skip_forward.assert_awaited_once_with(time_interval=10.0)
    remote.skip_backward.assert_awaited_once_with(time_interval=10.0)
    # Re-evaluate app capabilities and audio routing at each touch.
    states[FeatureName.SkipForward] = FeatureState.Unavailable
    assert 'av_seek_forward' not in binding.available(hass)
    assert 'av_seek_back' in binding.available(hass)
    with pytest.raises(HomeAssistantError): await av.async_execute(hass, AV, 'av_seek_forward')
    hass.states.async_set(SONOS, 'playing', {'source': 'Music'})
    with pytest.raises(HomeAssistantError): await av.async_execute(hass, AV, 'av_seek_back')
    assert remote.skip_backward.await_count == 1


@pytest.mark.parametrize('state', ['off', 'standby', 'unavailable', 'unknown', 'idle'])
async def test_skip_fails_closed_outside_playback(connected, state):
    hass, _, remote, _ = connected
    hass.states.async_set(PLAYER, state)
    assert apple.skip_target(hass, PLAYER, True) is None
    with pytest.raises(HomeAssistantError): await apple.async_skip(hass, PLAYER, True)
    remote.skip_forward.assert_not_called()


async def test_disconnect_unsupported_and_wrong_entity_do_not_send(connected):
    hass, states, remote, entry = connected
    assert apple.skip_target(hass, SONOS, True) is None
    for state in (FeatureState.Unknown, FeatureState.Unsupported, FeatureState.Unavailable):
        states[FeatureName.SkipForward] = state
        assert apple.skip_target(hass, PLAYER, True) is None
    states[FeatureName.SkipForward] = FeatureState.Available
    remote.skip_forward.side_effect = NotSupportedError()
    with pytest.raises(HomeAssistantError): await apple.async_skip(hass, PLAYER, True)
    entry.runtime_data.atv = None
    assert apple.skip_target(hass, PLAYER, True) is None


async def test_native_controls_hide_and_reappear_without_saving_preferences(connected):
    hass, _, _, _ = connected
    manager = DisplayLayouts(hass, SimpleNamespace(entry_id='availability'))
    item = element('media', 5, 5, 90, 90)
    item.update(id='player', entity_id=AV, media_controls=True, media_remote_view='media_view', media_controls_hidden=['next'])
    config = make_layout(); config['scenes']['dashboard']['elements'] = [item]
    manager.config = config
    try:
        for state, visible in [('playing', True), ('off', False), ('unavailable', False), ('paused', True)]:
            hass.states.async_set(PLAYER, state, {'app_name': 'Netflix'})
            values = manager.values()
            native, actions, _ = compile_scene({'view':'dashboard', 'layout':{'config':config, 'values':values}}, 1024, 600)
            keys = {k.rsplit('/', 1)[-1] for k in actions}
            assert ('remote' in keys) is visible
            assert ('seek_forward' in keys) is visible
            assert ('seek_back' in keys) is visible
            assert 'next' not in keys
            assert item['media_controls_hidden'] == ['next']
        hass.states.async_set(SONOS, 'playing', {'source':'Music'})
        children = expand(config['scenes']['dashboard'], manager.values())['elements']
        assert any(c['id'].endswith('/remote') for c in children)
        assert not any(c['id'].endswith('/seek_forward') for c in children)
        hass.states.async_set(PLAYER, 'off')
        assert not any(c['id'].endswith('/remote') for c in expand(config['scenes']['dashboard'], manager.values())['elements'])
    finally:
        await manager.async_close()
