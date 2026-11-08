"""Compile the shared Studio model into native LVGL objects, never screen pixels."""
from .weather_sources import resolve as resolve_weather
from copy import deepcopy
from datetime import datetime
import hashlib
import json
from zoneinfo import ZoneInfo
from pathlib import Path
import re
import math
from .lvgl_geometry import arrange, pixels, camera_tile_size
from .color import native_colors, opaque
from .moon import illumination
from . import home_theme, weather_background
from .symbols import mdi_geometry

PROTOCOL = 2
SCHEMA = 6
MAX_SCENE_BYTES = 128 * 1024
MAX_NATIVE_WIDGETS = 144  # Two 64-element views plus native background/artwork layers.
def shared_palette(filename, marker):
    source = (Path(__file__).parent / "www/runtime" / filename).read_text()
    return json.loads(re.search(r"/\* " + marker + r"_BEGIN \*/(.*?)/\* " + marker + r"_END \*/", source).group(1))


CONTROL_ICONS = shared_palette("layout.js", "CONTROL_ICONS")
CONTROL_FILLED_ICONS = shared_palette("layout.js", "CONTROL_FILLED_ICONS")


def control_basis(item):
    symbol=item.get("control_icon", "play");action=item.get("tap_action", {}).get("action")
    if action in {"av_play_pause", "av_remote_play_pause", "media_play_pause", "player_play_pause"} and symbol in {"play", "pause"}:return "play_pause"
    if action in {"av_mute", "media_mute", "player_mute"} and symbol in {"volume", "mute"}:return "volume_mute"
    return symbol


def control_symbol(item,value):
    basis=control_basis(item)
    if basis=="play_pause":return "pause" if value.get("av_remote_state" if item.get("tap_action", {}).get("action")=="av_remote_play_pause" else "state")=="playing" else "play"
    if basis=="volume_mute":return "mute" if value.get("is_volume_muted") else "volume"
    return item.get("control_icon", "play")


def control_color(item, value):
    colors = item.get("symbol_state_colors", {})
    state = str(value.get("state", "unknown"))
    if item.get("symbol_state_coloring") and state in colors:
        return colors[state]
    if item.get("tap_action", {}).get("action") == "av_power" and value.get("av_power") not in {None, "off", "unavailable"}:
        return item.get("accent_color", "#79e5c0")
    return item["color"]


def control_geometry(symbol,basis):
    if symbol.startswith("mdi:"):return mdi_geometry(symbol)
    if symbol in CONTROL_FILLED_ICONS:return CONTROL_FILLED_ICONS[symbol]
    variants={"play_pause":["play","pause"],"volume_mute":["volume","mute"]}.get(basis,[basis])
    points=[p for name in variants for path in CONTROL_ICONS[name] for p in path]
    left,right=min(p[0] for p in points),max(p[0] for p in points)
    top,bottom=min(p[1] for p in points),max(p[1] for p in points)
    scale=75/max(right-left,bottom-top);cx,cy=(left+right)/2,(top+bottom)/2
    return {"width":(right-left)*scale+5,"height":(bottom-top)*scale+5,
            "paths":[[[(p[0]-cx)*scale+40,(p[1]-cy)*scale+40] for p in path] for path in CONTROL_ICONS[symbol]]}


def control_paths(item,symbol):
    from .media_widget import SPEC
    if item.get("_media_control") and symbol in SPEC["icons"]:
        return SPEC["icons"][symbol]["paths"]
    return control_geometry(symbol,control_basis(item))["paths"] if item.get("symbol_fit")=="tight" or item.get("symbol_button") or symbol not in CONTROL_ICONS else CONTROL_ICONS[symbol]

BACKGROUND_PRESETS = shared_palette("layout.js", "BACKGROUND_PRESETS")
SKY_PALETTE = shared_palette("weather.js", "SKY_PALETTE")
CONDITIONS = shared_palette("weather.js", "CONDITIONS")


def touch_available(action, state):
    if isinstance(state, dict):
        if action.get("action", "").startswith("player_"):
            return action["action"] in state.get("player_available_actions", [])
        if action.get("action", "").startswith("av_"):
            return action["action"] in state.get("av_available_actions", [])
        state = state.get("state")
    return state is not None and state != "unavailable" and (state != "unknown" or action.get("action") in {"press", "activate"})


def background_paint(scene, sun, weather=None):
    name = scene.get("background")
    if name == "weather":
        return weather_background.overcast_paint(weather, sun) or background_paint({**scene, "background": "solar"}, sun or {"is_daytime": (weather or {}).get("state") != "clear-night", "elevation": -20 if (weather or {}).get("state") == "clear-night" else 35})
    if name == "gradient":
        paint = [{"kind": "linear", "angle": scene.get("gradient_angle", 0), "stops": [[0, "$color", 1], [1, "$accent", 1]]}]
    elif name == "solar":
        e = sun.get("elevation", 30 if sun.get("is_daytime") else -18)
        levels = SKY_PALETTE["levels"]
        def palette(name):
            return [v if isinstance(v, list) else v["rising" if sun.get("rising") else "setting"] for v in SKY_PALETTE[name]]
        tops, bottoms = palette("tops"), palette("bottoms")
        i = 0
        while i < 3 and e > levels[i + 1]:
            i += 1
        t = max(0, min(1, (e - levels[i]) / (levels[i + 1] - levels[i])))
        def mix(colors):
            return "#" + "".join(f"{math.floor(a + (b-a)*t + .5):02x}" for a,b in zip(colors[i],colors[i+1]))
        x = math.floor(sun["azimuth"] / 360 * 80 + 10 + .5) / 100 if "azimuth" in sun else .65
        alpha = math.floor((max(0, 1-abs(e-3)/22)*.2 + (.06 if e > 0 else 0))*1000 + .5) / 1000
        paint = [{"kind":"radial", "x":x, "y":math.floor(max(15,75-e)+.5)/100, "stops":[[0,"#ffcd9b",alpha],[.65,"#ffcd9b",0]]}, {"kind":"linear", "angle":160, "stops":[[0,mix(tops),1],[1,mix(bottoms),1]]}]
    else:
        paint = deepcopy(BACKGROUND_PRESETS.get(name, []))
    for layer in paint:
        for stop in layer["stops"]:
            stop[1] = scene.get(stop[1][1:], "#101e30") if stop[1].startswith("$") else stop[1]
    return paint


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()



def present(value):
    return value is not None and value != ""


def weather_icon(condition, day):
    if condition in {"sunny","clear","clear-night"}:return "moon" if day is False else "sun"
    if condition=="partlycloudy":return "nightcloud" if day is False else "partly"
    if condition in {"rainy","pouring"}:return "rain"
    if condition in {"snowy","snowy-rainy","hail"}:return "snow"
    if condition in {"lightning","lightning-rainy"}:return "storm"
    if condition=="fog":return "fog"
    if condition in {"windy","windy-variant"}:return "wind"
    return "cloud"


DAYS = ("Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag")
MONTHS = ("Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember")


def date_text(now, mode):
    if mode=="iso":return now.strftime("%Y-%m-%d")
    if mode=="short":return now.strftime("%d.%m.%Y")
    if mode=="weekday":return DAYS[now.weekday()]
    return f"{DAYS[now.weekday()]}, {now.day}. {MONTHS[now.month-1]}"


def forecast_date(value, mode, timezone):
    try:
        date=datetime.fromisoformat(value.replace("Z","+00:00"))
        if date.tzinfo is None:date=date.replace(tzinfo=ZoneInfo(timezone))
        date=date.astimezone(ZoneInfo(timezone))
        if mode=="hourly":return date.strftime("%H:%M")
        if mode=="calendar":return date.strftime("%d.%m. %H:%M")
        return f"{DAYS[date.weekday()][:2]}., {date.day:02d}."
    except (ValueError,TypeError,AttributeError):return ""


def compile_scene(state, width, height):
    payload = state.get("layout") or {}
    scenes = payload.get("config", {}).get("scenes", {})
    selected = state.get("view", "dashboard")
    values = payload.get("values", {})
    now = datetime.fromisoformat(payload["now"]).astimezone(ZoneInfo(payload.get("timezone", "UTC"))) if payload.get("now") else datetime.now(ZoneInfo("UTC"))
    message = state.get("message")
    layers = [(selected, scenes.get(selected, {"color": "#101e30", "elements": []}))]
    if message:
        notification = message["layout"]
        if notification in {"fullscreen","pip"}:
            layers = []
        layers.append((notification, scenes.get(notification, {"color": "#101e30", "elements": []})))
    from .media_widget import expand
    layers = [(key, expand(scene, values)) for key, scene in layers]
    widgets, actions, assets, warnings = [], {}, {}, []

    def asset(resource, query, w, h, fit="contain", refresh=0, camera_entity=None, camera_source=None):
        spec = {"resource": resource, "query": query, "width": w, "height": h, "fit": fit}
        if camera_entity:
            spec["camera_entity"] = camera_entity
        if camera_source:
            spec.update(camera_source=camera_source["camera_source"], camera_multicast_url=camera_source.get("multicast_url", ""))
        key = digest(spec)
        assets[key] = spec
        return {"id": key, "width": w, "height": h, "refresh": refresh}

    content_height = round(height * layers[0][1].get("scroll_height", 100) / 100) if layers else height
    for layer, scene in layers:
        layer_height = round(height * scene.get("scroll_height", 100) / 100)
        if scene.get("background") == "image" and scene.get("image_id"):
            widgets.append({"id": layer + "/background", "type": "image", "x": 0, "y": 0, "width": width, "height": height,
                            "image": asset("background.jpg", {"id": scene["image_id"]}, width, height, scene.get("image_fit", "contain")), "opacity": round(255 * (1 - scene.get("image_dim", 0)))})
        elif scene.get("background") not in {None, "solid"}:
            # Native gradient surface; no browser screenshot and no CSS dependency.
            widgets.append({"id": layer + "/background", "type": "surface", "x": 0, "y": 0, "width": width, "height": height,
                            "background": scene.get("color", "#101e30"), "paint": background_paint(scene, payload.get("sun", {}), resolve_weather(scene, values)), "opacity": 255, "radius": 0})
        if scene.get("background") == "weather":
            widgets[-1]["weather_sky"] = weather_background.model(scene, resolve_weather(scene, values), payload.get("sun"))
        if (scene.get("media_background_enabled") and (entity := scene.get("media_background_entity"))
                and values.get(entity, {}).get("state") in {"playing", "buffering"}
                and values.get(entity, {}).get("artwork")):
            widgets.append({"id": layer + "/media_background", "type": "image", "x": 0, "y": 0, "width": width, "height": height,
                            "image": asset("cover.jpg", {"entity": entity, "v": values.get(entity, {}).get("artwork", ""), "size": "640"}, width, height, scene.get("media_background_fit", "contain")), "opacity": round(255 * (1 - scene.get("media_background_dim", .35)))})
        for item in scene.get("elements", []):
            if item["kind"] == "camera" and item.get("camera_lock_aspect"):
                item = {**item, **camera_tile_size(item, width/height, scene.get("scroll_height", 100)-item["y"])}
            entity = item.get("entity_id", "")
            value = values.get(entity, {})
            kind = item["kind"]
            key = layer + "/" + item["id"]
            x, y = min(width - 1, round(width * item["x"] / 100)), min(layer_height - 1, round(height * item["y"] / 100))
            w, h = min(width - x, max(1, round(width * item["width"] / 100))), min(layer_height - y, max(1, round(height * item["height"] / 100)))
            if kind == "control" and item.get("symbol_button") and item.get("symbol_button_shape") != "rounded":
                side=min(w,h);x+=round((w-side)/2);y+=round((h-side)/2);w=h=side
            home = home_theme.enabled(scene, item)
            action = home_theme.primary_action(item, value) if home else item.get("tap_action", {"action": "none"})
            target = action.get("entity_id", "")
            available = not target or touch_available(action, values.get(target, {}))
            if action["action"] == "show_view":
                available = action.get("view") in scenes
            actionable = action["action"] != "none" and available and (bool(target) or action["action"] == "show_view")
            if actionable:
                actions[key] = deepcopy(action)
            hold = item.get("hold_action", {"action": "none"})
            hold_target = hold.get("entity_id", "")
            holdable = (hold["action"] != "none" and
                        (hold.get("view") in scenes if hold["action"] == "show_view" else
                         bool(hold_target) and touch_available(hold, values.get(hold_target, {}))))
            if holdable:
                actions[key + "/hold"] = deepcopy(hold)
            widget = {"id": key, "type": "switch" if kind == "switch" else "button" if kind == "button" else "card",
                      "x": x, "y": y, "width": w, "height": h,
                      "font": scene.get("text_font") if not item.get("style_override") and scene.get("text_font", "auto")!="auto" else item.get("font","sans"),
                      "color": item["color"], "background": item["background"], "opacity": round(255 * item["opacity"] * scene.get("surface_opacity", 1) * (.45 if scene.get("glass") else 1)),
                      "radius": pixels(height * item["radius"] / 1080), "font_size": max(4, min(384, pixels(height * item["font_size"] / 100 * scene.get("text_scale", 100) / 100))),
                      "align": item["align"], "clickable": actionable, "on": value.get("state") == "on", "parts": []}
            decoration = kind in {"logo", "animation", "spinner", "progress"} or (kind == "control" and item.get("control_type", "icon") == "icon" and not item.get("symbol_button"))
            if kind == "control" and item.get("control_type", "icon") == "icon":
                widget["pressed_outline"] = False
            if decoration and not item.get("style_override") and not item.get("tile_surface"):
                widget.update(opacity=0, radius=0)
            if scene.get("glass") and (kind != "clock" or item.get("tile_surface")) and widget["opacity"] > 0:
                widget["glass"] = True
            if scene.get("glass") and kind == "clock" and not item.get("tile_surface"):
                widget["opacity"] = 0
                widget["glass_clock"] = True
            widget.update(tap_trigger=item.get("tap_trigger", "release"), tap_enabled=actionable,
                          hold_enabled=holdable, hold_ms=item.get("hold_ms", 700))
            if holdable:
                widget["clickable"] = True
                if hold["action"] == "show_view":
                    widget["hold_navigate"] = hold["view"]
            inset = min(min(w,h)//4, max(0, round(min(w, h) * item.get("content_padding", 0) / 100)))
            if inset:
                widget["content_padding"] = inset
                w, h = max(1, w - 2*inset), max(1, h - 2*inset)
            if actionable and action['action'] == 'show_view':
                widget['navigate'] = action['view']
            if home:
                appearance, home_model = home_theme.appearance(item, value, w, h, height, scene)
                widget.update(appearance)
                if appearance["home"]["adjust"]:
                    actions[key+"/adjust"] = {"action":"home_adjust", "entity_id":entity, "view":""}
                widgets.append(widget)
                continue
            if kind == "control":
                value = values.get(entity or target, {})
                subtype = item.get("control_type", "icon")
                widget["text_opacity"] = scene.get("text_opacity",1)*item.get("text_opacity",1)
                widget["accent"] = item.get("accent_color", "#79e5c0")
                if subtype == "slider":
                    widget.update(type="slider", value=max(0,min(100,round((value.get("volume_level") or 0)*100))))
                elif subtype == "source":
                    options = value.get("av_sources", [])
                    widget.update(type="select", options=["Quelle wählen"]+[o["label"] for o in options], value=next((i+1 for i,o in enumerate(options) if o["value"]==value.get("av_selected_source")),0))
                    if actionable:
                        actions[key]["_options"] = [""]+[o["value"] for o in options]
                else:
                    symbol = control_symbol(item,value)
                    geometry=control_geometry(symbol,control_basis(item))
                    if item.get("_media_control"):
                        from .media_widget import SPEC
                        geometry=SPEC["icons"].get(symbol,geometry)
                    # An unassigned action is only a suggestion, not an offline
                    # device. Decorative symbols keep their configured opacity.
                    configured = bool(action.get("view")) if action["action"] == "show_view" else bool(target) and action["action"] != "none"
                    symbol_opacity = (.5 if item.get("_media_control") else .35) if configured and not actionable else 1
                    size = max(1, round(min(w,h)*.58))
                    if item.get("symbol_fit")=="tight" or geometry.get("fill") or item.get("symbol_button"):
                        padding=height/300
                        inner_w,inner_h=max(1,w-2*padding),max(1,h-2*padding)
                        if item.get("symbol_button"):inner_w=inner_h=min(inner_w,inner_h)*.6
                        size=max(1,round(min(inner_w*80/geometry["width"],inner_h*80/geometry["height"])))
                    if item.get("_media_control"):
                        size = max(1,round(size*.6))
                    if item.get("symbol_button"):
                        widget["radius"]=round(min(widget["width"],widget["height"])*(.22 if item.get("symbol_button_shape")=="rounded" else .5))
                        if not item.get("style_override"):widget["opacity"]=round(255*.92*scene.get("surface_opacity",1))
                    widget["parts"] = [{"id":"symbol", "text":"", "units":"px", "x":round((w-size)/2),"y":round((h-size)/2),"width":size,"height":size,"font_size":20,"icon":"control", "paths":control_paths(item,symbol), "stroke_width":5, "fill_all":bool(geometry.get("fill")), "color":control_color(item,value), "opacity":symbol_opacity*scene.get("text_opacity",1)*item.get("text_opacity",1)}]
                widgets.append(widget)
                continue
            label = item.get("label") or value.get("name", "")
            parts = {}
            icons = {}
            forecast_count = 0
            lunar_dates = {}
            if kind not in {"clock", "logo"} and item.get("show_label") and label:
                parts["label"] = label
            if kind in {"startup", "boot"}:
                from .startup_layout import design
                defaults=design("startup" if kind=="boot" else "connecting")
                parts["title"]=item.get("text") or defaults["text"]
                icons.update({p["id"]:p["icon"] for p in defaults["parts"] if "icon" in p})
            elif kind == "animation":
                from .animations import ANIMATIONS
                icons["animation"] = ANIMATIONS[item.get("animation_type", "spinner")]["icon"]
            elif kind in {"logo", "spinner", "progress"}:
                icons[kind] = {"logo":"esphome_logo", "spinner":"spinner", "progress":"boot_progress"}[kind]
            elif kind == "clock":
                widget.update(type="clock", clock_12h=item.get("clock_time_format") == "12h", clock_seconds=item.get("clock_seconds", False), clock_blink=item.get("clock_blink", False), clock_date_format=item.get("clock_date_format", "long"))
                parts.update(time=now.strftime(("%I:%M" if widget["clock_12h"] else "%H:%M")+(":%S" if widget["clock_seconds"] else "")+(" %p" if widget["clock_12h"] else "")), date=date_text(now, item.get("clock_date_format", "long")))
            elif kind == "text":
                parts["text"] = item.get("text", "")
            elif kind == "message":
                parts.update(title=(message or {}).get("title", "Home Assistant"), body=(message or {}).get("message", ""))
            elif kind == "weather":
                valid = bool(entity) and value.get("state") not in {None, "unavailable", "unknown"}
                if item.get("weather_style") == "minimal": widget["opacity"] = 0
                if item.get("weather_style") == "sky" and not scene.get("glass"):
                    widget["paint"] = background_paint({**scene, "background":"solar"}, payload.get("sun",{}))
                    widget["opacity"] = pixels(255*scene.get("surface_opacity",1))
                if not valid:
                    parts.update(temperature="–",detail="Entität auswählen" if not entity else "Nicht verfügbar")
                else:
                    parts["temperature"] = str(value.get("temperature") if present(value.get("temperature")) else "–")+" "+(value.get("temperature_unit") or "°C")
                    parts["detail"] = CONDITIONS.get(value["state"],value["state"])
                    if present(value.get("humidity")): parts["detail"] += " · "+str(value["humidity"])+" %"
                    if value.get("stale"): parts["detail"] += " · Letzter Stand"
                    icons["icon"] = weather_icon(value["state"],payload.get("sun",{}).get("is_daytime",value["state"]!="clear-night"))
                    lunar_dates["icon"] = now
                    if scene.get("glass"):
                        from .weather_metrics import metric_values
                        parts.update(metric_values(value))
                    mode=item.get("forecast_type","daily")
                    forecast=value.get("forecasts",{}).get(mode,value.get("forecast",[]) if mode=="daily" else [])
                    if mode=="current":forecast=[]
                    forecast=forecast[:item.get("forecast_count",4)]
                    forecast_count=len(forecast)
                    for index,period in enumerate(forecast,1):
                        prefix=f"forecast_{index}"
                        parts[prefix+"_time"] = forecast_date(period.get("datetime",""),mode,payload.get("timezone","UTC"))
                        parts[prefix+"_high"] = str(period['temperature'])+"°" if present(period.get('temperature')) else "–"
                        parts[prefix+"_low"] = str(period['templow'])+"°" if mode=="daily" and present(period.get('templow')) else ""
                        parts[prefix+"_rain"] = str(period['precipitation_probability'])+" %" if present(period.get('precipitation_probability')) else ""
                        icons[prefix+"_icon"] = weather_icon(period.get('condition',''),True if mode=="daily" else period.get('is_daytime'))
                        lunar_dates[prefix+"_icon"] = period.get('datetime') or now
                    if mode!="current" and not forecast:
                        parts["detail"] = CONDITIONS.get(value["state"],value["state"])+" · "+("Stundenprognose" if mode=="hourly" else "Tagesprognose")+" nicht verfügbar"
            elif kind == "calendar":
                events=value.get("events",[])[:6]
                parts["empty"] = "" if events else "Keine Termine"
                for index,event in enumerate(events,1):
                    parts[f"row_{index}_label"] = forecast_date(event.get("start",""),"calendar",payload.get("timezone","UTC"))
                    parts[f"row_{index}_value"] = event.get("summary","")
            elif kind == "media":
                parts.update(title=value.get("media_title", value.get("title", value.get("state", "unavailable"))), artist=value.get("media_artist", value.get("artist", "")), album=value.get("media_album_name", value.get("album", "")))
                if item.get("show_volume"):
                    volume = value.get("volume_level", value.get("volume"))
                    parts["volume"] = "Stumm" if value.get("is_volume_muted") else f"Lautstärke: {round(volume * 100)} %" if isinstance(volume, (int, float)) else "Lautstärke: –"
                if (item.get("show_progress") and isinstance(value.get("media_duration"), (int, float))
                        and value["media_duration"] > 0 and isinstance(value.get("media_position"), (int, float))
                        and value.get("state") in {"playing", "paused", "buffering"}):
                    def duration(seconds):
                        return f"{int(max(0, seconds)) // 60}:{int(max(0, seconds)) % 60:02d}"
                    position = value['media_position']
                    try:
                        updated = datetime.fromisoformat(value.get('media_position_updated_at',''))
                        if value['state']=='playing' and updated.tzinfo:
                            position += max(0,(now-updated).total_seconds())
                    except (ValueError,TypeError):
                        pass
                    position = max(0,min(position,value['media_duration']))
                    parts["elapsed"] = duration(position)
                    parts["duration"] = '−'+duration(value['media_duration']-position)+' / '+duration(value["media_duration"])
                    widget['media_timeline']={'position':position,'duration':value['media_duration'],'playing':value['state']=='playing','source_position':value['media_position'],'updated_at':value.get('media_position_updated_at')}
                cover = item.get("parts", {}).get("cover", {})
                if item.get("show_cover") and cover.get("visible", True) and value.get("artwork"):
                    if item.get("media_style", "compact") == "compact" or item.get("media_controls"):
                        # Existing firmware already renders positioned image objects.
                        # Keep the full-card touch layer above the artwork and surface.
                        surface = deepcopy(widget)
                        surface.update(id=key+"/surface", type="surface", clickable=False, parts=[])
                        widgets.append(surface)
                        box = cover if "x" in cover else {"x":5,"y":6,"width":32,"height":88}
                        cx,cy,cw,ch = [round(box[k] * d / 100) for k,d in (("x",w),("y",h),("width",w),("height",h))]
                        fit = cover.get("fit", "contain")
                        ratio = value.get("artwork_ratio")
                        if fit == "contain" and isinstance(ratio, (int, float)) and ratio > 0:
                            # RGB565 has no alpha channel. Size the actual image
                            # to its natural ratio instead of baking black padding
                            # into the requested cover rectangle.
                            iw = max(1, min(cw, round(ch * ratio)))
                            ih = max(1, min(ch, round(cw / ratio)))
                            cx += (cw-iw)//2; cy += (ch-ih)//2
                            cw,ch = iw,ih
                            fit = "cover"  # Only subpixel rounding; no stretching.
                        widgets.append({"id":key+"/cover", "type":"image", "x":x+inset+cx, "y":y+inset+cy,
                                        "width":max(1,cw), "height":max(1,ch), "opacity":255,
                                        "radius":widget["radius"], "image":asset("cover.jpg", {"entity":entity,"v":value["artwork"],"size":"640"},max(1,cw),max(1,ch),fit)})
                        widget["opacity"] = 0
                        # The glass surface already sits below the cover. The
                        # text/touch layer must not blur the artwork a second time.
                        widget.pop("glass", None)
                    else:
                        widget["image"] = asset("cover.jpg", {"entity": entity, "v": value["artwork"], "size": "640"}, w, max(1, h // 2))
            elif kind == "camera":
                full = item.get("camera_fullscreen", {})
                full_parts = full.get("parts", {})
                full_picture = {"x":0,"y":9,"width":100,"height":91,**full_parts.get("picture", {})}
                full_item = {**item,"content_padding":0,"font_size":3,"show_label":True,"parts":{
                    "label":{"x":6.25,"y":2.33,"width":90,"height":5,"font_size":3,"font_weight":600,"color":"#ffffff",**full_parts.get("label", {})},
                    "detail":{"visible":False}}}
                full_labels = arrange(full_item, {**scene,"text_scale":100}, width,height,height,{"label":item.get("label") or "Kamera"},{},0)
                widget["camera_fullscreen"] = {"viewport":{k:max(1 if k in {"width","height"} else 0,round(full_picture[k]*d/100)) for k,d in (("x",width),("y",height),("width",width),("height",height))},
                    "fit":full_picture.get("fit",full.get("camera_fit","contain")),
                    "zoom":full.get("camera_zoom",100),"pan_x":full.get("camera_pan_x",0),"pan_y":full.get("camera_pan_y",0),
                    "visible":full_picture.get("visible",True),"label":next((p for p in full_labels if p["id"]=="label"),None)}
                widget["camera_open"] = action["action"] == "camera_fullscreen"
                widget["clickable"] = actionable or holdable or widget["camera_open"]
                widget["tap_enabled"] = actionable or widget["camera_open"]
                widget.update(camera_mode=item.get("camera_mode", "auto"), camera_interval=item.get("camera_interval", 5), camera_title=item.get("label") or "Kamera")
                if item.get("camera_source") == "local":
                    widget["type"] = "local_camera"
                    for field, default in (("camera_zoom", 100), ("camera_pan_x", 0), ("camera_pan_y", 0)):
                        widget[field] = item.get(field, default)
                    picture = item.get("parts", {}).get("picture", {})
                    if picture.get("visible") is False:
                        widget["type"] = "card"
                    elif "x" in picture:
                        widget["camera_viewport"] = {
                            key: max(1 if key in {"width", "height"} else 0, round(picture[key] * dimension / 100))
                            for key, dimension in (("x", w), ("y", h), ("width", w), ("height", h))
                        }
                    if picture.get("fit") in {"cover", "contain"}:
                        widget["camera_fit"] = picture["fit"]
                elif item.get("camera_source") in {"entity", "test", "multicast"}:
                    widget["image"] = asset("camera.jpg", {"view": layer, "id": item["id"]}, w, h, item.get("camera_fit", "contain"), item.get("camera_interval", 5), entity if item.get("camera_source")=="entity" else None, item)
                    if entity or item.get("camera_source") in {"test", "multicast"}:
                        widget["camera_stream"] = widget["image"]["id"]
                else:
                    warnings.append(f'{key}: HLS/Multicast benötigt einen Videoausgang; auf ESP lokale Kamera oder HA-Einzelbilder wählen')
                    parts["detail"] = "Kameraquelle für ESP nicht unterstützt"
                widget.setdefault("camera_fit", item.get("camera_fit", "contain"))
            elif kind == "hdmi":
                warnings.append(f"{key}: HDMI benötigt den LG-Ausgang")
                parts["detail"] = "HDMI ist auf diesem ESP nicht verfügbar"
            else:
                if kind=="button":parts["value"]="Auslösen"
                elif not entity:parts.update(value="–",detail="Entität auswählen")
                elif value.get("state") in {None,"unavailable","unknown"}:parts.update(value="–",detail="Nicht verfügbar")
                else:
                    names={"on":"Ein","off":"Aus","home":"Zuhause","not_home":"Unterwegs","open":"Offen","closed":"Geschlossen","locked":"Verriegelt","unlocked":"Entriegelt"}
                    parts["value"] = names.get(value["state"],str(value["state"]))+(" "+str(value["unit"]) if value.get("unit") else "")
            if kind == "clock" and ("clock_gap" in item or not item.get("manual_size") and (item.get("clock_size") or item.get("clock_base_height") or (item["width"], item["height"]) in {(20,16),(25,20),(40,32),(80,60)})):
                widget["clock_center"] = True
                widget["clock_gap"] = round(h * item.get("clock_gap", 4) / 100)
            if kind in {"animation", "progress"} and item.get("progress_source") == "entity":
                from .animations import progress_percent
                item = {**item, "progress_value": progress_percent(item, value) or 0}
            widget["parts"] = arrange(item, scene, w, h, height, parts, icons, forecast_count)
            if widget.get("glass_clock") and not item.get("style_override"):
                for part in widget["parts"]:
                    if part["id"] == "time":
                        part["color"] = "#d9edfc"
            if layer == "updating" and kind == "text" and item.get("update_role") in {"status", "percent"}:
                for part in widget["parts"]:
                    if part["id"] == "text":part["update_role"] = item["update_role"]
            if kind == "logo" and item.get("graphic_id"):
                from .graphics import graphic_for
                graphic = graphic_for(item)
                if item["graphic_id"] == "esphome": graphic = {**graphic, "width":240, "height":234}
                for part in widget["parts"]:
                    if part["id"] != "logo": continue
                    pad = max(1, round(height*2/600))
                    scale = min(max(1, part["width"]-pad*2)/graphic["width"], max(1, part["height"]-pad*2)/graphic["height"])
                    gw, gh = max(1, round(graphic["width"]*scale)), max(1, round(graphic["height"]*scale))
                    part.update(x=part["x"]+(part["width"]-gw)//2, y=part["y"]+(part["height"]-gh)//2, width=gw, height=gh)
                    if item["graphic_id"] == "esphome":
                        part["icon"] = "graphic_esphome"
                    else:
                        part.update(icon="graphic", graphic=graphic)
            for part in widget["parts"]:
                if part['id']=='progress_bar' and widget.get('media_timeline'):
                    timeline=widget['media_timeline']
                    part['value']=round(timeline['position']/timeline['duration']*1000)
                if part.get('icon') in {'moon', 'nightcloud'}:
                    lunar = illumination(lunar_dates.get(part['id'], now))
                    part.update(moon_phase=round(lunar['phase'], 4), moon_fraction=round(lunar['fraction'], 4))
            widgets.append(widget)
    for widget in widgets:
        action = actions.get(widget["id"], {})
        name = action.get("action", "")
        value = values.get(action.get("entity_id", ""), {})
        feedback = None
        if widget["type"] in {"slider", "select"}:
            feedback = {"value": widget["value"]}
        elif name in {"toggle", "turn_on", "turn_off", "av_power", "av_play_pause", "av_remote_play_pause", "media_play_pause", "player_play_pause", "av_mute", "media_mute", "player_mute"}:
            current = int(value.get("av_power") not in {None, "off", "unavailable", "unknown"}) if name == "av_power" else int(bool(value.get("is_volume_muted"))) if name in {"av_mute", "media_mute", "player_mute"} else int(value.get("av_remote_state" if name == "av_remote_play_pause" else "state") == ("playing" if name in {"av_play_pause", "av_remote_play_pause", "media_play_pause", "player_play_pause"} else "on"))
            if name in {"toggle", "turn_on", "turn_off"} and action.get("entity_id", "").split(".")[0] in {"media_player", "climate"}:
                current = int(value.get("state") not in {None, "off", "unavailable", "unknown"})
            predicted = 1 if name == "turn_on" else 0 if name == "turn_off" else 1-current
            feedback = {"value": current, "next": predicted, "parts": deepcopy(widget.get("parts", []))}
            if widget.get("home"):
                original = next(i for layer, scene in layers for i in scene.get("elements", []) if layer+"/"+i["id"]==widget["id"])
                source_scene = next(scene for layer, scene in layers if layer==widget["id"].split("/")[0])
                predicted_value = {**value,"state":("playing" if predicted else "paused") if name=="media_play_pause" else ("on" if predicted else "off")}
                presentation, _ = home_theme.appearance(original, predicted_value, widget["width"]-2*widget.get("content_padding",0), widget["height"]-2*widget.get("content_padding",0), height, source_scene)
                feedback.update(parts=presentation["parts"], background=presentation["background"], opacity=presentation["opacity"])
            original = next(i for layer, scene in layers for i in scene.get("elements", []) if layer+"/"+i["id"]==widget["id"])
            for part in feedback["parts"]:
                if part.get("icon") == "control":
                    if name == "av_power": part["color"] = widget["accent"] if predicted else widget["color"]
                    elif name in {"av_play_pause", "av_remote_play_pause", "media_play_pause", "player_play_pause"} and control_basis(original)=="play_pause": part["paths"] = control_paths(original,"pause" if predicted else "play")
                    elif name in {"av_mute", "media_mute", "player_mute"} and control_basis(original)=="volume_mute": part["paths"] = control_paths(original,"mute" if predicted else "volume")
                elif part["id"] == "value" and part.get("text") in {"Ein", "Aus"}:
                    part["text"] = "Ein" if predicted else "Aus"
        if feedback is not None:
            widget["feedback"] = {**feedback, "timeout_ms": 5000}
    # Use final native geometry (camera aspect binding, circular buttons and
    # Home tiles included), rather than a second approximate editor rectangle.
    for layer, source_scene in layers:
        sky = next((widget.get("weather_sky") for widget in widgets if widget["id"] == layer+"/background"), None)
        if sky is None:
            continue
        reactive = {layer+"/"+item["id"] for item in source_scene.get("elements", []) if item.get("weather_reactive")}
        sky["obstacles"] = [{"x":widget["x"], "y":widget["y"], "w":widget["width"], "h":widget["height"],
                             "r":min(widget.get("radius",0),widget["width"]/2,widget["height"]/2)}
                            for widget in widgets if widget["id"] in reactive and not (widget["type"] == "clock" and not widget.get("opacity", 255))]
        sky["text_widgets"] = [widget["id"] for widget in widgets if widget["id"] in reactive and widget["type"] == "clock" and not widget.get("opacity", 255)]
    result = {"protocol": PROTOCOL, "schema": SCHEMA, "width": width, "height": height,
              "content_height": content_height, "view": selected, "background": layers[0][1].get("color", "#101e30") if layers else "#101e30", "widgets": widgets, "warnings": warnings, "actions_id": digest(actions)}
    if content_height > height:
        base_layer = layers[0][0]
        for widget in widgets:
            widget["fixed"] = widget["id"].endswith(("/background", "/media_background")) or not widget["id"].startswith(base_layer + "/")
    # Input validity follows the saved controls, not rapidly changing values,
    # artwork, clocks or optimistic feedback. A changed design/target/layer
    # still revokes queued touches from the previous UI.
    # Only the effective visible layers own these controls. Library edits to
    # another view must neither revoke touches nor rebuild this LVGL scene.
    result["action_context"] = digest({"view": selected, "layers": layers,
                                       "actions": actions})
    for widget in widgets:
        native_colors(widget)
    result["background"] = opaque(result["background"])
    revision_data = deepcopy(result)
    # Initial text is only a bootstrap value. Local clocks must not produce
    # scene revisions or network pushes as seconds/minutes/dates advance.
    for widget in revision_data["widgets"]:
        if timeline := widget.get("media_timeline"):
            timeline["position"] = timeline["source_position"]
            for part in widget.get("parts", []):
                if part["id"] in {"elapsed", "duration"}: part.pop("text", None)
                if part["id"] == "progress_bar": part.pop("value", None)
        if widget.get("type") == "clock":
            for part in widget.get("parts", []):
                if part.get("clock_live"):
                    part.pop("text", None)
    result["revision"] = digest(revision_data)
    structure = deepcopy(result)
    for widget in structure["widgets"]:
        widget.pop('media_timeline',None)
        if widget.get("home"):
            widget["home"] = True
            for key in ("background", "opacity", "color"):
                widget.pop(key,None)
            for part in widget.get("parts",[]):
                part.pop("color",None)
                part.pop("opacity",None)
        widget.pop("feedback", None)
        widget.pop("value", None)
        widget.pop("on", None)
        widget.pop("clickable", None)
        for part in widget.get("parts", []):
            if part['id']=='progress_bar':part.pop('value',None)
            if part.get("icon") == "control":
                part.pop("paths", None)
                part.pop("color", None)
                part.pop("opacity", None)
            part.pop("text", None)
            part.pop("icon", None)
            part.pop("moon_phase", None)
            part.pop("moon_fraction", None)
    structure.pop("revision")
    result["layout_id"] = digest(structure)
    result.update(epoch=int(now.timestamp()), utc_offset=int(now.utcoffset().total_seconds()))
    if len(widgets) > MAX_NATIVE_WIDGETS:
        raise ValueError("Native Studio scene exceeds 144 visual elements")
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_SCENE_BYTES:
        raise ValueError("Native Studio scene exceeds 128 KiB")
    return result, actions, assets
