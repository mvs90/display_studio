"""Provider-independent automation actions with per-entry authorization."""

import voluptuous as vol
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.auth.permissions.const import POLICY_CONTROL
from homeassistant.helpers import entity_registry as er, config_validation as cv
from .const import DOMAIN


@callback
def async_register_services(hass):
    async def handle(call):
        registry = er.async_get(hass)
        targets = set()
        if entry_id := call.data.get("config_entry_id"):
            targets.add(entry_id)
        for entity_id in call.data.get("entity_id", []):
            record = registry.async_get(entity_id)
            if not record or record.platform != DOMAIN:
                raise HomeAssistantError("Select a Display Studio entity")
            targets.add(record.config_entry_id)
        if not targets:
            raise HomeAssistantError("Select a Studio config entry or entity")
        user = (
            await hass.auth.async_get_user(call.context.user_id)
            if call.context.user_id
            else None
        )
        if call.context.user_id and not user:
            raise Unauthorized()
        # Validate all targets before changing any display.
        for entry_id in targets:
            if entry_id not in hass.data.get(DOMAIN, {}):
                raise HomeAssistantError("Display Studio entry is not loaded")
            entities = er.async_entries_for_config_entry(registry, entry_id)
            if (
                user
                and not user.is_admin
                and not any(
                    user.permissions.check_entity(e.entity_id, POLICY_CONTROL)
                    for e in entities
                )
            ):
                raise Unauthorized()
        values = {
            k: v
            for k, v in call.data.items()
            if k not in {"entity_id", "config_entry_id"}
        }
        for entry_id in targets:
            provider = hass.data[DOMAIN][entry_id]["provider"]
            if call.service == "show_view":
                await provider.async_show_view(**values)
            else:
                await provider.async_notify(**values)

    targets = {
        vol.Optional("config_entry_id"): cv.string,
        vol.Optional("entity_id"): cv.entity_ids,
    }
    hass.services.async_register(
        DOMAIN,
        "show_view",
        handle,
        schema=vol.Schema(
            {
                **targets,
                vol.Required("view"): cv.string,
                vol.Optional("transition", default="none"): vol.In(["none", "smooth"]),
                vol.Optional("duration", default=0): vol.All(
                    vol.Coerce(int), vol.Range(min=0, max=3600)
                ),
                vol.Optional("theme"): cv.string,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "show_notification",
        handle,
        schema=vol.Schema(
            {
                **targets,
                vol.Optional("title", default="Home Assistant"): vol.All(
                    cv.string, vol.Length(max=200)
                ),
                vol.Required("message"): vol.All(cv.string, vol.Length(max=2000)),
                vol.Optional("layout", default="overlay"): vol.In(
                    ["overlay", "pip", "fullscreen"]
                ),
                vol.Optional("duration", default=10): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=3600)
                ),
            }
        ),
    )
