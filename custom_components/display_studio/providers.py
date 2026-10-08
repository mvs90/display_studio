"""Capability-based output adapters. LG is imported only when selected."""

import asyncio
import time
from pathlib import Path
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.core import callback
from .const import DOMAIN, VERSION

ASSET_NAMES = (
    "layout.js",
    "layout.css",
    "weather.js",
    "cards.js",
    "camera.js",
    "startup-design.js",
    "grain.png",
)


def load_assets():
    root = Path(__file__).parent / "www/runtime"
    return {name: (root / name).read_bytes() for name in ASSET_NAMES}


class LGProvider:
    kind = "lg"

    def __init__(self, hass, entry, layouts):
        try:
            from custom_components.lg_rs232_ip.api import get_display_api
        except ImportError as err:
            raise ConfigEntryNotReady(
                "Install LG Professional Display 2.32.0 or newer"
            ) from err
        self.hass, self.entry, self.layouts = hass, entry, layouts.output
        self.api = get_display_api(hass, entry.data["lg_entry_id"], version=1)
        self.assets = None
        self.unsubscribe = None
        self._bind_lock = asyncio.Lock()
        self.closed = False

    @property
    def status(self):
        return self.api.studio_status

    @property
    def selected_view(self):
        if self.api.dashboard_active:
            return "dashboard"
        if self.api.pip_active:
            return "pip_view"
        if self.api.media_view_active:
            return "media_view"
        return self.api.active_view or "hdmi_full"

    async def async_start(self):
        if getattr(self.api, "studio_api_version", 0) < 1:
            raise ConfigEntryNotReady(
                "Update LG Professional Display to 2.32.0 or newer"
            )
        if not self.api.ready:
            raise ConfigEntryNotReady("Load the selected LG integration first")
        self.assets = await self.hass.async_add_executor_job(load_assets)
        await self.async_bind()
        self.unsubscribe = self.hass.bus.async_listen(
            "lg_rs232_ip_status", self._status_changed
        )

    @callback
    def _status_changed(self, event):
        if (
            not self.closed
            and event.data.get("entry_id") == self.entry.data["lg_entry_id"]
        ):
            self.hass.async_create_task(self.async_bind())

    async def async_bind(self):
        async with self._bind_lock:
            if not self.closed:
                await self.api.async_bind_studio(
                    self.entry.entry_id, self.layouts, self.assets, VERSION
                )
                self.hass.bus.async_fire(
                    "display_studio_status", {"entry_id": self.entry.entry_id}
                )

    async def async_show_view(self, view, **kwargs):
        await self.api.async_show_studio_view(view, **kwargs)

    async def async_notify(self, **kwargs):
        await self.api.async_present("show_display_app", **kwargs)

    async def async_end_preview(self, view, previous, *, active):
        if view in {"overlay", "pip", "fullscreen"}:
            await self.api.async_clear_content()
        elif active:
            if self.layouts.config["enabled"]:
                await self.async_show_view(previous if previous in self.layouts.config["scenes"] else "dashboard")

    async def async_close(self):
        self.closed = True
        if self.unsubscribe:
            self.unsubscribe()
        async with self._bind_lock:
            await self.api.async_unbind_studio(self.entry.entry_id)


class BrowserProvider:
    kind = "browser"

    def __init__(self, hass, entry, layouts):
        self.hass, self.entry, self.layouts = hass, entry, layouts.output
        self.selected_view = "dashboard"
        self.last_seen = 0
        self.message = None
        self._return = None
        self.revision = 0
        self.event = asyncio.Event()
        self.closed = False

    @property
    def status(self):
        return {
            "app_enabled": True,
            "resident_enabled": True,
            "connected": time.monotonic() - self.last_seen < 45,
            "client_startup_design": {},
            "capabilities": {
                "hdmi": False,
                "pip": False,
                "overlay": True,
                "startup": False,
                "screenshot": False,
            },
        }

    async def async_start(self):
        self.layouts.changed = self.changed

    @callback
    def changed(self):
        self.revision += 1
        self.event.set()
        self.hass.bus.async_fire(
            "display_studio_status", {"entry_id": self.entry.entry_id}
        )

    def validate_view(self, view):
        scenes = self.layouts.payload()
        scene = scenes and scenes["config"]["scenes"].get(view)
        if not scene or view in {
            "startup",
            "hdmi_full",
            "pip",
            "pip_view",
            "overlay",
            "fullscreen",
        }:
            raise HomeAssistantError("This view is not a browser source")
        if any(
            item["kind"] == "hdmi"
            or (item["kind"] == "camera" and item["camera_source"] == "multicast")
            for item in scene["elements"]
        ):
            raise HomeAssistantError(
                "This view needs a hardware HDMI / multicast adapter"
            )

    async def async_show_view(self, view, transition="none", duration=0, theme=None):
        self.validate_view(view)
        if theme:
            await self.layouts.async_set_theme(theme)
        previous = self._return[0] if self._return else self.selected_view
        self.selected_view = view
        self.message = None
        self._return = (previous, time.monotonic() + duration) if duration else None
        self.changed()

    async def async_notify(
        self, title="Home Assistant", message="", layout="overlay", duration=10
    ):
        if layout == "pip":
            raise HomeAssistantError(
                "Hardware PiP is not supported by a browser display"
            )
        self.message = {
            "title": title,
            "message": message,
            "layout": layout,
            "expires": time.monotonic() + duration,
        }
        self.changed()

    def state(self):
        self.last_seen = time.monotonic()
        if self._return and self.last_seen >= self._return[1]:
            self.selected_view, _ = self._return
            self._return = None
            self.changed()
        if self.message and self.last_seen >= self.message["expires"]:
            self.message = None
            self.changed()
        payload = self.layouts.payload()
        scenes = payload["config"]["scenes"] if payload else {}
        if self.selected_view not in scenes:
            self.selected_view = "dashboard"
        message = (
            {key: self.message[key] for key in ("title", "message", "layout")}
            if self.message
            else None
        )
        return {
            "version": VERSION,
            "revision": self.revision,
            "view": self.selected_view,
            "layout": payload,
            "message": message,
        }

    async def async_end_preview(self, view, previous, *, active):
        if view in {"overlay", "pip", "fullscreen"}:
            self.message = None
        elif active:
            self.selected_view = previous if previous in self.layouts.config["scenes"] else "dashboard"
        self.changed()

    async def async_close(self):
        self.closed = True
        self.layouts.changed = lambda: None
        self.event.set()
