"""Current lunar illumination from UTC ecliptic coordinates, also in weather.js.

Low-precision J2000 orbital elements with principal lunar longitude corrections.
This is a phase symbol, not an observer-oriented image of the lunar surface.
Reference phase instants: https://aa.usno.navy.mil/data/MoonPhases
The cross-runtime tests compare the JS and Python calculation at those instants.
"""
from datetime import datetime, timezone
from math import sin, cos, pi


def illumination(date):
    if isinstance(date, str):
        try:
            date = datetime.fromisoformat(date.replace('Z', '+00:00'))
        except ValueError:
            date = datetime.now(timezone.utc)
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    d = date.timestamp()/86400 - 10957.5
    r = pi/180
    m = (357.5291 + .98560028*d)*r
    sun = (280.46646 + .98564736*d + 1.9148*sin(m) + .0200*sin(2*m) + .0003*sin(3*m))*r
    mm = (134.963 + 13.064993*d)*r
    dm = (297.8502 + 12.19074912*d)*r
    f = (93.272 + 13.229350*d)*r
    lon = (218.316 + 13.176396*d + 6.289*sin(mm) + 1.274*sin(2*dm-mm) + .658*sin(2*dm) + .214*sin(2*mm) - .186*sin(m) - .114*sin(2*f))*r
    lat = 5.128*sin(f)*r
    return {'phase': ((lon-sun)/(2*pi)) % 1, 'fraction': (1-cos(lon-sun)*cos(lat))/2}
