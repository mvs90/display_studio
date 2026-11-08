"""Bounded, declarative display layouts. No HTML, templates or executable CSS."""
from .fonts import FONTS
from .weather_sources import CONDITIONS

from copy import deepcopy
import math
import json
from pathlib import Path
import ipaddress
from urllib.parse import urlsplit
import re

from .widget_parts import validate_parts
from .animations import ANIMATIONS
from .entity_actions import ENTITY_ACTIONS
from .symbols import mdi_geometry

CONTROL_SYMBOLS = json.loads(Path(__file__).with_name("control_symbols.json").read_text())

_WIDGET_DEFAULTS = json.loads(Path(__file__).with_name("widget_defaults.json").read_text())


def widget_defaults():
    """Independent initial styles for newly added widgets; saved views stay intact."""
    return deepcopy(_WIDGET_DEFAULTS)


SCENES = (
    "signal",
    "no_signal",
    "dashboard",
    "overlay",
    "pip",
    "fullscreen",
    "pip_view",
    "media_view",
    "hdmi_full",
    "startup",
)
KINDS = (
    "control",
    "boot",  # Legacy input, split when loading ESP libraries.
    "startup",
    "logo",
    "animation",
    "spinner",
    "progress",
    "hdmi",
    "camera",
    "clock",
    "weather",
    "calendar",
    "entity",
    "status",
    "switch",
    "button",
    "media",
    "text",
    "message",
)
BACKGROUNDS = (
    "solid",
    "homekit",
    "aurora",
    "dawn",
    "ocean",
    "sand",
    "midnight",
    "solar",
    "weather",
    "gradient",
    "image",
)
COLORS = re.compile(r"^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$")
ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
STARTUP_KINDS = (
    "control",
    "boot", "text", "clock", "startup", "logo", "animation", "spinner", "progress")
STARTUP_BACKGROUNDS = tuple(value for value in BACKGROUNDS if value not in ("solar", "weather"))

WEATHER_STYLE_DEFAULTS = {"weather_entity": "", "weather_animate": True, "weather_impact": False, "weather_accumulation": False, "glass": False, "weather_condition": "auto", "weather_precipitation_mode": "condition", "weather_precipitation_entity": ""}


def validate_startup_scene(value):
    """Only local, declarative content; enforce this for imports and both APIs."""
    if (
        value.get("scroll_height", 100) != 100
        or value["background"] not in STARTUP_BACKGROUNDS
        or value.get("media_background_enabled")
        or value.get("media_background_entity")
        or value.get("weather_entity")
        or any(
            item["kind"] not in STARTUP_KINDS or item.get("entity_id") or item.get("progress_source") == "entity"
            for item in value["elements"]
        )
    ):
        raise ValueError(
            "Startup supports only offline content elements, local clock/date and static backgrounds"
        )
    return value


def element(kind, x, y, width, height):
    return dict(
        **({"control_type":"icon", "control_icon":"play", "symbol_button_shape":"round"} if kind=="control" else {}),
        **({"animation_type":"spinner", "animation_duration":1000, "progress_value":60, "progress_source":"fixed"} if kind=="animation" else {}),
        **({"text_line_height":1.35} if kind=="text" else {"spinner_duration":1000} if kind=="spinner" else {"progress_value":60,"progress_source":"boot"} if kind=="progress" else {}),
        **({"media_controls":True,"media_remote_view":"","media_controls_hidden":[]} if kind=="media" else {}),
        id=kind,
        kind=kind,
        x=x,
        y=y,
        width=width,
        height=height,
        label="Animation · " + ANIMATIONS["spinner" if kind == "animation" else kind]["label"] if kind in {"animation", "spinner", "progress"} else "",
        text="",
        entity_id="",
        font_size=3.2,
        color="#f2f6fa",
        background="#142335",
        opacity=0 if kind in {"logo", "control", "animation", "spinner", "progress"} else 0.88,
        radius=0 if kind in {"logo", "control", "animation", "spinner", "progress"} else 24,
        align="left",
        font="sans",
        show_label=kind not in {"animation", "spinner", "progress"},
        forecast_type="daily",
        forecast_count=4,
        animate=True,
        weather_style="glass",
        media_style="compact",
        show_cover=True,
        show_progress=True,
        show_playback_icon=False,
        show_volume=True,
        status_coloring=True,
        accent_color="#79e5c0",
        camera_source="test",
        multicast_url="",
        camera_mode="auto",
        camera_interval=5,
        camera_fit="contain",
        camera_zoom=100,
        camera_pan_x=0,
        camera_pan_y=0,
        tap_trigger="release",
        hold_action={"action":"none","entity_id":"","view":""},
        hold_ms=700,
        tap_action={"action": "toggle" if kind == "switch" else "press" if kind == "button" else "none", "entity_id": "", "view": ""},
    )


TEXT_STYLE_DEFAULTS = {
    "card_style": "standard",
    "text_font": "auto",
    "text_weight": "auto",
    "text_italic": False,
    "text_underline": False,
    "text_scale": 100,
    "text_opacity": 1,
    "surface_opacity": 1,
    "card_accent_opacity": 1,
}


IMAGE_STYLE_DEFAULTS = {
    "image_background": "color",
    "image_scale_x": 100,
    "image_scale_y": 100,
    "image_lock_ratio": True,
}


def scene(
    background="aurora",
    elements=None,
    color="#101e30",
    accent="#6ee7d5",
    *,
    media_background_fit="contain",
):
    return dict(
        background=background,
        color=color,
        accent=accent,
        elements=elements or [],
        scroll_height=100,
        image_id="",
        image_fit="cover",
        image_dim=0.25,
        **IMAGE_STYLE_DEFAULTS,
        **WEATHER_STYLE_DEFAULTS,
        **TEXT_STYLE_DEFAULTS,
        gradient_angle=135,
        media_background_enabled=False,
        media_background_entity="",
        media_background_auto=True,
        media_background_fit=media_background_fit,
        media_background_color_source="edges",
        media_background_dim=0.35,
    )


def _block(kind, x, y, width, height, **values):
    item = element(kind, x, y, width, height)
    item.update(values)
    return item


def make_layout(style="cinema"):
    if style == "homekit":
        from .home_theme import home_layout
        return home_layout(make_layout("sand"))
    palettes = {
        "cinema": ("midnight", "#101827", "#8fb6ff"),
        "aurora": ("aurora", "#0b2228", "#79e5c0"),
        "morning": ("solar", "#382033", "#ffcfaa"),
        "sand": ("sand", "#e9e0cf", "#76654c"),
    }
    background, color, accent = palettes[style]
    light = style == "sand"
    ink, surface = ("#302c26", "#fffaf0") if light else ("#f2f6fa", "#122333")

    def block(kind, x, y, w, h, **kw):
        return _block(kind, x, y, w, h, color=ink, background=surface, **kw)

    overview = [
        block("clock", 5, 6, 40, 30, font_size=10, opacity=0, label="ZUHAUSE"),
        block("weather", 64, 7, 31, 28, label="Draußen", font_size=5),
        block("calendar", 5, 44, 53, 48, label="Was ansteht", font_size=3.3),
        block("entity", 64, 42, 31, 22, label="Raumklima", font_size=5),
        block(
            "text",
            64,
            70,
            31,
            22,
            label="WILLKOMMEN",
            text="Ein guter Ort, um anzukommen.",
            font_size=3,
        ),
    ]
    hdmi = _block("hdmi", 0, 0, 100, 100, opacity=0, radius=0)
    signal = (
        [deepcopy(hdmi)]
        if style == "cinema"
        else [
            block("clock", 4, 4, 27, 24, font_size=8, opacity=0),
            block("weather", 4, 34, 27, 26, label="Draußen", font_size=4.5),
            block("calendar", 4, 65, 27, 30, label="Als Nächstes", font_size=2.6),
            _block("hdmi", 35, 8, 61, 61, opacity=0, radius=0),
            block("entity", 35, 75, 28, 20, label="Zuhause", font_size=4),
            block(
                "text",
                67,
                75,
                29,
                20,
                text="Schön, dass du da bist.",
                opacity=0,
                font_size=3,
            ),
        ]
    )
    overlay = [deepcopy(hdmi), block("message", 60, 65, 36, 30, font_size=3.2)]
    pip = [
        _block("hdmi", 38, 24, 58, 58, opacity=0, radius=0),
        block("message", 4, 15, 30, 70, font_size=3.5),
        block("clock", 67, 3, 29, 17, font_size=5, opacity=0),
    ]
    fullscreen = [
        block("message", 8, 14, 84, 70, font_size=6, opacity=0),
        block("clock", 66, 2, 30, 12, font_size=4, opacity=0),
    ]
    dashboard = [
        block("clock", 5, 5, 32, 28, font_size=9, opacity=0, label="GUTEN MORGEN"),
        block(
            "weather",
            42,
            6,
            53,
            50,
            font_size=7,
            label="Dein Wetter",
            forecast_type="hourly",
            forecast_count=6,
            weather_style="sky",
        ),
        block("calendar", 5, 42, 32, 51, font_size=3.5, label="DEIN TAG"),
        block("entity", 42, 66, 24, 27, font_size=5, label="ZUHAUSE"),
        block(
            "text",
            71,
            66,
            24,
            27,
            font_size=2.8,
            opacity=0,
            text="Zeit für einen guten Start.",
        ),
    ]
    pip_view = (
        deepcopy(signal)
        if style != "cinema"
        else make_layout("aurora")["scenes"]["signal"]["elements"]
    )
    media_view = [
        block(
            "media",
            5,
            12,
            90,
            76,
            label="JETZT LÄUFT",
            font_size=8,
            opacity=0,
            media_style="stage",
            show_playback_icon=True,
            show_volume=False,
        ),
        block("clock", 74, 3, 21, 9, font_size=3, opacity=0, show_label=False),
    ]
    return {
        "schema": 1,
        "enabled": False,
        "mode": "auto",
        "signal_delay": 5,
        "sun_entity": "sun.sun",
        "scenes": {
            key: scene(
                "dawn" if key == "startup" and background == "solar" else background,
                items,
                color,
                accent,
                media_background_fit="colors" if key == "media_view" else "contain",
            )
            for key, items in zip(
                SCENES,
                (
                    signal,
                    overview,
                    dashboard,
                    overlay,
                    pip,
                    fullscreen,
                    pip_view,
                    media_view,
                    [deepcopy(hdmi)],
                    [
                        block("text", 10, 33, 80, 9, text="HOME ASSISTANT", font_size=2, align="center", opacity=0, show_label=False),
                        block("text", 10, 44, 80, 13, id="startup_title", text="Dein Display startet …", font_size=4.5, align="center", opacity=0, show_label=False),
                        block("text", 10, 59, 80, 9, id="startup_detail", text="Einen Moment bitte.", font_size=2.2, align="center", opacity=0, show_label=False),
                    ],
                ),
            )
        },
    }


def presets():
    result = [
        dict(id=key, name=name, description=description, layout=make_layout(key))
        for key, name, description in (
            (
                "cinema",
                "Cinema",
                "HDMI im Vollbild · dezente Meldungen · Übersicht ohne Signal",
            ),
            (
                "aurora",
                "Aurora",
                "Grüne Lichtflächen · HDMI neben Uhr, Wetter und Terminen",
            ),
            (
                "morning",
                "Sonnenstand",
                "Lebendiger Himmel · Farben und Licht folgen der Sonne",
            ),
            (
                "sand",
                "Paper & Sand",
                "Helle Flächen · klare Typografie · natürliche Farben",
            ),
        )
    ]
    result.append(dict(id="homekit", name="Home · Apple Home", description="Home-Kacheln · Glasflächen · farbige Gerätesymbole", layout=make_layout("homekit")))
    camera = make_layout("cinema")
    picture = element("camera", 0, 0, 100, 100)
    picture.update(camera_source="entity", camera_mode="auto", show_label=False,
                   radius=0, opacity=1)
    camera["scenes"]["dashboard"]["elements"] = [picture]
    result.append(dict(id="camera", name="Kamera", description="Home-Assistant-Kamera als eigene Ansicht", layout=camera))
    return result


def _number(value, low, high):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"Number must be between {low} and {high}")
    return round(value, 2)


def _text(value, limit):
    if (
        not isinstance(value, str)
        or len(value) > limit
        or any(ord(c) < 32 and c not in "\n\t" for c in value)
    ):
        raise ValueError("Invalid or oversized text")
    return value


def _choice(value, choices):
    if value not in choices:
        raise ValueError("Unsupported layout value")
    return value


def _color(value):
    if not isinstance(value, str) or not COLORS.fullmatch(value):
        raise ValueError("Use a six- or eight-digit hex color")
    return value.lower()


def validate_layout(value, *, camera_limit=1):
    if (
        not isinstance(value, dict)
        or value.get("schema") != 1
        or type(value.get("enabled")) is not bool
    ):
        raise ValueError("Unsupported layout document")
    result = dict(
        schema=1,
        enabled=value["enabled"],
        mode=_choice(value.get("mode"), ("auto", "signal", "no_signal")),
        signal_delay=_number(value.get("signal_delay"), 0, 30),
        sun_entity=_text(value.get("sun_entity", "sun.sun"), 255),
        scenes={},
    )
    if not isinstance(value.get("scenes"), dict):
        raise ValueError("Supply all layout scenes")
    if result["sun_entity"] and not re.fullmatch(
        r"sun\.[a-z0-9_]+", result["sun_entity"]
    ):
        raise ValueError("Select a sun entity")
    entities = set()
    extra = [key for key in value["scenes"] if key not in SCENES]
    if len([key for key in extra if key not in {"connecting", "updating"}]) > 24 or any(
        key not in {"connecting", "updating"} and not re.fullmatch(r"view_[a-zA-Z0-9_-]{1,35}", key) for key in extra
    ):
        raise ValueError("Invalid custom view IDs or too many custom views")
    for key in (*SCENES, *extra):
        raw = value.get("scenes", {}).get(key)
        if key == "startup" and raw is None:
            raw = make_layout()["scenes"]["startup"]
        if key == "hdmi_full" and raw is None:
            raw = make_layout()["scenes"]["hdmi_full"]
        if key == "media_view" and raw is None:
            raw = make_layout()["scenes"]["media_view"]
        if key == "pip_view" and raw is None:
            raw = deepcopy(value["scenes"].get("signal"))
        if key == "dashboard" and raw is None:
            raw = deepcopy(
                value["scenes"].get("no_signal")
            )  # Read existing 2.6 documents.
        if (
            not isinstance(raw, dict)
            or not isinstance(raw.get("elements"), list)
            or len(raw["elements"]) > 64
        ):
            raise ValueError("Each scene supports at most 64 elements")
        normalized = scene(
            _choice(raw.get("background"), BACKGROUNDS),
            [],
            _color(raw.get("color")),
            _color(raw.get("accent")),
        )
        if "element_palette" in raw:
            palette = raw["element_palette"]
            if not isinstance(palette, dict) or set(palette) != {"ink", "surface", "card_accent"}:
                raise ValueError("Invalid view element palette")
            normalized["element_palette"] = {key: _color(value) for key, value in palette.items()}
        image_id = raw.get("image_id", "")
        if not isinstance(image_id, str) or (
            image_id and not re.fullmatch(r"[a-f0-9]{64}", image_id)
        ):
            raise ValueError("Invalid background image")
        normalized.update(
            image_id=image_id,
            image_fit=_choice(raw.get("image_fit", "cover"), ("cover", "contain")),
            image_dim=_number(raw.get("image_dim", 0.25), 0, 0.9),
            gradient_angle=_number(raw.get("gradient_angle", 135), 0, 360),
        )
        normalized["scroll_height"] = _number(raw.get("scroll_height", 100), 100, 400)
        if normalized["scroll_height"] > 100 and any(i.get("kind") == "hdmi" for i in raw["elements"]):
            raise ValueError("HDMI views cannot scroll")
        normalized["card_style"] = _choice(raw.get("card_style", "standard"), ("standard", "homekit"))
        weather_entity = raw.get("weather_entity", "")
        if not isinstance(weather_entity, str) or (weather_entity and not re.fullmatch(r"weather\.[a-z0-9_]+", weather_entity)):
            raise ValueError("Select a weather entity for the background")
        normalized["weather_entity"] = weather_entity
        normalized["weather_condition"] = _choice(raw.get("weather_condition", "auto"), CONDITIONS)
        mode = _choice(raw.get("weather_precipitation_mode", "condition"), ("condition", "sensor", "hourly"))
        source = raw.get("weather_precipitation_entity", "")
        if not isinstance(source, str) or (source and not re.fullmatch(r"(?:weather|sensor|input_number)\.[a-z0-9_]+", source)):
            raise ValueError("Select a precipitation sensor or weather entity")
        if source and mode != "condition" and source.startswith("weather.") != (mode == "hourly"):
            raise ValueError("Precipitation source does not match the selected mode")
        normalized.update(weather_precipitation_mode=mode, weather_precipitation_entity=source)
        if normalized["background"] == "weather" and mode != "condition" and source:
            entities.add(source)
        for field in ("weather_animate", "weather_impact", "weather_accumulation", "glass"):
            if type(raw.get(field, WEATHER_STYLE_DEFAULTS[field])) is not bool:
                raise ValueError("Invalid weather/glass style")
            normalized[field] = raw.get(field, WEATHER_STYLE_DEFAULTS[field])
        if normalized["background"] == "weather" and weather_entity:
            entities.add(weather_entity)
        normalized.update(
            text_font=_choice(raw.get("text_font", "auto"), ("auto", *FONTS)),
            text_weight=_choice(raw.get("text_weight", "auto"), ("auto", "400", "500", "600", "700")),
            text_scale=_number(raw.get("text_scale", 100), 50, 200),
        )
        for field in ("text_italic", "text_underline"):
            if type(raw.get(field, False)) is not bool:
                raise ValueError("Invalid theme text style")
            normalized[field] = raw.get(field, False)
        for field in ("text_opacity", "surface_opacity", "card_accent_opacity"):
            normalized[field] = _number(raw.get(field, 1), 0, 1)
        locked = raw.get("image_lock_ratio", True)
        if type(locked) is not bool:
            raise ValueError("Invalid background image aspect ratio lock")
        scale_x = _number(raw.get("image_scale_x", 100), 1, 200)
        scale_y = _number(raw.get("image_scale_y", 100), 1, 200)
        normalized.update(
            image_background=_choice(raw.get("image_background", "color"), ("color", "edges")),
            image_scale_x=scale_x,
            image_scale_y=scale_x if locked else scale_y,
            image_lock_ratio=locked,
        )
        enabled = raw.get("media_background_enabled", False)
        player = _text(raw.get("media_background_entity", ""), 255)
        # An explicitly cleared player must not be suggested again by the editor.
        automatic = raw.get("media_background_auto", True)
        if type(enabled) is not bool or type(automatic) is not bool:
            raise ValueError("Invalid media background setting")
        if player and not re.fullmatch(r"media_player\.[a-z0-9_]+", player):
            raise ValueError("Select a media player for the background")
        if enabled and not player:
            raise ValueError("Select a media player for the background")
        normalized.update(
            media_background_enabled=enabled,
            media_background_entity=player,
            media_background_auto=automatic,
            media_background_fit=_choice(
                raw.get("media_background_fit", "contain"),
                ("stretch", "contain", "center", "colors"),
            ),
            media_background_color_source=_choice(
                raw.get("media_background_color_source", "edges"),
                ("edges", "cover"),
            ),
            media_background_dim=_number(raw.get("media_background_dim", 0.35), 0, 0.9),
        )
        if enabled and key not in ("signal", "no_signal"):
            entities.add(player)
        ids, hdmi, messages, cameras = set(), 0, 0, 0
        for item in raw["elements"]:
            if not isinstance(item, dict):
                raise ValueError("Invalid element")
            kind = _choice(item.get("kind"), KINDS)
            identifier = _text(item.get("id"), 40)
            if (
                not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", identifier)
                or identifier in ids
            ):
                raise ValueError("Element IDs must be unique within a scene")
            ids.add(identifier)
            hdmi += kind == "hdmi"
            cameras += kind == "camera"
            messages += kind == "message"
            obj = dict(id=identifier, kind=kind)
            for preference in ("lock_ratio", "manual_size", "grid_size", "tile_surface", "tap_auto", "style_override", "weather_reactive"):
                if preference in item:
                    if type(item[preference]) is not bool:
                        raise ValueError("Invalid size preference")
                    obj[preference] = item[preference]
            for field in ("x", "y", "width", "height"):
                obj[field] = _number(
                    item.get(field), .01 if field in ("width", "height") else 0, normalized["scroll_height"] if field == "y" else 100
                )
            if obj["x"] + obj["width"] > 100.01 or obj["y"] + obj["height"] > normalized["scroll_height"] + .01:
                raise ValueError("Elements must fit inside the screen")
            obj.update(
                label=_text(item.get("label", ""), 100),
                text=_text(item.get("text", ""), 2000),
                color=_color(item.get("color")),
                background=_color(item.get("background")),
                font_size=_number(item.get("font_size"), 1, 18),
                opacity=_number(item.get("opacity"), 0, 1),
                radius=_number(item.get("radius"), 0, 80),
                font=_choice(item.get("font"), tuple(FONTS)),
                align=_choice(item.get("align"), ("left", "center", "right")),
            )
            if "content_padding" in item:
                obj["content_padding"] = _number(item["content_padding"], 0, 25)
            if "card_style" in item:
                obj["card_style"] = _choice(item["card_style"], ("inherit", "standard", "homekit"))
            theme_id = _text(item.get("element_theme", ""), 48)
            if theme_id and not re.fullmatch(r"[a-zA-Z0-9_-]+", theme_id):
                raise ValueError("Invalid element theme")
            if "element_theme" in item:
                obj["element_theme"] = theme_id
            from .home_theme import SPEC, KINDS as HOME_KINDS, VARIANTS
            if kind in HOME_KINDS and ("home_variant" in item or "home_icon" in item):
                obj["home_variant"] = _choice(item.get("home_variant", "compact"), VARIANTS)
                obj["home_icon"] = _choice(item.get("home_icon", "auto"), ("auto", *SPEC["icons"]))
            if kind == "logo":
                from .graphics import catalog, validate_graphic
                # Old logo geometry is preserved until explicitly edited.
                if "graphic_id" in item:
                    obj["graphic_id"] = _choice(item["graphic_id"], (*catalog(), "custom"))
                    if obj["graphic_id"] == "custom":
                        obj["graphic"] = validate_graphic(item.get("graphic"))
                obj["label"] = "Grafik · " + ("Custom" if obj.get("graphic_id") == "custom" else catalog()[obj.get("graphic_id", "esphome")]["name"])
            if kind == "text":
                if "update_role" in item:
                    obj["update_role"] = _choice(item["update_role"], ("none", "status", "percent"))
                obj["text_line_height"] = _number(item.get("text_line_height", 1.35), .8, 3)
            if kind == "spinner":
                obj["spinner_duration"] = _number(item.get("spinner_duration", 1000), 250, 10000)
            if kind == "animation":
                obj["animation_type"] = _choice(item.get("animation_type", "spinner"), tuple(ANIMATIONS))
                obj["animation_duration"] = _number(item.get("animation_duration", 1000), 250, 10000)
            if kind in {"progress", "animation"}:
                obj["progress_value"] = _number(item.get("progress_value", 60), 0, 100)
                if "progress_highlight" in item:
                    obj["progress_highlight"] = _choice(item["progress_highlight"], ("auto", "white", "black"))
                obj["progress_source"] = _choice(item.get("progress_source", "boot" if kind == "progress" else "fixed"), ("boot", "fixed", "entity"))
                if obj["progress_source"] == "entity" or "progress_min" in item or "progress_max" in item:
                    obj["progress_min"] = _number(item.get("progress_min", 0), -1e9, 1e9)
                    obj["progress_max"] = _number(item.get("progress_max", 100), -1e9, 1e9)
                    if obj["progress_max"] <= obj["progress_min"]:
                        raise ValueError("Progress maximum must exceed minimum")
                if obj["progress_source"] == "entity" and kind == "animation" and obj["animation_type"] != "progress":
                    raise ValueError("Only progress animations support an entity source")
            if type(item.get("animate", True)) is not bool:
                raise ValueError("Invalid animation setting")
            count = item.get("forecast_count", 4)
            if type(count) is not int or not 1 <= count <= 8:
                raise ValueError("Use 1–8 forecast periods")
            obj.update(
                forecast_type=_choice(
                    item.get("forecast_type", "daily"), ("current", "daily", "hourly")
                ),
                forecast_count=count,
                animate=item.get("animate", True),
                weather_style=_choice(
                    item.get("weather_style", "glass"), ("glass", "sky", "minimal")
                ),
            )
            for flag in (
                "show_cover",
                "show_progress",
                "show_volume",
                "status_coloring",
            ):
                if type(item.get(flag, True)) is not bool:
                    raise ValueError("Invalid card option")
                obj[flag] = item.get(flag, True)
            if type(item.get("show_playback_icon", False)) is not bool:
                raise ValueError("Invalid playback icon option")
            obj["show_playback_icon"] = item.get("show_playback_icon", False)
            obj.update(
                camera_source=_choice(
                    item.get("camera_source", "test"), ("test", "entity", "multicast", "local")
                ),
                camera_mode=_choice(
                    item.get("camera_mode", "auto"), ("auto", "stream", "snapshot")
                ),
                camera_interval=_number(item.get("camera_interval", 5), 1, 300),
                camera_zoom=_number(item.get("camera_zoom", 100), 100, 400),
                camera_pan_x=_number(item.get("camera_pan_x", 0), -100, 100),
                camera_pan_y=_number(item.get("camera_pan_y", 0), -100, 100),
                camera_fit=_choice(
                    item.get("camera_fit", "contain"), ("contain", "cover")
                ),
            )
            if kind == "camera":
                if "camera_fullscreen" in item:
                    full = item["camera_fullscreen"]
                    if not isinstance(full, dict) or set(full)-{"parts","camera_fit","camera_zoom","camera_pan_x","camera_pan_y"}:
                        raise ValueError("Invalid fullscreen camera settings")
                    if not isinstance(full.get("parts", {}), dict) or set(full.get("parts", {})) - {"label","picture"}:
                        raise ValueError("Invalid fullscreen camera parts")
                    obj["camera_fullscreen"] = {"parts":validate_parts(full.get("parts", {}), "camera"),
                        "camera_fit":_choice(full.get("camera_fit", "contain"), ("contain","cover")),
                        "camera_zoom":_number(full.get("camera_zoom",100),100,400),
                        "camera_pan_x":_number(full.get("camera_pan_x",0),-100,100),
                        "camera_pan_y":_number(full.get("camera_pan_y",0),-100,100)}
                if "camera_size" in item:
                    obj["camera_size"] = _choice(item["camera_size"], ("camera_small", "camera_medium", "camera_large"))
                if "camera_lock_aspect" in item:
                    if type(item["camera_lock_aspect"]) is not bool:
                        raise ValueError("Invalid camera aspect binding")
                    obj["camera_lock_aspect"] = item["camera_lock_aspect"]
                if "camera_aspect_ratio" in item:
                    _number(item["camera_aspect_ratio"], .1, 10)
                    obj["camera_aspect_ratio"] = float(item["camera_aspect_ratio"])
            obj["multicast_url"] = validate_multicast_url(
                item.get("multicast_url", ""),
                required=kind == "camera" and obj["camera_source"] == "multicast",
            )
            obj["media_style"] = _choice(
                item.get("media_style", "compact"), ("compact", "poster", "stage")
            )
            if "text_opacity" in item:
                obj["text_opacity"] = _number(item["text_opacity"],0,1)
            obj["accent_color"] = _color(item.get("accent_color", "#79e5c0"))
            if type(item.get("show_label")) is not bool:
                raise ValueError("Invalid label visibility")
            obj["show_label"] = False if kind == "logo" else item["show_label"]
            if kind in {"animation", "spinner", "progress"}:
                variant = obj["animation_type"] if kind == "animation" else kind
                obj["label"] = "Animation · " + ANIMATIONS[variant]["label"]
                obj["show_label"] = False
            entity_id = "" if kind == "camera" and obj["camera_source"] == "local" else _text(item.get("entity_id", ""), 255)
            if entity_id:
                if not ENTITY.fullmatch(entity_id) or kind not in (
                    "animation",
                    "progress",
                    "control",
                    "entity",
                    "status",
                    "switch",
                    "button",
                    "media",
                    "weather",
                    "calendar",
                    "camera",
                ):
                    raise ValueError("Invalid entity binding")
                if kind == "media" and not entity_id.startswith("media_player."):
                    raise ValueError("Select a media player")
                if kind in (
                    "weather",
                    "calendar",
                    "camera",
                ) and not entity_id.startswith(kind + "."):
                    raise ValueError("Select a matching weather/calendar/camera entity")
                if key not in ("signal", "no_signal"):
                    entities.add(entity_id)
            if kind in {"animation", "progress"} and entity_id:
                if obj["progress_source"] != "entity" or entity_id.split(".")[0] not in {"sensor", "number", "input_number", "counter"}:
                    raise ValueError("Select a numeric progress entity")
            if kind == "switch" and entity_id and entity_id.split(".")[0] not in {"switch", "light", "input_boolean"}:
                raise ValueError("Select a switch, light or input boolean")
            if kind == "button" and entity_id and entity_id.split(".")[0] not in {"button", "input_button"}:
                raise ValueError("Select a button or input button")
            if kind == "media":
                from .media_widget import SPEC
                if type(item.get("media_controls", False)) is not bool:
                    raise ValueError("Invalid media controls")
                obj["media_controls"] = item.get("media_controls", False)
                remote = item.get("media_remote_view", "")
                if not isinstance(remote, str) or (remote and not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", remote)):
                    raise ValueError("Invalid media remote view")
                obj["media_remote_view"] = remote
                hidden = item.get("media_controls_hidden", [])
                if not isinstance(hidden, list) or any(not isinstance(v,str) or v not in {c["key"] for c in SPEC["controls"]} for v in hidden):
                    raise ValueError("Invalid media control selection")
                obj["media_controls_hidden"] = sorted(set(hidden))
            if kind == "media" and "media_av_auto" in item:
                if type(item.get("media_av_auto", False)) is not bool:
                    raise ValueError("Invalid automatic AV routing")
                obj["media_av_auto"] = item.get("media_av_auto", False)
            if kind == "control":
                obj["control_type"] = _choice(item.get("control_type", "icon"), ("icon", "slider", "source"))
                symbol = item.get("control_icon", "play")
                if isinstance(symbol,str) and symbol.startswith("mdi:"):
                    obj["symbol_art"] = deepcopy(mdi_geometry(symbol))
                    obj["control_icon"] = symbol
                else:
                    obj["control_icon"] = _choice(symbol, tuple(CONTROL_SYMBOLS))
                if obj["control_type"] == "icon":
                    if "symbol_fit" in item:
                        obj["symbol_fit"] = _choice(item["symbol_fit"], ("tight", "legacy"))
                    obj["label"] = "Symbole · " + CONTROL_SYMBOLS.get(obj["control_icon"],obj["control_icon"])
                    if "symbol_button" in item:
                        if type(item["symbol_button"]) is not bool: raise ValueError("Invalid symbol button")
                        obj["symbol_button"] = item["symbol_button"]
                    obj["symbol_button_shape"] = _choice(item.get("symbol_button_shape", "round"), ("round", "rounded"))
                    if "symbol_state_coloring" in item:
                        if type(item["symbol_state_coloring"]) is not bool:
                            raise ValueError("Invalid symbol state coloring")
                        obj["symbol_state_coloring"] = item["symbol_state_coloring"]
                    if "symbol_state_colors" in item:
                        colors = item["symbol_state_colors"]
                        if not isinstance(colors, dict) or len(colors) > 256:
                            raise ValueError("Invalid symbol state colors")
                        obj["symbol_state_colors"] = {}
                        for state, color in colors.items():
                            state = _text(state, 255)
                            if not state.strip() or any(ord(c) < 32 for c in state):
                                raise ValueError("Invalid symbol state")
                            obj["symbol_state_colors"][state] = _color(color)
                    obj["show_label"] = False
                if obj["control_type"] != "icon" and entity_id and not entity_id.startswith("media_player."):
                    raise ValueError("Select an AV media player")
            obj["entity_id"] = entity_id
            obj["tap_action"] = validate_tap_action(item.get("tap_action"), kind, entity_id)
            obj["tap_trigger"] = _choice(item.get("tap_trigger", "release"), ("press", "release"))
            obj["hold_action"] = validate_tap_action(item.get("hold_action", {"action": "none"}), kind, entity_id)
            obj["hold_ms"] = round(_number(item.get("hold_ms", 700), 300, 5000))
            if obj["hold_action"]["action"] in {"av_volume_set", "av_select_source", "camera_fullscreen"}:
                raise ValueError("Hold requires a discrete action")
            if kind == "control" and obj["control_type"] in {"slider", "source"} and obj["hold_action"]["action"] != "none":
                raise ValueError("Value controls do not support hold actions")
            if obj["hold_action"]["entity_id"]:
                entities.add(obj["hold_action"]["entity_id"])
            if kind == "control" and obj["control_type"] in {"slider", "source"}:
                expected = "av_volume_set" if obj["control_type"] == "slider" else "av_select_source"
                if obj["tap_action"]["action"] != expected:
                    raise ValueError("Control action must match its type")
            if kind == "control" and obj["control_type"] == "icon" and obj["tap_action"]["action"] in {"av_volume_set", "av_select_source"}:
                raise ValueError("Use a slider or source selector for value actions")
            if obj["tap_action"]["entity_id"]:
                entities.add(obj["tap_action"]["entity_id"])
            if "parts" in item:
                obj["parts"] = validate_parts(item["parts"], kind)
            if "widget_template" in item:
                reference = item["widget_template"]
                if not isinstance(reference, str) or not re.fullmatch(r"widget_[a-zA-Z0-9_-]{1,60}", reference):
                    raise ValueError("Invalid widget template reference")
                obj["widget_template"] = reference
            if kind == "clock":
                if "clock_gap" in item:
                    obj["clock_gap"] = _number(item["clock_gap"], 0, 40)
                if "clock_size" in item:
                    if item["clock_size"] not in ("clock_small", "clock_medium", "clock_large", "clock_extra_large"):
                        raise ValueError("Invalid clock preset")
                    obj["clock_size"] = item["clock_size"]
                if "clock_base_height" in item:
                    base_height = item["clock_base_height"]
                    if type(base_height) not in (int, float) or not math.isfinite(base_height) or not .01 <= base_height <= 100:
                        raise ValueError("Invalid clock base height")
                    obj["clock_base_height"] = base_height
                for field in ("clock_seconds", "clock_blink"):
                    if field in item:
                        if type(item[field]) is not bool:
                            raise ValueError("Invalid clock option")
                        obj[field] = item[field]
                for field, choices in (("clock_time_format", ("24h", "12h")), ("clock_date_format", ("long", "short", "weekday", "iso"))):
                    if field in item:
                        obj[field] = _choice(item[field], choices)
            normalized["elements"].append(obj)
        if cameras > camera_limit:
            raise ValueError("Use one additional camera/video element at most per scene" if camera_limit==1 else f"Use at most {camera_limit} camera elements per scene")
        if camera_limit>1:
            local=any(i["kind"]=="camera" and i["camera_source"]=="local" for i in normalized["elements"])
            streams=sum(i["kind"]=="camera" and i["camera_source"]!="local" and i["camera_mode"]!="snapshot" for i in normalized["elements"])
            if streams>4-int(local):
                raise ValueError("Use at most three external live streams with the board camera, or four without it; additional cameras can use snapshots")
        if hdmi > 1 or messages > 1:
            raise ValueError("Use one HDMI and one message element at most per scene")
        video = next(
            (item for item in normalized["elements"] if item["kind"] == "camera"), None
        )
        hdmi_item = next(
            (item for item in normalized["elements"] if item["kind"] == "hdmi"), None
        )
        if (
            video
            and hdmi_item
            and rectangles_overlap(video, hdmi_item)
            and (video["camera_source"] != "entity" or video["camera_mode"] == "stream")
        ):
            raise ValueError(
                "Place the camera stream beside HDMI; use automatic/snapshot mode for overlays"
            )
        if key in {"startup", "connecting", "updating"}:
            validate_startup_scene(normalized)
        result["scenes"][key] = normalized
    if len(entities) > 32:
        raise ValueError("Select no more than 32 distinct entities")
    if "power" in value:
        from .display_power import validate_power
        result["power"] = validate_power(value["power"], result["scenes"])
    return result


def rectangles_overlap(first, second):
    return (
        first["x"] < second["x"] + second["width"]
        and second["x"] < first["x"] + first["width"]
        and first["y"] < second["y"] + second["height"]
        and second["y"] < first["y"] + first["height"]
    )


def active_scenes(config):
    """Legacy automatic HDMI layouts remain editable, but no longer run."""
    return {
        key: scene
        for key, scene in config["scenes"].items()
        if key not in ("signal", "no_signal")
    }


def layout_entities(config):
    return media_background_entities(config) | {
        scene["weather_precipitation_entity"] for scene in active_scenes(config).values()
        if scene.get("background") == "weather" and scene.get("weather_precipitation_mode", "condition") != "condition" and scene.get("weather_precipitation_entity")
    } | {
        item.get(gesture, {}).get("entity_id")
        for scene in active_scenes(config).values()
        for item in scene["elements"]
        for gesture in ("tap_action", "hold_action")
        if item.get(gesture, {}).get("entity_id")
    } | {
        scene["weather_entity"]
        for scene in active_scenes(config).values()
        if scene.get("background") == "weather" and scene.get("weather_entity")
    } | {
        item["entity_id"]
        for scene in active_scenes(config).values()
        for item in scene["elements"]
        if item["entity_id"]
    }


def media_background_entities(config):
    """Only enabled bindings in assigned, active views may reach the display."""
    return {
        scene["media_background_entity"]
        for scene in active_scenes(config).values()
        if scene.get("media_background_enabled")
        and scene.get("media_background_entity")
    }


def validate_multicast_url(value, *, required=False):
    """Only administratively scoped IPv4 groups; never credentials or unicast."""
    if value == "" and not required:
        return ""
    try:
        if (
            not isinstance(value, str)
            or len(value) > 80
            or any(c.isspace() for c in value)
        ):
            raise ValueError
        url = urlsplit(value)
        host = ipaddress.IPv4Address(url.hostname)
        if (
            url.scheme != "udp"
            or host not in ipaddress.IPv4Network("239.0.0.0/8")
            or not url.port
            or url.username is not None
            or url.password is not None
            or url.path
            or url.query
            or url.fragment
        ):
            raise ValueError
        return f"udp://{host}:{url.port}"
    except (ValueError, TypeError, AttributeError):
        raise ValueError(
            "Use udp://239.x.x.x:port without credentials, path or query"
        ) from None


from .av_schema import AV_ACTIONS, PLAYER_ACTIONS

# One shared action schema for all output adapters. Never store arbitrary services.
ACTION_DOMAINS = {
    "home_primary": {"cover", "fan", "climate"},
    "home_adjust": {"light", "cover", "climate", "fan", "media_player"},
    **{action: set(spec["domains"]) for action,spec in ENTITY_ACTIONS.items()},
    **{action: {"media_player"} for action in AV_ACTIONS | PLAYER_ACTIONS},
}


def validate_tap_action(value, kind="text", entity_id=""):
    if value is None:
        value = {"action": "toggle" if kind == "switch" else "press" if kind == "button" else "none"}
    if not isinstance(value, dict) or set(value) - {"action", "entity_id", "view"}:
        raise ValueError("Invalid touch action")
    action = _choice(value.get("action", "none"), ("none", "show_view", "camera_fullscreen", *ACTION_DOMAINS))
    target = _text(value.get("entity_id") or (entity_id if action in ACTION_DOMAINS else ""), 255)
    view = _text(value.get("view", ""), 80)
    if action in ACTION_DOMAINS and (not ENTITY.fullmatch(target) or target.split(".")[0] not in ACTION_DOMAINS[action]):
        # Empty bindings are valid editor drafts but cannot execute.
        if target:
            raise ValueError("Select a matching touch entity")
    if action == "camera_fullscreen" and kind != "camera":
        raise ValueError("Camera fullscreen requires a camera widget")
    if action == "show_view" and not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", view):
        raise ValueError("Select a touch target view")
    if action not in ACTION_DOMAINS and target or action != "show_view" and view:
        raise ValueError("Unexpected touch target")
    return {"action": action, "entity_id": target, "view": view}
