"""State-color configuration survives storage and lowers to native LVGL colors."""
from copy import deepcopy

import pytest

from custom_components.display_studio.layout_config import element, make_layout, validate_layout
from custom_components.display_studio.lvgl import compile_scene


def layout(**overrides):
    config = make_layout()
    item = element('control', 10, 10, 25, 20)
    item.update(entity_id='switch.test', style_override=True, color='#778899',
                text_opacity=.5, symbol_state_coloring=True,
                symbol_state_colors={'on': '#FF440080', 'off': '#112233', 'unavailable': '#ffffff00'},
                tap_action={'action': 'none', 'entity_id': '', 'view': ''})
    item.update(overrides)
    config['scenes']['dashboard'].update(elements=[item], text_opacity=.5)
    return config


def render(config, state):
    scene, *rest = compile_scene({'view': 'dashboard', 'layout': {
        'config': config, 'values': {'switch.test': {'state': state}}}}, 1024, 600)
    return next(w for w in scene['widgets'] if any(p.get('id') == 'symbol' for p in w.get('parts', [])))


@pytest.mark.parametrize('state,color,opacity', [
    ('on', '#ff4400', .25*128/255), ('off', '#112233', .25),
    ('unavailable', '#ffffff', 0), ('unknown', '#778899', .25),
])
def test_state_changes_update_native_symbol_without_mutating_layout(state, color, opacity):
    config = validate_layout(layout())
    original = deepcopy(config)
    widget = render(config, state)
    part = next(p for p in widget['parts'] if p['id'] == 'symbol')
    assert part['color'] == color
    assert part['opacity'] == pytest.approx(opacity)
    assert config == original
    assert validate_layout(config) == config


def test_disabled_coloring_keeps_saved_palette_and_normal_color():
    config = validate_layout(layout(symbol_state_coloring=False))
    assert config['scenes']['dashboard']['elements'][0]['symbol_state_colors']['on'] == '#ff440080'
    assert render(config, 'on')['parts'][0]['color'] == '#778899'


def test_state_colors_independent_of_navigation_and_button_surface():
    config = validate_layout(layout(symbol_button=True, tap_action={
        'action': 'show_view', 'entity_id': '', 'view': 'media_view'}))
    a, b = render(config, 'on'), render(config, 'off')
    assert a['parts'][0]['color'] != b['parts'][0]['color']
    for key in ('background', 'opacity', 'radius', 'width', 'height'):
        assert a[key] == b[key]
    scene, actions, *_ = compile_scene({'view': 'dashboard', 'layout': {'config': config}}, 1024, 600)
    assert any(action.get('action') == 'show_view' and action.get('view') == 'media_view' for action in actions.values())


def test_decoration_without_entity_keeps_local_navigation():
    config = validate_layout(layout(entity_id='', tap_action={
        'action': 'show_view', 'entity_id': '', 'view': 'media_view'}))
    scene, actions, *_ = compile_scene({'view': 'dashboard', 'layout': {'config': config}}, 1024, 600)
    assert any(a.get('action') == 'show_view' and a.get('view') == 'media_view' for a in actions.values())


@pytest.mark.parametrize('changes', [
    {'symbol_state_coloring': 'true'}, {'symbol_state_coloring': 1},
    {'symbol_state_colors': []}, {'symbol_state_colors': {'on': 'red'}},
    {'symbol_state_colors': {'': '#ffffff'}}, {'symbol_state_colors': {'\n': '#ffffff'}},
    {'symbol_state_colors': {1: '#ffffff'}}, {'symbol_state_colors': {'a'*256: '#ffffff'}},
    {'symbol_state_colors': {str(i): '#ffffff' for i in range(257)}},
])
def test_reject_invalid_state_palettes(changes):
    with pytest.raises(ValueError):
        validate_layout(layout(**changes))


def test_default_layout_does_not_enable_or_invent_state_colors():
    normalized = validate_layout(make_layout())
    assert all(not item.get('symbol_state_coloring') for scene in normalized['scenes'].values() for item in scene['elements'])


def test_state_colors_survive_themed_library_roundtrip():
    from custom_components.display_studio.layout_library import from_config, validate_library
    config = validate_layout(layout(style_override=False))
    library = from_config(config)
    library['active_theme'] = library['themes'][0]['id']
    normalized, stored = validate_library(library, config)
    palette = normalized['scenes']['dashboard']['elements'][0]['symbol_state_colors']
    assert palette == {'on': '#ff440080', 'off': '#112233', 'unavailable': '#ffffff00'}
    assert render(normalized, 'on')['parts'][0]['color'] == '#ff4400'
    assert validate_library(stored, normalized) == (normalized, stored)
