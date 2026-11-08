"""Expand one editable player into the same bounded native/browser controls.

Virtual children are never persisted. Authorization derives them from the saved
parent on every request, so clients cannot choose arbitrary services or targets.
"""
from copy import deepcopy
import json
from pathlib import Path

SPEC = json.loads(Path(__file__).with_name("media_widget.json").read_text())


BOX = ("x", "y", "width", "height")


def manual_box(part, default):
    """Default frames saved by older editors remain eligible for reflow."""
    return all(key in part for key in BOX) and any(abs(part[key]-default[key]) > .01 for key in BOX)


def layout(source):
    """Reflow automatic controls; preserve deliberately positioned frames."""
    settings = SPEC["layout"]
    overrides = source.get("parts", {})
    controls = []
    for control in SPEC["controls"]:
        conf = overrides.get("control_"+control["key"], {})
        if control["key"] in source.get("media_controls_hidden", []) or conf.get("visible") is False:
            continue
        box = {**control, **{k:v for k,v in conf.items() if k not in BOX}}
        if manual_box(conf, control):
            box.update({k:conf[k] for k in BOX})
            box["manual"] = True
        controls.append(box)
    rows = [[c for c in controls if c["key"] in keys] for keys in settings["rows"]]
    # Empty rows return their space to the cover and metadata.
    if rows[0] and not rows[1]:
        for control in rows[0]:
            if not control.get("manual"):
                control["y"] += 20
    for index, row in enumerate(rows):
        if not row or len(row) == len(settings["rows"][index]):
            continue
        auto = [c for c in row if not c.get("manual")]
        if not auto:
            continue
        top = min(c["y"] for c in auto)
        bottom = max(c["y"]+c["height"] for c in auto)
        slots = [(settings["left"], settings["right"])]
        # Avoid placing automatic controls over manually arranged controls.
        for fixed in controls:
            if not fixed.get("manual") or fixed["y"] >= bottom or fixed["y"]+fixed["height"] <= top:
                continue
            left, right = fixed["x"]-settings["gap"], fixed["x"]+fixed["width"]+settings["gap"]
            slots = [(lo, hi) for a,b in slots for lo,hi in ((a,min(b,left)),(max(a,right),b)) if hi > lo]
        if not slots:
            continue
        left, right = max(slots, key=lambda slot: slot[1]-slot[0])
        span = right-left
        gap = min(settings["gap"], span/(len(auto)*2))
        available = max(.01, span-gap*(len(auto)-1))
        width = sum(c["width"] for c in auto)
        flex = [c for c in auto if c["key"] in settings["flex"]]
        if width > available:
            for control in auto:
                control["width"] *= available/width
        elif flex:
            weight = sum(c["width"] for c in flex)
            for control in flex:
                control["width"] += (available-width)*control["width"]/weight
        used = sum(c["width"] for c in auto)+gap*(len(auto)-1)
        x = left+(span-used)/2
        for control in auto:
            control["x"] = x
            x += control["width"]+gap
    bottom = 53 if rows[0] and rows[1] else 73 if rows[0] else 76 if rows[1] else 95
    scale = (bottom-settings["top"])/(settings["content_bottom"]-settings["top"])
    parts = deepcopy(SPEC["parts"])
    cover = source.get("show_cover", True) and overrides.get("cover", {}).get("visible") is not False
    for key, part in parts.items():
        if "y" in part:
            part["y"] = settings["top"]+(part["y"]-settings["top"])*scale
            part["height"] *= scale
        if not cover and key in {"label", "title", "artist", "album", "progress"}:
            part.update(x=settings["left"], width=settings["right"]-settings["left"])
    for key, conf in overrides.items():
        if key.startswith("control_"):
            continue
        conf = deepcopy(conf)
        if key in SPEC["parts"] and all(k in SPEC["parts"][key] for k in BOX) and not manual_box(conf, SPEC["parts"][key]):
            conf = {k:v for k,v in conf.items() if k not in BOX}
        parts[key] = {**parts.get(key, {}), **conf}
    return {"parts": parts, "controls": controls}


def expand(scene, values=None):
    if scene.get("_media_expanded"):
        return scene
    result = {**scene, "elements": [], "_media_expanded": True}
    for source in scene.get("elements", []):
        if source["kind"] != "media" or not source.get("media_controls", False):
            result["elements"].append(source)
            continue
        data = (values or {}).get(source.get("entity_id"), {})
        routed = source.get("media_av_auto") or data.get("av_routed")
        source = {**source, "media_av_auto": bool(routed)}
        remote_state = data.get("av_remote_state" if routed else "state")
        if not source.get("media_remote_view") or remote_state in {"off", "standby", "unavailable", "unknown"}:
            source["media_controls_hidden"] = [*source.get("media_controls_hidden", []), "remote"]
        available = data.get("av_available_actions" if routed else "player_available_actions")
        if isinstance(available, list):
            prefix = "av_" if routed else "player_"
            source["media_controls_hidden"] = list(set(source.get("media_controls_hidden", [])) | {
                c["key"] for c in SPEC["controls"] if c["key"] != "remote" and prefix+c["key"] not in available
            })
        item = deepcopy(source)
        arranged = layout(source)
        item["parts"] = arranged["parts"]
        item.update(show_volume=False, show_playback_icon=False, tap_action={"action":"none","entity_id":"","view":""})
        result["elements"].append(item)
        controls = sorted(arranged["controls"], key=lambda c: source.get("parts", {}).get("control_"+c["key"], {}).get("z_index", 2))
        for c in controls:
            conf = source.get("parts", {}).get("control_"+c["key"], {})
            box = c
            if c["key"] in source.get("media_controls_hidden", []) or conf.get("visible") is False:
                continue
            remote = c["key"] == "remote"
            view = source.get("media_remote_view", "") if remote else ""
            action = ("show_view" if view else "none") if remote else ("av_" if source.get("media_av_auto") else "player_") + c["key"]
            child = {**source, "id":source["id"]+"/media/"+c["key"], "kind":"control",
                     "label":c["label"], "show_label":False, "parts":{}, "content_padding":0,
                     "control_type":c["icon"] if c["icon"] in {"slider","source"} else "icon",
                     "control_icon":c["icon"] if c["icon"] not in {"slider","source"} else "volume",
                     "symbol_button":False,"symbol_fit":"tight", "_media_control":True, "opacity":0,"radius":0,
                     "font_size":max(.5, source["height"]*.045), "align":"center",
                     "weather_interaction":False,
                     "hold_action":{"action":"none","entity_id":"","view":""},
                     "tap_action":{"action":action,"entity_id":"" if remote else source.get("entity_id",""),"view":view}}
            for axis, size in (("x","width"),("y","height")):
                child[axis] = source[axis]+source[size]*box[axis]/100
                child[size] = source[size]*box[size]/100
            child["text_opacity"] = source.get("text_opacity", 1) * conf.get("opacity", 1)
            if "color" in conf:
                child["color"] = conf["color"]
            if "art" in c:
                child["symbol_art"] = c["art"]
            result["elements"].append(child)
    return result
