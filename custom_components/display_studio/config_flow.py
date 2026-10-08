"""Independent setup for browser displays and optional hardware adapters."""

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector
from .const import DOMAIN


class StudioConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input:
            self._name = user_input["name"].strip() or "Display Studio"
            if user_input["provider"] == "lg":
                return await self.async_step_lg()
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
            try:
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
        return self.async_show_form(
            step_id="lg",
            data_schema=vol.Schema({vol.Required("lg_entry_id"): vol.In(entries)}),
            errors=errors,
        )
