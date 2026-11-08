"""One import implementation serves backgrounds and the vision container."""
from io import BytesIO
from PIL import Image, ImageCms
import pytest

from custom_components.display_studio import photo_import as photos


@pytest.mark.parametrize('format',['JPEG','PNG','HEIF','TIFF','WEBP','AVIF'])
@pytest.mark.parametrize('maximum,expected',[((64,64),(32,64)),((64,32),(16,32))])
def test_mediatheque_formats_are_oriented_and_stripped(format,maximum,expected):
    image=Image.new('RGB',(80,40),(190,50,20))
    exif=Image.Exif();exif[274]=6;exif[270]='private photo metadata'
    # HEIF's encoder expects the serialized EXIF payload to create irot/imir.
    source=BytesIO();image.save(source,format,exif=exif.tobytes(),quality=95)
    result=Image.open(BytesIO(photos.prepare_photo(source.getvalue(),maximum=maximum)))
    assert result.format=='JPEG' and result.size==expected
    assert not result.getexif() and 'exif' not in result.info
    assert max(abs(a-b) for a,b in zip(result.getpixel((expected[0]//2,expected[1]//2)),(190,50,20)))<15


def test_photo_colour_profile_alpha_and_limits(monkeypatch):
    image=Image.new('RGBA',(64,32),(20,190,50,128));raw=BytesIO()
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    image.save(raw,'PNG',icc_profile=profile)
    result=Image.open(BytesIO(photos.prepare_photo(raw.getvalue())))
    assert result.mode=='RGB' and result.size==(64,32)
    assert all(abs(a-b)<5 for a,b in zip(result.getpixel((32,16)),(18,107,45)))
    assert 'icc_profile' not in result.info
    for invalid in [b'<svg/>',b'broken heic',b'']:
        with pytest.raises(ValueError):photos.prepare_photo(invalid)
    monkeypatch.setattr(photos,'MAX_PIXELS',1000)
    with pytest.raises(ValueError):photos.prepare_photo(raw.getvalue())
    monkeypatch.setattr(photos,'MAX_BYTES',8)
    with pytest.raises(ValueError):photos.prepare_photo(raw.getvalue())


@pytest.mark.parametrize('maximum,expected',[((64,64),(32,64)),((64,32),(16,32))])
def test_photos_mpf_jpeg_uses_primary_photo_not_auxiliary_image(maximum,expected):
    primary=Image.new('RGB',(80,40),(190,50,20))
    # A Photos JPEG may carry a grayscale HDR gain map in its MPF container.
    # Its MIME/extension remain image/jpeg/.jpg, but Pillow calls it MPO.
    gain_map=Image.new('L',(40,20),255)
    exif=Image.Exif();exif[274]=6;exif[270]='private photo metadata'
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    source=BytesIO();primary.save(source,'MPO',save_all=True,append_images=[gain_map],
                                 exif=exif,icc_profile=profile,quality=95)
    raw=source.getvalue()
    assert Image.open(BytesIO(raw)).format=='MPO'
    result=Image.open(BytesIO(photos.prepare_photo(raw,maximum=maximum)))
    assert result.format=='JPEG' and result.size==expected
    assert getattr(result,'n_frames',1)==1
    assert 'mp' not in result.info and 'exif' not in result.info and 'icc_profile' not in result.info
    assert max(abs(a-b) for a,b in zip(result.getpixel((0,0)),(190,50,20)))<5


def test_import_errors_distinguish_limits_format_and_decoder(monkeypatch,caplog):
    with pytest.raises(ValueError,match=r'\[photo_size\]'):
        photos.prepare_photo(b'')
    source=BytesIO();Image.new('RGB',(32,32)).save(source,'GIF')
    with pytest.raises(ValueError,match=r'\[photo_format:GIF\]'):
        photos.prepare_photo(source.getvalue())
    source=BytesIO();Image.new('RGB',(32,32)).save(source,'PNG',icc_profile=b'private invalid ICC profile')
    with pytest.raises(ValueError,match=r'\[photo_decode:profile\]'):
        photos.prepare_photo(source.getvalue())
    assert 'stage=profile format=PNG mode=RGB error=' in caplog.text
    assert 'private invalid' not in caplog.text
    monkeypatch.setattr(photos,'MAX_PIXELS',100)
    with pytest.raises(ValueError,match=r'\[photo_dimensions\]'):
        photos.prepare_photo(source.getvalue())
