"""Live transport capabilities through HA's already paired Apple TV connection.

The HA media player's SEEK flag describes absolute positioning, not relative
skip support. Remote.send_command cannot carry a requested time interval.
Keep this optional adapter bounded to a registered Apple TV media player and
use pyatv's public feature/remote API; never create a second connection.
"""
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er


def transport_target(hass, entity_id, command):
    """Require current app availability, not HA's static supported_features bits."""
    features = {"skip_forward": "SkipForward", "skip_backward": "SkipBackward",
                "next": "Next", "previous": "Previous"}
    if command not in features:
        return None
    state = hass.states.get(entity_id) if entity_id else None
    if not state or state.state not in {"playing", "paused", "buffering"} or hass.config_entries is None:
        return None
    entity = er.async_get(hass).async_get(entity_id)
    if not entity or entity.platform != "apple_tv" or entity.domain != "media_player":
        return None
    entry = hass.config_entries.async_get_entry(entity.config_entry_id)
    if not entry or entry.domain != "apple_tv":
        return None
    atv = getattr(getattr(entry, "runtime_data", None), "atv", None)
    if atv is None:
        return None
    from pyatv.const import FeatureName, FeatureState
    feature = getattr(FeatureName, features[command])
    if atv.features.get_feature(feature).state != FeatureState.Available:
        return None
    return getattr(atv.remote_control, command)


def skip_target(hass, entity_id, forward):
    return transport_target(hass, entity_id, "skip_forward" if forward else "skip_backward")


async def async_skip(hass, entity_id, forward):
    # Re-resolve at the moment of the action; an app/route may have changed.
    command = skip_target(hass, entity_id, forward)
    if command is None:
        raise HomeAssistantError("Apple TV does not currently support this skip command")
    from pyatv.exceptions import NotSupportedError, InvalidStateError, CommandError
    try:
        await command(time_interval=10.0)
    except (NotSupportedError, InvalidStateError, CommandError) as err:
        raise HomeAssistantError("Apple TV could not skip in the current playback") from err
