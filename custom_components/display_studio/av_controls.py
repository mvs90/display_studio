"""Scoped AV controls shared by the editor, browser and native ESP adapter.

Bindings come from the selected LG/AV config entry, never a client-supplied
service or a cached target. TV audio is detected on the linked sound system.
"""
import asyncio
from dataclasses import dataclass

from homeassistant.components.media_player import MediaPlayerEntityFeature as Feature
from homeassistant.core import State
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

MEDIA_ACTIONS = {
    "av_play_pause": ("media_play_pause", Feature.PLAY | Feature.PAUSE),
    "av_previous": ("media_previous_track", Feature.PREVIOUS_TRACK),
    "av_next": ("media_next_track", Feature.NEXT_TRACK),
    "av_volume_down": ("volume_down", Feature.VOLUME_STEP | Feature.VOLUME_SET),
    "av_volume_up": ("volume_up", Feature.VOLUME_STEP | Feature.VOLUME_SET),
    "av_volume_set": ("volume_set", Feature.VOLUME_SET),
    "av_mute": ("volume_mute", Feature.VOLUME_MUTE),
    "av_seek_back": ("media_seek", Feature.SEEK),
    "av_seek_forward": ("media_seek", Feature.SEEK),
}
from .av_schema import AV_ACTIONS, REMOTE_COMMANDS


def configured_entities(config):
    from .layout_config import active_scenes
    return {
        target
        for scene in active_scenes(config).values()
        for item in scene["elements"]
        for target in (
            item.get("entity_id") if item.get("media_av_auto") else None,
            *(item.get(gesture, {}).get("entity_id")
              for gesture in ("tap_action", "hold_action")
              if item.get(gesture, {}).get("action") in AV_ACTIONS),
        ) if target
    }


def routed_entities(hass, config):
    """Discover linked AV media cards as well as explicitly configured AV actions."""
    from .layout_config import active_scenes
    result = configured_entities(config)
    for scene in active_scenes(config).values():
        for item in scene["elements"]:
            entity = item.get("entity_id", "")
            if item["kind"] == "media" and entity not in result:
                binding = resolve(hass, entity)
                if binding and binding.sonos and binding.apple_tv:
                    result.add(entity)
    return result


def artwork_target(hass, entity_id):
    """Prefer the active player's cover; reuse AV's own app-logo fallback."""
    binding = resolve(hass, entity_id)
    if not binding or not binding.sonos or not binding.apple_tv:
        return entity_id
    target = binding.playback(hass)
    source = hass.states.get(target) if target else None
    if not usable(source):
        return ""
    if source.attributes.get("entity_picture"):
        return target
    system = hass.states.get(entity_id)
    # AV metadata can lag one state event. Never display the preceding app's logo.
    if usable(system) and system.attributes.get("entity_picture"):
        app_id = source.attributes.get("app_id")
        name = source.attributes.get("app_name")
        if ((app_id and app_id == system.attributes.get("app_id")) or
            (not app_id and name and name == system.attributes.get("app_name"))):
            return entity_id
    return target


def usable(state):
    return state is not None and state.state not in {"unavailable", "unknown"}


@dataclass(frozen=True)
class Binding:
    sonos: str
    apple_tv: str
    remote: str
    tv_source: str = "TV"
    audio_format: str = ""
    av: str = ""

    @property
    def dependencies(self):
        return {v for v in (self.sonos, self.apple_tv, self.remote, self.audio_format, self.av) if v}

    def playback(self, hass):
        sound = hass.states.get(self.sonos)
        if not usable(sound):
            return ""  # Never guess where a playback command should go.
        attrs = sound.attributes
        tv = (str(attrs.get("source") or "").strip().casefold() in {"tv", self.tv_source.strip().casefold()}
              or str(attrs.get("media_content_id") or "").casefold().startswith("x-sonos-htastream:"))
        # Selecting the actual TV input owns the route, including paused/idle TV.
        # Audio-format telemetry may lag or report no input between tracks.
        return self.apple_tv if tv else self.sonos

    def available(self, hass):
        result = []
        from .player_controls import available
        for action in MEDIA_ACTIONS:
            target = self.sonos if action.startswith(("av_volume_", "av_mute")) else self.playback(hass)
            if target == self.apple_tv and action in {"av_next", "av_previous"}:
                from .apple_tv_controls import transport_target
                if transport_target(hass, target, action.removeprefix("av_")) is not None:
                    result.append(action)
                # HA advertises these for the device even when the current app
                # explicitly reports them unavailable. Never fall back to that.
                continue
            # The AV card's +/-10 s transport belongs to Apple TV. Sonos may
            # advertise SEEK for music, but must not expose these TV controls.
            if action.startswith("av_seek_") and target != self.apple_tv:
                continue
            if action.startswith("av_seek_"):
                from .apple_tv_controls import skip_target
                if skip_target(hass, target, action == "av_seek_forward") is not None:
                    result.append(action)
                    continue
            if action.replace("av_", "player_", 1) in available(hass.states.get(target) if target else None):
                result.append(action)
        if self.remote and usable(hass.states.get(self.remote)):
            player = hass.states.get(self.apple_tv)
            result.extend(action for action in REMOTE_COMMANDS if action == "av_remote_wakeup"
                          or usable(player) and player.state not in {"off", "standby"})
        system = hass.states.get(self.av)
        if usable(system):
            feature = Feature.TURN_ON if system.state == "off" else Feature.TURN_OFF
            if int(system.attributes.get("supported_features", 0)) & feature:
                result.append("av_power")
        if self.sources(hass):
            result.append("av_select_source")
        return sorted(result)

    def sources(self, hass):
        result = []
        for prefix, target in (("av", self.av), ("sonos", self.sonos)):
            state = hass.states.get(target)
            if not usable(state) or not int(state.attributes.get("supported_features", 0)) & Feature.SELECT_SOURCE:
                continue
            for source in state.attributes.get("source_list", [])[:64]:
                if isinstance(source, str) and 0 < len(source) <= 180 and "\n" not in source:
                    result.append({"value": prefix + ":" + source, "label": ("TV · " if prefix == "av" else "Sonos · ") + source})
        return result



def resolve(hass, entity_id):
    if not isinstance(entity_id, str) or not entity_id.startswith("media_player."):
        return None
    registry = er.async_get(hass)
    entity = registry.async_get(entity_id)
    entry = hass.config_entries.async_get_entry(entity.config_entry_id) if entity else None
    if not entry or entry.domain not in {"av_companion", "lg_rs232_ip"}:
        return None
    options = entry.options
    def target(key, domain):
        value = options.get(key)
        return value if isinstance(value, str) and value.startswith(domain + ".") and value != entity_id else ""
    sonos = target("linked_volume_media_player_entity_id", "media_player")
    apple = target("linked_media_player_entity_id", "media_player")
    remote = target("linked_remote_entity_id", "remote")
    if not remote:
        player = registry.async_get(apple)
        if player and player.platform == "apple_tv" and player.device_id:
            candidates = [e.entity_id for e in er.async_entries_for_device(registry, player.device_id)
                          if e.domain == "remote" and e.platform == "apple_tv" and not e.disabled_by]
            if len(candidates) == 1:
                remote = candidates[0]
    sound = registry.async_get(sonos)
    audio = []
    if sound and sound.platform == "sonos" and sound.device_id:
        audio = [e.entity_id for e in er.async_entries_for_device(registry, sound.device_id)
                 if e.domain == "sensor" and e.platform == "sonos"
                 and e.translation_key == "audio_input_format" and not e.disabled_by]
    return Binding(sonos, apple, remote, str(options.get("sonos_tv_source") or "TV"), audio[0] if len(audio) == 1 else "", entity_id)


def dependencies(hass, config):
    return set().union(*(binding.dependencies for entity in routed_entities(hass, config)
                        if (binding := resolve(hass, entity))))


def display_state(hass, entity_id):
    binding = resolve(hass, entity_id)
    target = binding.playback(hass) if binding else ""
    source = hass.states.get(target) if target else None
    sound = hass.states.get(binding.sonos) if binding and binding.sonos else None
    attrs = dict(source.attributes) if source else {}
    mode = "Apple TV · TV-Ton" if binding and target == binding.apple_tv and target else "Sonos · Musik"
    if not target:
        mode = "AV · Quelle nicht verfügbar"
    attrs.update(friendly_name=mode, av_source=target,
                 av_available_actions=binding.available(hass) if binding else [],
                 av_dependencies=sorted(binding.dependencies) if binding else [])
    if not attrs.get("media_title"):
        attrs["media_title"] = attrs.get("app_name") or {"off": "Apple TV im Standby", "idle": "Bereit zur Wiedergabe",
                                "paused": "Wiedergabe pausiert"}.get(source.state if source else "", "Keine Wiedergabe")
    if not attrs.get("media_artist"):
        attrs["media_artist"] = attrs.get("app_name") or mode
    for key in ("volume_level", "is_volume_muted"):
        attrs[key] = sound.attributes.get(key) if usable(sound) else None
    system = hass.states.get(entity_id)
    choices = binding.sources(hass) if binding else []
    # The display source and audio playback target are independent. In particular,
    # idle Sonos must not erase Dashboard/HDMI or an AV startup request.
    allowed = {choice["value"] for choice in choices}
    display_source = "av:" + str(system.attributes.get("source", "")) if usable(system) else ""
    sound_source = "sonos:" + str(sound.attributes.get("source", "")) if usable(sound) else ""
    display_selected = usable(system) and (
        system.state != "off" or system.attributes.get("source_selection_pending") is True
    )
    selected = display_source if display_selected and display_source in allowed else ""
    if not selected and binding and target == binding.sonos and sound_source in allowed:
        selected = sound_source
    remote_player = hass.states.get(binding.apple_tv) if binding else None
    attrs.update(av_remote_state=remote_player.state if usable(remote_player) else "unavailable", av_sources=choices, av_selected_source=selected, av_power=system.state if system else "unavailable")
    return State(entity_id, source.state if source else "unavailable", attrs)


async def async_execute(hass, entity_id, action, value=None):
    binding = resolve(hass, entity_id)
    if not binding or action not in binding.available(hass):
        raise HomeAssistantError("AV control unavailable; check linked players and remote")
    if action == "av_volume_set":
        if type(value) is not int or not 0 <= value <= 100:
            raise HomeAssistantError("Volume must be an integer from 0 to 100")
        domain, service, data = "media_player", "volume_set", {"entity_id": binding.sonos, "volume_level": value / 100}
    elif action == "av_select_source":
        if not isinstance(value, str) or value not in {choice["value"] for choice in binding.sources(hass)}:
            raise HomeAssistantError("Source is no longer available")
        prefix, source_name = value.split(":", 1)
        domain, service, data = "media_player", "select_source", {"entity_id": binding.av if prefix == "av" else binding.sonos, "source": source_name}
    elif action == "av_power":
        domain, service, data = "media_player", "turn_on" if hass.states.get(entity_id).state == "off" else "turn_off", {"entity_id": entity_id}
    elif action in REMOTE_COMMANDS:
        domain, service = "remote", "send_command"
        data = {"entity_id": binding.remote, "command": REMOTE_COMMANDS[action]}
    else:
        domain, (service, _) = "media_player", MEDIA_ACTIONS[action]
        target = binding.sonos if action.startswith(("av_volume_", "av_mute")) else binding.playback(hass)
        data = {"entity_id": target}
        state = hass.states.get(target)
        if action.startswith("av_seek_"):
            from .apple_tv_controls import skip_target, async_skip
            if skip_target(hass, target, action == "av_seek_forward") is not None:
                await async_skip(hass, target, action == "av_seek_forward")
                return
            from .player_controls import seek_position
            data["seek_position"] = seek_position(state, -10 if action == "av_seek_back" else 10)
        elif action == "av_mute":
            data["is_volume_muted"] = state.attributes.get("is_volume_muted") is not True
        elif action.startswith("av_volume_") and not int(state.attributes.get("supported_features", 0)) & Feature.VOLUME_STEP:
            level = state.attributes.get("volume_level")
            if not isinstance(level, (float, int)):
                raise HomeAssistantError("Current AV volume is unavailable")
            service = "volume_set"
            data["volume_level"] = max(0, min(1, level + (.05 if action == "av_volume_up" else -.05)))
    command = hass.services.async_call(domain, service, data, blocking=True)
    if action in {"av_select_source", "av_power"}:
        # The native ESP HTTP client disconnects after five seconds, while an
        # accepted AV startup can need a minute. Let HA own that operation so
        # transport cancellation cannot discard the selected source mid-boot.
        # The AV integration still handles newer commands and HA shutdown.
        await asyncio.shield(hass.async_create_task(command, f"Display Studio {action}"))
    else:
        await command
