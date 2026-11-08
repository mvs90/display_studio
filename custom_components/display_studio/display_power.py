"""Versioned local ESP power policy, independent of the selected view."""
import math

DEFAULT_POWER = {
    "version": 1, "mode": "disabled", "idle_seconds": 300,
    "dim_percent": 10, "screensaver_view": "dashboard",
    "wake_mode": "last", "wake_view": "dashboard",
    "auto_brightness": False, "min_percent": 25, "max_percent": 100,
    "dark_level": 15, "bright_level": 75, "response_seconds": 5,
    "sleep_fade_ms": 2500, "wake_fade_ms": 350,
    "screensaver_transition": "fade", "view_transition": "none", "transition_ms": 300,
}


def screensaver_sources(views):
    """Saved, eligible source names; IDs remain stable across label changes."""
    result = {}
    for view, name in views.items():
        try:
            validate_power({'screensaver_view': view, 'wake_view': view}, views)
        except ValueError:
            continue
        result[view] = name
    return result


def validate_power(raw, scenes):
    if not isinstance(raw, dict) or set(raw) - DEFAULT_POWER.keys():
        raise ValueError("Invalid display power settings")
    value = {**DEFAULT_POWER, **raw}
    if type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Unsupported display power version")
    if not isinstance(value["mode"], str) or value["mode"] not in {"disabled", "dim", "screensaver", "off"}:
        raise ValueError("Invalid standby mode")
    if type(value["auto_brightness"]) is not bool:
        raise ValueError("Invalid automatic brightness")
    for key, limits in {"idle_seconds": (30, 86400), "dim_percent": (1, 100),
                        "min_percent": (1, 100), "max_percent": (1, 100),
                        "dark_level": (0, 99), "bright_level": (1, 100),
                        "response_seconds": (1, 60), "sleep_fade_ms": (0, 10000),
                        "wake_fade_ms": (0, 3000), "transition_ms": (0, 1500)}.items():
        number = value[key]
        if type(number) not in (int, float) or not math.isfinite(number) or not limits[0] <= number <= limits[1]:
            raise ValueError("Invalid display power " + key)
    if value["min_percent"] > value["max_percent"] or value["dark_level"] >= value["bright_level"]:
        raise ValueError("Brightness minimum must not exceed maximum; dark level must precede bright level")
    for key in ("screensaver_transition", "view_transition"):
        if not isinstance(value[key], str) or value[key] not in {"none", "fade", "slide_left", "slide_right"}:
            raise ValueError("Invalid display transition")
    if not isinstance(value['wake_mode'], str) or value['wake_mode'] not in {'last', 'view'}:
        raise ValueError('Invalid wake mode')
    for key in ('screensaver_view', 'wake_view'):
        view = value[key]
        if not isinstance(view, str) or view not in scenes or view in {
            "startup", "connecting", "hdmi_full", "signal", "no_signal", "overlay", "pip", "fullscreen",
        }:
            raise ValueError("Select an existing source view for " + key)
    return value
