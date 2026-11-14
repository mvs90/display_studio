# Shared Home tile artwork

`www/runtime/cards.js` contains the canonical `HOME_SPEC` used by browser clients.
After changing it, run `python scripts/generate_home_spec.py` and commit the generated
`custom_components/display_studio/home_spec.py` alongside the browser change.
`python scripts/generate_home_spec.py --check` and `tests/test_home_spec.py` check freshness.

Native rendering imports the generated Python data instead of opening and parsing
JavaScript at runtime. This avoids blocking Home Assistant's event loop when a layout
request first imports Home theme rendering, especially on slow storage. No layouts,
bindings, images, access tokens or entity actions are migrated by this change.
