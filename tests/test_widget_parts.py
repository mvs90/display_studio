"""Widget parts are declarative, bounded and retained across theme/offline saves."""

from copy import deepcopy
import pytest
from custom_components.display_studio.layout_config import (
    element,
    make_layout,
    validate_layout,
)
from custom_components.display_studio.layout_library import from_config, validate_library
from custom_components.display_studio.widget_parts import PARTS, TEXT_PARTS
from tests.test_layouts import layouts  # noqa: F401


def example(kind="clock"):
    config = make_layout()
    item = element(kind, 0, 0, 100, 100)
    config["scenes"]["dashboard"]["elements"] = [item]
    return config, item


@pytest.mark.parametrize("kind", PARTS)
def test_every_part_roundtrips_with_bounded_styles(kind):
    config, item = example(kind)
    item["parts"] = {
        key: dict(
            visible=True,
            x=10,
            y=10,
            width=80,
            height=80,
            font_size=15,
            font="serif",
            font_weight=600,
            align="center",
            color="#aabbcc",
            opacity=0.7,
            z_index=3,
            radius=5,
            fit="contain",
        )
        for key in PARTS[kind]
    }
    for key in TEXT_PARTS[kind]:
        item["parts"][key]["text"] = "<script>literal text</script>"
    if kind == "clock":
        item.update(clock_time_format="12h", clock_date_format="weekday")
    elif kind == "control":
        item.update(label="Symbole · Play",show_label=False)
    elif kind == "logo":
        item.update(label="Grafik · ESPHome",show_label=False)
    assert validate_layout(config)["scenes"]["dashboard"]["elements"][0] == item


@pytest.mark.parametrize(
    "part",
    [
        {"unknown": {}},
        {"time": {"x": 2}},
        {"time": {"visible": "false"}},
        {"time": {"font_size": float("inf")}},
        {"time": {"font_size": float("nan")}},
        {"time": {"font": "url(https://outside)"}},
        {"time": {"onclick": "code"}},
        {"time": {"color": "red;display:none"}},
        {"time": {"font_weight": 123}},
        {"time": {"x": 80, "y": 10, "width": 30, "height": 20}},
        {"time": {"text": "a" * 2001}},
        {"time": {"height": True}},
    ],
)
def test_invalid_parts_are_rejected(part):
    config, item = example()
    item["parts"] = part
    with pytest.raises(ValueError):
        validate_layout(config)


def test_non_text_parts_do_not_allow_replacing_the_decoder_or_cover_dom():
    for kind, key in (("media", "cover"), ("media", "progress"), ("camera", "picture")):
        config, item = example(kind)
        item["parts"] = {key: {"text": "not allowed"}}
        with pytest.raises(ValueError):
            validate_layout(config)


def test_themes_preserve_part_geometry_fonts_and_visibility_but_inherit_colours():
    config, item = example()
    item["parts"] = {
        "time": {"visible": False},
        "date": {
            "font_size": 15,
            "font": "serif",
            "color": "#123456",
            "x": 10,
            "y": 30,
            "width": 80,
            "height": 40,
        },
    }
    library = from_config(config)
    library["active_theme"] = "aurora"
    expected = deepcopy(item["parts"])
    del expected["date"]["color"]
    runtime, _ = validate_library(library, config)
    assert runtime["scenes"]["dashboard"]["elements"][0]["parts"] == expected
    library["views"][1]["theme_override"] = True
    runtime, _ = validate_library(library, config)
    assert runtime["scenes"]["dashboard"]["elements"][0]["parts"] == item["parts"]


async def test_offline_startup_preserves_local_clock_parts_and_changes_bundle_version(
    layouts,
):
    config = deepcopy(layouts.config)
    clock = element("clock", 5, 5, 90, 40)
    clock.update(
        clock_date_format="iso",
        clock_time_format="24h",
        parts={"time": {"visible": False}, "date": {"font": "mono", "font_size": 20}},
    )
    config["scenes"]["startup"]["elements"] = [clock]
    before = layouts.startup_design.version
    await layouts.async_save(config, 0)
    doc = layouts.startup_design.document()
    assert doc["scene"]["elements"][0]["parts"] == clock["parts"]
    assert doc["scene"]["elements"][0]["clock_date_format"] == "iso"
    assert layouts.startup_design.version != before

@pytest.mark.parametrize('value',[False,True])
def test_clock_options_and_edge_anchors_roundtrip(value):
    config,item=example()
    item.update(clock_seconds=value,clock_blink=value)
    item['parts']={'time':dict(anchor_x=0,anchor_y=100),'date':dict(anchor_x=100,anchor_y=0)}
    assert validate_layout(config)['scenes']['dashboard']['elements'][0]==item

@pytest.mark.parametrize('invalid',[{'anchor_x':0},{'anchor_x':0,'anchor_y':101},{'anchor_x':float('nan'),'anchor_y':0},{'anchor_x':True,'anchor_y':0}])
def test_invalid_clock_anchor_rejected(invalid):
    config,item=example();item['parts']={'time':invalid}
    with pytest.raises(ValueError):validate_layout(config)

@pytest.mark.parametrize('key',['clock_seconds','clock_blink'])
@pytest.mark.parametrize('value',[1,'false',None])
def test_clock_options_require_boolean(key,value):
    config,item=example();item[key]=value
    with pytest.raises(ValueError):validate_layout(config)

@pytest.mark.parametrize('part',['time','date'])
def test_clock_frame_and_aspect_preference_roundtrip(part):
    from custom_components.display_studio.layout_config import make_layout, validate_layout
    config=make_layout();item=next(i for i in config['scenes']['dashboard']['elements'] if i['kind']=='clock')
    item['lock_ratio']=False;item['manual_size']=True;item['parts']={part:dict(frame_width=100,frame_height=65,anchor_x=100,anchor_y=100)}
    saved=next(i for i in validate_layout(config)['scenes']['dashboard']['elements'] if i['kind']=='clock')
    assert saved['lock_ratio'] is False and saved['manual_size'] is True
    assert saved['parts'][part]==item['parts'][part]
    item['lock_ratio']='false'
    with pytest.raises(ValueError):validate_layout(config)

@pytest.mark.parametrize('value',[0,101,True,float('nan')])
def test_invalid_clock_frame_rejected(value):
    from custom_components.display_studio.widget_parts import validate_parts
    with pytest.raises(ValueError):validate_parts({'date':{'frame_width':value}},'clock')
    with pytest.raises(ValueError):validate_parts({'label':{'frame_width':100}},'clock')
    with pytest.raises(ValueError):validate_parts({'text':{'frame_width':100}},'text')


@pytest.mark.parametrize("value", [1, "true", None])
def test_manual_size_requires_boolean(value):
    config,item=example();item["manual_size"]=value
    with pytest.raises(ValueError):validate_layout(config)
