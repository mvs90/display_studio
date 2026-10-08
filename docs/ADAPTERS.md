# Output adapter contract

Studio owns `DisplayLayouts`, its versioned Store, background images, selected HA data caches, editor/admin endpoints and generic browser assets. Each config entry owns exactly one layout library and one output adapter. Layout subscriptions and caches are closed by Studio, not by the hardware integration.

`providers.py` defines the initial adapters with this common interface:

- `kind`, `status` (connection and explicit `hdmi`, `pip`, `overlay`, `startup`, `screenshot` capabilities), `selected_view`.
- `async_start()`, `async_show_view(view, transition, duration, theme)`, `async_notify(title, message, layout, duration)`, `async_close()`.
- Browser transport uses a scoped token, bounded 25-second long polling and immediate wake-up for selected entity/layout/view changes. One display-renderer clock ticks locally once per second. Camera/cover work is cached and tied to visible widgets. Unsupported hardware views fail explicitly.

The LG adapter imports only `custom_components.lg_rs232_ip.api.get_display_api(..., version=1)`. It requires `studio_api_version >= 1`, added in LG 2.32.0. That extension exposes:

- `studio_status` for capability/connection/cache confirmation.
- `async_bind_studio(owner, layouts, assets, version)` and `async_unbind_studio(owner)` with owner checks.
- `async_show_studio_view(...)`; native notification transport uses the existing `async_present("show_display_app", ...)` API.

LG serves bound generic assets through its existing paired app URL and reports `studio_version`; the native app reloads once when the renderer is attached, upgraded or detached. The editor and storage are never imported by LG. Without Studio, hardware entities, remote, native presentation, basic app notifications and resident HDMI remain available. Studio sources disappear until the extension is connected again. Existing AV API version 1 remains unchanged.

The adapter listens to LG's public `lg_rs232_ip_status` event and rebinds after LG reload. Rebinding is serialized and idempotent; a different Studio owner is rejected. Studio unload releases only its binding, not SI installation or hardware settings. LG unload leaves the independent layout store alive. The legacy-import module is the sole compatibility reader of old LG layout storage; it never edits or deletes it.

A new native display adapter should implement this provider contract and add a config-flow choice. Hardware drivers should expose a versioned API comparable to LG's, without importing Studio internals or assuming other hardware's capabilities. Keep power, native source selection and recovery inside the device integration. A browser-capable display can already use the generic provider without writing an adapter; native boot, capture or HDMI PiP are not inferred from browser support.

Optional LG load ordering uses Home Assistant's [after_dependencies](https://developers.home-assistant.io/docs/creating_integration_manifest/#after-dependencies); LG is not a required dependency. The Studio browser test suite runs without the LG package in its import path. LG's separate suite tests the combined native app/renderer contract.
