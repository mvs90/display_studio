"""Feature-checked controls for a directly selected media player."""
import asyncio
import math
from homeassistant.components.media_player import MediaPlayerEntityFeature as Feature
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
from .av_schema import PLAYER_ACTIONS

SERVICES = {
    "play_pause": ("media_play_pause", Feature.PLAY | Feature.PAUSE),
    "previous": ("media_previous_track", Feature.PREVIOUS_TRACK),
    "next": ("media_next_track", Feature.NEXT_TRACK),
    "seek_back": ("media_seek", Feature.SEEK),
    "seek_forward": ("media_seek", Feature.SEEK),
    "volume_down": ("volume_down", Feature.VOLUME_STEP | Feature.VOLUME_SET),
    "volume_up": ("volume_up", Feature.VOLUME_STEP | Feature.VOLUME_SET),
    "volume_set": ("volume_set", Feature.VOLUME_SET),
    "mute": ("volume_mute", Feature.VOLUME_MUTE),
    "select_source": ("select_source", Feature.SELECT_SOURCE),
}


def numeric(value):
    return type(value) in (float, int) and math.isfinite(value)


def seek_position(state, delta, now=None):
    attrs = state.attributes
    position, duration = attrs.get("media_position"), attrs.get("media_duration")
    if not numeric(position) or position < 0 or not numeric(duration) or duration <= 0:
        raise HomeAssistantError("Playback position unavailable")
    updated = attrs.get("media_position_updated_at")
    if isinstance(updated, str):
        updated = dt_util.parse_datetime(updated)
    if state.state == "playing" and updated is not None:
        if getattr(updated, "tzinfo", None):
            position += max(0, ((now or dt_util.utcnow()) - updated).total_seconds())
    return max(0, min(duration, position + delta))


def sources(state):
    raw = state.attributes.get("source_list", []) if state else []
    if not isinstance(raw, (tuple, list)):
        return []
    return [{"value": s, "label": s} for s in raw[:64]
            if isinstance(s, str) and 0 < len(s) <= 180 and "\n" not in s]


def available(state):
    if not state or state.state in {"unknown", "unavailable"}:
        return []
    attrs, result = state.attributes, []
    for name, (_, feature) in SERVICES.items():
        if name == "play_pause":
            feature = Feature.PAUSE if state.state == "playing" else Feature.PLAY
        if not int(attrs.get("supported_features", 0)) & feature:
            continue
        if name.startswith("seek_"):
            if state.state not in {"playing", "paused", "buffering"}:
                continue
            try: seek_position(state, 0)
            except HomeAssistantError: continue
        if name == "select_source" and not sources(state):
            continue
        if name in {"volume_up", "volume_down"} and not int(attrs.get("supported_features", 0)) & Feature.VOLUME_STEP and not numeric(attrs.get("volume_level")):
            continue
        result.append("player_"+name)
    return result


async def async_execute(hass, entity_id, action, value=None):
    state = hass.states.get(entity_id)
    if not entity_id.startswith("media_player.") or action not in PLAYER_ACTIONS or action not in available(state):
        raise HomeAssistantError("Media control unavailable")
    name = action.removeprefix("player_")
    service = SERVICES[name][0]
    data = {"entity_id": entity_id}
    if name == "volume_set":
        if type(value) is not int or not 0 <= value <= 100:
            raise HomeAssistantError("Volume must be an integer from 0 to 100")
        data["volume_level"] = value / 100
    elif name == "select_source":
        if not isinstance(value, str) or value not in {s["value"] for s in sources(state)}:
            raise HomeAssistantError("Source is no longer available")
        data["source"] = value
    elif value is not None:
        raise HomeAssistantError("Unexpected control value")
    elif name.startswith("seek_"):
        data["seek_position"] = seek_position(state, -10 if name == "seek_back" else 10)
    elif name == "mute":
        data["is_volume_muted"] = state.attributes.get("is_volume_muted") is not True
    elif name in {"volume_up", "volume_down"} and not int(state.attributes.get("supported_features", 0)) & Feature.VOLUME_STEP:
        service = "volume_set"
        data["volume_level"] = max(0, min(1, state.attributes["volume_level"] + (.05 if name == "volume_up" else -.05)))
    command = hass.services.async_call("media_player", service, data, blocking=True)
    if name == "select_source":
        await asyncio.shield(hass.async_create_task(command, "Display Studio source selection"))
    else:
        await command
