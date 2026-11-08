"""Protected system screens and optional, independently editable display sources."""

from copy import deepcopy
import re
import math

from .layout_config import make_layout, scene, validate_layout, validate_startup_scene
from .layout_themes import apply_element_themes, apply_theme, default_themes, validate_themes

FIXED_VIEWS = {
    "hdmi_full": "Nur HDMI",
    "startup": "Startanzeige",
    "overlay": "Mitteilung",
    "pip": "Mitteilung PiP",
    "fullscreen": "Mitteilung Vollbild",
}
OPTIONAL_VIEWS = {"connecting": "Verbindungsaufbau", "updating": "Firmwareaktualisierung"}
SOURCE_VIEWS = {
    "dashboard": "Dashboard", "pip_view": "Dashboard PiP", "media_view": "Mediaplayer"
}
MAX_VIEWS = 32  # Five system views plus 27 custom sources (including former defaults).
LEGACY_ORDER = ("hdmi_full", *SOURCE_VIEWS, "startup", "overlay", "pip", "fullscreen")
CUSTOM_ID = re.compile(r"view_[a-zA-Z0-9_-]{1,35}")


def from_config(config, *, preserve_sources=True):
    """Adopt existing runtime content; fresh installations opt out of source templates."""
    names = {**FIXED_VIEWS, **(SOURCE_VIEWS if preserve_sources else {})}
    names = {key: names[key] for key in LEGACY_ORDER if key in names}
    return {
        "library_version": 4,
        "themes": default_themes(),
        "active_theme": "",
        "views": [
            {"id": key, "name": "Bootscreen" if key=="startup" and "connecting" in config["scenes"] else name, "theme_override": False, "scene": deepcopy(config["scenes"][key])}
            for key, name in {**names, **{key:name for key,name in OPTIONAL_VIEWS.items() if key in config["scenes"]}}.items()
        ],
    }


def upgrade_library(value, settings):
    """Keep the user's previously assigned designs when adopting fixed slots."""
    if value.get("library_version") == 4:
        return deepcopy(value)
    if value.get("library_version") in (2, 3):
        result = deepcopy(value)
        result["library_version"] = 4
        defaults = from_config(settings)["views"]
        if value["library_version"] == 2:
            result["views"].insert(0, defaults[0])
        if not any(view["id"] == "startup" for view in result["views"]):
            result["views"].insert(4, next(view for view in defaults if view["id"] == "startup"))
        return result
    by_id = {view["id"]: view for view in value["views"]}
    assignments = value.get("assignments", {})
    assignments = {"pip_view": assignments.get("signal", ""), **assignments}
    result = from_config(settings)
    used = set()
    for view in result["views"]:
        old_id = assignments.get(view["id"])
        if old_id in by_id:
            view["scene"] = deepcopy(by_id[old_id]["scene"])
            used.add(old_id)
    for old in value["views"]:
        if old["id"] in used:
            continue
        copy = deepcopy(old)
        identifier = "view_" + old["id"][:30]
        base, suffix = identifier, 2
        while any(view["id"] == identifier for view in result["views"]):
            identifier = base + "_" + str(suffix)
            suffix += 1
        copy["id"] = identifier
        result["views"].append(copy)
    return result


def validate_grid(value):
    """Editor-only insertion guide; rendered scenes contain only real widgets."""
    if isinstance(value, dict) and set(value) == {"cells"}:
        cells = value["cells"]
        if not isinstance(cells, list) or not 1 <= len(cells) <= 64:
            raise ValueError("Grid requires 1–64 cells")
        for index, cell in enumerate(cells):
            if not isinstance(cell, dict) or set(cell) != {"x", "y", "width", "height"}:
                raise ValueError("Invalid grid cell")
            for key, low, high in (("x", 0, 99), ("y", 0, 99), ("width", 1, 100), ("height", 1, 100)):
                if type(cell[key]) not in (int, float) or not math.isfinite(cell[key]) or not low <= cell[key] <= high:
                    raise ValueError("Invalid grid cell dimensions")
            if cell["x"] + cell["width"] > 100.000001 or cell["y"] + cell["height"] > 100.000001:
                raise ValueError("Grid cell must fit inside the view")
            for other in cells[:index]:
                if (cell["x"] < other["x"] + other["width"] - .000001
                    and cell["x"] + cell["width"] > other["x"] + .000001
                    and cell["y"] < other["y"] + other["height"] - .000001
                    and cell["y"] + cell["height"] > other["y"] + .000001):
                    raise ValueError("Grid cells must not overlap")
        return deepcopy(value)
    if not isinstance(value, dict) or set(value) != {"columns", "rows", "gap", "margin"}:
        raise ValueError("Invalid view grid")
    for key in ("columns", "rows"):
        if type(value[key]) is not int or not 1 <= value[key] <= 8:
            raise ValueError("Grid requires 1–8 rows and columns")
    for key, maximum in (("gap", 6), ("margin", 10)):
        if type(value[key]) not in (int, float) or not math.isfinite(value[key]) or not 0 <= value[key] <= maximum:
            raise ValueError("Invalid grid spacing")
    return deepcopy(value)


def validate_library(value, settings, *, camera_limit=1):
    if (
        not isinstance(value, dict)
        or value.get("library_version") != 4
        or not isinstance(value.get("views"), list)
        or "assignments" in value
    ):
        raise ValueError("Supply a fixed-view library (version 4)")
    if len(value["views"]) > MAX_VIEWS + sum(any(v.get("id")==key for v in value["views"]) for key in OPTIONAL_VIEWS):
        raise ValueError("Use at most 27 custom views")
    active = value.get("active_theme", "")
    themes = validate_themes(value.get("themes", default_themes()), active)
    theme = next((row for row in themes if row["id"] == active), None)
    views, ids = [], set()
    for raw in value["views"]:
        if not isinstance(raw, dict):
            raise ValueError("Invalid view")
        identifier, name = raw.get("id"), raw.get("name")
        if (
            not isinstance(identifier, str)
            or (identifier not in FIXED_VIEWS and identifier not in OPTIONAL_VIEWS and identifier not in SOURCE_VIEWS and not CUSTOM_ID.fullmatch(identifier))
            or identifier in ids
        ):
            raise ValueError("View IDs must be unique")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > 80
            or any(ord(c) < 32 for c in name)
        ):
            raise ValueError("Use a view name with 1–80 characters")
        expected = {**FIXED_VIEWS, **OPTIONAL_VIEWS}.get(identifier)
        if identifier=="startup" and ("connecting" in settings["scenes"] or any(v.get("id")=="connecting" for v in value["views"])):expected="Bootscreen"
        if expected and name != expected:
            raise ValueError("Fixed views cannot be renamed")
        ids.add(identifier)
        candidate = make_layout()
        candidate["scenes"]["dashboard"] = raw.get("scene")
        normalized = validate_layout(candidate,camera_limit=camera_limit)["scenes"]["dashboard"]
        override = raw.get("theme_override", False)
        if type(override) is not bool:
            raise ValueError("Invalid theme override")
        if identifier in {"startup", "connecting", "updating"}:
            validate_startup_scene(normalized)
        if theme and not override:
            normalized = apply_theme(normalized, theme, startup=identifier in {"startup", "connecting", "updating"})
        normalized = apply_element_themes(normalized, themes)
        view = {"id": identifier, "name": name.strip(), "theme_override": override, "scene": normalized}
        if "grid" in raw:
            view["grid"] = validate_grid(raw["grid"])
        views.append(view)
    if not (set(FIXED_VIEWS) | (set(OPTIONAL_VIEWS) & set(settings["scenes"]))).issubset(ids):
        raise ValueError("Fixed views cannot be deleted")
    config = deepcopy(settings)
    config["scenes"] = {
        key: deepcopy(settings["scenes"][key]) for key in ("signal", "no_signal")
    }
    # Older renderers require these keys. Empty compatibility slots must never
    # recreate deleted content, subscribe to its entities or appear as sources.
    config["scenes"].update({key: scene("solid", color="#000000") for key in SOURCE_VIEWS if key not in ids})
    config["scenes"].update({view["id"]: deepcopy(view["scene"]) for view in views})
    return validate_layout(config,camera_limit=camera_limit), {"library_version": 4, "views": views, "themes": themes, "active_theme": active}


def sync_legacy(library, config, *, camera_limit=1):
    """A runtime editor can update layouts, but cannot remove protected views."""
    result = deepcopy(library)
    existing = {view["id"] for view in result["views"]}
    for key, name in SOURCE_VIEWS.items():
        # Explicit legacy imports may create a source. Empty runtime slots from
        # a previous deletion do not resurrect it on save or restart.
        if key not in existing and config["scenes"].get(key, {}).get("elements"):
            result["views"].append({"id": key, "name": name, "scene": deepcopy(config["scenes"][key]), "theme_override": bool(result.get("active_theme"))})
    for view in result["views"]:
        if view["id"] in config["scenes"]:
            if view["scene"] != config["scenes"][view["id"]] and result.get("active_theme"):
                # Legacy saves have no inheritance control: preserve their explicit edit.
                view["theme_override"] = True
            view["scene"] = deepcopy(config["scenes"][view["id"]])
    return validate_library(result, config,camera_limit=camera_limit)[1]


def source_views(library):
    return {
        view["id"]: view["name"]
        for view in library["views"]
        if view["id"] in SOURCE_VIEWS or view["id"] not in FIXED_VIEWS and view["id"] not in OPTIONAL_VIEWS
    }


def source_names(views, occupied):
    """Keep all HDMI, fixed and user-defined source labels unambiguous."""
    used, result = set(occupied), {}
    for key, title in views.items():
        name = title
        while name in used:
            name += " (App)"
        used.add(name)
        result[key] = name
    return result
