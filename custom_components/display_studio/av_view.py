"""Modern, shared AV layouts: native controls and the same browser design."""
from .layout_config import element, scene

MEDIA_VIEW = "view_av_media"
REMOTE_VIEW = "view_av_remote"


def create_views(av_entity):
    def text(identifier, title, x, y, w, h, font=3, background="#101a28", opacity=0):
        item = element("text", x, y, w, h)
        item.update(id=identifier, text=title, show_label=False, font_size=font,
                    color="#f3f6fa", background=background, opacity=opacity, radius=40)
        return item

    def control(identifier, label, symbol, x, y, w, h, action, *, view="", subtype="icon", primary=False):
        item = element("control", x, y, w, h)
        item.update(id=identifier, label=label, show_label=False, entity_id=av_entity,
                    control_type=subtype, control_icon=symbol, font_size=3, align="center",
                    color="#0b1920" if primary else "#e7edf6", accent_color="#77e0cc",
                    background="#77e0cc" if primary else "#1b2a3c", opacity=1, radius=60 if subtype=="icon" else 32,
                    tap_action={"action": action, "entity_id": av_entity if action.startswith("av_") else "", "view": view})
        return item

    def page(identifier, name, items):
        layout = scene("midnight", items, "#101c2d", "#54b9bf")
        return {"id": identifier, "name": name, "theme_override": True, "scene": layout}

    player = element("media", 4, 31, 92, 36)
    player.update(media_controls=False, id="now_playing", entity_id=av_entity, media_av_auto=True,
                  media_style="compact", font_size=4.3, background="#152438", radius=42,
                  tap_action={"action":"av_play_pause","entity_id":av_entity,"view":""},
                  opacity=1, show_cover=True, show_progress=True, show_volume=True, show_playback_icon=False)
    player["parts"] = {
        "cover": {"x": 2, "y": 7, "width": 27, "height": 86, "fit": "contain"},
        "label": {"x": 32, "y": 9, "width": 63, "height": 12, "font_size": 7, "color":"#77e0cc"},
        "title": {"x": 32, "y": 26, "width": 63, "height": 25, "font_size": 14},
        "artist": {"x": 32, "y": 53, "width": 63, "height": 14, "font_size": 9},
        "album": {"visible": False},
        "progress": {"x": 32, "y": 74, "width": 47, "height": 16},
        "elapsed": {"font_size": 45}, "duration": {"font_size": 45},
        "volume": {"x": 76, "y": 78, "width": 20, "height": 12, "font_size": 7, "align":"right"},
    }
    media = [text("title", "Wohnzimmer", 4, 3, 60, 11, 5),
             control("dashboard", "Dashboard", "home", 79, 3, 7, 12, "show_view", view="dashboard"),
             control("power", "AV-System ein / aus", "power", 89, 3, 7, 12, "av_power"),
             text("source_label", "QUELLE", 4, 18, 14, 10, 2.2),
             control("source", "Quelle wählen", "home", 19, 18, 77, 10, "av_select_source", subtype="source"), player,
             control("previous", "Vorheriger Titel", "previous", 31, 71, 8, 13, "av_previous"),
             control("play", "Wiedergabe / Pause", "play", 44, 70, 10, 15, "av_play_pause", primary=True),
             control("next", "Nächster Titel", "next", 59, 71, 8, 13, "av_next"),
             control("remote", "Apple TV Fernbedienung", "remote", 87, 71, 9, 14, "show_view", view=REMOTE_VIEW),
             control("mute", "Ton stummschalten", "volume", 4, 88, 6, 9, "av_mute"),
             control("volume", "Lautstärke", "volume", 12, 88, 84, 9, "av_volume_set", subtype="slider")]
    remote = [text("title", "Apple TV", 16, 3, 64, 11, 5),
              control("media", "Zur Medienansicht", "back", 4, 3, 7, 12, "show_view", view=MEDIA_VIEW),
              control("power", "AV-System ein / aus", "power", 89, 3, 7, 12, "av_power"),
              text("remote_base", "", 5, 19, 49, 59, background="#142337", opacity=1),
              control("source", "Quelle wählen", "home", 62, 20, 34, 11, "av_select_source", subtype="source")]
    for key, symbol, x, y in (("up", "up", 23, 21), ("left", "left", 8, 40),
                              ("select", "check", 23, 40), ("right", "right", 38, 40), ("down", "down", 23, 59)):
        remote.append(control(key, {"up":"Hoch","left":"Links","select":"OK","right":"Rechts","down":"Runter"}[key], symbol, x, y, 13, 17, "av_remote_"+key, primary=key=="select"))
    remote += [control("menu", "Zurück", "back", 63, 39, 14, 18, "av_remote_menu"),
               control("home", "Apple TV Home", "home", 82, 39, 14, 18, "av_remote_home"),
               control("play_pause", "Apple TV Wiedergabe / Pause", "play", 63, 62, 33, 16, "av_remote_play_pause"),
               control("mute", "Ton stummschalten", "volume", 5, 86, 7, 11, "av_mute"),
               control("volume", "Lautstärke", "volume", 15, 86, 81, 11, "av_volume_set", subtype="slider")]
    return [page(MEDIA_VIEW, "Wohnzimmer · Medien", media), page(REMOTE_VIEW, "Apple TV · Fernbedienung", remote)]
