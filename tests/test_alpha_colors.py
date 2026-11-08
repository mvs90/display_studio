from copy import deepcopy
import pytest
from custom_components.display_studio.layout_config import make_layout, element, validate_layout
from custom_components.display_studio.widget_parts import validate_parts
from custom_components.display_studio.lvgl import compile_scene
from custom_components.display_studio.color import native_colors


def test_alpha_roundtrip_and_native_composition_preserve_zero():
    config=make_layout();item=element('clock',0,0,25,20)
    item.update(color='#FF660080',background='#12345600',opacity=.5,parts={'time':{'color':'#AABBCC80','opacity':.5},'date':{'color':'#12345600'}})
    config['scenes']['dashboard'].update(elements=[item],text_opacity=.5,color='#12345680')
    normalized=validate_layout(config);clock=normalized['scenes']['dashboard']['elements'][0]
    assert clock['background']=='#12345600' and clock['parts']['time']['color']=='#aabbcc80'
    original=deepcopy(normalized)
    result=compile_scene({'view':'dashboard','layout':{'config':normalized}},1024,600)[0]
    widget=next(w for w in result['widgets'] if w['type']=='clock');parts={p['id']:p for p in widget['parts']}
    assert widget['background']=='#123456' and widget['opacity']==0
    assert parts['time']['color']=='#aabbcc' and parts['time']['opacity']==pytest.approx(.5*.5*128/255)
    assert parts['date']['opacity']==0
    assert normalized==original


def test_gradient_alpha_and_primitive_alpha_are_applied_once():
    config=make_layout();scene=config['scenes']['dashboard']
    scene.update(background='gradient',color='#ff000080',accent='#0000ff00',elements=[])
    result=compile_scene({'view':'dashboard','layout':{'config':config}},1024,600)[0]
    assert result['widgets'][0]['paint'][0]['stops']==[[0,'#ff0000',128/255],[1,'#0000ff',0]]
    part={'icon':'boot_progress','color':'#12345680','accent':'#12345680','opacity':.5}
    native_colors(part,part=True)
    assert part['color']==part['accent']=='#123456' and part['opacity']==pytest.approx(.5*128/255)


def test_feedback_and_control_transparency_are_lowered_together():
    obj={'color':'#11223380','accent':'#00ffff00','parts':[{'color':'#11223380','opacity':.4}],
         'feedback':{'background':'#11223380','opacity':200,'parts':[{'color':'#00ffff00','opacity':1}]}}
    native_colors(obj)
    assert obj['text_opacity']==pytest.approx(128/255) and obj['accent_opacity']==0
    assert obj['parts'][0]['opacity']==pytest.approx(.4*128/255)
    assert obj['feedback']['opacity']==100 and obj['feedback']['parts'][0]['opacity']==0


@pytest.mark.parametrize('bad',['#12345','#1234567','#123456789','rgba(1,2,3,.5)','transparent','#123456zz'])
def test_color_protocol_accepts_only_canonical_hex(bad):
    with pytest.raises(ValueError):validate_parts({'time':{'color':bad}},'clock')
