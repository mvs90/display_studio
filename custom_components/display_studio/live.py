"""Leased editor previews: transient layouts never enter persistent storage."""

import asyncio
from copy import deepcopy
import re
import logging

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_call_later

from .layout_library import validate_library
from .layout_config import layout_entities
from .layouts import LayoutConflict

_LOGGER = logging.getLogger(__name__)

LEASE_SECONDS = 45
NOTIFICATIONS = {"overlay", "pip", "fullscreen"}


class LayoutOutput:
    """Stable adapter binding that can temporarily render an editor draft."""

    def __init__(self, base):
        self.base = base
        self.draft = None
        self.owner = None
        self.provider = None
        self.view = None
        self.previous = None
        self.message = None
        self._timer = None
        self._lock = asyncio.Lock()

    def __getattr__(self, name):
        # Offline boot design and all writes always refer to the saved document.
        target = (
            self.base
            if name
            in {"startup_design", "async_save", "async_set_theme", "validate_theme"}
            else self.draft or self.base
        )
        return getattr(target, name)

    @property
    def changed(self):
        return self.base.changed

    @changed.setter
    def changed(self, callback):
        self.base.changed = callback
        if self.draft:
            self.draft.changed = callback

    async def async_update(self, provider, owner, data):
        async with self._lock, self.base._lock:
            if self.owner and self.owner != owner:
                raise LayoutConflict("Another editor is already live on this display")
            if (
                type(data.get("revision")) is not int
                or data["revision"] != self.base.revision
            ):
                raise LayoutConflict("Saved layout changed; reload before going live")
            view = data.get("view")
            if not isinstance(view, str):
                raise ValueError("Supply a preview view")
            if self.owner and self.view != view:
                raise LayoutConflict("Stop the previous preview before changing views")
            if "config" not in data and not self.draft:
                raise ValueError("Start live preview with a layout")
            if not provider.status.get("connected"):
                raise HomeAssistantError("Display is not connected")
            if "config" in data:
                runtime, library = validate_library(data["config"], data["config"])
                if view not in runtime["scenes"]:
                    raise ValueError("Unknown preview view")
                scene = runtime["scenes"][view]
                if provider.kind == "browser" and (
                    view in {"hdmi_full", "pip_view", "pip", "startup"}
                    or any(
                        (item["kind"] == "hdmi" and view != "overlay")
                        or (
                            item["kind"] == "camera"
                            and item["camera_source"] == "multicast"
                        )
                        for item in scene["elements"]
                    )
                ):
                    raise ValueError("This view requires a hardware display adapter")
                images = {
                    row["scene"]["image_id"]
                    for row in library["views"]
                    if row["scene"]["image_id"]
                }
                if images and not images.issubset(
                    set(await self.base.backgrounds.async_list())
                ):
                    raise ValueError("Upload missing background images first")
                runtime["enabled"] = True
                # Start design can be previewed without overwriting its offline cache.
                if view == "startup":
                    runtime["scenes"]["dashboard"] = deepcopy(scene)
                if not self.draft:
                    self.draft = type(self.base)(self.base.hass, self.base.entry)
                draft = self.draft
                subscriptions_changed = (
                    not self.owner
                    or layout_entities(runtime) != layout_entities(draft.config)
                    or runtime.get("sun_entity") != draft.config.get("sun_entity")
                )
                old_requests = draft.forecast_requests()
                draft.config, draft.library = runtime, library
                draft.changed = self.changed
                # Moving/resizing retains in-flight forecasts, caches and subscriptions.
                if subscriptions_changed or old_requests != draft.forecast_requests():
                    draft.revision += 1
                    draft._subscribe()
            starting = self.owner is None
            self.owner, self.provider, self.view = owner, provider, view
            if starting:
                self.previous = provider.selected_view
            try:
                self.changed()
                message = str(data.get("message", "Deine Benachrichtigung"))[:2000]
                if view in NOTIFICATIONS and (
                    starting or "config" not in data or message != self.message
                ):
                    await provider.async_notify(
                        title="Home Assistant",
                        message=message,
                        layout=view,
                        duration=LEASE_SECONDS,
                    )
                    self.message = message
                elif starting and view not in NOTIFICATIONS:
                    await provider.async_show_view(
                        "dashboard" if view == "startup" else view
                    )
            except BaseException:
                await self._stop(restore=False)
                raise
            if self._timer:
                self._timer()
            self._timer = async_call_later(self.base.hass, LEASE_SECONDS, self._expire)
            return {"live": True, "lease": LEASE_SECONDS}

    async def _expire(self, _):
        try:
            await self.async_stop()
        except HomeAssistantError:
            _LOGGER.debug("Live preview expired while display was disconnected")

    async def async_stop(self, owner=None, *, restore=True):
        async with self._lock:
            if owner is not None and self.owner != owner:
                return
            await self._stop(restore=restore)

    async def _stop(self, *, restore):
        if self._timer:
            self._timer()
            self._timer = None
        draft, provider, view, previous = (
            self.draft,
            self.provider,
            self.view,
            self.previous,
        )
        active = provider is not None and provider.selected_view == (
            "dashboard" if view == "startup" else view
        )
        self.draft = self.owner = self.provider = self.view = self.previous = (
            self.message
        ) = None
        if draft:
            await draft.async_close()
            self.changed()
        if restore and provider and not provider.closed:
            await provider.async_end_preview(view, previous, active=active)


def preview_owner(request, session):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{16,64}", session):
        raise ValueError("Invalid preview session")
    return (request["hass_user"].id, session)
