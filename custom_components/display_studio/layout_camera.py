"""On-demand camera access for paired displays; no background camera polling."""

import asyncio
from collections import OrderedDict
import time
from urllib.parse import urlencode
from contextlib import suppress

from .camera_sources import source_key, input_args

from homeassistant.components import camera
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
from .layout_media import prepare_covers


class LayoutCamera:
    def __init__(self, hass, target_lg_entry_id=None):
        self.hass = hass
        self.target_lg_entry_id = target_lg_entry_id
        self._cache = OrderedDict()
        self._tasks = {}
        self._slots = asyncio.Semaphore(2)
        self._closed = False
        self._streams = OrderedDict()

    def allowed(self, entity_id):
        state = self.hass.states.get(entity_id)
        record = er.async_get(self.hass).async_get(entity_id)
        return bool(
            state
            and state.domain == "camera"
            and state.state not in ("unavailable", "unknown", "off")
            # Other LG displays are valid sources. Only direct self-feedback
            # and Studio's own rendered previews are excluded.
            and not (record and (record.platform == DOMAIN or
                record.platform == "lg_rs232_ip" and self.target_lg_entry_id and
                record.config_entry_id == self.target_lg_entry_id))
        )

    def mjpeg_url(self, entity_id):
        if self._closed or not self.allowed(entity_id):
            return None
        record = er.async_get(self.hass).async_get(entity_id)
        if not record or record.platform != "lg_rs232_ip":
            return None
        # Share HA's camera-only proxy token, as HA does for its image element;
        # never expose LG credentials or a source URL to a paired display.
        entity = camera.get_camera_from_entity_id(self.hass, entity_id)
        token = next(reversed(entity.access_tokens), None)
        return "/api/camera_proxy_stream/" + entity_id + "?" + urlencode({"token": token}) if token else None

    async def async_get(self, entity_id, kind):
        if self._closed or not self.allowed(entity_id):
            return None
        if kind == "stream":
            url = self.mjpeg_url(entity_id)
            if url:
                return url
        key = (entity_id, kind)
        cached = self._cache.get(key)
        if cached and time.monotonic() < cached[0]:
            return cached[1]
        if key not in self._tasks:
            if len(self._tasks) >= 4:
                return None
            self._tasks[key] = asyncio.create_task(self._fetch(key))
        return await asyncio.shield(self._tasks[key])

    async def _fetch(self, key):
        entity_id, kind = key
        value = None
        try:
            async with asyncio.timeout(10), self._slots:
                if kind == "stream":
                    url = await camera.async_request_stream(self.hass, entity_id, "hls")
                    # HA owns the stream. Never reveal a camera's RTSP credentials.
                    if isinstance(url, str) and url.startswith("/api/hls/"):
                        value = url
                else:
                    image = await camera.async_get_image(
                        self.hass, entity_id, width=1280, height=720
                    )
                    images = await self.hass.async_add_executor_job(
                        prepare_covers, image.content, (1280,)
                    )
                    value = images[1280]
        except Exception:
            # An unavailable/unsupported stream falls back to snapshots in the app.
            # Errors may contain camera credentials; do not log their text.
            pass
        finally:
            self._tasks.pop(key, None)
        self._cache[key] = (time.monotonic() + (60 if kind == "stream" else 1), value)
        self._cache.move_to_end(key)
        while len(self._cache) > 8:
            self._cache.popitem(last=False)
        return value

    async def async_item(self, item, kind):
        if item.get("camera_source") == "entity":
            return await self.async_get(item.get("entity_id", ""), kind)
        if self._closed:
            return None
        source = source_key(item)
        if kind == "stream" and source[0] == "test":
            return "/display_studio/runtime/test-stream.m3u8"
        key = (*source, kind)
        cached = self._cache.get(key)
        if cached and time.monotonic() < cached[0]:
            return cached[1]
        if key not in self._tasks:
            if len(self._tasks) >= 4:
                return None
            self._tasks[key] = asyncio.create_task(self._external_fetch(key, item))
        return await asyncio.shield(self._tasks[key])

    async def _external_fetch(self, key, item):
        value = process = None
        try:
            async with asyncio.timeout(10), self._slots:
                if key[-1] == "stream":
                    from homeassistant.components.camera import DynamicStreamSettings
                    from homeassistant.components.stream import create_stream
                    stream = self._streams.get(key)
                    if stream is None:
                        if len(self._streams) >= 2:
                            _, old = self._streams.popitem(last=False)
                            await old.stop()
                        stream = create_stream(self.hass, key[1], options={},
                                               dynamic_stream_settings=DynamicStreamSettings(),
                                               stream_label="Display Studio Multicast")
                        self._streams[key] = stream
                    stream.add_provider("hls", timeout=30)
                    await stream.start()
                    value = stream.endpoint_url("hls")
                else:
                    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1"]
                    # MPEG-TS input seeking can repeatedly return the first
                    # keyframe. Decode to the requested position instead.
                    args += input_args(item) + (["-ss", str(time.monotonic()%4)] if key[0]=="test" else []) + ["-an", "-sn", "-dn", "-frames:v", "1", "-vf",
                        "scale=1280:720:force_original_aspect_ratio=decrease", "-c:v", "mjpeg", "-q:v", "3", "-threads", "1", "-f", "image2pipe", "pipe:1"]
                    process = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                    data = await process.stdout.read(4*1024*1024+1)
                    # read() can return a short pipe chunk; read until EOF with a bound.
                    while len(data) <= 4*1024*1024:
                        chunk = await process.stdout.read(min(65536,4*1024*1024+1-len(data)))
                        if not chunk:
                            break
                        data += chunk
                    if len(data) <= 4*1024*1024 and data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9"):
                        value = data
        except Exception:
            pass  # Source URLs/credentials are never logged.
        finally:
            if process and process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
                await process.wait()
            self._tasks.pop(key, None)
        if not self._closed:
            self._cache[key] = (time.monotonic() + (20 if key[-1] == "stream" else 1), value)
            self._cache.move_to_end(key)
            while len(self._cache) > 8:
                self._cache.popitem(last=False)
        return value

    async def async_close(self):
        self._closed = True
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._cache.clear()
        await asyncio.gather(*(stream.stop() for stream in self._streams.values()), return_exceptions=True)
        self._streams.clear()
