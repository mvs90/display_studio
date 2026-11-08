"""Device inventory and exclusive, resolution-compatible Studio bindings."""

import asyncio
import logging
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN
from .layout_api import require_admin, read_document

_LOGGER = logging.getLogger(__name__)

PROVIDERS = {"lg": "lg_rs232_ip", "esphome": "esphome_display"}
KEYS = {"lg": "lg_entry_id", "esphome": "esphome_entry_id"}
MODELS = {
    "guition_jc1060p470": ("Guition · 7 Zoll", "guition-7.webp"),
    "guition_jc4880p443": ("Guition · 4,3 Zoll", "guition-43.webp"),
    "guition_esp32_4848s040": ("Guition · 4 Zoll", "guition-4.webp"),
    "waveshare_esp32_s3_touch_lcd_4_rev4": ("Waveshare · 4 Zoll", "waveshare-4.jpg"),
}
TYPES = [
    {"id": "esphome", "name": "ESPHome Display", "image": "guition-7.webp", "description": "Touchdisplays mit ESPHome", "integration": "esphome_display"},
    {"id": "lg", "name": "LG Professional Display", "image": "lg.jpg", "description": "LG-Displays mit webOS", "integration": "lg_rs232_ip"},
    {"id": "browser", "name": "Browser / Kiosk", "image": "browser.jpg", "description": "Tablets und Bildschirme im Browser"},
]


def binding_lock(hass):
    return hass.data.setdefault(DOMAIN + "_device_lock", asyncio.Lock())


def target_id(entry):
    return entry.data.get(KEYS.get(entry.data.get("provider"), ""))


def hardware(hass, provider, entry_id):
    entry = hass.config_entries.async_get_entry(entry_id) if isinstance(entry_id, str) and entry_id else None
    return entry if entry and entry.domain == PROVIDERS.get(provider) else None


def identity(entry):
    """Aliases of the same configured physical endpoint cannot acquire two owners."""
    if entry.domain == "esphome_display":
        node = entry.data.get("native_node", "").strip().lower()
        return (entry.domain, "node", node) if node else (entry.domain, entry.entry_id)
    return (entry.domain, str(entry.data.get("host", "")).lower().rstrip("."),
            entry.data.get("port", 9761), entry.data.get("display_id", entry.data.get("set_id", 1)))


def descriptor(entry):
    if entry.domain == "esphome_display":
        width, height = entry.data.get("width"), entry.data.get("height")
        profile = entry.data.get("profile", "custom")
        model, image = MODELS.get(profile, ("ESPHome Display", "generic.svg"))
        # Portrait/landscape mounting does not change the physical resolution.
        size = sorted((width, height)) if isinstance(width, int) and isinstance(height, int) else []
        return {"provider": "esphome", "model": model, "image": image, "profile": profile,
                "width": width, "height": height, "compatibility": "esphome:" + "x".join(map(str, size))}
    return {"provider": "lg", "model": "LG Professional Display", "image": "lg.jpg", "compatibility": "lg"}


def binding_info(hass, entry):
    if device := hardware(hass, entry.data.get("provider"), target_id(entry)):
        return descriptor(device)
    return dict(entry.data.get("binding_info", {}))


def owners(hass, device, excluding=None):
    result = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.entry_id == excluding:
            continue
        target = hardware(hass, entry.data.get("provider"), target_id(entry))
        if target and identity(target) == identity(device):
            result.append(entry)
    return result


def validate_target(hass, provider, entry_id, *, current=None):
    target = hardware(hass, provider, entry_id)
    if not target:
        raise ValueError("device_missing")
    if current:
        info = binding_info(hass, current)
        if current.data.get("provider") != provider or info.get("compatibility") != descriptor(target)["compatibility"]:
            raise ValueError("incompatible_device")
        if provider == "esphome" and not info.get("width"):
            raise ValueError("incompatible_device")
    if owners(hass, target, current.entry_id if current else None):
        raise ValueError("device_in_use")
    return target


def inventory(hass):
    entries, targets = [], []
    for provider, domain in PROVIDERS.items():
        for device in hass.config_entries.async_entries(domain):
            assigned = owners(hass, device)
            targets.append({"entry_id": device.entry_id, "name": device.title, **descriptor(device),
                            "assigned_to": [e.entry_id for e in assigned],
                            "assigned_names": [e.title for e in assigned]})
    for entry in hass.config_entries.async_entries(DOMAIN):
        data = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
        provider = data.get("provider")
        status = provider.status if provider else {}
        info = binding_info(hass, entry)
        kind = entry.data.get("provider", "browser")
        target = hardware(hass, kind, target_id(entry))
        connected = bool(status.get("connected"))
        view = getattr(provider, "selected_view", None)
        layouts = data.get("layouts")
        view_name = layouts.source_views.get(view, view) if layouts else None
        entries.append({"entry_id": entry.entry_id, "name": entry.title, "provider": kind,
                        **info, "image": info.get("image", "browser.jpg" if kind == "browser" else "generic.svg"),
                        "model": info.get("model", "Browser / Kiosk" if kind == "browser" else "Display"),
                        "target_entry_id": target_id(entry), "target_name": target.title if target else None,
                        "connected": connected, "available": layouts is not None,
                        "status": "unbound" if kind != "browser" and not target_id(entry) else
                                  "online" if connected else "offline" if layouts else "setup_error",
                        "selected_view": view_name})
    return {"entries": entries, "targets": targets, "types": TYPES}


class DevicesView(HomeAssistantView):
    url = "/api/display_studio/devices"
    name = "api:display_studio:devices"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request):
        require_admin(request)
        return web.json_response(inventory(self.hass), headers={"Cache-Control": "no-store"})

    async def post(self, request):
        require_admin(request)
        data = await read_document(request)
        name, provider = data.get("name"), data.get("provider")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or not isinstance(provider, str) or provider not in {"browser", *PROVIDERS}:
            return web.json_response({"error": "invalid_device"}, status=400)
        try:
            target = validate_target(self.hass, provider, data.get("target_entry_id")) if provider != "browser" else None
            result = await self.hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"}, data={"name": name.strip(), "provider": provider})
            if target and result["type"] == "form":
                result = await self.hass.config_entries.flow.async_configure(result["flow_id"], {KEYS[provider]: target.entry_id})
            if result["type"] != "create_entry":
                if result.get("flow_id"):
                    self.hass.config_entries.flow.async_abort(result["flow_id"])
                return web.json_response({"error": result.get("reason") or next(iter(result.get("errors", {}).values()), "device_not_ready")}, status=409)
            return web.json_response({"entry_id": result["result"].entry_id}, status=201)
        except ValueError as err:
            return web.json_response({"error": str(err)}, status=409)


class DeviceBindingView(HomeAssistantView):
    url = "/api/display_studio/device_binding/{entry_id}"
    name = "api:display_studio:device_binding"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def post(self, request, entry_id):
        require_admin(request)
        payload = await read_document(request)
        async with binding_lock(self.hass):
            entry = self.hass.config_entries.async_get_entry(entry_id)
            if not entry or entry.domain != DOMAIN:
                raise web.HTTPNotFound()
            kind = entry.data.get("provider")
            if kind not in KEYS or "target_entry_id" not in payload:
                return web.json_response({"error": "invalid_device"}, status=400)
            if payload.get("previous_target_entry_id") != target_id(entry):
                return web.json_response({"error": "binding_changed"}, status=409)
            target = payload["target_entry_id"]
            if target == target_id(entry):
                return web.json_response({"entry_id": entry_id})
            try:
                device = validate_target(self.hass, kind, target, current=entry) if target is not None else None
                old_data, old_unique = dict(entry.data), entry.unique_id
                info = binding_info(self.hass, entry)
                current = self.hass.data.get(DOMAIN, {}).get(entry_id, {}).get("provider")
                snapshot = current.status if current else {}
                view = getattr(current, "selected_view", None)
                updated = {**old_data, KEYS[kind]: target, "binding_info": descriptor(device) if device else info,
                           "binding_capabilities": snapshot.get("capabilities", old_data.get("binding_capabilities", {})),
                           "binding_rendering": snapshot.get("rendering", old_data.get("binding_rendering", {}))}
                if not await self.hass.config_entries.async_unload(entry_id):
                    raise ValueError("device_busy")
                try:
                    self.hass.config_entries.async_update_entry(entry, data=updated, unique_id=kind + "_" + target if target else "unbound_" + entry_id)
                    self.hass.data.setdefault(DOMAIN + "_binding_views", {})[entry_id] = view
                    if not await self.hass.config_entries.async_setup(entry_id):
                        raise HomeAssistantError("device_not_ready")
                except Exception:
                    # Keep designs, entry identity and the old binding intact on failure.
                    try:
                        await self.hass.config_entries.async_unload(entry_id)
                    except Exception:
                        _LOGGER.exception("Could not unload failed Studio binding %s", entry_id)
                    finally:
                        self.hass.config_entries.async_update_entry(entry, data=old_data, unique_id=old_unique)
                        try:
                            self.hass.data.setdefault(DOMAIN + "_binding_views", {})[entry_id] = view
                            await self.hass.config_entries.async_setup(entry_id)
                        except Exception:
                            _LOGGER.exception("Could not restart restored Studio entry %s", entry_id)
                    raise ValueError("device_not_ready") from None
                finally:
                    self.hass.data.get(DOMAIN + "_binding_views", {}).pop(entry_id, None)
                self.hass.bus.async_fire("display_studio_status", {"entry_id": entry_id})
                return web.json_response({"entry_id": entry_id})
            except ValueError as err:
                return web.json_response({"error": str(err)}, status=409)
