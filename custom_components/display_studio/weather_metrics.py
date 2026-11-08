"""Wind/UV badges, using the browser's shared artwork and existing LVGL parts."""
from functools import lru_cache
import json
import math
from pathlib import Path

SPEC = json.loads(Path(__file__).with_suffix('.json').read_text())


def metric_values(data):
    result = {}
    for key, attribute in (('wind', 'wind_speed'), ('uv', 'uv_index')):
        value = data.get(attribute)
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            continue
        try:
            if not str(value).strip() or not math.isfinite(float(value)):
                continue
        except ValueError:
            continue
        text = format(float(value), '.15g')
        if key == 'wind' and data.get('wind_speed_unit'):
            text += ' ' + str(data['wind_speed_unit'])
        result[key+'_value'] = text
    return result


@lru_cache(maxsize=128)
def badge_image(width, height, radius):
    """Small cached, antialiased surface; text and symbols stay native vectors."""
    from PIL import Image, ImageDraw
    from .graphics import encode_graphic
    scale = 4
    image = Image.new('RGBA', (width*scale, height*scale))
    color = lambda key, opacity: tuple(bytes.fromhex(SPEC[key][1:]))+(round(255*SPEC[opacity]),)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, width*scale-1, height*scale-1), radius=radius*scale,
                           fill=color('border_color', 'border_opacity'))
    inset = SPEC['border']*scale
    # CSS paints the translucent background underneath the translucent border.
    background = Image.new('RGBA', image.size)
    ImageDraw.Draw(background).rounded_rectangle((0, 0, width*scale-1, height*scale-1),
        radius=radius*scale, fill=color('background', 'background_opacity'))
    draw.rounded_rectangle((inset, inset, width*scale-1-inset, height*scale-1-inset),
                           radius=max(0, radius*scale-inset), fill=(0, 0, 0, 0))
    return encode_graphic(Image.alpha_composite(background, image).resize((width,height), Image.Resampling.LANCZOS))


def native_metrics(item, scene, width, height, base, padding_x, padding_y, texts):
    from .lvgl_geometry import font, pixels
    active = [key for key in ('wind','uv') if key+'_value' in texts]
    if not scene.get('glass') or not active:
        return [], 0
    unit = base*SPEC['scale']
    family = scene.get('text_font') if not item.get('style_override') and scene.get('text_font','auto')!='auto' else item.get('font','sans')
    inherited = scene.get('text_weight','auto')
    weight = inherited if isinstance(inherited, int) else 400
    value_size, label_size = [max(4,pixels(unit*SPEC[key])) for key in ('value_size','label_size')]
    value_line, label_line = [pixels(size*SPEC['line_height']) for size in (value_size,label_size)]
    icon = unit*SPEC['icon_size']
    content_height = max(icon, value_line+label_line)
    badge_height = pixels(content_height+2*(SPEC['border']+unit*SPEC['padding_y']))
    top = height-padding_y-badge_height
    x = padding_x
    opacity = scene.get('text_opacity',1)*item.get('text_opacity',1)
    parts = []
    for key in active:
        text, title = texts[key+'_value'], 'Wind' if key=='wind' else 'UV-Index'
        text_width = math.ceil(max(font(value_size,family,500).getlength(text),font(label_size,family,weight).getlength(title)))+1
        badge_width = pixels(2*(SPEC['border']+unit*SPEC['padding_x'])+icon+unit*SPEC['icon_gap']+text_width)
        left = x+SPEC['border']+unit*SPEC['padding_x']
        text_x = left+icon+unit*SPEC['icon_gap']
        text_y = top+(badge_height-value_line-label_line)/2
        common = dict(text='',units='px',font_size=value_size,font=family,align='left',color=item['color'],opacity=opacity,nowrap=True)
        def part(suffix, px, py, pw, ph, **extra):
            parts.append(dict(common, id=key+'_'+suffix,x=pixels(px),y=pixels(py),width=max(1,pixels(pw)),height=max(1,pixels(ph)),**extra))
        part('badge',x,top,badge_width,badge_height,icon='graphic',graphic=badge_image(badge_width,badge_height,pixels(unit*SPEC['radius'])))
        # Surface opacity is independent of the text opacity in Studio.
        parts[-1]['opacity']=1
        part('icon',left,top+(badge_height-icon)/2,icon,icon,icon='control',paths=SPEC['icons'][key],stroke_width=SPEC['stroke_width']*80/24)
        part('value',text_x,text_y,text_width,value_line,line_height=value_line,font_weight=500)
        parts[-1]['text']=text
        part('label',text_x,text_y+value_line,text_width,label_line,line_height=label_line,font_weight=weight)
        parts[-1].update(text=title,font_size=label_size,opacity=opacity*SPEC['label_opacity'])
        x += badge_width+unit*SPEC['gap']
    return parts, badge_height+unit*SPEC['margin']
