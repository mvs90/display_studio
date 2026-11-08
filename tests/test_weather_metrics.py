"""Metric values, their shared artwork, and the existing native protocol."""
from copy import deepcopy
import json
from pathlib import Path
import re
import pytest
from custom_components.display_studio.weather_metrics import SPEC, metric_values, badge_image
from custom_components.display_studio.graphics import validate_graphic
from custom_components.display_studio.lvgl import compile_scene

ROOT=Path(__file__).parents[1]/'custom_components/display_studio'


@pytest.mark.parametrize('value',[None,'',' ',True,False,'unknown','unavailable','NaN','Infinity',float('nan'),float('inf')])
def test_missing_and_invalid_metrics_are_not_zero(value):
    assert metric_values({'wind_speed':value,'uv_index':value})=={}


def test_zero_and_units_are_preserved_independently():
    assert metric_values({'wind_speed':'13.300','uv_index':0.0})=={'wind_value':'13.3','uv_value':'0'}
    assert metric_values({'wind_speed':0,'wind_speed_unit':'km/h','uv_index':'0'})=={'wind_value':'0 km/h','uv_value':'0'}
    assert metric_values({'uv_index':' 2.5 '})=={'uv_value':'2.5'}
    assert metric_values({'wind_speed':'12.4','wind_speed_unit':'m/s'})=={'wind_value':'12.4 m/s'}


def test_browser_and_native_use_identical_metric_artwork():
    text=(ROOT/'www/runtime/weather.js').read_text()
    assert json.loads(re.search(r'/\* WEATHER_METRICS_BEGIN \*/(.*?)/\* WEATHER_METRICS_END \*/',text).group(1))==SPEC
    for paths in SPEC['icons'].values():
        assert all(0<=value<=80 for path in paths for point in path for value in point)


def cases():
    return json.loads((Path(__file__).parent/'fixtures/weather-metrics.json').read_text())


@pytest.mark.parametrize('case',cases(),ids=lambda c:c['name'])
def test_compiled_metrics_are_current_bounded_and_separate_from_forecasts(case):
    state={'view':'dashboard','layout':{'config':{'scenes':{'dashboard':case['scene']}},'values':{'weather.test':case['data']},'now':'2026-10-27T12:00:00+00:00'}}
    compiled=compile_scene(state,1024,600)[0]
    assert compiled==case['native']
    card=next(w for w in compiled['widgets'] if w['id']=='dashboard/weather')
    metrics=[p for p in card['parts'] if p['id'].startswith(('wind_','uv_'))]
    assert len(metrics)==8
    for part in metrics:
        assert 0<=part['x'] and part['x']+part['width']<=card['width']
        assert 0<=part['y'] and part['y']+part['height']<=card['height']
        if part.get('icon')=='graphic':validate_graphic(part['graphic'])
    top=min(p['y'] for p in metrics)
    for part in card['parts']:
        if part['id'].startswith('forecast_'):assert part['y']+part['height']<=top
    case=deepcopy(case);case['scene']['glass']=False
    state['layout']['config']['scenes']['dashboard']=case['scene']
    card=compile_scene(state,1024,600)[0]['widgets'][-1]
    assert not any(p['id'].startswith(('wind_','uv_')) for p in card['parts'])


def test_badge_surface_is_cached_not_recomputed_on_each_state_update():
    badge_image.cache_clear()
    assert badge_image(100,36,15) is badge_image(100,36,15)
    assert badge_image.cache_info().hits==1
