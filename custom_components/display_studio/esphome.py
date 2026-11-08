"""ESPHome frames use the exact same runtime and layout model as other outputs."""

from pathlib import Path
from homeassistant.core import callback
from homeassistant.exceptions import ConfigEntryNotReady
from .providers import BrowserProvider
from .fonts import font_assets


def runtime_assets():
    root = Path(__file__).parent / "www/runtime"
    return {**{name: (root / name).read_bytes() for name in (
        "index.html", "browser.js", "layout.js", "layout.css", "weather.js",
        "cards.js", "camera.js", "grain.png",
    )}, **font_assets()}


class ESPHomeProvider(BrowserProvider):
    kind = "esphome"

    def __init__(self, hass, entry, layouts):
        super().__init__(hass, entry, layouts)
        self.api = self._get_api()
        self.assets = None
        self.unsubscribe = None
        self._startup_cache = None
        self._navigation_cache = None

    def _get_api(self):
        try:
            from custom_components.esphome_display.api import get_display_api
        except ImportError as err:
            raise ConfigEntryNotReady("Install ESPHome Display 0.2.0 or newer") from err
        return get_display_api(self.hass, self.entry.data["esphome_entry_id"], version=2)

    @property
    def status(self):
        return self.api.status

    async def async_set_rotation(self, rotation):
        return await self.api.async_set_rotation(rotation)

    def state(self):
        state = super().state()
        # A JPEG output requests snapshots through the same camera renderer.
        # Keep the saved view intact when switching between LG, browser and ESP.
        if self.api.legacy:
            state["camera_snapshots"] = True
        return state

    @callback
    def changed(self):
        super().changed()
        self.api.invalidate(self.entry.entry_id)

    async def async_start(self):
        await super().async_start()
        self.layouts.state_publish_delay = .025
        self.assets = await self.hass.async_add_executor_job(runtime_assets) if self.api.legacy else {}
        await self.async_bind()
        self.unsubscribe = self.hass.bus.async_listen("esphome_display_status", self._updated)

    async def async_bind(self):
        if not self.closed:
            self.api = self._get_api()
            if not self.api.legacy:
                await self.api.async_bind_native(self.entry.entry_id, self.compile_scene, self.async_touch, self.layouts.async_resource)
                self.bind_view_control()
                return
            await self.api.async_bind_studio(
                self.entry.entry_id, self.state, self.layouts.async_resource, self.assets
            )
            self.bind_view_control()

    def bind_view_control(self):
        # Optional extension: older bridge versions retain their existing output.
        if callable(bind := getattr(self.api, "bind_view_control", None)):
            bind(self.entry.entry_id, self.view_control_context, self.async_show_view)
        if callable(bind := getattr(self.api, "bind_power_control", None)):
            bind(self.entry.entry_id, self.power_policy, self.validate_device_power)
        if callable(bind := getattr(self.api, "bind_power_wake", None)):
            bind(self.entry.entry_id, self.wake_view)

    @callback
    def wake_view(self):
        """Choose the saved wake target before the first device response."""
        from .display_power import screensaver_sources
        power = self.power_policy()
        base = getattr(self.layouts, 'base', self.layouts)
        view = power.get('wake_view')
        if power.get('wake_mode') != 'view' or view not in screensaver_sources(base.source_views):
            return
        self.selected_view = view
        self.message = self._return = None
        self.changed()

    @staticmethod
    def validate_device_power(raw):
        from .display_power import validate_power
        import re
        if not isinstance(raw, dict):
            raise ValueError('Invalid device power settings')
        views = {'dashboard': {}}
        for key in ('screensaver_view', 'wake_view'):
            view = raw.get(key, 'dashboard')
            if not isinstance(view, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', view):
                raise ValueError('Invalid ' + key + ' ID')
            views[view] = {}
        # Keep a device choice through temporarily unavailable/deleted designs.
        # Compilation falls back to dashboard without changing its saved value.
        return validate_power(raw, views)

    def power_policy(self):
        device_power = getattr(self.api, 'device_power', None)
        if device_power is not None:
            return dict(device_power)
        from .display_power import DEFAULT_POWER
        base = getattr(self.layouts, 'base', self.layouts)
        return {**DEFAULT_POWER, **base.config.get('power', {})}

    def view_control_context(self):
        from .display_power import screensaver_sources
        base = getattr(self.layouts, 'base', self.layouts)
        return {"view": self.selected_view, "notification": bool(self.message) or bool(getattr(self.layouts, "owner", None)),
                "views": self.layouts.source_views,
                "screensaver_views": screensaver_sources(base.source_views),
                "navigation": self.navigation_context()}

    def navigation_context(self):
        from .lvgl import digest
        base = getattr(self.layouts, 'base', self.layouts)
        cached = self._navigation_cache
        # Saves publish a new config/revision. Entity, camera and power updates
        # cannot change navigation; hashing all saved views for every status
        # read blocks the same HA loop that supplies the live pictures.
        if cached and cached[0] is base.config and cached[1] == base.revision:
            return cached[2]
        scenes = base.config['scenes']
        from .media_widget import expand
        edges = {name: sorted({item[gesture]['view'] for item in expand(scene).get('elements', [])
                 for gesture in ('tap_action', 'hold_action')
                 if item.get(gesture, {}).get('action') == 'show_view'
                 and item[gesture].get('view') in scenes}) for name, scene in scenes.items()}
        result = {'version': digest(base.config), 'edges': edges}
        self._navigation_cache = (base.config, base.revision, result)
        return result

    @callback
    def _updated(self, event):
        if event.data.get("entry_id") != self.entry.data["esphome_entry_id"] or self.closed:
            return
        self.hass.bus.async_fire("display_studio_status", {"entry_id": self.entry.entry_id})
        current = self.hass.data.get("esphome_display", {}).get(self.entry.data["esphome_entry_id"])
        if current is not None and current is not self.api:
            self.hass.async_create_task(self.async_bind())

    async def async_close(self):
        if self.unsubscribe:
            self.unsubscribe()
            self.unsubscribe = None
        await super().async_close()
        await self.api.async_unbind_studio(self.entry.entry_id)


    def compile_scene(self, width, height):
        from .lvgl import compile_scene
        state = self.state()
        power = self.power_policy()
        standby = bool(getattr(self.api, 'power_standby', False))
        if standby:
            # Temporary output selection: never overwrite the user's selected
            # view, notification lifetime or personalized view on the host.
            state['message'] = None
            if power['mode'] == 'screensaver':
                state['view'] = power['screensaver_view']
                # The saver is a saved source, never a stale live-editor draft.
                base = getattr(self.layouts, 'base', self.layouts)
                state['layout'] = base.payload()
                if state['view'] not in base.config['scenes']:
                    state['view'] = 'dashboard'
        result,actions,assets=compile_scene(state, width, height)
        result['power'] = power
        result['power_standby'] = standby
        # Prepare the chosen public wake view without changing active selection.
        # Self-contained native widgets/paints need no network on the wake path.
        target = power.get('wake_view')
        if power.get('wake_mode') == 'view' and target != state['view']:
            from .display_power import screensaver_sources
            base = getattr(self.layouts, 'base', self.layouts)
            if target in screensaver_sources(base.source_views):
                try:
                    prepared, _, wake_assets = compile_scene({**state, 'view': target,
                        'message': None, 'layout': base.payload()}, width, height)
                except ValueError:
                    pass  # Optional cache must never prevent the active view.
                else:
                    if not wake_assets:
                        result['power_resume'] = prepared
        if standby:
            actions = {}  # First touch wakes; it must not operate a hidden control.
        base=getattr(self.layouts,'base',self.layouts)
        version=base.startup_design.version
        cache_key=(version,width,height)
        if not self._startup_cache or self._startup_cache[0]!=cache_key:
            from .esphome_layout import validate_native_startup
            validate_native_startup(base.config)
            from .startup_layout import default_scene
            bundle={'version':version}
            for phase,key in [('startup','scene'),('connecting','connecting'),('updating','updating')]:
                if phase in base.config['scenes']:
                    startup,_,_=compile_scene({'view':phase,'layout':{'config':base.config,'timezone':str(self.hass.config.time_zone),'now':'2000-01-01T00:00:00+00:00'}},width,height)
                else:startup=default_scene(width,height,phase)
                # No stale wall clock before the first time synchronization.
                for widget in startup['widgets']:
                    if widget['type']=='clock':
                        for part in widget.get('parts',[]):
                            if part['id'] in {'time','date'}:part['text']='–'
                startup.pop('epoch',None)
                startup.pop('utc_offset',None)
                bundle[key]=startup
            self._startup_cache=(cache_key,bundle)
        result['startup']=self._startup_cache[1]
        # Bounded prefetch of linked views. Security policy is enforced by the
        # bridge before any of this public navigation data reaches the device.
        if not standby and not self.message and not getattr(self.layouts, 'owner', None):
            navigation=self.navigation_context()
            pending=list(navigation['edges'].get(result['view'], []))
            visited={result['view']}; targets=[]
            while pending and len(visited)<33:
                target=pending.pop(0)
                if target in visited:continue
                visited.add(target)
                prepared, _, target_assets=compile_scene({**state,'view':target,'message':None},width,height)
                targets.append(prepared);assets.update(target_assets)
                pending.extend(navigation['edges'].get(target, []))
            result['navigation']={'version':navigation['version'],'views':targets}
        return result,actions,assets

    def validate_view(self, view):
        if self.api.legacy:
            return super().validate_view(view)
        from .layout_config import active_scenes
        config = self.layouts.config
        # Source-list reads validate every saved view several times per status
        # update. This only needs geometry metadata, not a deep-copied runtime
        # payload with all entity values, forecasts and image recipes.
        if not config["enabled"] or view=="hdmi_full" or view not in active_scenes(config) or (view in {"dashboard", "pip_view", "media_view"} and view not in self.layouts.source_views):
            from homeassistant.exceptions import HomeAssistantError
            raise HomeAssistantError("Unknown Studio view")

    async def async_notify(self, title="Home Assistant", message="", layout="overlay", duration=10):
        if self.api.legacy or layout != "pip":
            return await super().async_notify(title, message, layout, duration)
        import time
        self.message = {"title": title, "message": message, "layout": layout, "expires": time.monotonic() + duration}
        self.changed()
