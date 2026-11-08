"""Font catalog shared with all browser renderers, backed by identical local TTFs."""
import json,re
from pathlib import Path
ROOT=Path(__file__).parent
FONTS=json.loads(re.search(r"/\* FONT_CATALOG_BEGIN \*/(.*?)/\* FONT_CATALOG_END \*/",(ROOT/'www/runtime/layout.js').read_text()).group(1))
FONT_FILES=tuple(spec[weight] for spec in FONTS.values() for weight in ('regular','bold'))
def font_path(family='sans',weight=400):
    return ROOT/'fonts'/FONTS.get(family,FONTS['sans'])['bold' if isinstance(weight,(float,int)) and weight>=600 else 'regular']
def font_assets():
    return {name:(ROOT/'fonts'/name).read_bytes() for name in FONT_FILES}
