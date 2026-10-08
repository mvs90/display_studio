# Changelog

## 1.1.7

- Show the four built-in themes as selection-only tiles without edit, duplicate, reset or delete controls.
- Add a blank + tile to the colour picker and theme overview for creating custom themes. Custom themes appear in the view picker and retain their own editor and management actions.
- Move colour palette editing to custom themes; apply a custom theme directly back to the originating view without changing its content or cover background.

## 1.1.6

- Added a small delete button beside the background player dropdown. It resets selected or automatically suggested sources to **Mediaplayer wählen** without changing media cards.
- Explicit removal disables the cover background and persists across saving, reopening, duplication and theme changes. A player can be selected again at any time; undo restores the previous selection.

## 1.1.5

- Moved the background media player and cover controls into a separate per-view section before **Hintergrund & Themes**, available without enabling custom styling.
- Theme changes and resetting theme inheritance now preserve each view’s cover settings. Cover edits do not enable a visual theme override. Full view reset still resets cover settings.
- Shared theme editing and offline startup views hide the player controls. Existing resolved view settings and legacy theme imports remain readable.

## 1.1.4

- Show cover background options only after a media player is selected. Keep **Bei Wiedergabe anzeigen** as the independent playback toggle.
- Preselect a media player already assigned to the view without enabling the background or changing saved settings. Explicit background bindings take precedence; configuring an option commits the suggested player.

## 1.1.3

- Hide room card suggestions in the fixed **Nur HDMI** view. Other views retain their suggestions.
- Show notification testing only while Live preview is active. Stop, navigation and connection failures hide it again; startup and theme editors keep it hidden.

## 1.1.2

- Choose the widget type only when adding an element. Placed widgets retain their type; the redundant type selector has been removed from their properties.
- Removed the extra content-edit pencil from HDMI/PiP elements in the preview, element list and properties. Selecting, moving, resizing and deleting HDMI remains available. Other widgets keep their content editor.

## 1.1.1

- Moved backgrounds and theme settings below room card suggestions, giving the preview more space.
- Added **Eigenes Styling** for per-view appearance overrides. Controls expand only when enabled; disabling restores theme inheritance while preserving widgets and geometry. Existing overrides, reset and undo stay consistent.
- The shared theme editor keeps its appearance controls available.

## 1.1.0

- Replaced editor display controls with a **Live** button below the preview. Drafts reach the connected display without saving; changes are coalesced and sent sequentially.
- Live sessions are scoped to one editor, expire after disconnection and restore saved layouts. Startup previews never replace the offline boot design.
- Removed the global layout enable checkbox from the editor. Saving or displaying a view enables Studio layouts automatically; resetting a view resets its design.
- Moved import/export to the bottom of the page. Saved-source selection remains in the overview.
- Added backend and browser coverage for live editing, conflicts, request ordering and cleanup.

## 1.0.1

- Removed the view tab bar from the editor. Switch views through the overview; unsaved drafts remain intact.

## 1.0.0

- Extract Display Studio from LG Professional Display into an independent HACS integration.
- Add browser/kiosk display setup and explicit hardware capabilities.
- Preserve layout libraries, themes, widgets and backgrounds; copy existing LG designs once.
- Add provider-neutral view/notification actions and a Studio source entity.
- Bind to LG Professional Display 2.32.0+ through a versioned public extension API; preserve AV Companion and OSD handling.
- Add independent runtime, lifecycle, access-boundary and browser tests.
