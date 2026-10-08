# Verification

The extracted suites retain layout validation, authorization, bounded images/camera/artwork caches, weather/calendar/solar updates, view libraries, themes, startup design and widget sub-elements. New tests cover independent browser use, lifecycle failure cleanup, one-time non-destructive imports, per-display token isolation/revocation, latest-message replacement, timed view return, unsupported HDMI/PiP rejection and independent sidebar assets.

- Python: HA 2025.3.4 / Python 3.13 and HA 2026.9.4 / Python 3.14.
- Browser: Chromium and WebKit; retained editor cases plus standalone renderer, offline recovery and capability-specific controls.
- The LG repository additionally tests the public owner/bind/reload/unbind contract and its full native-app/remote regression suite with Studio as a test dependency only.
- Hardware verification uses the existing HA 2026.9.4 Docker installation and LG UH5F. Existing nine-view library and revision 124 were copied exactly; AV Companion and Apple TV remain loaded. Tests compare source selection with the app's reported rendered scene.

Run `python -m pytest -q` and `ruff check custom_components tests`. For browser tests: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm test`. CI also runs HACS validation and Hassfest. No live credentials or local HA configuration are required for CI.
