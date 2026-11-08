# ESPHome AV startup and LG dashboard compatibility

Verified on 2026-10-15 with the existing Home Assistant 2026.9.4 container, AV Companion 1.6.2, LG Professional Display 2.33.1 and the local Display Studio 1.4.1 bundle.

## Failure modes and fixes

- A native ESPHome request expires after five seconds. Awaiting the AV service directly tied its lifetime to the HTTP client; disconnecting cancelled the accepted startup and cleared the pending source. AV source and power actions now run as Home Assistant-owned tasks, awaited through `asyncio.shield`. Validation still happens before dispatch, connected clients receive service errors, and AV supersession/shutdown logic remains authoritative.
- Audio metadata and display-source feedback are separate. A valid active AV source, including a pending source while the display is off, takes precedence in the dropdown. An idle or unavailable Sonos cannot replace Dashboard with an invalid `sonos:` value. Sonos fallback is accepted only if that source is present in the actual choices.
- The newer scroll viewport used CSS `inset`, unsupported by the LG webOS Chromium 53 renderer. The resulting viewport was one pixel wide, leaving only the background visible. Explicit top/right/bottom/left edges restore the viewport; the same compatibility correction covers camera fullscreen and shared modal surfaces.

## Verification

- 104 targeted Python checks: source feedback through off/on/idle startup states, HDMI/Dashboard/Dashboard PiP/Mediaplayer, idle/playing/paused/unavailable Sonos, native compilation, provider binding, live previews, cancellation and connected-client errors.
- 12 Chromium/WebKit browser checks, including emulation of the legacy CSS parser boundary. The viewport test failed at 1 px before the fix and passes at 1920 x 1080 after it.
- 99 LG app cases exercised against this Studio bundle. One older moon-icon cache assertion needed to accept the existing lunar-phase suffix; the affected case passed after that compatibility adjustment.
- Physical cold start: LG put in standby, its controlled supply switched off, then exactly one native ESP source action selected Dashboard. The HTTP client disconnected after its firmware-equivalent five-second timeout without retrying. Dashboard was confirmed after 49 seconds, and all 60 sampled source values over 61 seconds remained `TV · Dashboard`.
- Actual LG screenshots verified the empty background before the fix and visible clock/weather/cards afterward. Unassigned calendar/entity cards still show their configuration placeholders.
- ESP standby was disabled temporarily for the measurement and its original mode restored afterward. An off OSD readback after the power cycle required restoring its recorded original setting; this source/rendering fix does not change the LG OSD implementation.

These changes are limited to the existing local Studio working tree. Saved layouts, entity bindings, audio playback configuration and unrelated ongoing Studio changes were preserved.
