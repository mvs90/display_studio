"""Capability-based output adapters. LG is imported only when selected."""

import asyncio
import time
from pathlib import Path
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.core import callback
from .const import DOMAIN, VERSION
from .fonts import font_assets

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
    return {**{name: (root / name).read_bytes() for name in ASSET_NAMES}, **font_assets()}


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
                await self.async_show_view(previous if previous in self.layouts.source_views or previous == "hdmi_full" else next(iter(self.layouts.source_views), "hdmi_full"))

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
        self.touch_sessions = {}
        self.touch_lock = asyncio.Lock()
        self._deadline_cancel = None
        self._deadline_at = 0

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
        # Canonical palette files are loaded once off the HA event loop.
        from importlib import import_module
        await self.hass.async_add_executor_job(import_module, __package__ + ".lvgl")
        self.layouts.state_publish_delay = .3
        self.layouts.changed = self.changed

    @callback
    def changed(self):
        self._schedule_deadline()
        self.revision += 1
        self.event.set()
        self.hass.bus.async_fire(
            "display_studio_status", {"entry_id": self.entry.entry_id}
        )

    def _schedule_deadline(self):
        deadlines = ([self._return[1]] if self._return else []) + ([self.message["expires"]] if self.message else [])
        when = min(deadlines) if deadlines and not self.closed else 0
        if when == self._deadline_at:
            return
        if self._deadline_cancel:
            self._deadline_cancel.cancel()
        self._deadline_cancel = None
        self._deadline_at = when
        if when:
            def expired():
                self._deadline_cancel = None
                self._deadline_at = 0
                if not self.closed:
                    self.state()  # Shared expiry/return logic also triggers a native push.
                    self._schedule_deadline()
            self._deadline_cancel = self.hass.loop.call_later(max(.001, when - time.monotonic()), expired)

    def resolved_view(self, view):
        """Retain existing sources; deleted sources return to a remaining view."""
        sources = self.layouts.source_views
        if view in sources:
            return view
        if view in {"startup", "connecting", "updating"} and view in self.layouts.config["scenes"]:
            return view
        for candidate in sources:
            try:
                self.validate_view(candidate)
            except HomeAssistantError:
                continue
            return candidate
        return "startup"

    def validate_view(self, view):
        from .layout_config import active_scenes
        config = self.layouts.config
        scene = config["enabled"] and active_scenes(config).get(view)
        if not scene or view not in self.layouts.source_views or view in {
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
            for item in scene["elements"]
        ):
            raise HomeAssistantError(
                "This view needs a hardware HDMI adapter"
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
            "touch_revision": self.revision,
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
        self.selected_view = self.resolved_view(self.selected_view)
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
            "touch_revision": self.revision,
        }

    async def async_end_preview(self, view, previous, *, active):
        if view in {"overlay", "pip", "fullscreen"}:
            self.message = None
        elif active:
            self.selected_view = self.resolved_view(previous)
        self.changed()

    async def async_close(self):
        self.closed = True
        if self._deadline_cancel:
            self._deadline_cancel.cancel()
            self._deadline_cancel = None
        self.layouts.changed = lambda: None
        self.event.set()

    async def async_touch(self, action, value=None):
        from homeassistant.exceptions import HomeAssistantError
        from .layout_config import validate_tap_action
        choices = action.get("_options", [])
        action = validate_tap_action({k: v for k, v in action.items() if k != "_options"})
        if action["action"] in {"av_select_source", "player_select_source"} and type(value) is int:
            if not 0 <= value < len(choices):
                raise ValueError("Invalid source selection")
            value = choices[value]
        if value is not None and action["action"] not in {"av_volume_set", "av_select_source", "player_volume_set", "player_select_source", "home_adjust"}:
            raise ValueError("Unexpected control value")
        if action["action"] == "show_view":
            await self.async_show_view(action["view"])
            return
        target = action["entity_id"]
        if action["action"] in {"home_primary", "home_adjust"}:
            from .home_controls import async_execute as home_execute
            await home_execute(self.hass, target, action["action"], value)
            self.changed()
            return
        from .av_schema import PLAYER_ACTIONS
        if action["action"] in PLAYER_ACTIONS:
            from .player_controls import async_execute as player_execute
            await player_execute(self.hass, target, action["action"], value)
            self.changed()
            return
        from .av_controls import AV_ACTIONS, async_execute
        if action["action"] in AV_ACTIONS:
            await async_execute(self.hass, target, action["action"], value)
            self.changed()
            return
        state = self.hass.states.get(target)
        from .lvgl import touch_available
        if not touch_available(action, state.state if state else None):
            raise HomeAssistantError("Touch target unavailable")
        domain = target.split(".")[0]
        from .entity_actions import ENTITY_ACTIONS, action_supported
        name=action["action"]
        if not action_supported(name,domain,state.attributes):
            raise HomeAssistantError("Entity function unavailable")
        data={"entity_id":target}
        if name=="media_mute":data["is_volume_muted"]=not state.attributes.get("is_volume_muted",False)
        await self.hass.services.async_call(domain, ENTITY_ACTIONS[name]["service"], data, blocking=True)
        self.changed()


    async def async_browser_touch(self, body):
        import re
        from .layout_config import validate_tap_action
        if not isinstance(body, dict) or set(body) - {"value"} != {"revision", "element", "scene", "session", "sequence"}:
            raise ValueError("Invalid kiosk touch")
        if type(body["revision"]) is not int or type(body["sequence"]) is not int or not 1 <= body["sequence"] <= 2147483647 or not isinstance(body["session"], str) or not re.fullmatch(r"[a-f0-9]{32}", body["session"]):
            raise ValueError("Invalid kiosk touch sequence")
        async with self.touch_lock:
            state = self.state()  # Expire timed views/messages before authorizing.
            active = {state["view"]}
            if state["message"]:
                if state["message"]["layout"] == "fullscreen":
                    active.clear()
                active.add(state["message"]["layout"])
            if self.closed or body["revision"] != self.revision or body["scene"] not in active:
                raise ValueError("Stale kiosk scene")
            scene = (state["layout"] or {}).get("config", {}).get("scenes", {}).get(body["scene"], {})
            from .media_widget import expand
            scene = expand(scene, (state["layout"] or {}).get("values", {}))
            adjust = isinstance(body["element"], str) and body["element"].endswith("/adjust")
            hold = isinstance(body["element"], str) and body["element"].endswith("/hold")
            if hold and "value" in body:
                raise ValueError("Hold requires a discrete action")
            element = body["element"][:-7] if adjust else body["element"][:-5] if hold else body["element"]
            item = next((i for i in scene.get("elements", []) if i["id"] == element), None)
            if not item:
                raise ValueError("Unknown kiosk element")
            from .home_theme import enabled as home_enabled, primary_action, model
            home = home_enabled(scene,item)
            if adjust and not home:
                raise ValueError("Unknown kiosk adjustment")
            data = (state["layout"] or {}).get("values", {}).get(item.get("entity_id", ""), {})
            if adjust:
                if not model(item,data)["popup"]["adjust"]:raise ValueError("Unavailable adjustment")
                raw = {"action":"home_adjust","entity_id":item["entity_id"],"view":""}
            elif hold:raw = item.get("hold_action", {"action": "none"})
            else:raw = primary_action(item,data) if home else item.get("tap_action")
            action = validate_tap_action(raw, item["kind"], item.get("entity_id", ""))
            if action["action"] == "none" or (not action["entity_id"] and action["action"] != "show_view"):
                raise ValueError("Unconfigured kiosk touch")
            session = body["session"]
            if body["sequence"] <= self.touch_sessions.get(session, 0):
                return {"duplicate": True}
            if len(self.touch_sessions) >= 32 and session not in self.touch_sessions:
                self.touch_sessions.pop(next(iter(self.touch_sessions)))
            self.touch_sessions[session] = body["sequence"]
            await self.async_touch(action, body["value"]) if "value" in body else await self.async_touch(action)
            return {"duplicate": False}


class UnboundProvider(BrowserProvider):
    """Keep designs editable while a physical display is being replaced."""

    def __init__(self, hass, entry, layouts):
        super().__init__(hass, entry, layouts)
        self.kind = entry.data["provider"]

    @property
    def status(self):
        result = super().status
        result.update(connected=False, unbound=True,
                      capabilities={**result["capabilities"], **self.entry.data.get("binding_capabilities", {})},
                      rendering={**self.entry.data.get("binding_rendering", {}), "rotation_supported": False})
        return result

    def validate_view(self, view):
        if view in self.layouts.source_views or (view == "hdmi_full" and self.kind == "lg"):
            return
        raise HomeAssistantError("Unknown display view")
