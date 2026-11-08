"""Camera boundaries, shared work and optional automation installation."""

import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
import pytest

from custom_components.display_studio.blueprint import install_blueprint
from custom_components.display_studio.layout_camera import LayoutCamera
from custom_components.display_studio.layout_config import (
    element,
    make_layout,
    validate_layout,
)


def test_camera_scene_accepts_one_video_and_rejects_invalid_sources():
    config = make_layout()
    item = element("camera", 65, 5, 30, 30)
    config["scenes"]["hdmi_full"]["elements"][0]["width"] = 60
    config["scenes"]["hdmi_full"]["elements"].append(item)
    assert (
        validate_layout(config)["scenes"]["hdmi_full"]["elements"][1]["camera_source"]
        == "test"
    )
    for values in (
        {"camera_interval": 0.5},
        {"camera_interval": 301},
        {"camera_mode": "rtsp"},
        {"camera_source": "https://secret"},
        {"entity_id": "media_player.wrong"},
        {"camera_fit": "css"},
    ):
        bad = deepcopy(config)
        bad["scenes"]["hdmi_full"]["elements"][1].update(values)
        with pytest.raises(ValueError):
            validate_layout(bad)
    config["scenes"]["hdmi_full"]["elements"].append({**item, "id": "second"})
    with pytest.raises(ValueError, match="one additional"):
        validate_layout(config)


@pytest.fixture
async def cameras(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    hass.states.async_set("camera.door", "idle")
    manager = LayoutCamera(hass)
    manager.registry = {}
    with patch(
        "custom_components.display_studio.layout_camera.er.async_get",
        return_value=SimpleNamespace(async_get=manager.registry.get),
    ):
        yield manager
    await manager.async_close()
    await hass.async_stop(force=True)


async def test_camera_requests_are_demand_driven_coalesced_cached_and_resized(cameras):
    source = (Path(__file__).parent / "fixtures/media-cover.png").read_bytes()
    fetch = AsyncMock(return_value=SimpleNamespace(content=source))
    with patch(
        "custom_components.display_studio.layout_camera.camera.async_get_image", fetch
    ):
        first, second = await asyncio.gather(
            *(cameras.async_get("camera.door", "image") for _ in range(2))
        )
        assert first == second and first.startswith(b"\xff\xd8\xff")
        assert await cameras.async_get("camera.door", "image") == first
        fetch.assert_awaited_once()
        await cameras.async_close()
        assert not cameras._cache and not cameras._tasks
        assert await cameras.async_get("camera.door", "image") is None


async def test_only_ha_hls_endpoint_is_shared_and_failures_are_cached(cameras):
    fetch = AsyncMock(return_value="rtsp://user:password@camera.local/")
    with patch(
        "custom_components.display_studio.layout_camera.camera.async_request_stream", fetch
    ):
        assert await cameras.async_get("camera.door", "stream") is None
        assert await cameras.async_get("camera.door", "stream") is None
        fetch.assert_awaited_once()
        cameras._cache.clear()
        fetch.return_value = "/api/hls/scoped-token/master_playlist.m3u8"
        assert (await cameras.async_get("camera.door", "stream")).startswith(
            "/api/hls/"
        )


async def test_lg_preview_feedback_and_unavailable_entities_are_blocked(cameras):
    entry = SimpleNamespace(entity_id="camera.lg_preview", platform="lg_rs232_ip", config_entry_id="lg-own")
    cameras.target_lg_entry_id = "lg-own"
    cameras.registry[entry.entity_id] = entry
    cameras.hass.states.async_set(entry.entity_id, "idle")
    assert not cameras.allowed(entry.entity_id)
    other = SimpleNamespace(entity_id="camera.lg_other", platform="lg_rs232_ip", config_entry_id="lg-other")
    cameras.registry[other.entity_id] = other
    cameras.hass.states.async_set(other.entity_id, "idle")
    assert cameras.allowed(other.entity_id)
    cameras.target_lg_entry_id = None  # ESP/browser have no LG self-preview.
    assert cameras.allowed(entry.entity_id)
    assert not cameras.allowed("camera.unknown")
    cameras.hass.states.async_set("camera.door", "unavailable")
    assert not cameras.allowed("camera.door")


async def test_unload_cancels_camera_work_without_leaking_cache(cameras):
    started = asyncio.Event()

    async def fetch(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    with patch(
        "custom_components.display_studio.layout_camera.camera.async_get_image", fetch
    ):
        task = asyncio.create_task(cameras.async_get("camera.door", "image"))
        await asyncio.wait_for(started.wait(), 1)
        await cameras.async_close()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not cameras._tasks and not cameras._cache


def test_blueprint_install_does_not_overwrite_local_edits(tmp_path):
    install_blueprint(tmp_path)
    path = tmp_path / "blueprints/automation/display_studio/event_view.yaml"
    assert "display_studio.show_view" in path.read_text()
    path.write_text("user modified this")
    install_blueprint(tmp_path)
    assert path.read_text() == "user modified this"


def test_native_stream_overlap_is_rejected_but_auto_and_snapshot_overlays_work():
    config = make_layout()
    item = element("camera", 64, 60, 32, 32)
    config["scenes"]["hdmi_full"]["elements"].append(item)
    with pytest.raises(ValueError, match="beside HDMI"):
        validate_layout(config)
    item.update(camera_source="entity", camera_mode="stream", entity_id="camera.door")
    with pytest.raises(ValueError, match="beside HDMI"):
        validate_layout(config)
    for mode in ("auto", "snapshot"):
        item["camera_mode"] = mode
        assert (
            validate_layout(config)["scenes"]["hdmi_full"]["elements"][1]["camera_mode"]
            == mode
        )


def test_local_camera_supports_live_or_configurable_snapshot_without_an_entity():
    for mode in ('auto','stream','snapshot'):
        config=make_layout()
        camera=element('camera',0,0,30,30)
        camera.update(camera_source='local',camera_mode=mode,camera_interval=5)
        config['scenes']['dashboard']['elements']=[camera]
        result=validate_layout(config)['scenes']['dashboard']['elements'][0]
        assert result['camera_mode']==mode and result['camera_interval']==5
        camera['camera_interval']=300
        assert validate_layout(config)['scenes']['dashboard']['elements'][0]['camera_interval']==300

async def test_external_sources_validate_deduplicate_and_close(cameras):
    from custom_components.display_studio.camera_sources import input_args
    assert input_args({'camera_source':'test'})[-1].endswith('/test-stream.ts')
    for address in ('http://example.test','udp://127.0.0.1:1234','udp://239.1.2.3:1234?file=x','udp://user@239.1.2.3:1234'):
        with pytest.raises(ValueError):
            await cameras.async_item({'camera_source':'multicast','multicast_url':address},'image')
    assert await cameras.async_item({'camera_source':'test'},'stream')=='/display_studio/runtime/test-stream.m3u8'
    calls=[]
    async def spawn(*args,**kwargs):
        calls.append(args)
        assert args[args.index('-i')+1]=='udp://239.1.2.3:5000?fifo_size=131072&overrun_nonfatal=1'
        reader=asyncio.StreamReader();reader.feed_data(b'\xff\xd8test\xff\xd9');reader.feed_eof()
        return SimpleNamespace(stdout=reader,returncode=0)
    item={'camera_source':'multicast','multicast_url':'udp://239.1.2.3:5000'}
    with patch('asyncio.create_subprocess_exec',side_effect=spawn):
        first,second=await asyncio.gather(cameras.async_item(item,'image'),cameras.async_item(item,'image'))
        assert first==second==b'\xff\xd8test\xff\xd9' and len(calls)==1
        assert await cameras.async_item(item,'image')==first
    stream=SimpleNamespace(add_provider=lambda *args,**kwargs:None,start=AsyncMock(),stop=AsyncMock(),endpoint_url=lambda fmt:'/api/hls/test/master_playlist.m3u8')
    with patch('homeassistant.components.stream.create_stream',return_value=stream):
        assert await cameras.async_item(item,'stream')=='/api/hls/test/master_playlist.m3u8'
    await cameras.async_close();stream.stop.assert_awaited_once()

async def test_external_snapshot_unload_reaps_process(cameras):
    started=asyncio.Event();process=SimpleNamespace(stdout=asyncio.StreamReader(),returncode=None,wait=AsyncMock())
    process.kill=lambda:setattr(process,'returncode',-9)
    async def spawn(*args,**kwargs):started.set();return process
    with patch('asyncio.create_subprocess_exec',side_effect=spawn):
        task=asyncio.create_task(cameras.async_item({'camera_source':'test'},'image'))
        await started.wait();await cameras.async_close()
        with pytest.raises(asyncio.CancelledError):await task
        assert process.returncode==-9 and not cameras._cache and not cameras._tasks

async def test_unsaved_source_preview_is_admin_only_and_validated(cameras):
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from custom_components.display_studio.layout_api import LayoutCameraView
    cameras.hass.data['display_studio']={'lab':{'layouts':SimpleNamespace(cameras=cameras)}}
    view=LayoutCameraView(cameras.hass)
    @web.middleware
    async def authenticate(request,handler):
        request['hass_user']=SimpleNamespace(is_admin=request.headers.get('X-Admin')=='yes')
        return await handler(request)
    app=web.Application(middlewares=[authenticate])
    async def post(request):return await view.post(request,request.match_info['entry'])
    app.router.add_post('/{entry}',post)
    async with TestClient(TestServer(app)) as client:
        body={'camera_source':'test','kind':'stream'}
        assert (await client.post('/lab',json=body)).status==403
        assert (await client.post('/unknown',json=body,headers={'X-Admin':'yes'})).status==404
        for source in ('local','https://example.test'):
            assert (await client.post('/lab',json={**body,'camera_source':source},headers={'X-Admin':'yes'})).status==400
        result=await client.post('/lab',json=body,headers={'X-Admin':'yes'})
        assert result.status==200 and (await result.json())['stream'].endswith('/test-stream.m3u8')


async def test_lg_live_uses_ha_mjpeg_without_hls_or_source_credentials(cameras):
    cameras.registry["camera.door"] = SimpleNamespace(platform="lg_rs232_ip", config_entry_id="other")
    entity = SimpleNamespace(access_tokens=["expired", "camera_only_token"])
    with patch("custom_components.display_studio.layout_camera.camera.get_camera_from_entity_id", return_value=entity), patch("custom_components.display_studio.layout_camera.camera.async_request_stream", AsyncMock()) as hls:
        assert await cameras.async_get("camera.door", "stream") == "/api/camera_proxy_stream/camera.door?token=camera_only_token"
        entity.access_tokens.append("rotated")
        assert (await cameras.async_get("camera.door", "stream")).endswith("token=rotated")
        hls.assert_not_called()
        cameras.target_lg_entry_id = "other"
        assert await cameras.async_get("camera.door", "stream") is None


def test_native_multiple_cameras_keep_lg_limit_and_bound_live_channels():
    config=make_layout()
    cameras=[]
    for n in range(8):
        item=element('camera',n%4*25,n//4*30,24,25)
        item.update(id=f'camera_{n}',camera_mode='snapshot',camera_source='local' if n==0 else 'test')
        cameras.append(item)
    config['scenes']['dashboard']['elements']=cameras
    assert len(validate_layout(config,camera_limit=8)['scenes']['dashboard']['elements'])==8
    with pytest.raises(ValueError,match='one additional'):validate_layout(config)
    for item in cameras[1:4]:item['camera_mode']='stream'
    validate_layout(config,camera_limit=8)
    cameras[4]['camera_mode']='stream'
    with pytest.raises(ValueError,match='three external'):validate_layout(config,camera_limit=8)
    cameras[0]['camera_source']='test'
    validate_layout(config,camera_limit=8)
    cameras.append({**cameras[-1],'id':'ninth'})
    with pytest.raises(ValueError,match='at most 8'):validate_layout(config,camera_limit=8)


async def test_test_video_snapshots_contain_different_pixels_over_time(cameras):
    import hashlib
    from io import BytesIO
    import shutil
    from PIL import Image
    if not shutil.which('ffmpeg'):
        pytest.skip('Real FFmpeg is needed for the MPEG-TS seek regression')
    pixels=[]
    for position in (.5,1.5,2.5):
        cameras._cache.clear()
        with patch('custom_components.display_studio.layout_camera.time',SimpleNamespace(monotonic=lambda:position)):
            raw=await cameras.async_item({'camera_source':'test'},'image')
        assert raw
        with Image.open(BytesIO(raw)) as image:
            assert image.format=='JPEG'
            pixels.append(hashlib.sha256(image.convert('RGB').tobytes()).hexdigest())
    assert len(set(pixels))==3, 'Test snapshots must advance, rather than repeat the first keyframe'
