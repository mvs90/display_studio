"""Validated local camera inputs shared by Studio and the ESP stream bridge."""
from pathlib import Path
from .layout_config import validate_multicast_url

TEST_VIDEO = Path(__file__).parent / 'www/runtime/test-stream.ts'


def source_key(item):
    source = item.get('camera_source', 'entity')
    if source == 'test':
        return ('test', '')
    if source == 'multicast':
        return ('multicast', validate_multicast_url(item.get('multicast_url', ''), required=True))
    raise ValueError('Unsupported external camera source')


def input_args(item, *, realtime=False):
    source, address = source_key(item)
    if source == 'test':
        return (['-re'] if realtime else []) + ['-stream_loop', '-1', '-i', str(TEST_VIDEO)]
    return ['-i', address + '?fifo_size=131072&overrun_nonfatal=1']
