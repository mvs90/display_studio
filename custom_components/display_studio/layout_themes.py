"""Saved visual themes; runtime scenes remain bounded and fully resolved."""

from copy import deepcopy
import re

from .layout_config import COLORS, IMAGE_STYLE_DEFAULTS, TEXT_STYLE_DEFAULTS, WEATHER_STYLE_DEFAULTS, make_layout, presets, validate_layout

STYLE_FIELDS = (
    "background",
    "color",
    "accent",
    "image_id",
    "image_fit",
    "image_dim",
    *IMAGE_STYLE_DEFAULTS,
    *TEXT_STYLE_DEFAULTS,
    *WEATHER_STYLE_DEFAULTS,
    "gradient_angle",
    "media_background_enabled",
    "media_background_entity",
    "media_background_fit",
    "media_background_color_source",
    "media_background_dim",
)
# Keep legacy cover fields valid in stored/imported themes, but source and cover
# presentation now belong to each view and are never replaced by a theme.
APPLIED_STYLE_FIELDS = tuple(
    key for key in STYLE_FIELDS if not key.startswith("media_background_")
)
PALETTE_FIELDS = ("ink", "surface", "card_accent")
BUILTIN_THEMES = ("cinema", "aurora", "morning", "sand", "homekit")
MAX_THEMES = 25


def theme_from_scene(identifier, name, scene):
    colors = next((item for item in scene["elements"] if item["kind"] != "hdmi"), {})
    return {
        "id": identifier,
        "name": name,
        "style": {
            **{key: deepcopy(scene[key]) for key in STYLE_FIELDS},
            "ink": colors.get("color", "#f2f6fa"),
            "surface": colors.get("background", "#122333"),
            "card_accent": colors.get("accent_color", scene["accent"]),
        },
    }


def default_themes():
    return [
        theme_from_scene(p["id"], p["name"], p["layout"]["scenes"]["dashboard"])
        for p in presets()
        if p["id"] in BUILTIN_THEMES
    ]


def validate_themes(value, active):
    if not isinstance(value, list) or not 4 <= len(value) <= MAX_THEMES:
        raise ValueError("Use the built-in themes and at most 20 custom themes")
    # Add the new theme to existing libraries without changing their active theme.
    value = deepcopy(value)
    if not any(isinstance(t, dict) and t.get("id") == "homekit" for t in value):
        value.append(next(t for t in default_themes() if t["id"] == "homekit"))
    if len(value) > MAX_THEMES:
        raise ValueError("Use at most 20 custom themes")
    result, ids = [], set()
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("Invalid theme")
        identifier, name, style = raw.get("id"), raw.get("name"), raw.get("style")
        if (
            not isinstance(identifier, str)
            or identifier in ids
            or (
                identifier not in BUILTIN_THEMES
                and not re.fullmatch(r"theme_[a-zA-Z0-9_-]{1,35}", identifier)
            )
        ):
            raise ValueError("Theme IDs must be unique")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > 80
            or any(ord(c) < 32 for c in name)
        ):
            raise ValueError("Use a theme name with 1–80 characters")
        if not isinstance(style, dict) or set(style) - set(STYLE_FIELDS + PALETTE_FIELDS) or not (
            set(STYLE_FIELDS + PALETTE_FIELDS) - set(IMAGE_STYLE_DEFAULTS) - set(TEXT_STYLE_DEFAULTS) - set(WEATHER_STYLE_DEFAULTS)
        ).issubset(style):
            raise ValueError("A theme contains only background and palette fields")
        style = {**IMAGE_STYLE_DEFAULTS, **TEXT_STYLE_DEFAULTS, **WEATHER_STYLE_DEFAULTS, **style}
        candidate = make_layout()
        candidate["scenes"]["dashboard"].update(
            {key: style[key] for key in STYLE_FIELDS}
        )
        normalized = validate_layout(candidate)["scenes"]["dashboard"]
        palette = {}
        for key in PALETTE_FIELDS:
            if not isinstance(style[key], str) or not COLORS.fullmatch(style[key]):
                raise ValueError("Use six- or eight-digit theme colors")
            palette[key] = style[key].lower()
        ids.add(identifier)
        result.append(
            {
                "id": identifier,
                "name": name.strip(),
                "style": {**{key: normalized[key] for key in STYLE_FIELDS}, **palette},
            }
        )
    if (
        not set(BUILTIN_THEMES).issubset(ids)
        or not isinstance(active, str)
        or (active and active not in ids)
    ):
        raise ValueError("Built-in themes and the selected theme must exist")
    return result


def apply_theme(scene, theme, *, startup=False):
    result, style = deepcopy(scene), theme["style"]
    result.update({key: deepcopy(style[key]) for key in APPLIED_STYLE_FIELDS})
    result["element_palette"] = {key: style[key] for key in PALETTE_FIELDS}
    if startup:
        if result["background"] in ("solar", "weather"):
            result["background"] = "dawn"
        result["weather_entity"] = ""
        result["media_background_enabled"] = False
        result["media_background_entity"] = ""
    for item in result["elements"]:
        if item["kind"] != "hdmi" and not item.get("element_theme") and not item.get("style_override"):
            for part in item.get("parts", {}).values():
                part.pop("color", None)
            item.update(
                color=style["ink"],
                background=style["surface"],
                accent_color=style["card_accent"],
            )
    return result


def inherit_element_style(item, palette):
    """Drop visual overrides while retaining content, layout and interactions."""
    kind = item["kind"]
    transparent = kind in {"clock", "logo", "animation", "spinner", "progress"} or (kind == "control" and item.get("control_type", "icon") == "icon")
    item.update(card_style="inherit", color=palette["ink"], background=palette["surface"],
                accent_color=palette["card_accent"], font="sans", text_opacity=1,
                align="center" if kind == "clock" else "left", opacity=0 if transparent and not item.get("tile_surface") else .92,
                radius=0 if transparent and kind != "clock" and not item.get("tile_surface") else 24)
    item.pop("element_theme", None)
    for part in item.get("parts", {}).values():
        for key in ("color", "font", "font_weight", "align", "opacity", "radius"):
            part.pop(key, None)


def apply_element_themes(scene, themes):
    """Migrate named widget themes to independent styling; resolve inheritance."""
    for item in scene["elements"]:
        identifier = item.get("element_theme")
        if identifier and "style_override" not in item:
            theme = next((t for t in themes if t["id"] == identifier), None)
            if theme is None:
                raise ValueError("Unknown element theme")
            style = theme["style"]
            item.update(style_override=True, card_style=style["card_style"], color=style["ink"],
                        background=style["surface"], accent_color=style["card_accent"])
        if "style_override" in item:
            item.pop("element_theme", None)
            if not item["style_override"] and item["kind"] != "hdmi":
                palette = scene.get("element_palette")
                if palette:
                    inherit_element_style(item, palette)
    return scene
