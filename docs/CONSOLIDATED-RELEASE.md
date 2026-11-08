# 1.5.1

Consolidates the installed Studio implementation, including weather glass backgrounds, local fonts, HEIC/AVIF photo import, device binding, media controls and native rendering adapters. Existing saved layouts and bindings remain supported; no settings reset or storage deletion is introduced. Browser tests cover editing, undo, rendering, gestures and link revocation. Older Home Assistant Pillow versions use an AVIF decoder fallback.

Validation: 573 Python tests pass on Home Assistant 2025.3.4 and 2026.9.4, and in an isolated 2026.10.4 container. 622 Chromium/WebKit cases cover the complete editor/renderer matrix, including weather rendering, gestures, geometry, media controls and browser lifecycle. Eight saved layout documents containing 104 views pass validation. Existing installed files and all 19 saved settings hashes remain unchanged. Rendered rain/night views were also visually inspected. Physical device actions were not repeated for this repository consolidation.

The 1.5.1 follow-up fixes popup scroll anchoring and ResizeObserver painting on Linux/WebKit, and makes animation/preview tests deterministic across platforms.

Text selection handles retain keyboard focus and pointer identity during repaint. Resize callbacks repaint only when dimensions used by the fit calculation change, preventing layout feedback loops.
