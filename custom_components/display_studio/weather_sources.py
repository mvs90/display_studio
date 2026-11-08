"""Provider-independent weather bindings; amounts are never guessed as rates."""
from datetime import datetime, UTC
import math

CONDITIONS = ("auto", "sunny", "clear-night", "partlycloudy", "cloudy", "drizzle",
              "rainy", "pouring", "snowy", "snowy-rainy", "hail", "fog", "windy",
              "windy-variant", "lightning", "lightning-rainy", "exceptional")


def number(value):
    try:
        result = float(value) if value not in (None, "") and not isinstance(value, bool) else math.nan
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def timestamp(value):
    try:
        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return date.timestamp() if date.tzinfo else None
    except (ValueError, TypeError):
        return None


def hourly_rate(data, now):
    """Only a fresh, explicitly hourly, one-hour interval can supply a rate."""
    if data.get("stale") or data.get("state") in ("unknown", "unavailable"):
        return None
    unit = data.get("precipitation_unit")
    if unit not in ("mm", "in"):
        return None
    rows = data.get("forecasts", {}).get("hourly", [])
    for index, row in enumerate(rows):
        at = timestamp(row.get("datetime"))
        if at is None or not at <= now < at + 3600:
            continue
        # Refuse provider data labelled hourly but spaced three/six hours apart.
        other = rows[index + 1] if index + 1 < len(rows) else rows[index - 1] if index else None
        neighbor = timestamp(other.get("datetime")) if other else None
        if neighbor is None or abs(abs(neighbor - at) - 3600) > 1:
            return None
        value = number(row.get("precipitation"))
        return value * (25.4 if unit == "in" else 1) if value is not None else None
    return None


def resolve(scene, values, now=None):
    """Return a copy: a manual sky must not change weather cards or HA state."""
    result = dict(values.get(scene.get("weather_entity"), {}))
    override = scene.get("weather_condition", "auto")
    if override != "auto" and override in CONDITIONS:
        result["state"] = override
        result.pop("cloud_coverage", None)
    mode = scene.get("weather_precipitation_mode", "condition")
    source = values.get(scene.get("weather_precipitation_entity") or scene.get("weather_entity"), {})
    rate = None
    if mode == "sensor":
        unit = source.get("unit", source.get("unit_of_measurement"))
        value = number(source.get("state"))
        if unit in ("mm/h", "in/h") and value is not None:
            rate = value * (25.4 if unit == "in/h" else 1)
    elif mode == "hourly":
        rate = hourly_rate(source, datetime.now(UTC).timestamp() if now is None else now)
    if rate is not None:
        result["rain_rate"] = round(min(500, rate), 4)
        result["rain_rate_source"] = mode
    return result
