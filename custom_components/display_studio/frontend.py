"""Admin editor owned entirely by Display Studio."""

from hashlib import sha256
from pathlib import Path
from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from .const import VERSION
from .fonts import FONT_FILES


ASSET_FILES = {
    **{name:"../fonts/"+name for name in FONT_FILES},
    "Roboto.ttf": "../fonts/Roboto.ttf",
    "Roboto-Semibold.ttf": "../fonts/Roboto-Semibold.ttf",
    "studio.js": "studio.js",
    "devices.js": "devices.js",
    "design_library.js": "design_library.js",
    "element_picker.js": "element_picker.js",
    "picker_controls.js": "picker_controls.js",
    "native_controls.js": "native_controls.js",
    **{"device-images/" + name: "device-images/" + name for name in (
        "guition-7.webp", "guition-4.webp", "guition-43.webp", "waveshare-4.jpg",
        "lg.jpg", "browser.jpg", "generic.svg", "sources.html", "sources.json",
    )},
    **{"symbols/"+name:"symbols/"+name for name in ["index.json","LICENSE",*[f"{n:02x}.json" for n in range(256)]]},
    "photo_upload.js": "photo_upload.js",
    "camera_preview.js": "camera_preview.js",
    "camera_direct.js": "camera_direct.js",
    "vendor/hls-1.7.3.light.min.mjs": "vendor/hls-1.7.3.light.min.mjs",
    "vendor/hls-LICENSE": "vendor/hls-LICENSE",
    "vendor/hls-APACHE-2.0.txt": "vendor/hls-APACHE-2.0.txt",
    "studio.css": "studio.css",
    "layout-runtime.js": "runtime/layout.js",
    "camera-runtime.js": "runtime/camera.js",
    "layout.css": "runtime/layout.css",
    "weather.js": "runtime/weather.js",
    "cards.js": "runtime/cards.js",
    "grain.png": "runtime/grain.png",
    "runtime/test-stream.m3u8": "runtime/test-stream.m3u8",
    "runtime/test-stream.ts": "runtime/test-stream.ts",
}


def asset_version(root: Path) -> str:
    """Keep the editor and every imported module on one immutable bundle URL.

    ES modules stay cached for the document lifetime, regardless of HTTP cache
    headers. Changing only the panel URL leaves old runtime modules in memory.
    """
    digest = sha256()
    for url, file in sorted(ASSET_FILES.items()):
        digest.update(url.encode() + b"\0")
        digest.update(sha256((root / file).read_bytes()).digest())
    return f"{VERSION}-{digest.hexdigest()[:16]}"


async def async_register_frontend(hass):
    root = Path(__file__).parent / "www"
    version = await hass.async_add_executor_job(asset_version, root)
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig("/display_studio/" + url, str(root / file), False)
            for url, file in ASSET_FILES.items()
        ]
    )
    config = {
        "_panel_custom": {
            "name": "display-studio",
            "module_url": f"/display_studio/studio.js?v={version}",
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
