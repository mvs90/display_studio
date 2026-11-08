"""Portable sRGB colors; keep alpha separate on the native wire protocol."""
import math


def split(color):
    """Split validated #RRGGBB[AA] into RGB and straight alpha."""
    return color[:7], int(color[7:9], 16) / 255 if len(color) == 9 else 1.0


def opaque(color):
    """Flatten the bottommost display color over black (no layer beneath it)."""
    rgb, alpha = split(color)
    return '#' + ''.join(f'{math.floor(int(rgb[i:i+2],16)*alpha+.5):02x}' for i in (1,3,5))


def native_colors(widget, *, part=False):
    """Lower alpha colors to existing part/surface opacity, exactly once."""
    if 'background' in widget:
        widget['background'], alpha = split(widget['background'])
        if alpha != 1 and not widget.get('paint'):
            widget['opacity'] = math.floor(widget.get('opacity',255)*alpha+.5)
    # Primitive bars/spinners render accent rather than text color. Their color
    # and accent can be the same RGBA value, so never multiply alpha twice.
    rendered = 'accent' if part and widget.get('icon') in {'spinner','boot_progress'} and 'accent' in widget else 'color'
    for key in ('color','accent'):
        if key not in widget:
            continue
        widget[key], alpha = split(widget[key])
        if alpha != 1:
            if part and key == rendered:
                widget['opacity'] = widget.get('opacity',1)*alpha
            elif not part:
                opacity_key='text_opacity' if key=='color' else 'accent_opacity'
                widget[opacity_key] = widget.get(opacity_key,1)*alpha
    for layer in widget.get('paint',[]):
        for stop in layer['stops']:
            stop[1], alpha = split(stop[1])
            stop[2] *= alpha
    for child in widget.get('parts',[]):
        native_colors(child,part=True)
    if 'feedback' in widget:
        native_colors(widget['feedback'])
