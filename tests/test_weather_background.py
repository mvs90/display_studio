"""Weather-only bindings, safe legacy themes and decorative astronomy."""
from copy import deepcopy
from datetime import datetime, UTC
from types import SimpleNamespace
import math
import pytest
from astral import Observer
from homeassistant.core import HomeAssistant
from custom_components.display_studio.celestial import moon_position
from custom_components.display_studio.layout_config import make_layout, validate_layout, layout_entities
from custom_components.display_studio.layout_themes import default_themes, validate_themes, apply_theme
from custom_components.display_studio.layouts import DisplayLayouts


def test_weather_binding_and_theme_round_trip():
    config = make_layout()
    config['scenes']['dashboard'].update(background='weather', weather_entity='weather.home', glass=True)
    result = validate_layout(config)
    assert 'weather.home' in layout_entities(result)
    themes = default_themes()
    themes[0]['style'].update(background='weather', weather_entity='weather.home', glass=True)
    checked = validate_themes(themes, 'cinema')
    assert apply_theme(result['scenes']['dashboard'], checked[0])['glass']
    startup = apply_theme(result['scenes']['startup'], checked[0], startup=True)
    assert startup['background'] == 'dawn' and startup['weather_entity'] == ''
    for theme in themes:
        for field in ('weather_entity', 'weather_animate', 'glass'):
            theme['style'].pop(field, None)
    assert validate_themes(themes, 'cinema')[0]['style']['glass'] is False


@pytest.mark.parametrize('field,value', [('weather_entity','sensor.secret'), ('weather_entity',{}), ('glass',1), ('weather_animate','yes')])
def test_invalid_weather_style_is_rejected(field, value):
    config = make_layout()
    config['scenes']['dashboard'][field] = value
    with pytest.raises(ValueError):
        validate_layout(config)


def test_startup_refuses_live_weather():
    config = make_layout()
    config['scenes']['startup']['background'] = 'weather'
    with pytest.raises(ValueError, match='offline'):
        validate_layout(config)


async def test_background_only_weather_is_published_without_private_coordinates(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    hass.config.latitude, hass.config.longitude = 52.52, 13.405
    layouts = DisplayLayouts(hass, SimpleNamespace(entry_id='weather', options={}))
    try:
        await layouts.async_start()
        config = deepcopy(layouts.config)
        config['enabled'] = True
        config['scenes']['dashboard'].update(background='weather', weather_entity='weather.home')
        hass.states.async_set('weather.home', 'hail', {'wind_speed':14, 'wind_bearing':150, 'cloud_coverage':98, 'uv_index':0})
        await layouts.async_save(config, 0)
        payload = layouts.payload()
        assert payload['values']['weather.home']['state'] == 'hail'
        assert payload['values']['weather.home']['cloud_coverage'] == '98'
        assert payload['sun']['moon']['azimuth'] >= 0
        assert 'latitude' not in str(payload) and 'longitude' not in str(payload)
        assert layouts.sun() == payload['sun']
    finally:
        await layouts.async_close()
        await hass.async_stop(force=True)


@pytest.mark.parametrize('lat,lon', [(52.52,13.405),(-33.87,151.21),(90,0),(-90,0)])
def test_moon_is_finite_and_changes_with_time_and_location(lat,lon):
    now = datetime(2026,10,23,12,tzinfo=UTC)
    result = moon_position(Observer(lat,lon),now)
    assert all(math.isfinite(value) for value in result.values())
    assert -90 <= result['elevation'] <= 90
    assert 0 <= result['azimuth'] < 360 and 0 <= result['phase'] <= 1
    later = moon_position(Observer(lat,lon),now.replace(hour=18))
    assert result['azimuth'] != later['azimuth']


def test_moon_matches_suncalc_reference_azimuth():
    # Public SunCalc 1.9 reference case; compare degrees north, not radians south.
    result = moon_position(Observer(50.5,30.5), datetime(2013,3,5,tzinfo=UTC))
    assert result['azimuth'] == pytest.approx(123.9435, abs=.02)
