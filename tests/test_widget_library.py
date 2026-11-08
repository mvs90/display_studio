"""Shared content changes must never replace per-display bindings or geometry."""
from copy import deepcopy
from unittest.mock import Mock
import pytest
from custom_components.display_studio.layout_config import element, validate_layout
from custom_components.display_studio.widget_library import KEY, WidgetLibrary, resolve_item, validate_widget
from custom_components.display_studio.layouts import DisplayLayouts, LayoutConflict
from tests.test_layouts import layouts  # noqa: F401


def definition(**extra):
    return {'id': 'widget_clock', 'name': 'Meine Uhr', 'item': {**element('clock', 0, 0, 25, 20), 'clock_gap': 3, **extra}}


@pytest.mark.parametrize('change', [
    {'id': '../x'}, {'name': ''}, {'name': 'x\ny'}, {'name': 'x'*81},
    {'item': {}}, {'item': element('hdmi', 0, 0, 50, 50)},
    {'item': {**element('clock', 0, 0, 25, 20), 'width': float('nan')}},
])
def test_invalid_definitions_are_rejected(change):
    with pytest.raises((ValueError, TypeError, KeyError)):
        validate_widget({**definition(), **change})


def test_design_preserves_binding_size_and_visibility():
    template = validate_widget(definition())
    item = {**element('clock', 43, 20, 40, 32), 'widget_template': template['id'],
            'clock_seconds': True, 'tap_action': {'action':'show_view','entity_id':'','view':'view_home'},
            'parts': {'date': {'visible': False, 'x': 8}}, 'clock_gap': 1}
    updated = resolve_item(item, [template])
    assert updated['clock_gap'] == 3
    assert updated['parts']['date'] == {'visible': False}
    for key in ('id','x','y','width','height','tap_action','clock_seconds'):
        assert updated[key] == item[key]
    assert item['clock_gap'] == 1


async def test_shared_edit_updates_use_not_unrelated_views_and_survives_restart(layouts):
    library = WidgetLibrary(layouts.hass)
    layouts.hass.data[KEY] = library
    await library.async_save(definition(), 0)
    views = deepcopy(layouts.library)
    one = next(v for v in views['views'] if v['id']=='dashboard')
    two = deepcopy(one);two.update(id='view_second', name='Zweite Uhr')
    for i, view in enumerate((one,two)):
        view['scene']['elements'] = [{**definition()['item'], 'id':'clock_'+str(i),
            'widget_template':'widget_clock', 'x':10+i*20, 'clock_seconds':bool(i)}]
    views['views'].append(two)
    await layouts.async_save(layouts.config, layouts.revision, views)
    before = deepcopy(layouts.library)
    layouts.changed = Mock()
    await library.async_save(definition(clock_gap=8), 1)
    for old, new in zip(before['views'], layouts.library['views']):
        if old['id'] not in ('dashboard','view_second'):
            assert new == old
        else:
            assert new['scene']['elements'][0]['clock_gap'] == 8
            for key in ('id','x','width','height','clock_seconds'):
                assert new['scene']['elements'][0][key] == old['scene']['elements'][0][key]
    layouts.changed.assert_called_once()
    restored = WidgetLibrary(layouts.hass);await restored.async_load()
    assert restored.widgets == library.widgets
    restarted = DisplayLayouts(layouts.hass, layouts.entry)
    try:
        await restarted.async_start()
        assert restarted.library == layouts.library
        assert validate_layout(restarted.config) == restarted.config
    finally:
        await restarted.async_close()


async def test_stale_template_editor_and_invalid_type_cannot_overwrite(layouts):
    library = WidgetLibrary(layouts.hass);layouts.hass.data[KEY] = library
    await library.async_save(definition(), 0)
    with pytest.raises(LayoutConflict):await library.async_save(definition(clock_gap=9), 0)
    assert library.widgets[0]['item']['clock_gap'] == 3
    bound = {**definition()['item'], 'widget_template':'widget_clock'}
    other = validate_widget({**definition(), 'item':element('text',0,0,25,20)})
    with pytest.raises(ValueError):resolve_item(bound,[other])
    with pytest.raises(ValueError):resolve_item(bound,[])


async def test_offline_layout_resolves_new_template_at_start(layouts):
    library = WidgetLibrary(layouts.hass);layouts.hass.data[KEY] = library
    await library.async_save(definition(),0)
    views = deepcopy(layouts.library)
    view = next(v for v in views['views'] if v['id']=='dashboard')
    view['scene']['elements']=[{**definition()['item'],'widget_template':'widget_clock'}]
    await layouts.async_save(layouts.config,layouts.revision,views)
    # Simulate an unloaded display during a template update.
    layouts.hass.data['display_studio'] = {}
    await library.async_save(definition(clock_gap=7),1)
    restarted = DisplayLayouts(layouts.hass,layouts.entry)
    try:
        await restarted.async_start()
        item = next(v for v in restarted.library['views'] if v['id']=='dashboard')['scene']['elements'][0]
        assert item['clock_gap'] == 7
        assert restarted.revision == layouts.revision+1
    finally:await restarted.async_close()


async def test_multiple_displays_keep_entities_actions_positions_and_native_output(layouts):
    from types import SimpleNamespace
    from custom_components.display_studio.lvgl import compile_scene
    library = WidgetLibrary(layouts.hass);layouts.hass.data[KEY] = library
    template = {'id':'widget_weather','name':'Wetter','item':element('weather',0,0,50,50)}
    await library.async_save(template,0)
    second = DisplayLayouts(layouts.hass,SimpleNamespace(entry_id='two',options={},data={'provider':'esphome'}))
    try:
        await second.async_start()
        layouts.hass.data['display_studio']['two']={'layouts':second}
        for index, manager in enumerate((layouts,second)):
            saved=deepcopy(manager.library)
            base=deepcopy(saved['views'][0]);base.update(id='view_shared',name='Gemeinsames Wetter')
            base['scene']['elements']=[{**template['item'],'widget_template':template['id'],
                'entity_id':['weather.home','weather.office'][index], 'x':10+index*10,
                'tap_action':{'action':'show_view','entity_id':'','view':'view_shared'}}]
            saved['views'].append(base)
            await manager.async_save(manager.config,manager.revision,saved)
        changed=deepcopy(template);changed['item']['parts']={'label':{'font_size':11}}
        await library.async_save(changed,1)
        for index,manager in enumerate((layouts,second)):
            item=next(v for v in manager.library['views'] if v['id']=='view_shared')['scene']['elements'][0]
            assert item['entity_id']==['weather.home','weather.office'][index]
            assert item['tap_action']['view']=='view_shared'
            assert item['x']==10+index*10
            assert item['parts']['label']['font_size']==11
            # Native ESP receives the same resolved design, not a template ID it cannot render.
            config=deepcopy(manager.config);config['scenes']['view_shared']=deepcopy(next(v for v in manager.library['views'] if v['id']=='view_shared')['scene'])
            payload,_,_=compile_scene({'view':'view_shared','layout':{'config':config,'values':{}}},1024,600)
            widget=next(w for w in payload['widgets'] if w['id']=='view_shared/'+item['id'])
            assert widget['x']==round(item['x']*10.24)
        revision=library.revision;before=[m.revision for m in (layouts,second)]
        await library.async_save(changed,revision)
        assert library.revision==revision
        assert [m.revision for m in (layouts,second)]==before
    finally:
        await second.async_close()


async def test_template_type_is_immutable_even_while_display_is_unloaded(layouts):
    library=WidgetLibrary(layouts.hass);layouts.hass.data[KEY]=library
    await library.async_save(definition(),0)
    layouts.hass.data['display_studio']={}
    with pytest.raises(ValueError,match='new widget'):
        await library.async_save({**definition(),'item':element('text',0,0,25,20)},1)
    assert library.revision==1


async def test_widget_api_requires_admin_rejects_invalid_and_conflicting_requests(layouts):
    from aiohttp import web
    from aiohttp.test_utils import TestClient,TestServer
    from types import SimpleNamespace
    from custom_components.display_studio.widget_library import WidgetLibraryView
    library=WidgetLibrary(layouts.hass);layouts.hass.data[KEY]=library
    @web.middleware
    async def auth(request,handler):
        request['hass_user']=SimpleNamespace(is_admin=request.headers.get('X-Admin')=='yes')
        request['ha_authenticated']=request.headers.get('X-Auth')=='yes'
        return await handler(request)
    app=web.Application(middlewares=[auth]);view=WidgetLibraryView(layouts.hass);view.register(layouts.hass,app,app.router)
    async with TestClient(TestServer(app)) as client:
        url='/api/display_studio/widget_library'
        assert (await client.get(url)).status==401
        assert (await client.post(url+'?token=panel',json={})).status==401
        assert (await client.get(url,headers={'X-Auth':'yes'})).status==403
        headers={'X-Admin':'yes','X-Auth':'yes'}
        assert (await client.post(url,headers=headers,json={'widget':definition(),'revision':0})).status==200
        assert (await client.post(url,headers=headers,json={'widget':definition(),'revision':0})).status==409
        assert (await client.post(url,headers=headers,json={'widget':{**definition(),'name':'<script>\n'},'revision':1})).status==400
        response=await client.get(url,headers=headers)
        assert response.headers['Cache-Control']=='no-store'
        assert (await response.json())['widgets'][0]['name']=='Meine Uhr'


def test_shared_text_content_changes_keep_placement_and_action():
    raw={'id':'widget_text','name':'Hinweis','item':{**element('text',0,0,30,20),'text':'Neuer Inhalt'}}
    template=validate_widget(raw)
    placed={**raw['item'],'text':'Alter Inhalt','x':42,'widget_template':'widget_text',
            'tap_action':{'action':'show_view','entity_id':'','view':'view_next'}}
    result=resolve_item(placed,[template])
    assert result['text']=='Neuer Inhalt'
    assert result['x']==42
    assert result['tap_action']==placed['tap_action']
