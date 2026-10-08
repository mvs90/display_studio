"""Standalone runtime, migration, adapter lifecycle and display-token boundaries."""

import asyncio
import builtins
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.exceptions import HomeAssistantError
from custom_components.display_studio.layouts import DisplayLayouts
from custom_components.display_studio.providers import BrowserProvider
from custom_components.display_studio.browser import BrowserView, BrowserLinkView
from custom_components.display_studio.migration import async_import_lg
from custom_components.display_studio.media_player import StudioPlayer
from custom_components.display_studio import async_setup_entry, async_unload_entry


@pytest.fixture
async def runtime(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    entry = SimpleNamespace(
        entry_id="browser", title="Kitchen", options={}, data={"provider": "browser"}
    )
    layouts = DisplayLayouts(hass, entry)
    await layouts.async_start()
    config = layouts.document()["config"]
    config["enabled"] = True
    await layouts.async_save(config, 0)
    provider = BrowserProvider(hass, entry, layouts)
    await provider.async_start()
    hass.data["display_studio"] = {
        entry.entry_id: {
            "layouts": layouts,
            "provider": provider,
            "token": "scoped-token",
        }
    }
    yield SimpleNamespace(hass=hass, entry=entry, layouts=layouts, provider=provider)
    await provider.async_close()
    await layouts.async_close()
    await hass.async_stop(force=True)


async def test_browser_has_no_lg_import_or_hardware_capabilities(runtime):
    original = builtins.__import__

    def restricted(name, *args, **kwargs):
        assert not name.startswith("custom_components.lg_rs232_ip")
        return original(name, *args, **kwargs)

    with patch("builtins.__import__", restricted):
        await runtime.provider.async_show_view("media_view")
        assert runtime.provider.state()["view"] == "media_view"
        assert not runtime.provider.status["capabilities"]["hdmi"]
        assert runtime.provider.status["connected"]
        entity = StudioPlayer(
            runtime.hass.data["display_studio"]["browser"], runtime.entry
        )
        assert "Mediaplayer" in entity.source_list
        assert "Dashboard PiP" not in entity.source_list
        assert "Nur HDMI" not in entity.source_list
        await runtime.provider.async_show_view("dashboard")


@pytest.mark.parametrize(
    "view", ["hdmi_full", "pip_view", "startup", "overlay", "pip", "missing"]
)
async def test_browser_rejects_unsupported_source(runtime, view):
    with pytest.raises(HomeAssistantError):
        await runtime.provider.async_show_view(view)


async def test_browser_latest_notification_and_timed_view_return(runtime):
    provider = runtime.provider
    await provider.async_show_view("media_view", duration=20)
    await provider.async_show_view("media_view", duration=30)
    await provider.async_notify(message="old", duration=5)
    await provider.async_notify(message="latest", duration=10)
    assert provider.state()["message"]["message"] == "latest"
    with patch(
        "custom_components.display_studio.providers.time.monotonic",
        return_value=provider._return[1] + 1,
    ):
        assert provider.state()["view"] == "dashboard"
        assert provider.state()["message"] is None
    await provider.async_show_view("media_view", duration=20)
    await provider.async_show_view("dashboard")
    assert provider._return is None
    with pytest.raises(HomeAssistantError):
        await provider.async_notify(layout="pip")


async def test_browser_custom_view_must_not_require_hdmi(runtime):
    library = deepcopy(runtime.layouts.library)
    custom = deepcopy(library["views"][0])
    custom.update(id="view_custom", name="Custom")
    library["views"].append(custom)
    await runtime.layouts.async_save(
        runtime.layouts.config, runtime.layouts.revision, library
    )
    with pytest.raises(HomeAssistantError, match="HDMI"):
        await runtime.provider.async_show_view("view_custom")


async def test_scoped_browser_token_cannot_edit_or_read_other_entities(runtime):
    @web.middleware
    async def auth(request, handler):
        request["ha_authenticated"] = request.headers.get("X-Auth") == "yes"
        request["hass_user"] = SimpleNamespace(
            is_admin=request.headers.get("X-Admin") == "yes"
        )
        return await handler(request)

    app = web.Application(middlewares=[auth])
    for view in (BrowserView(runtime.hass), BrowserLinkView(runtime.hass)):
        view.register(runtime.hass, app, app.router)
    root = "/api/display_studio/browser/browser/scoped-token/"
    async with TestClient(TestServer(app)) as client:
        assert (await client.get(root + "index.html")).status == 200
        assert (
            await client.get(root.replace("scoped-token", "wrong") + "state")
        ).status == 404
        assert (
            await client.get(root + "cover.jpg?entity=media_player.secret")
        ).status == 404
        assert (
            await client.get(root + "camera.json?view=dashboard&id=secret")
        ).status == 404
        assert (await client.get(root + "services")).status == 404
        assert (await client.post(root + "state", json={})).status == 405
        link = "/api/display_studio/browser_link/browser"
        assert (await client.get(link)).status == 401
        assert (await client.get(link, headers={"X-Auth": "yes"})).status == 403
        headers = {"X-Auth": "yes", "X-Admin": "yes"}
        pending = asyncio.create_task(
            client.get(root + "state?since=" + str(runtime.provider.revision))
        )
        await asyncio.sleep(0.03)
        await runtime.provider.async_notify(message="wake")
        response = await asyncio.wait_for(pending, 1)
        assert (await response.json())["message"]["message"] == "wake"
        new = await (await client.post(link, headers=headers)).json()
        assert "scoped-token" not in new["path"]
        assert (await client.get(root + "state")).status == 404
        assert (await client.get(new["path"])).status == 200


async def test_existing_lg_design_copied_once_with_images_original_preserved(runtime):
    source = Store(runtime.hass, 1, "lg_rs232_ip.lg.layouts")
    original = {
        "config": runtime.layouts.config,
        "library": runtime.layouts.library,
        "revision": 23,
    }
    await source.async_save(original)
    image = Path(
        runtime.hass.config.path(
            ".storage", "lg_rs232_ip.lg.backgrounds", "a" * 64 + ".jpg"
        )
    )
    image.parent.mkdir()
    image.write_bytes(b"existing image")
    # Simulate new Studio entry with no saved layout.
    entry = SimpleNamespace(entry_id="new", options={})
    target = DisplayLayouts(runtime.hass, entry)
    try:
        assert await async_import_lg(runtime.hass, target, "lg")
        assert await target.store.async_load() == original
        assert (target.backgrounds.root / image.name).read_bytes() == b"existing image"
        await source.async_save({**original, "revision": 99})
        assert not await async_import_lg(runtime.hass, target, "lg")
        assert (await target.store.async_load())["revision"] == 23
        assert image.read_bytes() == b"existing image"
    finally:
        await target.async_close()


async def test_setup_unload_and_failed_platform_cleanup(runtime):
    runtime.hass.config_entries = SimpleNamespace(
        async_forward_entry_setups=AsyncMock(),
        async_unload_platforms=AsyncMock(return_value=True),
    )
    entry = SimpleNamespace(
        entry_id="second",
        title="Browser",
        data={"provider": "browser"},
        options={},
        async_on_unload=Mock(),
    )
    with (
        patch.object(
            runtime.hass.config_entries, "async_forward_entry_setups", AsyncMock()
        ),
        patch.object(
            runtime.hass.config_entries,
            "async_unload_platforms",
            AsyncMock(return_value=True),
        ),
    ):
        assert await async_setup_entry(runtime.hass, entry)
        data = runtime.hass.data["display_studio"]["second"]
        assert len(data["token"]) >= 40
        assert await async_unload_entry(runtime.hass, entry)
        assert data["layouts"]._closed and data["provider"].closed
    with patch.object(
        runtime.hass.config_entries,
        "async_forward_entry_setups",
        AsyncMock(side_effect=RuntimeError("platform failed")),
    ):
        with pytest.raises(RuntimeError, match="platform failed"):
            await async_setup_entry(runtime.hass, entry)
        assert "second" not in runtime.hass.data["display_studio"]


async def test_frontend_independent_panel_and_all_assets_exist(runtime):
    from custom_components.display_studio.frontend import async_register_frontend
    from homeassistant.components.frontend import DATA_PANELS

    runtime.hass.http = SimpleNamespace(async_register_static_paths=AsyncMock())
    await async_register_frontend(runtime.hass)
    paths = runtime.hass.http.async_register_static_paths.await_args.args[0]
    assert all(Path(item.path).is_file() for item in paths)
    assert (
        runtime.hass.data[DATA_PANELS]["display-studio"].sidebar_title
        == "Display Studio"
    )
    assert runtime.hass.data[DATA_PANELS]["display-studio"].require_admin
    assert runtime.hass.data[DATA_PANELS]["lg-display-studio"].sidebar_title is None


async def test_browser_config_flow_never_needs_lg(runtime):
    from custom_components.display_studio.config_flow import StudioConfigFlow

    flow = StudioConfigFlow()
    flow.hass = runtime.hass
    flow.context = {"source": "user"}
    result = await flow.async_step_user({"name": "Kitchen", "provider": "browser"})
    assert result["type"] == "create_entry"
    assert result["data"] == {"provider": "browser"}
    assert result["title"] == "Kitchen"
    runtime.hass.config_entries = SimpleNamespace(async_entries=lambda _: [])
    assert (await flow.async_step_lg())["reason"] == "no_lg_display"


async def test_service_targets_and_permissions(runtime):
    from homeassistant.core import Context
    from homeassistant.exceptions import Unauthorized
    from custom_components.display_studio.services import async_register_services

    async_register_services(runtime.hass)
    runtime.hass.auth = SimpleNamespace(
        async_get_user=AsyncMock(
            return_value=SimpleNamespace(
                is_admin=False, permissions=Mock(check_entity=Mock(return_value=False))
            )
        )
    )
    registry = Mock()
    entity = SimpleNamespace(
        config_entry_id="browser",
        platform="display_studio",
        entity_id="media_player.studio",
    )
    registry.async_get.return_value = entity
    with (
        patch(
            "custom_components.display_studio.services.er.async_get",
            return_value=registry,
        ),
        patch(
            "custom_components.display_studio.services.er.async_entries_for_config_entry",
            return_value=[entity],
        ),
    ):
        with pytest.raises(Unauthorized):
            await runtime.hass.services.async_call(
                "display_studio",
                "show_view",
                {"config_entry_id": "browser", "view": "media_view"},
                blocking=True,
                context=Context(user_id="restricted"),
            )
        assert runtime.provider.selected_view == "dashboard"
        await runtime.hass.services.async_call(
            "display_studio",
            "show_view",
            {"entity_id": "media_player.studio", "view": "media_view"},
            blocking=True,
        )
        assert runtime.provider.selected_view == "media_view"
        with pytest.raises(HomeAssistantError, match="not loaded"):
            await runtime.hass.services.async_call(
                "display_studio",
                "show_view",
                {"config_entry_id": "missing", "view": "media_view"},
                blocking=True,
            )
