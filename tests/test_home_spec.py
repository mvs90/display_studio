"""Cold imports must not make filesystem reads on HA's event loop."""
import importlib.util
import json
from pathlib import Path
import re

from custom_components.display_studio.home_theme import SPEC
from scripts.generate_home_spec import generated_source

ROOT = Path(__file__).parents[1] / 'custom_components/display_studio'


def test_native_artwork_matches_browser_and_generated_source_is_current():
    js = (ROOT / 'www/runtime/cards.js').read_text(encoding='utf-8')
    browser = json.loads(re.search(
        r'/\* HOME_SPEC_BEGIN \*/(.*?)/\* HOME_SPEC_END \*/', js
    ).group(1))
    assert SPEC == browser
    assert (ROOT / 'home_spec.py').read_text(encoding='utf-8') == generated_source()


def test_cold_import_does_not_open_runtime_assets(monkeypatch):
    def reject(*args, **kwargs):
        raise AssertionError('Runtime asset read during Home theme import')

    monkeypatch.setattr(Path, 'read_text', reject)
    monkeypatch.setattr(Path, 'read_bytes', reject)
    monkeypatch.setattr(Path, 'open', reject)
    # Execute both module bodies afresh; an already cached theme could hide the bug.
    modules = {}
    for name in ('home_spec', 'home_theme'):
        spec = importlib.util.spec_from_file_location(
            'custom_components.display_studio.' + name, ROOT / (name + '.py')
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules[name] = module
    assert modules['home_theme'].SPEC == modules['home_spec'].SPEC == SPEC
    assert modules['home_theme'].KINDS == set(SPEC['kinds'])
