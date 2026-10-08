"""Read-only, narrowly scoped browser display access; never an HA API token."""

import asyncio
import secrets
from pathlib import Path
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.storage import Store
from .const import DOMAIN
from .layout_api import require_admin

HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}
ASSETS = {
    "index.html": "text/html",
    "browser.js": "application/javascript",
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
        if not data or data["provider"].kind != "browser":
            raise web.HTTPNotFound()
        return data

    async def get(self, request, entry_id):
        data = self.data(request, entry_id)
        return web.json_response(
            {
                "path": f"/api/display_studio/browser/{entry_id}/{data['token']}/index.html"
            },
            headers=HEADERS,
        )

    async def post(self, request, entry_id):
        data = self.data(request, entry_id)
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
            return await data["layouts"].async_resource(
                resource, request.query, HEADERS
            )
        if resource not in ASSETS:
            raise web.HTTPNotFound()
        if resource not in self.assets:
            self.assets[resource] = await self.hass.async_add_executor_job(
                (Path(__file__).parent / "www/runtime" / resource).read_bytes
            )
        return web.Response(
            body=self.assets[resource],
            content_type=ASSETS[resource],
            headers={
                **HEADERS,
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'",
            },
        )
