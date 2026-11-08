"""Named views persist independently; only assigned scenes reach the panel."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import pytest

from custom_components.display_studio.layout_api import (
    LayoutLibraryView,
    LayoutBackgroundView,
)
from custom_components.display_studio.layout_config import make_layout, element, presets
from custom_components.display_studio.layout_library import (
    from_config,
    validate_library,
    sync_legacy,
    upgrade_library,
    FIXED_VIEWS,
    source_names,
    source_views,
)
from custom_components.display_studio.layouts import DisplayLayouts, LayoutConflict
from tests.test_layouts import layouts
from tests.test_layout_cards import cover


def test_named_library_validation_and_independent_copies():
    config = make_layout("morning")
    library = from_config(config)
    copy = deepcopy(library["views"][2])
    copy.update(id="view_evening", name="Abend")
    copy["scene"]["color"] = "#112233"
    library["views"].append(copy)
    runtime, normalized = validate_library(library, config)
    assert normalized["views"][2]["scene"]["color"] != "#112233"
    assert runtime["scenes"]["dashboard"]["color"] != "#112233"
    assert next(p for p in presets() if p["id"] == "morning")["name"] == "Sonnenstand"
    assert all(scene["background"] == ("dawn" if key == "startup" else "solar") for key, scene in config["scenes"].items())
    for mutation in (
        lambda lib: lib["views"].append(deepcopy(lib["views"][0])),
        lambda lib: lib["views"][0].update(name="  "),
        lambda lib: lib["views"][0].update(id="../outside"),
        lambda lib: lib["views"][0]["scene"].update(color="url(https://bad)"),
        lambda lib: lib["views"].pop(0),
        lambda lib: lib["views"][0].update(name="Renamed"),
        lambda lib: lib.update(views=[dict(copy, id=f"view_{i}") for i in range(25)]),
    ):
        invalid = deepcopy(library)
        mutation(invalid)
        with pytest.raises(ValueError):
            validate_library(invalid, config)


def test_runtime_save_preserves_custom_views_and_fixed_identity():
    config = make_layout()
    library = from_config(config)
    reserved = deepcopy(library["views"][0])
    reserved.update(id="view_draft", name="Saved view")
    library["views"].append(reserved)
    runtime, library = validate_library(library, config)
    runtime["scenes"]["dashboard"]["color"] = "#123456"
    result = sync_legacy(library, runtime)
    assert next(v for v in result["views"] if v["id"] == reserved["id"]) == reserved
    assert result["views"][0]["id"] == "hdmi_full"
    compiled, _ = validate_library(result, runtime)
    assert compiled == runtime
    assert sync_legacy(result, runtime) == result


async def test_custom_views_publish_as_sources_survive_restart_and_delete(layouts):
    config = make_layout()
    config["enabled"] = True
    library = from_config(config)
    spare = deepcopy(library["views"][0])
    spare.update(id="view_morning", name="Mein Morgen")
    item = element("entity", 5, 5, 40, 40)
    item["entity_id"] = "sensor.room"
    spare["scene"]["elements"] = [item]
    library["views"].append(spare)
    layouts.hass.states.async_set("sensor.room", "22")
    await layouts.async_save(config, 0, library)
    assert layouts.source_views["view_morning"] == "Mein Morgen"
    assert layouts.payload()["values"]["sensor.room"]["state"] == "22"
    assert "view_morning" in layouts.payload()["config"]["scenes"]
    assert len(layouts.editor_document()["config"]["views"]) == 9
    second = DisplayLayouts(layouts.hass, layouts.entry)
    await second.async_start()
    try:
        assert second.library == layouts.library
        assert second.config == layouts.config
    finally:
        await second.async_close()
    library["views"][-1]["name"] = "Abend"
    await layouts.async_save(config, 1, library)
    assert layouts.source_views["view_morning"] == "Abend"
    with pytest.raises(LayoutConflict):
        await layouts.async_save(config, 1, library)
    library["views"].pop()
    await layouts.async_save(config, 2, library)
    assert "sensor.room" not in layouts.values()
    assert "view_morning" not in layouts.source_views
    assert layouts.config["scenes"]["dashboard"] == make_layout()["scenes"]["dashboard"]


async def test_existing_runtime_is_adopted_without_losing_user_bindings(layouts):
    config = make_layout("sand")
    config["scenes"]["dashboard"]["elements"][1]["entity_id"] = "weather.home"
    await layouts.store.async_save({"config": config, "revision": 7})
    second = DisplayLayouts(layouts.hass, layouts.entry)
    await second.async_start()
    try:
        assert second.config == config and second.revision == 7
        assert second.library["views"][1]["scene"] == config["scenes"]["dashboard"]
        # The original storage remains intact until the user saves.
        assert "library" not in await second.store.async_load()
    finally:
        await second.async_close()


async def test_removed_background_player_survives_save_theme_and_restart(layouts):
    config = make_layout()
    library = from_config(config)
    library["active_theme"] = "cinema"
    view = next(v for v in library["views"] if v["id"] == "media_view")
    card = next(e for e in view["scene"]["elements"] if e["kind"] == "media")
    card["entity_id"] = "media_player.sonos"
    view["scene"].update(
        media_background_enabled=False,
        media_background_entity="",
        media_background_auto=False,
    )
    await layouts.async_save(config, 0, library)
    second = DisplayLayouts(layouts.hass, layouts.entry)
    await second.async_start()
    try:
        saved = next(v for v in second.library["views"] if v["id"] == "media_view")
        assert saved["scene"]["media_background_auto"] is False
        assert saved["scene"]["media_background_entity"] == ""
        assert saved["scene"]["media_background_enabled"] is False
        assert next(e for e in saved["scene"]["elements"] if e["kind"] == "media")["entity_id"] == "media_player.sonos"
        assert second.config["scenes"]["media_view"] == saved["scene"]
    finally:
        await second.async_close()


async def test_library_api_authorization_and_inactive_background_protection(layouts):
    image_id = await layouts.backgrounds.async_upload(cover())
    editor = layouts.editor_document()["config"]
    extra = deepcopy(editor["views"][2])
    extra.update(id="view_spare", name="Später")
    extra["scene"]["image_id"] = image_id
    editor["views"].append(extra)

    @web.middleware
    async def auth(request, handler):
        request["ha_authenticated"] = request.headers.get("X-Auth") == "yes"
        request["hass_user"] = SimpleNamespace(
            is_admin=request.headers.get("X-Admin") == "yes"
        )
        return await handler(request)

    app = web.Application(middlewares=[auth])
    for view in (LayoutLibraryView(layouts.hass), LayoutBackgroundView(layouts.hass)):
        view.register(layouts.hass, app, app.router)
    headers = {"X-Auth": "yes", "X-Admin": "yes"}
    async with TestClient(TestServer(app)) as client:
        path = "/api/display_studio/layout_library/one"
        assert (await client.get(path)).status == 401
        assert (await client.get(path, headers={"X-Auth": "yes"})).status == 403
        response = await client.post(
            path, headers=headers, json={"config": editor, "revision": 0}
        )
        assert response.status == 200
        assert len((await response.json())["config"]["views"]) == 9
        assert (
            await client.post(
                path, headers=headers, json={"config": editor, "revision": 0}
            )
        ).status == 409
        assert (
            await client.delete(
                f"/api/display_studio/layout_background/one/{image_id}", headers=headers
            )
        ).status == 409
        editor["views"].pop(0)
        assert (
            await client.post(
                path, headers=headers, json={"config": editor, "revision": 1}
            )
        ).status == 400
        assert layouts.revision == 1


async def test_live_sun_updates_are_bounded_published_and_cleaned_up(layouts):
    config = make_layout("morning")
    config["enabled"] = True
    layouts.hass.states.async_set("sun.sun", "above_horizon", {"rising": True})
    await layouts.async_save(config, 0)
    layouts.changed = Mock()
    with (
        patch(
            "custom_components.display_studio.layouts.elevation", side_effect=[10, 11]
        ) as elevation,
        patch("custom_components.display_studio.layouts.azimuth", side_effect=[120, 121]),
    ):
        assert layouts.sun()["elevation"] == 10
        assert layouts.sun()["elevation"] == 10
        elevation.assert_called_once()
        layouts._sun_timer()
        layouts._sun_tick(None)
        layouts.changed.assert_called_once()
        assert layouts.sun()["elevation"] == 11
        assert layouts.sun()["azimuth"] == 121
        assert "latitude" not in str(layouts.payload())
    assert layouts._sun_timer is not None
    config["enabled"] = False
    await layouts.async_save(config, 1)
    assert layouts._sun_timer is None


def test_existing_assignments_become_fixed_views_without_losing_designs():
    config = make_layout("morning")
    old = {
        "views": [
            {
                "id": "music",
                "name": "Music",
                "scene": deepcopy(config["scenes"]["media_view"]),
            },
            {
                "id": "unused",
                "name": "Extra",
                "scene": deepcopy(config["scenes"]["dashboard"]),
            },
        ],
        "assignments": {"dashboard": "music", "media_view": "music"},
    }
    before = deepcopy(old)
    upgraded = upgrade_library(old, config)
    runtime, library = validate_library(upgraded, config)
    assert [v["name"] for v in library["views"] if v["id"] in FIXED_VIEWS] == list(FIXED_VIEWS.values())
    assert (
        runtime["scenes"]["dashboard"]
        == runtime["scenes"]["media_view"]
        == old["views"][0]["scene"]
    )
    assert library["views"][-1]["id"] == "view_unused"
    assert old == before
    assert "assignments" not in library
    assert upgrade_library(library, runtime) == library


async def test_legacy_hdmi_scenes_stay_saved_but_do_not_publish_or_request_data(
    layouts,
):
    config = make_layout()
    config["enabled"] = True
    old = element("media", 5, 5, 40, 40)
    old["entity_id"] = "media_player.legacy"
    weather = element("weather", 50, 5, 40, 40)
    weather["entity_id"] = "weather.legacy"
    config["scenes"]["signal"]["elements"] = [old, weather]
    config["scenes"]["no_signal"]["elements"] = [old, weather]
    await layouts.async_save(config, 0)
    assert layouts.document()["config"]["scenes"]["signal"]["elements"]
    assert "signal" not in layouts.payload()["config"]["scenes"]
    assert "no_signal" not in layouts.payload()["config"]["scenes"]
    assert layouts.values() == {} and layouts.media_entities() == set()
    assert layouts.forecast_requests() == {}


def test_sources_are_unique_even_when_names_collide_with_hdmi_and_each_other():
    names = source_names(
        {
            "dashboard": "Dashboard",
            "pip_view": "Dashboard PiP",
            "view_one": "Dashboard",
            "view_two": "Dashboard (App)",
            "view_three": "HDMI 1",
        },
        {"Dashboard", "HDMI 1"},
    )
    assert len(set(names.values())) == 5
    assert names["dashboard"] == "Dashboard (App)"
    assert names["view_three"] == "HDMI 1 (App)"


async def test_custom_sources_share_the_32_entity_bound(layouts):
    config = make_layout()
    library = from_config(config)
    for n in range(3):
        scene = deepcopy(config["scenes"]["dashboard"])
        scene["elements"] = []
        for i in range(11):
            item = element("entity", 0, 0, 10, 10)
            item.update(id=f"card_{i}", entity_id=f"sensor.room_{n}_{i}")
            scene["elements"].append(item)
        library["views"].append(
            {"id": f"view_{n}", "name": f"Room {n}", "scene": scene}
        )
    with pytest.raises(ValueError, match="32 distinct"):
        validate_library(library, config)


def test_version_two_adds_hdmi_default_and_preserves_every_existing_view():
    config = make_layout("morning")
    legacy = from_config(config)
    legacy["views"].pop(0)
    legacy["library_version"] = 2
    config["scenes"].pop("hdmi_full")
    from custom_components.display_studio.layout_config import validate_layout

    upgraded_config = validate_layout(config)
    upgraded = upgrade_library(legacy, upgraded_config)
    assert upgraded["library_version"] == 4
    assert upgraded["views"][1:] == legacy["views"]
    assert upgraded["views"][0]["scene"] == make_layout()["scenes"]["hdmi_full"]
    runtime, library = validate_library(upgraded, upgraded_config)
    assert "hdmi_full" not in source_views(library)
    assert runtime["scenes"]["pip_view"] == config["scenes"]["pip_view"]


async def test_hdmi_scene_edits_publish_and_survive_reload_with_scoped_data(layouts):
    config = make_layout()
    config["enabled"] = True
    card = element("entity", 2, 2, 20, 10)
    card["entity_id"] = "sensor.hdmi_info"
    config["scenes"]["hdmi_full"]["elements"].append(card)
    layouts.hass.states.async_set("sensor.hdmi_info", "42")
    await layouts.async_save(config, 0)
    assert layouts.library["views"][0]["name"] == "Nur HDMI"
    assert layouts.payload()["values"]["sensor.hdmi_info"]["state"] == "42"
    assert (
        layouts.payload()["config"]["scenes"]["hdmi_full"]
        == config["scenes"]["hdmi_full"]
    )
    second = DisplayLayouts(layouts.hass, layouts.entry)
    await second.async_start()
    try:
        assert second.config == config
        assert second.library == layouts.library
    finally:
        await second.async_close()


def test_editor_grid_survives_library_roundtrip_but_is_not_display_content():
    config=make_layout();library=from_config(config)
    custom=deepcopy(library['views'][1]);custom.update(id='view_grid',name='Raster',grid={'columns':3,'rows':2,'gap':2.5,'margin':4})
    custom['scene']['elements']=[];library['views'].append(custom)
    runtime,saved=validate_library(library,config)
    result=next(v for v in saved['views'] if v['id']=='view_grid')
    assert result['grid']==custom['grid']
    assert runtime['scenes']['view_grid']['elements']==[]
    assert 'grid' not in runtime['scenes']['view_grid']
    assert next(v for v in sync_legacy(saved,runtime)['views'] if v['id']=='view_grid')['grid']==custom['grid']
    library['active_theme']='morning'
    runtime,themed=validate_library(library,config)
    result=next(v for v in themed['views'] if v['id']=='view_grid')
    assert result['theme_override'] is False
    assert result['scene']['background']=='solar'
    assert result['grid']==custom['grid']


@pytest.mark.parametrize('grid',[
 {'cells':[]}, {'cells':[{'x':0,'y':0,'width':100,'height':101}]},
 {'cells':[{'x':90,'y':0,'width':20,'height':50}]},
 {'cells':[{'x':0,'y':0,'width':50,'height':50}]*2},
 {'cells':[{'x':False,'y':0,'width':50,'height':50}]},
 {'cells':[{'x':0,'y':0,'width':float('nan'),'height':50}]},
 {'cells':[{'x':0,'y':0,'width':50,'height':50,'html':'bad'}]},
 {'cells':[{'x':0,'y':0,'width':1,'height':1}]*65},
 None,{}, {'columns':0,'rows':2,'gap':2,'margin':4},
 {'columns':9,'rows':2,'gap':2,'margin':4}, {'columns':True,'rows':2,'gap':2,'margin':4},
 {'columns':2,'rows':2.5,'gap':2,'margin':4}, {'columns':2,'rows':2,'gap':float('nan'),'margin':4},
 {'columns':2,'rows':2,'gap':2,'margin':-1}, {'columns':2,'rows':2,'gap':7,'margin':4},
 {'columns':2,'rows':2,'gap':2,'margin':11}, {'columns':2,'rows':2,'gap':2,'margin':4,'html':'bad'},
])
def test_invalid_editor_grids_are_rejected(grid):
    config=make_layout();library=from_config(config);library['views'][1]['grid']=grid
    with pytest.raises(ValueError):validate_library(library,config)


@pytest.mark.parametrize('source',['dashboard','pip_view','media_view','native'])
def test_asymmetric_grid_templates_roundtrip_without_hardware_or_content(source):
    config=make_layout();library=from_config(config)
    cells=([dict(x=0,y=0,width=48,height=48),dict(x=0,y=50,width=48,height=48),dict(x=50,y=0,width=50,height=100)]
           if source=='native' else [{key:item[key] for key in ('x','y','width','height')} for item in config['scenes'][source]['elements']])
    view=deepcopy(library['views'][1]);view.update(id='view_cells',name='Neutrales Raster',grid={'cells':cells});view['scene']['elements']=[]
    library['views'].append(view)
    runtime,saved=validate_library(library,config)
    assert next(v for v in saved['views'] if v['id']=='view_cells')['grid']=={'cells':cells}
    assert runtime['scenes']['view_cells']['elements']==[]
    assert 'grid' not in runtime['scenes']['view_cells']
    assert next(v for v in sync_legacy(saved,runtime)['views'] if v['id']=='view_cells')['grid']=={'cells':cells}


@pytest.mark.parametrize('kind',['clock','control','logo','animation','camera','weather','media','text'])
def test_grid_widget_sizes_survive_save_and_native_compilation(kind):
    from custom_components.display_studio.lvgl import compile_scene
    config=make_layout();library=from_config(config)
    view=library['views'][1];view['grid']={'columns':2,'rows':2,'gap':2,'margin':4}
    item=element(kind,4,4,45,45);item.update(grid_size=True,manual_size=False)
    if kind=='clock':item.update(clock_base_height=45,show_label=False)
    if kind=='camera':item.update(camera_lock_aspect=False,camera_fit='contain',camera_source='local')
    view['scene']['elements']=[item]
    runtime,saved=validate_library(library,config)
    normalized=runtime['scenes'][view['id']]['elements'][0]
    assert normalized['grid_size'] is True
    assert [normalized[k] for k in ('x','y','width','height')]==[4,4,45,45]
    assert sync_legacy(saved,runtime)['views'][1]['scene']['elements'][0]==normalized
    payload,_,_=compile_scene({'view':view['id'],'layout':{'config':runtime,'values':{}}},1024,600)
    widget=next(w for w in payload['widgets'] if w['id']==view['id']+'/'+item['id'])
    assert [widget[k] for k in ('x','y','width','height')]==[41,24,461,270]


@pytest.mark.parametrize('value',[1,'true',None,[],{}])
def test_invalid_grid_size_flags_are_rejected(value):
    config=make_layout();library=from_config(config)
    library['views'][1]['scene']['elements'][0]['grid_size']=value
    with pytest.raises(ValueError):validate_library(library,config)


@pytest.mark.parametrize("provider", ["browser", "lg", "esphome"])
async def test_fresh_installation_has_no_automatic_source_views(layouts, provider):
    entry = SimpleNamespace(entry_id="fresh_" + provider, data={"provider": provider}, options={})
    fresh = DisplayLayouts(layouts.hass, entry)
    await fresh.async_start()
    try:
        assert fresh.source_views == {}
        assert not {"dashboard", "pip_view", "media_view"} & {v["id"] for v in fresh.library["views"]}
        for key in ("dashboard", "pip_view", "media_view"):
            assert fresh.config["scenes"][key]["elements"] == []
        await fresh.async_save({**fresh.config, "enabled": True}, fresh.revision)
        second = DisplayLayouts(layouts.hass, entry)
        await second.async_start()
        try:
            assert second.source_views == {}
            assert second.library == fresh.library
        finally:
            await second.async_close()
    finally:
        await fresh.async_close()


@pytest.mark.parametrize("identifier", ["dashboard", "pip_view", "media_view"])
async def test_former_default_is_renameable_deletable_and_stays_deleted(layouts, identifier):
    from custom_components.display_studio.layout_config import layout_entities
    from custom_components.display_studio.providers import BrowserProvider
    from custom_components.display_studio.esphome import ESPHomeProvider
    from homeassistant.exceptions import HomeAssistantError
    config = make_layout()
    config["enabled"] = True
    library = from_config(config)
    target = next(v for v in library["views"] if v["id"] == identifier)
    target["name"] = "Meine eigene Ansicht"
    item = element("entity", 0, 0, 50, 50)
    item["entity_id"] = "sensor.deleted_source"
    target["scene"]["elements"] = [item]
    target["grid"] = {"columns": 2, "rows": 2, "gap": 2, "margin": 4}
    await layouts.async_save(config, layouts.revision, library)
    assert layouts.source_views[identifier] == target["name"]
    assert next(v for v in layouts.library["views"] if v["id"] == identifier) == target
    before = deepcopy(layouts.library)
    library["views"] = [v for v in library["views"] if v["id"] != identifier]
    await layouts.async_save(layouts.config, layouts.revision, library)
    assert layouts.library["views"] == [v for v in before["views"] if v["id"] != identifier]
    assert identifier not in layouts.source_views
    assert "sensor.deleted_source" not in layout_entities(layouts.config)
    assert layouts.config["scenes"][identifier]["elements"] == []
    assert sync_legacy(layouts.library, layouts.config) == layouts.library
    browser = BrowserProvider(layouts.hass, layouts.entry, layouts)
    browser.selected_view = identifier
    assert browser.state()["view"] != identifier
    with pytest.raises(HomeAssistantError):
        browser.validate_view(identifier)
    with pytest.raises(HomeAssistantError):
        ESPHomeProvider.validate_view(SimpleNamespace(api=SimpleNamespace(legacy=False), layouts=layouts), identifier)
    await browser.async_close()
    second = DisplayLayouts(layouts.hass, layouts.entry)
    await second.async_start()
    try:
        assert second.library == layouts.library
        assert identifier not in second.source_views
        await second.async_set_theme("aurora")
        assert identifier not in second.source_views
        assert not second.config["scenes"][identifier]["elements"]
    finally:
        await second.async_close()
