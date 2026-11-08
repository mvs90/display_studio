"""Independent setup for browser displays and optional hardware adapters."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from .const import DOMAIN
from .devices import binding_lock


class StudioConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input:
            self._name = user_input["name"].strip() or "Display Studio"
            if user_input["provider"] == "lg":
                return await self.async_step_lg()
            if user_input["provider"] == "esphome":
                return await self.async_step_esphome()
            return self.async_create_entry(
                title=self._name, data={"provider": "browser"}
            )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("name", default="Display Studio"): str,
                    vol.Required(
                        "provider", default="browser"
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                {
                                    "value": "esphome",
                                    "label": "ESPHome Display",
                                },
                                {
                                    "value": "browser",
                                    "label": "Browser / Kiosk / anderes Display",
                                },
                                {
                                    "value": "lg",
                                    "label": "LG Professional Display (ab 2.32.0)",
                                },
                            ]
                        )
                    ),
                }
            ),
        )

    async def async_step_lg(self, user_input=None):
        entries = {
            e.entry_id: e.title
            for e in self.hass.config_entries.async_entries("lg_rs232_ip")
        }
        if not entries:
            return self.async_abort(reason="no_lg_display")
        errors = {}
        if user_input:
            target = user_input["lg_entry_id"]
            await self.async_set_unique_id("lg_" + target)
            self._abort_if_unique_id_configured()
            async with binding_lock(self.hass):
                try:
                    from .devices import validate_target
                    validate_target(self.hass, "lg", target)
                    from custom_components.lg_rs232_ip.api import get_display_api

                    api = get_display_api(self.hass, target)
                    if getattr(api, "studio_api_version", 0) < 1:
                        errors["base"] = "lg_update_required"
                    elif not api.ready:
                        errors["base"] = "lg_not_ready"
                    elif target in entries:
                        return self.async_create_entry(
                            title=self._name, data={"provider": "lg", "lg_entry_id": target}
                        )
                except ImportError:
                    errors["base"] = "lg_update_required"
                except (ConfigEntryNotReady, HomeAssistantError):
                    errors["base"] = "lg_not_ready"
                except ValueError as err:
                    errors["base"] = str(err)
        return self.async_show_form(
            step_id="lg",
            data_schema=vol.Schema({vol.Required("lg_entry_id"): vol.In(entries)}),
            errors=errors,
        )

    async def async_step_esphome(self, user_input=None):
        entries = {e.entry_id: e.title for e in self.hass.config_entries.async_entries("esphome_display")}
        if not entries:
            return self.async_abort(reason="no_esphome_display")
        errors = {}
        if user_input and user_input.get("esphome_entry_id") in entries:
            target = user_input["esphome_entry_id"]
            await self.async_set_unique_id("esphome_" + target)
            self._abort_if_unique_id_configured()
            async with binding_lock(self.hass):
                try:
                    from .devices import validate_target
                    validate_target(self.hass, "esphome", target)
                    from custom_components.esphome_display.api import get_display_api
                    get_display_api(self.hass, target, version=2)
                except (ImportError, ConfigEntryNotReady, HomeAssistantError):
                    errors["base"] = "esphome_not_ready"
                except ValueError as err:
                    errors["base"] = str(err)
                else:
                    return self.async_create_entry(title=self._name, data={
                        "provider": "esphome", "esphome_entry_id": target,
                    })
        return self.async_show_form(step_id="esphome", data_schema=vol.Schema({
            vol.Required("esphome_entry_id"): vol.In(entries),
        }), errors=errors)
