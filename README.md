# Display Studio

An independent, local Home Assistant / HACS integration for designed display views. **Version 1.1.2** supports ordinary browser/kiosk displays and extends [LG Professional Display 2.32.0+](https://github.com/mvs90/lg_rs232_ip) through its public adapter API. No LG integration is required for browser displays.

[Deutsche Bedienungsanleitung](docs/DISPLAY-STUDIO.md) · [Adapter architecture](docs/ADAPTERS.md) · [Testing](docs/TESTING.md) · [MIT license](LICENSE)

## Installation

1. Add `https://github.com/mvs90/display_studio` as a **custom Integration repository** in HACS and download it.
2. For LG hardware, also install/update LG Professional Display to **2.32.0 or newer**. Restart Home Assistant.
3. Settings → Devices & services → Add integration → **Display Studio**.
4. Choose **Browser / Kiosk / other display** or select an existing **LG Professional Display**.
5. Open **Display Studio** in the sidebar. Configure widgets, save the design and choose **Anzeigen** (Show).

Home Assistant **2025.3+**. Not yet in HACS's default catalogue. Manual installation: copy `custom_components/display_studio` into HA's `custom_components` directory. The editor is currently German; setup is available in German and English.

## What it does

- Saved, editable views; duplicate/delete custom views and restore fixed views individually.
- Global themes with per-view overrides, editable backgrounds, sun-position colour gradients and 4K-scaled widgets.
- Clock/date, weather and forecasts, calendars, entity/status cards, media-player artwork/progress and camera widgets.
- Room-based card suggestions; Sonos and other players use their existing HA integrations.
- Configurable notification designs, media backgrounds sampled from cover edges or the whole cover, buffered artwork and bounded resource use.
- A Studio media-player entity exposes saved views as sources. The LG adapter also extends the existing LG and AV Companion source lists.
- `display_studio.show_view` and `display_studio.show_notification` automation actions, plus an installed event-view blueprint.

## Display capabilities

| Output | Browser / kiosk | LG adapter |
|---|---|---|
| Dashboard, media and custom views | Yes | Yes |
| Overlay / fullscreen message | Over the Studio page | Resident LG app / native handling |
| Physical HDMI and hardware PiP | No | Uses the LG integration's supported inputs |
| Native source switching, power, OSD guard | Hardware integration's responsibility | LG integration |
| Startup design and resident SI provisioning | No native boot control | LG integration and Studio's offline design |
| Display screenshot | No new camera endpoint | Existing LG preview camera |

**Browser setup:** use **Anzeigelink → Anzeige öffnen** in the selected display's Studio overview. Open that URL in the target display's browser or kiosk software; configure that software's startup separately. The link is a private, per-display read-only credential for the saved Studio contents, artwork and configured cameras. It is not an HA access token and cannot edit designs or call services. Keep it private and use HTTPS for access outside a trusted local network. Admin API `POST /api/display_studio/browser_link/<entry_id>` replaces the link and revokes the old one. Removing the entry revokes display access. Browser video decoding/HLS support depends on its engine; native HDMI and UDP multicast need a hardware adapter. On connection loss the browser clears private widgets after 30 seconds and reconnects with backoff.

**LG setup:** enable the LG display app, SI mode and resident startup in LG Professional Display. Studio supplies designs and renderer assets to the existing app. Hardware access, OSD restoration, HDMI/video planes, SI recovery and capture stay with LG. Installing Studio does not automatically change the display's SI-server configuration. One Studio entry may bind each LG device; multiple different displays are supported.

## Automations

```yaml
action: display_studio.show_view
target:
  entity_id: media_player.lg_display_studio_views
data:
  view: dashboard
  duration: 30
  transition: smooth
  theme: morning
```

Use the stable view/theme IDs displayed in the editor. `duration: 0` keeps the selected view; a timed view returns to the previous view. Manual selection cancels the return. The theme remains active after return. `smooth` uses the LG HDMI transition; browser views currently switch directly.

```yaml
action: display_studio.show_notification
target:
  entity_id: media_player.lg_display_studio_views
data:
  title: Home Assistant
  message: Die Waschmaschine ist fertig.
  layout: overlay
  duration: 10
```

Use your actual Studio entity ID. `config_entry_id` is an alternative to the entity target, used by the editor. Browser notifications replace the previous message, never queue stale messages. `pip` requires the LG adapter. Studio displays media metadata; AV Companion remains responsible for sound, coordinated standby and a combined HomeKit media player.

## Existing LG Studio designs

When connecting a new Studio entry to an LG entry for the first time, Studio copies the old layout document and uploaded backgrounds to its own storage. View IDs, revision, bindings, themes and background hashes remain intact. Original LG storage remains available as a backup. Existing Studio storage is never overwritten on reload. The old `/lg-display-studio` bookmark opens the new editor; new links use `/display-studio`. Existing LG presentation actions remain compatible when Studio is connected. New automations should use the independent Studio actions.

The three repositories have separate releases: **LG Professional Display** owns hardware, **Display Studio** owns designs/rendering, and **AV Companion** owns optional AV orchestration. None of their credentials or local configuration is included here.
