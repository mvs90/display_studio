from copy import deepcopy
import pytest
from custom_components.display_studio.fonts import FONTS, FONT_FILES, font_assets, font_path
from custom_components.display_studio.layout_config import make_layout, element, validate_layout
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.lvgl_geometry import font
from custom_components.display_studio.providers import load_assets
from custom_components.display_studio.frontend import ASSET_FILES
from custom_components.display_studio.browser import ASSETS


def test_every_delivery_path_serves_identical_font_bytes():
    from custom_components.display_studio.esphome import runtime_assets
    assets=font_assets()
    assert len(assets)==10
    assert set(FONT_FILES)<=set(ASSET_FILES)
    for bundle in [load_assets(),runtime_assets()]:
        for name,data in assets.items():assert bundle[name]==data
    assert all(ASSETS[name]=='font/ttf' for name in assets)


@pytest.mark.parametrize('family',FONTS)
def test_font_choice_survives_validation_and_native_compilation(family):
    config=make_layout();item=element('clock',0,0,25,20)
    item.update(font=family,clock_size='clock_medium',clock_base_height=20,
                parts={'time':{'font_size':70},'date':{'font':'mono','font_size':18}})
    config['scenes']['dashboard']['elements']=[item]
    normalized=validate_layout(config)
    assert normalized['scenes']['dashboard']['elements'][0]['clock_size']=='clock_medium'
    document=compile_scene({'view':'dashboard','layout':{'config':normalized}},1024,600)[0]
    widget=next(w for w in document['widgets'] if w['type']=='clock')
    assert widget['font']==family
    assert {p['id']:p['font'] for p in widget['parts']}=={'time':family,'date':'mono'}
    assert font_path(family).is_file() and font_path(family,600).is_file()


def test_all_families_have_distinct_metrics_and_native_clock_keeps_size_when_compacted():
    assert len({font(32,f).getlength('Welt Äg 0123456789') for f in FONTS})==5
    config=make_layout();item=element('clock',0,0,25,20)
    item.update(parts={'time':{'font_size':70},'date':{'font_size':18}},clock_base_height=20)
    config['scenes']['dashboard']['elements']=[item]
    def native():return next(w for w in compile_scene({'view':'dashboard','layout':{'config':validate_layout(config)}},1024,600)[0]['widgets'] if w['type']=='clock')
    original=native();item['height']=5;item['parts']['time']['visible']=False
    compact=native();assert compact['height']==30
    assert compact['parts'][0]['font_size']==original['parts'][1]['font_size']
    assert compact['parts'][0]['clock_ink']['relative'] is True
    assert compact['parts'][0]['clock_ink']['y']==50
    assert compact['parts'][0]['clock_ink']['height']==30
