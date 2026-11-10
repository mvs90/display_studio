"""Scoped HTTP kiosk: views and configured actions, never a general HA token."""

import asyncio
import secrets
from pathlib import Path
from urllib.parse import urlencode
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.storage import Store
from .const import DOMAIN
from .layout_api import require_admin

from .fonts import FONT_FILES, ROOT as FONT_ROOT

HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}
ASSETS = {
    **{name:"font/ttf" for name in FONT_FILES},
    "index.html": "text/html",
    "browser.js": "application/javascript",
    "performance.js": "application/javascript",
    "layout.js": "application/javascript",
    "weather.js": "application/javascript",
    "cards.js": "application/javascript",
    "camera.js": "application/javascript",
    "layout.css": "text/css",
    "grain.png": "image/png",
    "test-stream.m3u8": "application/vnd.apple.mpegurl",
    "test-stream.ts": "video/mp2t",
}


class BrowserLinkView(HomeAssistantView):
    url = "/api/display_studio/browser_link/{entry_id}"
    name = "api:display_studio:browser_link"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    def data(self, request, entry_id):
        require_admin(request)
        data = self.hass.data.get(DOMAIN, {}).get(entry_id)
        if not data or data["provider"].kind not in {"browser", "esphome"} or data["provider"].status.get("unbound"):
            raise web.HTTPNotFound()
        return data

    async def get(self, request, entry_id):
        data = self.data(request, entry_id)
        if data["provider"].kind == "esphome":
            return web.json_response({"substitutions": data["provider"].api.provision}, headers=HEADERS)
        entry = self.hass.config_entries.async_get_entry(entry_id) if self.hass.config_entries else None
        options = entry.options if entry else {}
        profile = options.get("browser_performance", "auto")
        device = options.get("browser_device", "auto")
        if profile not in {"auto", "economy", "balanced", "quality"}: profile = "auto"
        if device not in {"auto", "cisco-navigator-gen1", "cisco-navigator-gen2"}: device = "auto"
        query = urlencode({"performance": profile, "device": device})
        return web.json_response(
            {
                "path": f"/api/display_studio/browser/{entry_id}/{data['token']}/index.html?{query}"
            },
            headers=HEADERS,
        )

    async def post(self, request, entry_id):
        data = self.data(request, entry_id)
        if data["provider"].kind == "esphome":
            raise web.HTTPMethodNotAllowed("POST", ["GET"])
        token = secrets.token_urlsafe(32)
        await Store(self.hass, 1, f"{DOMAIN}.{entry_id}.access").async_save(
            {"token": token}
        )
        data["token"] = token
        data["provider"].changed()
        return await self.get(request, entry_id)


class BrowserView(HomeAssistantView):
    url = "/api/display_studio/browser/{entry_id}/{token}/{resource}"
    name = "api:display_studio:browser"
    requires_auth = False

    def __init__(self, hass):
        self.hass = hass
        self.assets = {}
        self.asset_signatures = {}

    async def get(self, request, entry_id, token, resource):
        data = self.hass.data.get(DOMAIN, {}).get(entry_id)
        if (
            not data
            or not secrets.compare_digest(data["token"].encode(), token.encode())
            or data["provider"].kind != "browser"
        ):
            raise web.HTTPNotFound()
        provider = data["provider"]
        if resource == "state":
            # Long polling wakes immediately for layout/entity/view changes.
            provider.event.clear()
            if request.query.get("since") == str(provider.revision):
                try:
                    await asyncio.wait_for(
                        provider.event.wait(),
                        1 if provider.message or provider._return else 25,
                    )
                except TimeoutError:
                    pass
            if provider.closed or not secrets.compare_digest(
                data["token"].encode(), token.encode()
            ):
                raise web.HTTPNotFound()
            return web.json_response(provider.state(), headers=HEADERS)
        if resource in ("camera.json", "camera.jpg", "cover.jpg", "background.jpg"):
            return await provider.layouts.async_resource(
                resource, request.query, HEADERS
            )
        if resource not in ASSETS:
            raise web.HTTPNotFound()
        path = (FONT_ROOT/"fonts"/resource) if resource in FONT_FILES else (Path(__file__).parent / "www/runtime" / resource)
        stat = await self.hass.async_add_executor_job(path.stat)
        signature = (stat.st_mtime_ns, stat.st_size)
        if resource not in self.assets or self.asset_signatures.get(resource) != signature:
            self.assets[resource] = await self.hass.async_add_executor_job(path.read_bytes)
            self.asset_signatures[resource] = signature
        return web.Response(
            body=self.assets[resource],
            content_type=ASSETS[resource],
            headers={
                **HEADERS,
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'",
            },
        )


    async def post(self, request, entry_id, token, resource):
        data = self.hass.data.get(DOMAIN, {}).get(entry_id)
        if not data or data["provider"].closed or data["provider"].kind != "browser" or not secrets.compare_digest(data["token"].encode(), token.encode()):
            raise web.HTTPNotFound()
        if resource == "telemetry":
            if request.content_length is None or request.content_length > 512:
                raise web.HTTPBadRequest()
            try:
                body = await request.json()
            except ValueError as err:
                raise web.HTTPBadRequest() from err
            if not isinstance(body, dict) or set(body) != {"profile", "device", "automatic", "render_ms", "memory", "cores"}:
                raise web.HTTPBadRequest()
            if body["profile"] not in {"economy", "balanced", "quality"} or body["device"] not in {"auto", "cisco-navigator-gen1", "cisco-navigator-gen2"} or type(body["automatic"]) is not bool:
                raise web.HTTPBadRequest()
            if any(type(body[k]) not in (int, float) or not 0 <= body[k] <= 10000 for k in ("render_ms", "memory", "cores")):
                raise web.HTTPBadRequest()
            data["provider"].client_performance = body
            return web.json_response({"ok": True}, headers=HEADERS)
        if resource != "action":
            raise web.HTTPMethodNotAllowed("POST", ["GET"])
        if request.content_length is None or request.content_length > 512:
            raise web.HTTPRequestEntityTooLarge(max_size=512, actual_size=request.content_length or 513)
        from homeassistant.exceptions import HomeAssistantError
        try:
            result = await data["provider"].async_browser_touch(await request.json())
        except (ValueError, TypeError, KeyError, HomeAssistantError):
            raise web.HTTPBadRequest(text="Stale, unavailable or unconfigured kiosk action") from None
        return web.json_response(result, headers=HEADERS)
