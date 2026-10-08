"""Admin editor owned entirely by Display Studio."""

from pathlib import Path
from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from .const import VERSION


async def async_register_frontend(hass):
    root = Path(__file__).parent / "www"
    files = {
        "studio.js": "studio.js",
        "studio.css": "studio.css",
        "layout-runtime.js": "runtime/layout.js",
        "layout.css": "runtime/layout.css",
        "weather.js": "runtime/weather.js",
        "cards.js": "runtime/cards.js",
        "grain.png": "runtime/grain.png",
    }
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig("/display_studio/" + url, str(root / file), False)
            for url, file in files.items()
        ]
    )
    config = {
        "_panel_custom": {
            "name": "display-studio",
            "module_url": f"/display_studio/studio.js?v={VERSION}",
            "embed_iframe": False,
            "trust_external": False,
        }
    }
    for path, title in (
        ("display-studio", "Display Studio"),
        ("lg-display-studio", None),
    ):
        async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title=title,
            sidebar_icon="mdi:view-dashboard-edit",
            frontend_url_path=path,
            config=config,
            require_admin=True,
        )
