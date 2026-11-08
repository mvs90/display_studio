"""Authenticated administrator editor API; the panel token cannot edit layouts."""

import json
from aiohttp import web
from homeassistant.components.http import HomeAssistantView

from .const import DOMAIN
from .layout_config import presets, validate_layout, widget_defaults
from .layouts import LayoutConflict


def require_admin(request):
    user = request.get("hass_user")
    if not user or not user.is_admin:
        raise web.HTTPForbidden()


async def read_document(request):
    raw = bytearray()
    async for part in request.content.iter_chunked(8192):
        raw.extend(part)
        if len(raw) > 1048576:
            raise web.HTTPRequestEntityTooLarge(max_size=1048576, actual_size=len(raw))
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError
        return data
    except (ValueError, TypeError):
        raise web.HTTPBadRequest(text="Invalid layout document") from None


class LayoutValidateView(HomeAssistantView):
    url = "/api/display_studio/layout_validate"
    name = "api:display_studio:layout_validate"
    requires_auth = True

    def __init__(self,hass=None):
        self.hass=hass

    async def post(self, request):
        require_admin(request)
        data = await read_document(request)
        try:
            manager=self.hass.data.get(DOMAIN,{}).get(data.get("entry_id"),{}).get("layouts") if self.hass else None
            camera_limit=getattr(manager,"camera_limit",1)
            config = validate_layout(data.get("config"),camera_limit=camera_limit)
            if "views" in data.get("config", {}):
                from .layout_library import upgrade_library, validate_library

                library = upgrade_library(data["config"], config)
                from .widget_library import KEY, resolve_library
                if self.hass and (widgets := self.hass.data.get(KEY)):
                    library = resolve_library(library, widgets.widgets)
                config, library = validate_library(library, config, camera_limit=camera_limit)
                config.update(library)
        except (ValueError, TypeError, KeyError, AttributeError) as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response(
            {"config": config}, headers={"Cache-Control": "no-store"}
        )


class LayoutListView(HomeAssistantView):
    url = "/api/display_studio/layouts"
    name = "api:display_studio:layouts"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request):
        require_admin(request)
        entries = []
        for entry_id, data in self.hass.data.get(DOMAIN, {}).items():
            if not isinstance(data, dict) or "layouts" not in data:
                continue
            provider = data.get("provider")
            status = provider.status if provider else {}
            entries.append(
                {
                    "entry_id": entry_id,
                    "name": data.get("name", "Display Studio"),
                    **status,
                    "provider": provider.kind if provider else "lg",
                }
            )
        return web.json_response(
            {"entries": entries, "presets": presets(), "widget_defaults": widget_defaults()},
            headers={"Cache-Control": "no-store"},
        )


class LayoutEntryView(HomeAssistantView):
    """Shared authorization without inherited mutation handlers."""

    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    def manager(self, request, entry_id):
        require_admin(request)
        manager = self.hass.data.get(DOMAIN, {}).get(entry_id, {}).get("layouts")
        if not manager:
            raise web.HTTPNotFound()
        return manager

    def camera_preview(self, entry_id):
        provider = self.hass.data[DOMAIN][entry_id].get("provider")
        return provider.status.get("camera_preview", {}) if provider else {}

    def rendering(self, entry_id):
        provider = self.hass.data.get(DOMAIN, {}).get(entry_id, {}).get("provider")
        return provider.status.get("rendering", {}) if provider else {}

    def startup_status(self, entry_id, manager):
        provider = self.hass.data.get(DOMAIN, {}).get(entry_id, {}).get("provider")
        status = provider.status if provider else {}
        connected = status.get("connected", False)
        reported = status.get("client_startup_design", {})
        return {
            "connected": connected,
            "stored": bool(connected and reported.get("cached") is True
                           and reported.get("version") == manager.startup_design.version),
        }


class LayoutOrientationView(LayoutEntryView):
    """Physical display setting, independent of saved or live layout drafts."""
    url = "/api/display_studio/layout_orientation/{entry_id}"
    name = "api:display_studio:layout_orientation"

    async def post(self, request, entry_id):
        self.manager(request, entry_id)
        data = await read_document(request)
        provider = self.hass.data[DOMAIN][entry_id].get("provider")
        setter = getattr(provider, "async_set_rotation", None)
        if not setter or set(data) != {"rotation"}:
            raise web.HTTPBadRequest(text="Display rotation unavailable")
        try:
            rendering = await setter(data["rotation"])
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response({"rendering": rendering}, headers={"Cache-Control": "no-store"})


class LayoutCameraView(LayoutEntryView):
    """Admin preview of an unsaved source; never accepts arbitrary input URLs."""
    url = "/api/display_studio/layout_camera/{entry_id}"
    name = "api:display_studio:layout_camera"

    async def post(self, request, entry_id):
        manager = self.manager(request, entry_id)
        data = await read_document(request)
        from .camera_sources import source_key
        try:
            if data.get("camera_source") == "entity":
                if not manager.cameras.allowed(data.get("entity_id", "")):
                    raise ValueError("Camera unavailable or own display preview")
            else:
                source_key(data)
            if data.get("kind") not in ("image", "stream"):
                raise ValueError("Invalid preview kind")
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        value = await manager.cameras.async_item(data, data["kind"])
        headers = {"Cache-Control": "no-store"}
        if data["kind"] == "stream":
            return web.json_response({"stream": value}, headers=headers)
        return web.Response(body=value, status=200 if value else 204, content_type="image/jpeg", headers=headers)


class LayoutEditorView(LayoutEntryView):
    url = "/api/display_studio/layout/{entry_id}"
    name = "api:display_studio:layout"

    async def get(self, request, entry_id):
        manager = self.manager(request, entry_id)
        values = manager.values()
        entity = request.query.get("media_entity", "")
        if entity and (preview := manager.preview_media_value(entity)) is not None:
            values[entity] = preview
        return web.json_response(
            {
                **manager.document(),
                "values": values,
                "sun": manager.sun(),
                "backgrounds": await manager.backgrounds.async_list(),
                "timezone": str(self.hass.config.time_zone),
                "startup_design": self.startup_status(entry_id, manager),
                "camera_preview": self.camera_preview(entry_id),
                "rendering": self.rendering(entry_id),
            },
            headers={"Cache-Control": "no-store"},
        )

    async def post(self, request, entry_id):
        manager = self.manager(request, entry_id)
        data = await read_document(request)
        try:
            if not isinstance(data, dict) or type(data.get("revision")) is not int:
                raise ValueError("Supply the current layout revision")
            result = await manager.async_save(data.get("config"), data["revision"])
        except LayoutConflict as err:
            raise web.HTTPConflict(text=str(err)) from None
        except (ValueError, TypeError, KeyError, AttributeError) as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response(result, headers={"Cache-Control": "no-store"})


class LayoutGraphicView(LayoutEntryView):
    url = "/api/display_studio/layout_graphic/{entry_id}"
    name = "api:display_studio:layout_graphic"

    async def post(self, request, entry_id):
        self.manager(request, entry_id)
        from .photo_import import MAX_BYTES
        from .graphics import import_graphic
        raw = bytearray()
        async for part in request.content.iter_chunked(65536):
            raw.extend(part)
            if len(raw) > MAX_BYTES:
                raise web.HTTPRequestEntityTooLarge(max_size=MAX_BYTES, actual_size=len(raw))
        try:
            graphic = await self.hass.async_add_executor_job(import_graphic, bytes(raw))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response({"graphic": graphic}, headers={"Cache-Control": "no-store"})


class LayoutBackgroundView(LayoutEditorView):
    url = "/api/display_studio/layout_background/{entry_id}/{image_id}"
    name = "api:display_studio:layout_background"

    async def get(self, request, entry_id, image_id):
        manager = self.manager(request, entry_id)
        try:
            data = await manager.backgrounds.async_read(image_id)
        except (ValueError, FileNotFoundError):
            raise web.HTTPNotFound() from None
        return web.Response(
            body=data,
            content_type="image/jpeg",
            headers={
                "Cache-Control": "private, max-age=86400",
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def post(self, request, entry_id, image_id):
        manager = self.manager(request, entry_id)
        if image_id != "upload":
            raise web.HTTPNotFound()
        from .layout_backgrounds import MAX_BYTES

        raw = bytearray()
        async for part in request.content.iter_chunked(65536):
            raw.extend(part)
            if len(raw) > MAX_BYTES:
                raise web.HTTPRequestEntityTooLarge(
                    max_size=MAX_BYTES, actual_size=len(raw)
                )
        try:
            identifier = await manager.backgrounds.async_upload(bytes(raw))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response({"image_id": identifier})

    async def delete(self, request, entry_id, image_id):
        manager = self.manager(request, entry_id)
        # Share the save lock: referenced images cannot disappear during a save.
        async with manager._lock:
            scenes = manager.all_scenes() + (manager.output.draft.all_scenes() if manager.output.draft else [])
            if any(scene["image_id"] == image_id for scene in scenes):
                raise web.HTTPConflict(text="This background is still in use")
            try:
                await manager.backgrounds.async_delete(image_id)
            except (ValueError, FileNotFoundError):
                raise web.HTTPNotFound() from None
        return web.json_response({"ok": True})


class LayoutSuggestionsView(LayoutEntryView):
    url = "/api/display_studio/layout_suggestions/{entry_id}"
    name = "api:display_studio:layout_suggestions"

    async def get(self, request, entry_id):
        self.manager(request, entry_id)
        from .layout_cards import room_suggestions

        try:
            result = room_suggestions(self.hass, self.hass.data[DOMAIN][entry_id].get("source_entry_id", entry_id), request.query.get("area_id"))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response(result, headers={"Cache-Control": "no-store"})


class LayoutMediaView(LayoutEntryView):
    url = "/api/display_studio/layout_media/{entry_id}/{entity_id}"
    name = "api:display_studio:layout_media"

    async def get(self, request, entry_id, entity_id):
        manager = self.manager(request, entry_id)
        # Only administrators may preview a not-yet-saved media binding.
        from .layout_media import artwork_size

        try:
            size = artwork_size(request.query.get("size", "640"))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        target = manager._media_target(entity_id)
        key = manager.media.key(target)
        requested = request.query.get("v", "preview")
        data = await manager.media.async_image(
            target, key if requested == "preview" else requested, size
        )
        return web.Response(
            body=data,
            status=200 if data else 204,
            content_type="image/jpeg",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )


class LayoutLibraryView(LayoutEditorView):
    url = "/api/display_studio/layout_library/{entry_id}"
    name = "api:display_studio:layout_library"

    async def get(self, request, entry_id):
        manager = self.manager(request, entry_id)
        return web.json_response(
            {
                **manager.editor_document(),
                "values": manager.values(),
                "sun": manager.sun(),
                "backgrounds": await manager.backgrounds.async_list(),
                "timezone": str(self.hass.config.time_zone),
                "startup_design": self.startup_status(entry_id, manager),
                "camera_preview": self.camera_preview(entry_id),
                "rendering": self.rendering(entry_id),
            },
            headers={"Cache-Control": "no-store"},
        )

    async def post(self, request, entry_id):
        manager = self.manager(request, entry_id)
        data = await read_document(request)
        try:
            if type(data.get("revision")) is not int:
                raise ValueError("Supply the current layout revision")
            config = data.get("config")
            from .layout_library import validate_library

            runtime, library = validate_library(config, config,camera_limit=getattr(manager,"camera_limit",1))
            await manager.async_save(runtime, data["revision"], library=library)
        except LayoutConflict as err:
            raise web.HTTPConflict(text=str(err)) from None
        except (ValueError, TypeError, KeyError, AttributeError) as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        return web.json_response(
            {**manager.editor_document(), "startup_design": self.startup_status(entry_id, manager)},
            headers={"Cache-Control": "no-store"},
        )


class LayoutLiveView(LayoutEntryView):
    """Administrator-only, session-owned live drafts with a short lease."""

    url = "/api/display_studio/layout_live/{entry_id}/{session}"
    name = "api:display_studio:layout_live"

    async def post(self, request, entry_id, session):
        from homeassistant.exceptions import HomeAssistantError
        from .live import preview_owner

        manager = self.manager(request, entry_id)
        data = await read_document(request)
        try:
            result = await manager.output.async_update(
                self.hass.data[DOMAIN][entry_id]["provider"],
                preview_owner(request, session), data,
            )
        except LayoutConflict as err:
            raise web.HTTPConflict(text=str(err)) from None
        except (ValueError, TypeError, KeyError, AttributeError) as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        except HomeAssistantError as err:
            raise web.HTTPServiceUnavailable(text=str(err)) from None
        return web.json_response(result, headers={"Cache-Control": "no-store"})

    async def delete(self, request, entry_id, session):
        from .live import preview_owner
        from homeassistant.exceptions import HomeAssistantError

        manager = self.manager(request, entry_id)
        try:
            await manager.output.async_stop(preview_owner(request, session))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err)) from None
        except HomeAssistantError:
            # The transient layout is already discarded even if the display disconnected.
            pass
        return web.json_response({"live": False}, headers={"Cache-Control": "no-store"})
