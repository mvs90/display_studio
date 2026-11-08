"""Exclusive device ownership, rollback and offline design preservation."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from aiohttp import web
from homeassistant.core import HomeAssistant

from custom_components.display_studio.devices import (
    DevicesView, DeviceBindingView, inventory, validate_target, descriptor, binding_lock,
)


def entry(id, domain, **data):
    return SimpleNamespace(entry_id=id, title=id, domain=domain, data=data,
                           unique_id=id, options={})


class Request(dict):
    def __init__(self, data=None, admin=True):
        super().__init__(hass_user=SimpleNamespace(is_admin=admin))
        async def chunks(_):
            yield json.dumps(data or {}).encode()
        self.content = SimpleNamespace(iter_chunked=chunks)


@pytest.fixture
async def devices(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    rows = [entry('square', 'esphome_display', native_node='square', profile='guition_esp32_4848s040', width=480, height=480),
            entry('replacement', 'esphome_display', native_node='replacement', profile='waveshare_esp32_s3_touch_lcd_4_rev4', width=480, height=480),
            entry('large', 'esphome_display', native_node='large', profile='guition_jc1060p470', width=1024, height=600),
            entry('lg', 'lg_rs232_ip', host='lg.local', port=9761),
            entry('studio', 'display_studio', provider='esphome', esphome_entry_id='square')]
    manager = SimpleNamespace(
        async_entries=lambda domain: [e for e in rows if e.domain == domain],
        async_get_entry=lambda id: next((e for e in rows if e.entry_id == id), None),
        async_unload=AsyncMock(return_value=True), async_setup=AsyncMock(return_value=True),
        flow=SimpleNamespace(async_init=AsyncMock(), async_configure=AsyncMock(), async_abort=Mock()))
    manager.async_update_entry = Mock(side_effect=lambda e, **kwargs: [setattr(e, k, v) for k, v in kwargs.items()])
    hass.config_entries = manager
    layouts = SimpleNamespace(source_views={'mine': 'Meine Ansicht'})
    provider = SimpleNamespace(status={'connected': True, 'capabilities': {'native_lvgl': True}, 'rendering': {'width': 480, 'height': 480}}, selected_view='mine')
    hass.data['display_studio'] = {'studio': {'provider': provider, 'layouts': layouts}}
    yield SimpleNamespace(hass=hass, rows=rows, manager=manager, studio=rows[-1], layouts=layouts)
    hass.config_entries = SimpleNamespace(async_shutdown=AsyncMock())
    await hass.async_stop(force=True)


async def test_inventory_includes_unloaded_and_bound_devices_without_secrets(devices):
    d = devices
    d.rows.append(entry('offline-studio', 'display_studio', provider='lg', lg_entry_id='lg', token='never-export'))
    result = inventory(d.hass)
    assert len(result['entries']) == 2
    assert result['entries'][0]['selected_view'] == 'Meine Ansicht'
    assert result['entries'][0]['status'] == 'online'
    assert result['entries'][1]['status'] == 'setup_error'
    assert next(t for t in result['targets'] if t['entry_id']=='square')['assigned_to'] == ['studio']
    assert 'never-export' not in json.dumps(result)
    assert {t['id'] for t in result['types']} == {'lg', 'esphome', 'browser'}


async def test_same_resolution_accepts_different_models(devices):
    assert validate_target(devices.hass, 'esphome', 'replacement', current=devices.studio).entry_id == 'replacement'
    for provider, target in [('esphome', 'large'), ('lg', 'lg')]:
        with pytest.raises(ValueError, match='incompatible_device'):
            validate_target(devices.hass, provider, target, current=devices.studio)
    assert descriptor(entry('p', 'esphome_display', width=480, height=800))['compatibility'] == descriptor(entry('l', 'esphome_display', width=800, height=480))['compatibility']


async def test_duplicate_physical_alias_is_rejected_even_if_owner_is_unloaded(devices):
    d = devices
    d.rows.append(entry('alias', 'esphome_display', native_node='SQUARE', width=480, height=480))
    with pytest.raises(ValueError, match='device_in_use'):
        validate_target(d.hass, 'esphome', 'alias')
    d.rows.extend([entry('lg2','lg_rs232_ip',host='LG.LOCAL.',port=9761),entry('lg-studio','display_studio',provider='lg',lg_entry_id='lg')])
    with pytest.raises(ValueError, match='device_in_use'):
        validate_target(d.hass,'lg','lg2')


async def test_rebind_preserves_entry_library_and_view(devices):
    d = devices
    async def setup(id):
        assert d.hass.data['display_studio_binding_views'][id] == 'mine'
        return True
    d.manager.async_setup.side_effect = setup
    response = await DeviceBindingView(d.hass).post(Request({'target_entry_id':'replacement','previous_target_entry_id':'square'}),'studio')
    assert response.status == 200
    assert d.studio.data['esphome_entry_id'] == 'replacement'
    assert 'binding_view' not in d.studio.data
    assert not d.hass.data.get('display_studio_binding_views')
    assert d.studio.unique_id == 'esphome_replacement'
    assert d.hass.data['display_studio']['studio']['layouts'] is d.layouts
    d.manager.async_unload.assert_awaited_once_with('studio')
    d.manager.async_setup.assert_awaited_once_with('studio')


@pytest.mark.parametrize('target,previous,error',[('large','square','incompatible_device'),('lg','square','device_missing'),('missing','square','device_missing'),('replacement','stale','binding_changed')])
async def test_invalid_or_stale_binding_has_no_side_effect(devices,target,previous,error):
    d = devices
    result=await DeviceBindingView(d.hass).post(Request({'target_entry_id':target,'previous_target_entry_id':previous}),'studio')
    assert result.status==409 and json.loads(result.text)['error']==error
    assert d.studio.data['esphome_entry_id']=='square'
    d.manager.async_unload.assert_not_called()


async def test_setup_failure_rolls_back_and_keeps_old_owner(devices):
    d=devices;old=dict(d.studio.data);d.manager.async_setup.side_effect=[False,True]
    result=await DeviceBindingView(d.hass).post(Request({'target_entry_id':'replacement','previous_target_entry_id':'square'}),'studio')
    assert result.status==409
    assert d.studio.data==old and d.studio.unique_id=='studio'
    assert d.manager.async_setup.await_count==2
    with pytest.raises(ValueError,match='device_in_use'):validate_target(d.hass,'esphome','square')


async def test_detach_retains_resolution_and_releases_device(devices):
    d=devices
    result=await DeviceBindingView(d.hass).post(Request({'target_entry_id':None,'previous_target_entry_id':'square'}),'studio')
    assert result.status==200
    assert d.studio.data['binding_info']['compatibility']=='esphome:480x480'
    assert inventory(d.hass)['entries'][0]['status']=='unbound'
    assert validate_target(d.hass,'esphome','square').entry_id=='square'
    assert validate_target(d.hass,'esphome','replacement',current=d.studio).entry_id=='replacement'
    with pytest.raises(ValueError,match='incompatible_device'):validate_target(d.hass,'esphome','large',current=d.studio)


async def test_simultaneous_creation_cannot_claim_one_device_twice(devices):
    d=devices
    d.manager.flow.async_init.return_value={'type':'form','flow_id':'new'}
    async def finish(*_):
        async with binding_lock(d.hass):
            validate_target(d.hass, 'esphome', 'replacement')
            await asyncio.sleep(0)
            return await create()
    async def create():
        created=entry('new-studio','display_studio',provider='esphome',esphome_entry_id='replacement')
        d.rows.append(created)
        return {'type':'create_entry','result':created}
    d.manager.flow.async_configure.side_effect=finish
    view=DevicesView(d.hass)
    results=await asyncio.gather(*(view.post(Request({'name':'Neu','provider':'esphome','target_entry_id':'replacement'})) for _ in range(2)))
    assert sorted(r.status for r in results)==[201,409]
    assert len([e for e in d.rows if e.entry_id=='new-studio'])==1


async def test_browser_creation_and_failed_flow_cleanup(devices):
    d=devices;view=DevicesView(d.hass)
    d.manager.flow.async_init.return_value={'type':'create_entry','result':entry('browser','display_studio')}
    result=await view.post(Request({'name':'Küche','provider':'browser'}))
    assert result.status==201 and json.loads(result.text)['entry_id']=='browser'
    d.manager.flow.async_configure.assert_not_called()
    d.manager.flow.async_init.return_value={'type':'form','flow_id':'pending'}
    d.manager.flow.async_configure.return_value={'type':'form','flow_id':'pending','errors':{'base':'esphome_not_ready'}}
    result=await view.post(Request({'name':'Neu','provider':'esphome','target_entry_id':'replacement'}))
    assert result.status==409
    d.manager.flow.async_abort.assert_called_once_with('pending')


async def test_admin_required_and_unknown_entry_rejected(devices):
    with pytest.raises(web.HTTPForbidden):await DevicesView(devices.hass).get(Request(admin=False))
    with pytest.raises(web.HTTPForbidden):await DevicesView(devices.hass).post(Request(admin=False))
    with pytest.raises(web.HTTPForbidden):await DeviceBindingView(devices.hass).post(Request(admin=False),'studio')
    with pytest.raises(web.HTTPNotFound):await DeviceBindingView(devices.hass).post(Request(),'missing')
