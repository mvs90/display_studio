"""Per-display layout storage and narrowly selected, cached Home Assistant data."""

import asyncio
from copy import deepcopy
from datetime import timedelta
import logging
import math
from astral import Observer
from astral.sun import elevation, azimuth
import time

from homeassistant.core import callback
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .celestial import moon_position
from .startup_design import StartupDesign
from .layout_backgrounds import LayoutBackgrounds
from .layout_media import LayoutMedia
from .layout_camera import LayoutCamera
from .layout_cards import card_metadata
from .layout_config import (
    active_scenes,
    layout_entities,
    make_layout,
    media_background_entities,
    validate_layout,
)
from .layout_library import (
    from_config,
    source_views,
    sync_legacy,
    upgrade_library,
    validate_library,
)

_LOGGER = logging.getLogger(__name__)


class LayoutConflict(ValueError):
    """Another editor saved this document first."""


class DisplayLayouts:
    def __init__(self, hass, entry):
        self.hass, self.entry = hass, entry
        self.store = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}.layouts")
        self.backgrounds = LayoutBackgrounds(hass, entry.entry_id)
        self.media = LayoutMedia(hass, lambda: self.changed())
        self.cameras = LayoutCamera(hass, getattr(entry, "data", {}).get("lg_entry_id"))
        self.config = make_layout()
        self.config, self.library = validate_library(from_config(self.config, preserve_sources=False), self.config)
        self.revision = 0
        self.startup_design = StartupDesign(self)
        self.changed = lambda: None
        self.state_publish_delay = .3
        self._lock = asyncio.Lock()
        self._unsub = self._timer = self._debounce = self._sun_timer = None
        self._av_capability_timer = None
        self._av_capability_entities = set()
        self._av_capability_signature = ()
        self._sun_cache = None
        self._fetch_task = None
        self._cache = {}
        self._closed = False
        from .live import LayoutOutput

        self.output = LayoutOutput(self)

    @property
    def camera_limit(self):
        return 8 if getattr(self.entry,"data",{}).get("provider")=="esphome" else 1

    async def async_start(self):
        from .symbols import load_catalog
        await self.hass.async_add_executor_job(load_catalog)
        # Compiler/default assets are read once outside HA's event loop.
        if getattr(self.entry,'data',{}).get('provider')=='esphome':
            from importlib import import_module
            await self.hass.async_add_executor_job(import_module, __package__+'.esphome_layout')
        saved = await self.store.async_load()
        if saved:
            try:
                self.config = validate_layout(saved["config"],camera_limit=self.camera_limit)
                self.config, self.library = validate_library(
                    upgrade_library(
                        saved.get("library", from_config(self.config)), self.config
                    ),
                    self.config,camera_limit=self.camera_limit,
                )
                self.revision = int(saved.get("revision", 0))
            except (ValueError, TypeError, KeyError):
                self.config = make_layout()
                self.config, self.library = validate_library(from_config(self.config, preserve_sources=False), self.config)
                _LOGGER.warning(
                    "Invalid stored display layout; custom layouts disabled"
                )
        from .widget_library import KEY, resolve_library
        if widgets := self.hass.data.get(KEY):
            library = resolve_library(self.library, widgets.widgets)
            config, library = validate_library(library, self.config, camera_limit=self.camera_limit)
            if config != self.config or library != self.library:
                self.config, self.library = config, library
                self.revision += 1
                await self.store.async_save({'config': config, 'library': library, 'revision': self.revision})
        if getattr(self.entry,'data',{}).get('provider')=='esphome':
            from .esphome_layout import adapt
            config,library=adapt(self.config,self.library,migrate=True)
            if config!=self.config or library!=self.library:
                self.config,self.library=config,library
                self.revision+=1
                await self.store.async_save({'config':config,'library':library,'revision':self.revision})
        self._subscribe()

    async def async_close(self):
        self._closed = True
        await self.output.async_stop(restore=False)
        await self.media.async_close()
        await self.cameras.async_close()
        for name in ("_unsub", "_timer", "_debounce", "_sun_timer", "_av_capability_timer"):
            if unsub := getattr(self, name):
                unsub()
                setattr(self, name, None)
        if self._fetch_task:
            self._fetch_task.cancel()
            await asyncio.gather(self._fetch_task, return_exceptions=True)
            self._fetch_task = None

    @property
    def source_views(self):
        return source_views(self.library)

    def document(self):
        return {"config": deepcopy(self.config), "revision": self.revision}

    def editor_document(self):
        return {
            "config": {**deepcopy(self.config), **deepcopy(self.library)},
            "revision": self.revision,
        }

    def all_scenes(self):
        return list(self.config["scenes"].values()) + [
            view["scene"] for view in self.library["views"]
        ] + [theme["style"] for theme in self.library.get("themes", [])]

    def validate_theme(self, theme):
        if not isinstance(theme, str) or not any(row["id"] == theme for row in self.library.get("themes", [])):
            raise ValueError("Unknown Studio theme ID")
        validate_library({**self.library, "active_theme": theme}, self.config,camera_limit=self.camera_limit)

    async def async_set_theme(self, theme):
        self.validate_theme(theme)
        if self.library.get("active_theme") == theme:
            return
        library = deepcopy(self.library)
        library["active_theme"] = theme
        await self.async_save(self.config, self.revision, library)

    async def async_save(self, config, expected_revision, library=None):
        config = validate_layout(config,camera_limit=self.camera_limit)
        async with self._lock:
            if expected_revision != self.revision:
                raise LayoutConflict(
                    "Layout changed in another editor. Reload before saving."
                )
            library = sync_legacy(self.library, config,camera_limit=self.camera_limit) if library is None else library
            from .widget_library import KEY, resolve_library
            if widgets := self.hass.data.get(KEY):
                library = resolve_library(library, widgets.widgets)
            config, library = validate_library(library, config,camera_limit=self.camera_limit)
            if getattr(self.entry,'data',{}).get('provider')=='esphome':
                from .esphome_layout import adapt,validate_native_startup
                config,library=adapt(config,library)
                validate_native_startup(config)
            if config == self.config and library == self.library:
                return self.document()
            images = {
                scene["image_id"]
                for scene in [v["scene"] for v in library["views"]] + [t["style"] for t in library["themes"]]
                if scene["image_id"]
            }
            if images and not images.issubset(set(await self.backgrounds.async_list())):
                raise ValueError(
                    "Upload the missing background image on this installation first"
                )
            old_requests = self.forecast_requests()
            same_sun = config.get("sun_entity") == self.config.get("sun_entity")
            bindings_changed = (
                layout_entities(config) != layout_entities(self.config)
                or config["enabled"] != self.config["enabled"]
                or config.get("sun_entity") != self.config.get("sun_entity")
            )
            revision = self.revision + 1
            await self.store.async_save(
                {"config": config, "library": library, "revision": revision}
            )
            self.config, self.library, self.revision = config, library, revision
            requests = self.forecast_requests() if config["enabled"] else {}
            # Saving geometry or another view must not blank the current
            # forecast, restart subscriptions or cancel a useful pending fetch.
            if bindings_changed or requests != old_requests:
                if self._fetch_task:
                    self._fetch_task.cancel()
                    await asyncio.gather(self._fetch_task, return_exceptions=True)
                    self._fetch_task = None
                self._cache = {
                    key: {**value, "items": value["items"][:requests[key]]}
                    for key, value in self._cache.items() if key in requests
                }
                self._subscribe(preserve_sun=same_sun)
            self.changed()
        return self.document()

    def _subscribe(self, *, preserve_sun=False):
        if self._av_capability_timer:
            self._av_capability_timer()
            self._av_capability_timer = None
        self._av_capability_entities = set()
        if self._sun_timer:
            self._sun_timer()
            self._sun_timer = None
        if not preserve_sun:
            self._sun_cache = None
        if self._unsub:
            self._unsub()
            self._unsub = None
        if self._timer:
            self._timer()
            self._timer = None
        if self._debounce:
            self._debounce()
            self._debounce = None
        if self.config["enabled"] and not self._closed:
            from .av_controls import dependencies, routed_entities
            self._av_dependencies = dependencies(self.hass, self.config)
            self._av_capability_entities = routed_entities(self.hass, self.config)
            self._av_capability_signature = self._av_capabilities()
            self._schedule_av_capabilities()
            entities = layout_entities(self.config) | self._av_dependencies
            if self.config.get("sun_entity"):
                entities.add(self.config["sun_entity"])
            if entities:
                self._unsub = async_track_state_change_event(
                    self.hass, entities, self._state_changed
                )
            self._schedule_fetch(1)
            self._schedule_sun()

    def _av_capabilities(self):
        from .av_controls import resolve
        return tuple((entity, tuple(binding.available(self.hass)))
                     for entity in sorted(self._av_capability_entities)
                     if (binding := resolve(self.hass, entity)) and binding.apple_tv)

    def _schedule_av_capabilities(self):
        if self._av_capability_entities and self._av_capability_timer is None:
            # Read pyatv's local capability cache only: no network polling and no
            # ESP updates unless capabilities changed. Companion can update its
            # control flags without producing a HA media/state event.
            self._av_capability_timer = async_call_later(self.hass, 1, self._av_capability_tick)

    @callback
    def _av_capability_tick(self, _):
        self._av_capability_timer = None
        if self._closed or not self.config["enabled"]:
            return
        signature = self._av_capabilities()
        if signature != self._av_capability_signature:
            self._av_capability_signature = signature
            self._state_changed(None)
        self._schedule_av_capabilities()

    def _schedule_sun(self):
        if self.config.get("sun_entity") == "sun.sun":
            self._sun_timer = async_call_later(self.hass, 30, self._sun_tick)

    @callback
    def _sun_tick(self, _):
        self._sun_timer = None
        if self._closed or not self.config["enabled"]:
            return
        self._sun_cache = None
        self.changed()
        self._schedule_sun()

    @callback
    def _state_changed(self, _):
        from .av_controls import dependencies
        if dependencies(self.hass, self.config) != getattr(self, "_av_dependencies", set()):
            self._subscribe()
        else:
            self._av_capability_signature = self._av_capabilities()
        # Coalesce high-rate sensors; do not create one task per state update.
        if self._debounce is None:
            self._debounce = async_call_later(self.hass, self.state_publish_delay, self._publish)

    @callback
    def _publish(self, _):
        self._debounce = None
        if not self._closed:
            self.changed()

    def _schedule_fetch(self, delay=600):
        self._timer = async_call_later(self.hass, delay, self._fetch_tick)

    async def _fetch_tick(self, _):
        self._timer = None
        if self._closed or not self.config["enabled"]:
            return
        if not self._fetch_task:
            self._fetch_task = asyncio.create_task(self.async_refresh_data())
            try:
                await self._fetch_task
            finally:
                self._fetch_task = None
        if not self._closed and self.config["enabled"] and self._timer is None:
            self._schedule_fetch()

    def forecast_requests(self):
        requests = {}
        for scene in active_scenes(self.config).values():
            if scene.get("background") == "weather" and scene.get("weather_precipitation_mode") == "hourly":
                entity = scene.get("weather_precipitation_entity") or scene.get("weather_entity")
                if entity:
                    requests[entity, "hourly"] = 24
            for item in scene["elements"]:
                entity = item["entity_id"]
                if not entity:
                    continue
                if item["kind"] == "calendar":
                    requests[entity, "calendar"] = 6
                elif item["kind"] == "weather" and item["forecast_type"] != "current":
                    key = entity, item["forecast_type"]
                    requests[key] = max(requests.get(key, 0), item["forecast_count"])
        return requests

    def sun(self):
        state = self.hass.states.get(self.config.get("sun_entity", "sun.sun"))
        if not state or state.state in ("unknown", "unavailable"):
            if not any(scene.get("background") == "weather" for scene in active_scenes(self.config).values()):
                return None
            state = None
        attrs = state.attributes if state else {}
        if not state or state.entity_id == "sun.sun":
            # Compute live position on HA; location never travels to the panel.
            if self._sun_cache and time.monotonic() - self._sun_cache[0] < 30:
                return dict(self._sun_cache[1])
            now = dt_util.utcnow()
            observer = Observer(
                self.hass.config.latitude,
                self.hass.config.longitude,
                self.hass.config.elevation,
            )
            try:
                e = elevation(observer, now)
                a = azimuth(observer, now)
                if not all(math.isfinite(v) for v in (e, a)):
                    raise ValueError("Invalid sun position")
                data = {
                    "elevation": round(e, 2),
                    "azimuth": round(a, 2),
                    "rising": attrs.get("rising") is True,
                    "is_daytime": e > -0.833,
                    "moon": moon_position(observer, now),
                }
                self._sun_cache = (time.monotonic(), data)
                return dict(data)
            except (ValueError, TypeError):
                pass

        def number(key):
            try:
                value = float(attrs.get(key))
                return round(value, 1) if math.isfinite(value) else None
            except (ValueError, TypeError):
                return None

        return {
            "elevation": number("elevation"),
            "azimuth": number("azimuth"),
            "rising": attrs.get("rising") is True,
            "is_daytime": state.state == "above_horizon",
        }

    def _forecast_daytime(self, value):
        try:
            date = dt_util.parse_datetime(str(value))
            if date is None:
                return None
            if date.tzinfo is None:
                date = date.replace(
                    tzinfo=dt_util.get_time_zone(self.hass.config.time_zone)
                )
            observer = Observer(
                self.hass.config.latitude,
                self.hass.config.longitude,
                self.hass.config.elevation,
            )
            return elevation(observer, date) > -0.833
        except (ValueError, TypeError):
            return None

    async def async_refresh_data(self):
        """Fetch only requested forecast types; astronomy and decoding stay on HA."""
        if not self.config["enabled"]:
            return
        requests = self.forecast_requests()
        # Document revisions also change for unrelated views and styling.
        # Only changed data bindings may invalidate an in-flight response.
        def current():
            return not self._closed and self.config["enabled"] and requests == self.forecast_requests()
        semaphore = asyncio.Semaphore(2)

        async def fetch(key, count):
            entity_id, kind = key
            async with semaphore:
                try:
                    async with asyncio.timeout(8):
                        if kind == "calendar":
                            start = dt_util.now()
                            result = await self.hass.services.async_call(
                                "calendar",
                                "get_events",
                                {
                                    "entity_id": entity_id,
                                    "start_date_time": start.isoformat(),
                                    "end_date_time": (
                                        start + timedelta(days=7)
                                    ).isoformat(),
                                },
                                blocking=True,
                                return_response=True,
                            )
                            items = [
                                {
                                    k: str(event.get(k, ""))[:200]
                                    for k in ("summary", "start", "end", "location")
                                }
                                for event in result.get(entity_id, {}).get(
                                    "events", []
                                )[:count]
                            ]
                        else:
                            result = await self.hass.services.async_call(
                                "weather",
                                "get_forecasts",
                                {"entity_id": entity_id, "type": kind},
                                blocking=True,
                                return_response=True,
                            )
                            items = []
                            for row in result.get(entity_id, {}).get("forecast", [])[
                                :count
                            ]:
                                item = {
                                    k: str(row.get(k, ""))[:60]
                                    for k in (
                                        "datetime",
                                        "condition",
                                        "temperature",
                                        "templow",
                                        "precipitation_probability",
                                        "precipitation",
                                        "wind_speed",
                                    )
                                }
                                if kind == "hourly":
                                    item["is_daytime"] = (
                                        row.get("is_daytime")
                                        if type(row.get("is_daytime")) is bool
                                        else self._forecast_daytime(row.get("datetime"))
                                    )
                                items.append(item)
                    if current():
                        self._cache[key] = {"items": items, "updated": time.time()}
                except Exception:
                    if current():
                        if key in self._cache:
                            self._cache[key]["stale"] = True
                        else:
                            self._cache[key] = {
                                "items": [],
                                "updated": time.time(),
                                "unavailable": True,
                            }

        await asyncio.gather(*(fetch(key, count) for key, count in requests.items()))
        if current():
            self.changed()

    def media_entities(self):
        return media_background_entities(self.config) | {
            item["entity_id"]
            for scene in active_scenes(self.config).values()
            for item in scene["elements"]
            if item["kind"] == "media"
            and item.get("show_cover", True)
            and item["entity_id"]
        }

    def _media_target(self, entity_id):
        from .av_controls import artwork_target
        return artwork_target(self.hass, entity_id)

    def preview_media_value(self, entity_id):
        """Read-only metadata for an admin's not-yet-saved media selection."""
        from .av_controls import resolve, display_state
        if not isinstance(entity_id, str) or not entity_id.startswith("media_player."):
            return None
        binding = resolve(self.hass, entity_id)
        routed = bool(binding and binding.sonos and binding.apple_tv)
        state = display_state(self.hass, entity_id) if routed else self.hass.states.get(entity_id)
        if not state:
            return None
        data = {"state": state.state, "name": state.attributes.get("friendly_name", entity_id), **card_metadata(state)}
        if routed:
            data.update({k: state.attributes.get(k) for k in ("av_source", "av_dependencies", "av_available_actions", "av_sources", "av_selected_source", "av_power", "av_remote_state")})
            data["av_routed"] = True
        data["artwork"] = self.media.ready_key(self._media_target(entity_id))
        data["artwork_ratio"] = self.media.aspect_ratio(self._media_target(entity_id))
        return data

    def values(self, config=None):
        selected = config or self.config
        cards = {
            item["entity_id"]
            for scene in active_scenes(selected).values()
            for item in scene["elements"]
            if item["kind"] in ("media", "status", "entity", "switch", "button")
        }
        from .av_controls import routed_entities, display_state
        av_entities = routed_entities(self.hass, selected)
        media_entities = self.media_entities()
        values = {}
        for entity_id in layout_entities(selected):
            state = display_state(self.hass, entity_id) if entity_id in av_entities else self.hass.states.get(entity_id)
            if not state:
                values[entity_id] = {
                    "state": "unavailable",
                    "name": entity_id,
                    "unit": "",
                }
                continue
            attrs = state.attributes
            value = {
                "state": state.state[:200],
                "name": str(attrs.get("friendly_name", entity_id))[:100],
                "unit": str(attrs.get("unit_of_measurement", ""))[:30],
            }
            if entity_id in av_entities:
                value.update(av_remote_state=attrs.get("av_remote_state", "unavailable"), av_sources=attrs.get("av_sources", []), av_selected_source=attrs.get("av_selected_source", ""), av_power=attrs.get("av_power"), av_routed=True, av_source=attrs.get("av_source"), av_available_actions=attrs.get("av_available_actions", []), av_dependencies=attrs.get("av_dependencies", []))
            if entity_id in cards:
                metadata = card_metadata(state)
                if entity_id in av_entities:
                    metadata.pop("av_sources", None)
                    metadata.pop("av_selected_source", None)
                value.update(metadata)
            if entity_id in media_entities:
                value["artwork"] = self.media.ready_key(self._media_target(entity_id))
                value["artwork_ratio"] = self.media.aspect_ratio(self._media_target(entity_id))
            if entity_id.startswith("weather."):
                for key in (
                    "temperature",
                    "temperature_unit",
                    "humidity",
                    "wind_speed",
                    "wind_speed_unit",
                    "wind_bearing",
                    "cloud_coverage",
                    "precipitation_unit",
                    "uv_index",
                ):
                    value[key] = str(attrs.get(key, ""))[:60]
            if entity_id.startswith("calendar."):
                value["events"] = (
                    [
                        {
                            "summary": str(attrs.get("message", ""))[:200],
                            "start": self._calendar_date(attrs.get("start_time", "")),
                            "end": self._calendar_date(attrs.get("end_time", "")),
                        }
                    ]
                    if attrs.get("message")
                    else []
                )
            for kind in ("calendar", "daily", "hourly"):
                cached = self._cache.get((entity_id, kind))
                if not cached or time.time() - cached["updated"] >= 3600:
                    continue
                if cached.get("stale"):
                    value["stale"] = True
                if cached.get("unavailable"):
                    value.setdefault("forecast_unavailable", []).append(kind)
                    continue
                if kind == "calendar":
                    value["events"] = cached["items"]
                else:
                    value.setdefault("forecasts", {})[kind] = cached["items"]
                    if kind == "daily":
                        value["forecast"] = cached["items"]
            values[entity_id] = value
        return values

    def _calendar_date(self, value):
        value = str(value)[:60]
        if len(value) == 10:
            return value  # All-day events are dates, not UTC instants.
        try:
            parsed = dt_util.parse_datetime(value)
        except ValueError:
            return value
        if parsed and parsed.tzinfo is None:
            parsed = parsed.replace(
                tzinfo=dt_util.get_time_zone(self.hass.config.time_zone)
            )
        return parsed.isoformat() if parsed else value

    def payload(self, view_ids=None):
        if not self.config["enabled"]:
            return None
        if view_ids is None:
            document = self.document()
            document["config"]["scenes"] = active_scenes(document["config"])
        else:
            # Browser clients render only their current view and active message.
            # Never serialize the editor library or unrelated entities per tick.
            config = {key: deepcopy(value) for key, value in self.config.items()
                      if key not in {"scenes", "views", "themes"}}
            config["scenes"] = {key: deepcopy(value) for key, value in active_scenes(self.config).items()
                                if key in view_ids}
            document = {"config": config, "revision": self.revision}
        return {
            **document,
            "values": self.values(document["config"]),
            "sun": self.sun(),
            "timezone": str(self.hass.config.time_zone),
            "now": dt_util.utcnow().isoformat(),
        }

    async def async_resource(self, resource, query, headers):
        from aiohttp import web
        if resource in ("camera.json", "camera.jpg"):
            from .layout_config import active_scenes

            scene = active_scenes(self.config).get(
                query.get("view"), {}
            )
            item = next(
                (
                    item
                    for item in scene.get("elements", [])
                    if item["id"] == query.get("id")
                    and item["kind"] == "camera"
                ),
                None,
            )
            if (
                not self.config["enabled"]
                or not item
                or item["camera_source"] not in {"entity", "test", "multicast"}
            ):
                raise web.HTTPNotFound()
            if resource == "camera.json":
                url = None
                # Fullscreen always requests a stream, even for a still tile.
                url = await self.cameras.async_item(item, "stream")
                return web.json_response({"stream": url}, headers=headers)
            data = await self.cameras.async_item(item, "image")
            return web.Response(
                body=data,
                status=200 if data else 204,
                content_type="image/jpeg",
                headers=headers,
            )
        if resource == "cover.jpg":
            entity = query.get("entity", "")
            if (
                not self.config["enabled"]
                or entity not in self.media_entities()
            ):
                raise web.HTTPNotFound()
            from .layout_media import artwork_size

            try:
                size = artwork_size(query.get("size", "640"))
            except ValueError as err:
                raise web.HTTPBadRequest(text=str(err)) from None
            data = await self.media.async_image(
                self._media_target(entity), query.get("v"), size
            )
            return web.Response(
                body=data,
                status=200 if data else 204,
                content_type="image/jpeg",
                headers=headers,
            )
        if resource == "background.jpg":
            from .layout_config import active_scenes

            identifier = query.get("id", "")
            if not any(
                scene.get("image_id") == identifier and identifier
                for scene in active_scenes(self.config).values()
            ):
                raise web.HTTPNotFound()
            try:
                data = await self.backgrounds.async_read(identifier)
            except (ValueError, FileNotFoundError):
                raise web.HTTPNotFound() from None
            return web.Response(
                body=data,
                content_type="image/jpeg",
                headers={**headers, "Cache-Control": "private, max-age=86400"},
            )
        raise web.HTTPNotFound()
