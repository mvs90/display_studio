"""Independent Display Studio with optional hardware adapters."""

import secrets
import asyncio
from homeassistant.const import Platform, EVENT_HOMEASSISTANT_STOP
from homeassistant.helpers.storage import Store
from homeassistant.helpers import config_validation as cv
from .const import DOMAIN
from .layouts import DisplayLayouts
from .providers import BrowserProvider, LGProvider

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.MEDIA_PLAYER]


async def async_setup(hass, config):
    from .frontend import async_register_frontend
    from . import layout_api
    from .browser import BrowserView, BrowserLinkView
    from .services import async_register_services
    from .blueprint import install_blueprint

    await async_register_frontend(hass)
    for name in (
        "LayoutListView",
        "LayoutLiveView",
        "LayoutEditorView",
        "LayoutLibraryView",
        "LayoutBackgroundView",
        "LayoutSuggestionsView",
        "LayoutMediaView",
    ):
        hass.http.register_view(getattr(layout_api, name)(hass))
    hass.http.register_view(layout_api.LayoutValidateView())
    hass.http.register_view(BrowserView(hass))
    hass.http.register_view(BrowserLinkView(hass))
    async_register_services(hass)
    await hass.async_add_executor_job(install_blueprint, hass.config.config_dir)
    return True


async def async_setup_entry(hass, entry):
    from .migration import async_import_lg

    layouts = DisplayLayouts(hass, entry)
    provider = None
    try:
        if entry.data["provider"] == "lg":
            await async_import_lg(hass, layouts, entry.data["lg_entry_id"])
        await layouts.async_start()
        token_store = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}.access")
        saved = await token_store.async_load()
        token = saved.get("token") if saved else None
        if not token:
            token = secrets.token_urlsafe(32)
            await token_store.async_save({"token": token})
        provider = (LGProvider if entry.data["provider"] == "lg" else BrowserProvider)(
            hass, entry, layouts
        )
        hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
            "name": entry.title,
            "layouts": layouts,
            "provider": provider,
            "token": token,
            "source_entry_id": entry.data.get("lg_entry_id", entry.entry_id),
        }
        await provider.async_start()
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

        async def stop(_):
            await provider.async_close()
            await layouts.async_close()

        entry.async_on_unload(
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
        )
        return True
    except (Exception, asyncio.CancelledError):
        try:
            if provider:
                await provider.async_close()
        finally:
            await layouts.async_close()
            hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        raise


async def async_unload_entry(hass, entry):
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    data = hass.data[DOMAIN].pop(entry.entry_id)
    try:
        await data["provider"].async_close()
    finally:
        await data["layouts"].async_close()
    return True
