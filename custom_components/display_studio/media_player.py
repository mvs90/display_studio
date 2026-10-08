"""Saved Studio views as sources, without claiming hardware volume or power."""

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from .const import DOMAIN, VERSION


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([StudioPlayer(hass.data[DOMAIN][entry.entry_id], entry)])


class StudioPlayer(MediaPlayerEntity):
    _attr_has_entity_name = True
    _attr_name = "Views"
    _attr_should_poll = False
    _attr_supported_features = MediaPlayerEntityFeature.SELECT_SOURCE

    def __init__(self, data, entry):
        self.data, self.entry = data, entry
        self._attr_unique_id = entry.entry_id + "_views"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Display Studio",
            model="LG adapter" if data["provider"].kind == "lg" else "Browser display",
            sw_version=VERSION,
            configuration_url="homeassistant://config/integrations/integration/display_studio",
        )

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.hass.bus.async_listen("display_studio_status", self._updated)
        )

    @callback
    def _updated(self, event):
        if event.data.get("entry_id") == self.entry.entry_id:
            self.async_write_ha_state()

    @property
    def state(self):
        return MediaPlayerState.IDLE

    @property
    def sources(self):
        provider = self.data["provider"]
        sources = dict(self.data["layouts"].source_views)
        if provider.status["capabilities"]["hdmi"]:
            sources = {"hdmi_full": "Nur HDMI", **sources}
        else:
            sources.pop("pip_view", None)
            for key in list(sources):
                try:
                    provider.validate_view(key)
                except HomeAssistantError:
                    sources.pop(key)
        # Avoid ambiguous names while preserving stable IDs for automations.
        result, used = {}, set()
        for key, name in sources.items():
            candidate = name
            if candidate in used:
                candidate = f"{name} ({key})"
            used.add(candidate)
            result[key] = candidate
        return result

    @property
    def source_list(self):
        return list(self.sources.values())

    @property
    def source(self):
        return self.sources.get(self.data["provider"].selected_view)

    @property
    def extra_state_attributes(self):
        status = self.data["provider"].status
        return {
            "view_sources": self.sources,
            "display_connected": status["connected"],
            "display_provider": self.data["provider"].kind,
            "capabilities": status["capabilities"],
        }

    async def async_select_source(self, source):
        from homeassistant.exceptions import HomeAssistantError

        view = next((key for key, name in self.sources.items() if name == source), None)
        if not view:
            raise HomeAssistantError("Unknown Studio source")
        await self.data["provider"].async_show_view(view)
        self.async_write_ha_state()
