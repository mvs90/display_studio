"""Locally bundled Home Assistant icons; never fetch artwork from the cloud."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import threading
import zlib

ROOT = Path(__file__).parent / "www/symbols"
_packed = {}
_load_lock = threading.Lock()


def load_catalog():
    """Read once in HA's executor; keep compact bytes, not 7,447 object trees."""
    global _packed
    with _load_lock:
        if not _packed:
            _packed = {f"{n:02x}": zlib.compress((ROOT / f"{n:02x}.json").read_bytes())
                       for n in range(256)}


@lru_cache(maxsize=32)
def _chunk(key):
    if not _packed:
        load_catalog()  # Standalone compiler/build tools have no HA startup.
    return json.loads(zlib.decompress(_packed[key]))


def mdi_geometry(name):
    if not isinstance(name, str) or not re.fullmatch(r"mdi:[a-z0-9-]{1,100}", name):
        raise ValueError("Unknown Home Assistant symbol")
    geometry = _chunk(hashlib.sha256(name.encode()).hexdigest()[:2]).get(name)
    if geometry is None:
        raise ValueError("Unknown Home Assistant symbol")
    return geometry
