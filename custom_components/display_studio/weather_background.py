"""Bounded native weather model matching the shared browser sky.

Only environmental changes cross the wire. Animation time belongs to the
display; coordinates remain on Home Assistant (only sky positions are sent).
"""
import math

CLOUDY = {"cloudy", "drizzle", "rainy", "pouring", "hail", "snowy", "snowy-rainy", "fog", "lightning", "lightning-rainy"}


def number(value, default):
    try:
        n = float(value) if value not in (None, "") else default
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def model(scene, data, sun):
    data, sun = data or {}, sun or {}
    state = data.get("state", "unavailable")
    if state in {"unknown", "unavailable"}:
        state = "unavailable"
    day = bool(sun.get("is_daytime", state != "clear-night"))
    cloudy = state in CLOUDY
    coverage = max(0, min(1, number(data.get("cloud_coverage"), 48 if state == "partlycloudy" else 96 if cloudy else 0 if state == "unavailable" else 10) / 100))
    temperature = math.nan if isinstance(data.get("temperature"), bool) else number(data.get("temperature"), math.nan)
    unit = data.get("temperature_unit")
    if unit == "°F": temperature = (temperature-32)*5/9
    elif unit != "°C": temperature = math.nan
    temperature = round(temperature, 3) if math.isfinite(temperature) and -120 <= temperature <= 80 else None
    rate = data.get("rain_rate")
    intensity = (0.28 if state == "drizzle" else 1.35 if state == "pouring" else 1)
    if rate is not None:
        intensity = 0 if rate == 0 else max(.18, min(1.5, math.log1p(rate) / math.log(5)))
    kind = "hail" if state == "hail" else "snow" if state == "snowy" else "sleet" if state == "snowy-rainy" else "rain" if state in {"drizzle", "rainy", "pouring", "lightning-rainy"} else "none"
    drizzle = state == "drizzle" or (kind == "rain" and rate is not None and 0 < rate <= .5)
    darkness = max(0, min(1, (6-number(sun.get("elevation"), 30 if day else -18))/18))
    wet = .32 if state.startswith("lightning") else .26 if state == "pouring" else .09 if drizzle else .18 if kind != "none" else 0
    def position(body, visible):
        body = body or {}
        return {"visible": bool(visible and number(body.get("elevation"), -90) > -.833),
                "x": round(max(4, min(96, number(body.get("azimuth"), 180) / 3.6)), 3),
                "y": round(max(7, min(90, 82-number(body.get("elevation"), 0)*.82)), 3)}
    moon = sun.get("moon") or {}
    return {"version": 1, "night": not day, "coverage": round(coverage, 4),
            "darkness": round(darkness, 4), "wetness": wet, "intensity": round(intensity, 4), "drizzle": drizzle,
            "fog": state == "fog", "storm": state in {"lightning", "lightning-rainy"}, "kind": kind, "animate": scene.get("weather_animate", True),
            "temperature_c": temperature,
            "impact": scene.get("weather_impact", False),
            "accumulate": scene.get("weather_accumulation", False),
            "drift": round(-math.sin((number(data.get("wind_bearing"), 180)%360)*math.pi/180)*140),
            "sun": position(sun, day and not cloudy and state != "unavailable"),
            "moon": {**position(moon, not day and not cloudy and state != "unavailable"),
                     "phase": max(0, min(1, number(moon.get("phase"), .5)))}}


def overcast_paint(data, sun):
    if (data or {}).get("state") not in CLOUDY:
        return None
    sky = model({}, data, sun)
    darkness, wet = sky["darkness"], sky["wetness"]
    def mix(day, night):
        channels = [round((a*(1-darkness)+b*darkness)*(1-wet)) for a,b in zip(day,night)]
        return "#"+"".join(f"{v:02x}" for v in channels)
    return [{"kind": "linear", "angle": 175-5*darkness,
             "stops": [[0, mix((169,186,201),(40,56,75)), 1],
                       [.36+.14*darkness, mix((99,120,135),(20,35,51)), 1],
                       [1, mix((41,60,76),(8,15,30)), 1]]}]
