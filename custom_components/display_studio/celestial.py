"""Low precision lunar position for decorative skies; coordinates stay on HA.

Orbital approximation follows SunCalc 1.9 (Vladimir Agafonkin, MIT) and
https://aa.quae.nl/en/reken/hemelpositie.html. Not a navigation ephemeris.
"""

from math import asin, atan2, cos, degrees, radians, sin, tan
from astral.moon import phase


def moon_position(observer, now):
    days = now.timestamp() / 86400 + 2440587.5 - 2451545
    anomaly = radians(134.963 + 13.064993 * days)
    longitude = radians(218.316 + 13.176396 * days) + radians(6.289) * sin(anomaly)
    latitude = radians(5.128) * sin(radians(93.272 + 13.229350 * days))
    tilt = radians(23.4397)
    ra = atan2(sin(longitude) * cos(tilt) - tan(latitude) * sin(tilt), cos(longitude))
    dec = asin(sin(latitude) * cos(tilt) + cos(latitude) * sin(tilt) * sin(longitude))
    hour = radians(280.16 + 360.9856235 * days + observer.longitude) - ra
    lat = radians(observer.latitude)
    altitude = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(hour))
    azimuth = atan2(sin(hour), cos(hour) * sin(lat) - tan(dec) * cos(lat))
    return {
        "elevation": round(degrees(altitude), 2),
        "azimuth": round((degrees(azimuth) + 180) % 360, 2),
        "phase": round(phase(now.date()) / 28, 4),
    }
