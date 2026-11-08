"""Reusable widget designs, resolved into ordinary layouts for every renderer."""

import asyncio
from copy import deepcopy
import re

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .layout_config import make_layout, validate_layout
from .layout_library import validate_library

KEY = DOMAIN + "_widgets"
ID = re.compile(r"widget_[a-zA-Z0-9_-]{1,60}")
# These belong to a particular placement, not the reusable design.
INSTANCE_FIELDS = frozenset((
    "id", "x", "y", "width", "height", "grid_size", "manual_size", "lock_ratio",
    "clock_size", "clock_base_height", "camera_size", "widget_template",
    "entity_id", "label", "tap_action", "tap_auto", "tap_trigger",
    "hold_action", "hold_ms", "media_remote_view", "media_controls", "media_controls_hidden",
    "camera_source", "multicast_url", "camera_mode", "camera_interval",
    "camera_aspect_ratio", "camera_lock_aspect", "camera_fit", "camera_zoom",
    "camera_pan_x", "camera_pan_y", "weather_reactive", "progress_source", "progress_min",
    "progress_max", "progress_value", "forecast_type", "forecast_count",
    "clock_seconds", "clock_blink", "clock_time_format", "clock_date_format",
))


def validate_widget(raw):
    if not isinstance(raw, dict) or set(raw) != {"id", "name", "item"}:
        raise ValueError("Supply a widget ID, name and design")
    if not isinstance(raw["id"], str) or not ID.fullmatch(raw["id"]):
        raise ValueError("Invalid widget ID")
    name = raw["name"]
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
        raise ValueError("Use a widget name with 1–80 characters")
    candidate = make_layout()
    item = deepcopy(raw["item"])
    if not isinstance(item, dict) or item.get("kind") == "hdmi":
        raise ValueError("Invalid reusable widget")
    item.pop("widget_template", None)
    item["id"] = "template"
    candidate["scenes"]["dashboard"]["elements"] = [item]
    normalized = validate_layout(candidate, camera_limit=8)["scenes"]["dashboard"]["elements"][0]
    # Never publish somebody's device bindings as a shared default.
    normalized["entity_id"] = ""
    for key in ("tap_action", "hold_action"):
        normalized[key]["entity_id"] = ""
        normalized[key]["view"] = ""
        if normalized[key]["action"] == "show_view":
            normalized[key]["action"] = "none"
    normalized["media_remote_view"] = ""
    normalized["multicast_url"] = ""
    if normalized.get("camera_source") in ("local", "multicast"):
        normalized["camera_source"] = "entity"
    return {"id": raw["id"], "name": name.strip(), "item": normalized}


def resolve_item(item, templates):
    identifier = item.get("widget_template")
    if not identifier:
        return deepcopy(item)
    template = next((w for w in templates if w["id"] == identifier), None)
    if template is None:
        raise ValueError("The selected widget template no longer exists")
    design = template["item"]
    if (item["kind"], item.get("control_type")) != (design["kind"], design.get("control_type")):
        raise ValueError("A used widget cannot change its type")
    result = {**deepcopy(design), **{k: deepcopy(v) for k, v in item.items() if k in INSTANCE_FIELDS}}
    # Visibility is an instance setting (e.g. time only versus date only).
    for key, part in item.get("parts", {}).items():
        if "visible" in part:
            result.setdefault("parts", {}).setdefault(key, {})["visible"] = part["visible"]
    return result


def resolve_library(library, templates):
    result = deepcopy(library)
    for view in result["views"]:
        view["scene"]["elements"] = [resolve_item(i, templates) for i in view["scene"]["elements"]]
    return result


class WidgetLibrary:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, KEY)
        self.widgets = []
        self.revision = 0
        self.lock = asyncio.Lock()

    async def async_load(self):
        saved = await self.store.async_load()
        if saved:
            self.widgets = [validate_widget(w) for w in saved["widgets"]]
            self.revision = saved["revision"]

    def managers(self):
        return [v["layouts"] for v in self.hass.data.get(DOMAIN, {}).values() if isinstance(v, dict) and "layouts" in v]

    def document(self):
        usage = {}
        for manager in self.managers():
            for view in manager.library["views"]:
                for item in view["scene"]["elements"]:
                    if key := item.get("widget_template"):
                        usage.setdefault(key, []).append({"entry_id": manager.entry.entry_id, "view": view["name"], "element_id": item["id"]})
        return {"widgets": deepcopy(self.widgets), "revision": self.revision, "usage": usage}

    async def async_save(self, raw, revision):
        from .layouts import LayoutConflict
        widget = validate_widget(raw)
        async with self.lock:
            if type(revision) is not int or revision != self.revision:
                raise LayoutConflict("The widget library changed. Reload before saving.")
            previous = next((w for w in self.widgets if w["id"] == widget["id"]), None)
            if previous and (previous["item"]["kind"], previous["item"].get("control_type")) != (widget["item"]["kind"], widget["item"].get("control_type")):
                raise ValueError("Create a new widget to change its type")
            updated = [widget if w["id"] == widget["id"] else w for w in self.widgets]
            if previous is None:
                updated.append(widget)
            if len(updated) > 128:
                raise ValueError("Use at most 128 widget templates")
            # Validate every loaded target before changing the shared source.
            for manager in self.managers():
                config, target = validate_library(resolve_library(manager.library, updated), manager.config, camera_limit=manager.camera_limit)
                if getattr(manager.entry, "data", {}).get("provider") == "esphome":
                    from .esphome_layout import adapt, validate_native_startup
                    config, target = adapt(config, target)
                    validate_native_startup(config)
            if updated == self.widgets:
                return self.document()
            await self.store.async_save({"widgets": updated, "revision": self.revision + 1})
            self.widgets, self.revision = updated, self.revision + 1
            # Each display saves through its usual revision, subscription and
            # change-detection path. Offline displays resolve on their next start.
            for manager in self.managers():
                for attempt in range(3):
                    try:
                        await manager.async_save(manager.config, manager.revision, manager.library)
                        break
                    except LayoutConflict:
                        if attempt == 2:
                            raise
            return self.document()


class WidgetLibraryView(HomeAssistantView):
    url = "/api/display_studio/widget_library"
    name = "api:display_studio:widget_library"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request):
        from .layout_api import require_admin
        require_admin(request)
        return web.json_response(self.hass.data[KEY].document(), headers={"Cache-Control": "no-store"})

    async def post(self, request):
        from .layout_api import require_admin, read_document
        from .layouts import LayoutConflict
        require_admin(request)
        data = await read_document(request)
        try:
            result = await self.hass.data[KEY].async_save(data.get("widget"), data.get("revision"))
        except LayoutConflict as err:
            raise web.HTTPConflict(text=str(err)) from None
        except (ValueError, TypeError, KeyError) as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response(result, headers={"Cache-Control": "no-store"})
