"""Portable, bounded RGBA graphics shared by browser and offline LVGL scenes.

Palette entries are RGB565 + alpha. Runs are count/index byte pairs (hex).
No external URLs, decoders or network access are needed on the display.
"""
from functools import lru_cache
from pathlib import Path
import json
import re

MAX_DATA = 6000


@lru_cache(maxsize=1)
def catalog():
    return json.loads(Path(__file__).with_name("graphics.json").read_text())


def validate_graphic(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid graphic")
    width, height = value.get("width"), value.get("height")
    palette, runs = value.get("palette"), value.get("runs")
    if (type(width) is not int or type(height) is not int or not 1 <= width <= 256 or not 1 <= height <= 256
            or not isinstance(palette, str) or not isinstance(runs, str)
            or not 6 <= len(palette) <= 64 * 6 or len(palette) % 6 or not runs or len(runs) % 4
            or len(palette) + len(runs) > MAX_DATA or not re.fullmatch("[a-f0-9]+", palette + runs)):
        raise ValueError("Invalid graphic dimensions or encoding")
    data = bytes.fromhex(runs)
    if any(not data[i] or data[i+1] >= len(palette)//6 for i in range(0, len(data), 2)) or sum(data[::2]) != width*height:
        raise ValueError("Invalid graphic pixels")
    if not any(bytes.fromhex(palette)[2::3]):
        raise ValueError("Graphic is completely transparent")
    return dict(width=width, height=height, palette=palette, runs=runs)


def encode_graphic(image):
    """Trim alpha margins and keep the highest resolution fitting the budget."""
    from PIL import Image
    image = image.convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("Die Grafik ist vollständig transparent.")
    image = image.crop(bounds)
    for size in (256, 192, 144, 108, 80, 60, 44, 32):
        preview = image.copy()
        preview.thumbnail((size, size), Image.Resampling.LANCZOS)
        quantized = preview.quantize(colors=64, method=Image.Quantize.FASTOCTREE).convert("RGBA")
        colors, indices = [], {}
        runs = bytearray()
        previous, count = -1, 0
        for r, g, b, a in quantized.getdata():
            pixel = (((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3), a)
            if pixel not in indices:
                indices[pixel] = len(colors)
                colors.append(pixel)
            index = indices[pixel]
            if index == previous and count < 255:
                count += 1
            else:
                if count:
                    runs.extend((count, previous))
                previous, count = index, 1
        runs.extend((count, previous))
        palette = "".join(f"{rgb:04x}{alpha:02x}" for rgb, alpha in colors)
        if len(palette) + len(runs)*2 <= MAX_DATA:
            return validate_graphic(dict(width=preview.width, height=preview.height, palette=palette, runs=runs.hex()))
    raise ValueError("Die Grafik ist zu komplex für den lokalen Grafikspeicher.")


def import_graphic(source):
    from io import BytesIO
    from PIL import Image
    from .photo_import import prepare_photo
    normalized = prepare_photo(source, (1024, 1024), preserve_alpha=True)
    with Image.open(BytesIO(normalized)) as image:
        return encode_graphic(image)


def graphic_for(item):
    key = item.get("graphic_id", "esphome")
    return item.get("graphic") if key == "custom" else catalog()[key]["image"]
