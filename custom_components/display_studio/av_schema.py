"""Declarative AV actions; safe to import in offline layout tools."""
REMOTE_COMMANDS = {"av_remote_" + key: key for key in (
    "up", "down", "left", "right", "select", "menu", "home", "play_pause",
    "skip_backward", "skip_forward", "wakeup", "suspend",
)}
PLAYER_ACTIONS = {"player_"+name for name in ("play_pause","previous","next","seek_back","seek_forward","volume_down","volume_up","volume_set","mute","select_source")}

AV_ACTIONS = {"av_seek_back", "av_seek_forward","av_volume_set", "av_select_source", "av_power", "av_play_pause", "av_previous", "av_next", "av_volume_down", "av_volume_up", "av_mute", *REMOTE_COMMANDS}
