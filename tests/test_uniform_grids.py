"""Real editor-generated grids survive HA storage and native pixel conversion."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from custom_components.display_studio.layout_config import element, make_layout
from custom_components.display_studio.layout_library import from_config, sync_legacy, validate_library
from custom_components.display_studio.lvgl import compile_scene

FIXTURES = sorted((Path(__file__).parent / 'fixtures').glob('uniform-grid-*.json'))
CASES = [case for path in FIXTURES for case in json.loads(path.read_text())]


def test_editor_grid_fixture_coverage():
    assert {(c['width'], c['height']) for c in CASES} == {(1024, 600), (600, 1024), (1920, 1080), (900, 900)}
    assert len(CASES) == 44


@pytest.mark.parametrize('case', CASES, ids=lambda c: f"{c['id']}-{c['width']}x{c['height']}")
def test_uniform_editor_grid_storage_and_native_geometry(case):
    config = make_layout()
    library = from_config(config)
    view = deepcopy(library['views'][1])
    view.update(id='view_uniform', name='Raster', grid=deepcopy(case['grid']))
    view['scene']['elements'] = []
    for index, cell in enumerate(case['grid']['cells']):
        widget = element('text', cell['x'], cell['y'], cell['width'], cell['height'])
        widget.update(id=f'cell_{index}', grid_size=True, manual_size=False)
        view['scene']['elements'].append(widget)
    library['views'].append(view)
    runtime, saved = validate_library(library, config)
    restored = next(v for v in sync_legacy(saved, runtime)['views'] if v['id'] == view['id'])
    assert restored['grid'] == case['grid']
    assert 'grid' not in runtime['scenes'][view['id']]
    payload, _, _ = compile_scene({'view': view['id'], 'layout': {'config': runtime, 'values': {}}}, case['width'], case['height'])
    native = {w['id']: w for w in payload['widgets']}
    for index, cell in enumerate(case['grid']['cells']):
        widget = native[f"view_uniform/cell_{index}"]
        for key in ('x', 'y', 'width', 'height'):
            extent = case['width'] if key in ('x', 'width') else case['height']
            assert abs(widget[key] - cell[key] * extent / 100) <= 1
