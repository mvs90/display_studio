"""Local animation variants shared by the browser and native scene compiler."""
import json
from pathlib import Path

ANIMATIONS = json.loads(Path(__file__).with_name("animations.json").read_text())


def progress_percent(item, value=None):
    """Map a numeric HA state to a bounded percentage; None means unavailable."""
    import math
    import re
    if item.get("progress_source") != "entity":
        return item.get("progress_value", 60)
    state = (value or {}).get("state")
    if not isinstance(state, (str, int, float)) or isinstance(state, bool):
        return None
    if not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", str(state).strip()):
        return None
    number = float(state)
    low, high = item.get("progress_min", 0), item.get("progress_max", 100)
    if not math.isfinite(number) or high <= low:
        return None
    return max(0, min(100, (number - low) / (high - low) * 100))
