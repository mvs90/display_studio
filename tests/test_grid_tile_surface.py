"""Grid previews, saved theme inheritance and native widgets share tile surfaces."""
from copy import deepcopy

import pytest

from custom_components.display_studio.layout_config import element, make_layout, validate_layout
from custom_components.display_studio.layout_library import from_config, validate_library
from custom_components.display_studio.layout_themes import inherit_element_style
from custom_components.display_studio.lvgl import compile_scene


@pytest.mark.parametrize('kind', ['clock', 'logo', 'animation', 'control', 'text', 'weather', 'media', 'camera'])
def test_grid_surface_survives_save_theme_change_and_native_compilation(kind):
    config = make_layout()
    item = element(kind, 5, 5, 40, 35)
    item.update(tile_surface=True, grid_size=True, style_override=False)
    if kind in ('logo', 'control'):
        item['content_padding'] = 14
    config['scenes']['dashboard']['elements'] = [item]
    config = validate_layout(config)
    library = from_config(config)
    _, normalized = validate_library(library, config)
    palette = dict(ink='#abcdef', surface='#183a52', card_accent='#45abcd')
    for view in normalized['views']:
        for card in view['scene']['elements']:
            if card.get('tile_surface'):
                inherit_element_style(card, palette)
                view['scene']['glass'] = True
                view['scene']['surface_opacity'] = .6
                scene = view['scene']
    assert scene['elements'][0]['tile_surface'] is True
    assert scene['elements'][0]['style_override'] is False
    assert scene['elements'][0]['opacity'] == .92
    assert scene['elements'][0]['background'] == palette['surface']
    payload = compile_scene({'view':'dashboard', 'layout':{'config':{'scenes':{'dashboard':scene}}}}, 1024, 600)[0]
    widget = next(w for w in payload['widgets'] if w['id'] == 'dashboard/' + item['id'])
    assert widget['opacity'] == round(255 * .92 * .6 * .45)
    assert widget['glass'] is True
    assert 'glass_clock' not in widget
    assert widget['background'] == palette['surface']
    if kind in ('logo', 'control'):
        assert scene['elements'][0]['content_padding'] == 14


@pytest.mark.parametrize('kind', ['clock', 'logo', 'animation', 'control'])
def test_existing_frameless_widgets_stay_frameless(kind):
    item = element(kind, 0, 0, 50, 50)
    inherit_element_style(item, dict(ink='#ffffff', surface='#111111', card_accent='#abcdef'))
    assert item['opacity'] == 0
    assert 'tile_surface' not in item


def test_tile_surface_requires_a_boolean():
    config = make_layout()
    config['scenes']['dashboard']['elements'][0]['tile_surface'] = 'true'
    with pytest.raises(ValueError):
        validate_layout(config)
