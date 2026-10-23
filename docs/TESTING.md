# Verification

The extracted suites retain layout validation, authorization, bounded images/camera/artwork caches, weather/calendar/solar updates, view libraries, themes, startup design and widget sub-elements. New tests cover independent browser use, lifecycle failure cleanup, one-time non-destructive imports, per-display token isolation/revocation, latest-message replacement, timed view return, unsupported HDMI/PiP rejection and independent sidebar assets.

- Python: HA 2025.3.4 / Python 3.13 and HA 2026.9.4 / Python 3.14.
- Browser: Chromium and WebKit; retained editor cases plus standalone renderer, offline recovery and capability-specific controls.
- The LG repository additionally tests the public owner/bind/reload/unbind contract and its full native-app/remote regression suite with Studio as a test dependency only.
- Hardware verification uses the existing HA 2026.9.4 Docker installation and LG UH5F. Existing nine-view library and revision 124 were copied exactly; AV Companion and Apple TV remain loaded. Tests compare source selection with the app's reported rendered scene.

Run `python -m pytest -q` and `ruff check custom_components tests`. For browser tests: `npm ci`, `npx playwright install --with-deps chromium webkit`, `npm test`. CI also runs HACS validation and Hassfest. No live credentials or local HA configuration are required for CI.

## 1.2.2 audit — 2026-10-22

163 Python tests pass on HA 2025.3.4/Python 3.13 and HA 2026.9.4/Python 3.14. Measured Studio statement/branch coverage is 84% on the latter; LG-provider integration is additionally exercised by the LG suite. 128 browser tests pass across Chromium and WebKit, covering editor/mobile workflows, themes/backgrounds, media/camera widgets, live drafts, notifications, offline recovery and browser lifecycle. New regressions reproduce and fix missing reconnection after persisted pagehide/pageshow and retained private widgets after token revocation. Removed scenes also clear the previous frame.

The coordinated verification includes 840 LG tests and 309 AV tests on each supported HA version, plus 314 LG browser tests. No new physical panel, power-cycle, HomeKit, Apple TV or Sonos acceptance was performed during this audit. Earlier hardware evidence remains historical.

## 1.3.0 weather/glass verification — 2026-10-23

175 backend tests pass on HA 2025.3.4/Python 3.13 and HA 2026.9.4/Python 3.14. New cases cover background-only weather subscriptions and values, legacy theme defaults, strict field validation, startup fallback and private coordinate boundaries. The approximate lunar azimuth is checked against SunCalc's published reference case and finite output is checked at both poles and hemispheres.

136 Chromium/WebKit cases cover the existing editor and standalone renderer plus desktop/mobile weather-theme creation, persistence/undo, weather-state transitions, bounded node reuse, sun/moon visibility, missing data, reduced motion, page visibility and cleanup. Actual 1920×1080 rain/night renders were visually inspected. 236 existing LG app/outage integration cases pass with the extended provider. No new physical LG/webOS device, HDMI decoder or cold-boot acceptance is claimed.

## Weather hardware follow-up — 2026-10-23

Installed the weather extension into the existing HA 2026.10.2 instance and physical 75UH5F-HJ/webOS 4.0 installation. Its later local Studio 1.4.1 functionality was retained through a staged merge (installed build 1.4.4), rather than replaced with the older public tree. All ten original LG views remain unchanged apart from defaulted weather fields; a separate Weather & Glass view is active.

Native captures verified synthetic rain, hail, snow, full-screen fog, daytime sun and the starry night sky, followed by real Open-Meteo rain/temperature/wind. The hardware exposed missing weather forwarding in the background painter and unsupported CSS inset on Chromium 53; both are fixed in 1.3.1. The regression renderer now removes inset declarations before checking full-screen fog bounds. Notification render acknowledgement/return, HDMI/Weather source round trips and motion-off/on captures were exercised. Temporary weather/sun entities were deleted and live weather restored. Lunar astronomy and above/below-horizon behavior remain covered by browser/backend cases; a physical nighttime moon transit was not observed. Private captures, credentials and configuration snapshots remain outside Git.
