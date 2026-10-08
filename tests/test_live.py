"""Live edits are scoped, temporary, serialized and recover to saved layouts."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from custom_components.display_studio.layouts import DisplayLayouts, LayoutConflict
from custom_components.display_studio.providers import BrowserProvider
from custom_components.display_studio.layout_api import LayoutLiveView


@pytest.fixture
async def live(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    entry = SimpleNamespace(entry_id="display", title="Display", options={})
    manager = DisplayLayouts(hass, entry)
    await manager.async_start()
    config = manager.document()["config"]
    config["enabled"] = True
    await manager.async_save(config, 0)
    provider = BrowserProvider(hass, entry, manager)
    await provider.async_start()
    provider.state()  # A connected browser display.
    hass.data["display_studio"] = {
        "display": {"layouts": manager, "provider": provider}
    }
    yield SimpleNamespace(
        hass=hass, manager=manager, output=manager.output, provider=provider
    )
    await provider.async_close()
    await manager.async_close()
    await hass.async_stop(force=True)


def request(live, view="dashboard"):
    return {
        "config": live.manager.editor_document()["config"],
        "revision": live.manager.revision,
        "view": view,
    }


async def test_draft_projects_without_writes_and_expiry_restores_saved_view(live):
    saved = await live.manager.store.async_load()
    await live.provider.async_show_view("media_view")
    data = request(live)
    data["config"]["views"][1]["scene"]["color"] = "#123456"
    await live.output.async_update(live.provider, ("admin", "one"), data)
    assert (
        live.provider.state()["layout"]["config"]["scenes"]["dashboard"]["color"]
        == "#123456"
    )
    assert await live.manager.store.async_load() == saved
    assert (
        live.manager.editor_document()["config"]["views"][1]["scene"]["color"]
        != "#123456"
    )
    assert live.output.startup_design is live.manager.startup_design
    await live.output._expire(None)
    assert live.provider.state()["view"] == "media_view"
    assert live.output.draft is None
    assert await live.manager.store.async_load() == saved


async def test_owner_revision_conflicts_and_late_stop_do_not_replace_other_editor(live):
    data = request(live)
    await live.output.async_update(live.provider, ("admin", "one"), data)
    with pytest.raises(LayoutConflict):
        await live.output.async_update(live.provider, ("admin", "two"), data)
    await live.output.async_stop(("admin", "two"))
    assert live.output.owner == ("admin", "one")
    await live.manager.async_save(live.manager.config, live.manager.revision)
    with pytest.raises(LayoutConflict):
        await live.output.async_update(live.provider, ("admin", "one"), data)
    await live.output.async_stop(("admin", "one"))
    await live.output.async_update(live.provider, ("admin", "two"), request(live))
    await live.output.async_stop(("admin", "one"))
    assert live.output.owner == ("admin", "two")


async def test_heartbeat_retains_draft_and_save_updates_returned_layout(live):
    data = request(live)
    await live.output.async_update(live.provider, ("a", "one"), data)
    draft = live.output.draft
    await live.output.async_update(
        live.provider,
        ("a", "one"),
        {"view": "dashboard", "revision": live.manager.revision},
    )
    assert live.output.draft is draft
    changed = deepcopy(live.manager.library)
    changed["views"][1]["scene"]["color"] = "#abcdef"
    await live.manager.async_save(live.manager.config, live.manager.revision, changed)
    await live.output.async_stop()
    assert (
        live.provider.state()["layout"]["config"]["scenes"]["dashboard"]["color"]
        == "#abcdef"
    )


async def test_external_source_selection_is_not_undone_when_live_stops(live):
    await live.output.async_update(live.provider, ("a", "one"), request(live))
    await live.provider.async_show_view("media_view")
    await live.output.async_stop()
    assert live.provider.selected_view == "media_view"


@pytest.mark.parametrize("view", ["dashboard", "media_view", "overlay", "fullscreen"])
async def test_browser_supported_preview_views(live, view):
    await live.output.async_update(live.provider, ("a", "one"), request(live, view))
    assert live.output.draft
    if view in {"overlay", "fullscreen"}:
        assert live.provider.state()["message"]["layout"] == view
    await live.output.async_stop()
    assert live.provider.message is None


@pytest.mark.parametrize("view", ["hdmi_full", "pip_view", "pip", "startup"])
async def test_browser_rejects_hardware_only_previews_without_mutation(live, view):
    with pytest.raises(ValueError):
        await live.output.async_update(live.provider, ("a", "one"), request(live, view))
    assert live.output.draft is None


async def test_unreachable_or_failed_display_does_not_leave_a_draft(live):
    live.provider.last_seen = 0
    with pytest.raises(HomeAssistantError):
        await live.output.async_update(live.provider, ("a", "one"), request(live))
    assert live.output.draft is None
    live.provider.state()
    live.provider.async_show_view = AsyncMock(side_effect=HomeAssistantError("failed"))
    with pytest.raises(HomeAssistantError):
        await live.output.async_update(live.provider, ("a", "one"), request(live))
    assert live.output.draft is None
    assert live.output.owner is None


async def test_lg_startup_preview_does_not_change_offline_design_and_moves_once(live):
    provider = SimpleNamespace(
        kind="lg",
        status={"connected": True},
        selected_view="hdmi_full",
        closed=False,
        async_show_view=AsyncMock(),
        async_end_preview=AsyncMock(),
        async_notify=AsyncMock(),
    )
    original = live.manager.startup_design.version
    data = request(live, "startup")
    await live.output.async_update(provider, ("a", "one"), data)
    await live.output.async_update(provider, ("a", "one"), data)
    provider.async_show_view.assert_awaited_once_with("dashboard")
    assert live.output.startup_design.version == original
    assert (
        live.output.config["scenes"]["dashboard"]
        == live.output.config["scenes"]["startup"]
    )
    await live.output.async_stop()
    provider.async_end_preview.assert_awaited_once()


async def test_live_api_is_admin_only_and_session_scoped(live):
    @web.middleware
    async def auth(req, handler):
        req["ha_authenticated"] = req.headers.get("X-Auth") == "yes"
        req["hass_user"] = SimpleNamespace(
            is_admin=req.headers.get("X-Admin") == "yes", id="admin"
        )
        return await handler(req)

    app = web.Application(middlewares=[auth])
    LayoutLiveView(live.hass).register(live.hass, app, app.router)
    path = "/api/display_studio/layout_live/display/" + "s" * 32
    async with TestClient(TestServer(app)) as client:
        assert (await client.post(path, json=request(live))).status == 401
        assert (
            await client.post(path, headers={"X-Auth": "yes"}, json=request(live))
        ).status == 403
        headers = {"X-Auth": "yes", "X-Admin": "yes"}
        assert (
            await client.post(path, headers=headers, json=request(live))
        ).status == 200
        assert (
            await client.post(path + "2", headers=headers, json=request(live))
        ).status == 409
        assert (await client.delete(path + "2", headers=headers)).status == 200
        assert live.output.draft is not None
        assert (
            await client.post(
                path,
                headers=headers,
                json={"config": None, "revision": 1, "view": "dashboard"},
            )
        ).status == 400
        assert (await client.delete(path, headers=headers)).status == 200
        assert live.output.draft is None


async def test_geometry_updates_keep_forecast_cache_and_callback(live):
    live.manager.changed = Mock()
    data = request(live)
    await live.output.async_update(live.provider, ("a", "one"), data)
    live.output.draft._cache[("weather.house", "daily")] = {"updated": 1, "items": []}
    data["config"]["views"][1]["scene"]["color"] = "#121212"
    await live.output.async_update(live.provider, ("a", "one"), data)
    assert ("weather.house", "daily") in live.output.draft._cache
    assert live.manager.changed.call_count == 2
