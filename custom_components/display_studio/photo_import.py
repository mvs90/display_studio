"""Shared, bounded photo import for Studio backgrounds and host face enrollment.

The vision image uses this same source file, including orientation/color handling.
Only the normalized pixels are retained; EXIF/location metadata is discarded.
"""
from io import BytesIO
import logging

from PIL import Image, ImageCms, ImageOps, features
from pillow_heif import register_heif_opener

register_heif_opener(thumbnails=False, decode_threads=1)
# HA 2025.3 pins Pillow before its built-in AVIF support. Retain the same
# import formats without replacing Home Assistant's Pillow dependency.
if "avif" not in features.get_supported():
    import pillow_avif  # noqa: F401

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 64_000_000
# Apple Photos JPEG exports can contain an MPF HDR gain map and are detected
# as MPO. Frame zero is the ordinary SDR photo, later frames are auxiliary.
FORMATS = {"MPO", "JPEG", "PNG", "HEIF", "TIFF", "WEBP", "AVIF"}
_LOGGER = logging.getLogger(__name__)
ERROR = "Bitte ein gültiges HEIC/HEIF-, JPEG-, PNG-, TIFF-, WebP- oder AVIF-Foto bis 20 MiB und 64 Megapixel wählen."


def prepare_photo(source, maximum=(3840, 2160), *, preserve_alpha=False):
    if not 0 < len(source) <= MAX_BYTES:
        raise ValueError("[photo_size] Das Foto ist leer oder größer als 20 MiB.")
    stage = "open"
    image_format = "unknown"
    image_mode = "unknown"
    try:
        with Image.open(BytesIO(source)) as original:
            image_format, image_mode = original.format, original.mode
            if original.format not in FORMATS:
                raise ValueError(f"[photo_format:{original.format}] " + ERROR)
            if not 0 < original.width * original.height <= MAX_PIXELS or max(original.size)>16384:
                raise ValueError("[photo_dimensions] Das Foto darf höchstens 64 Megapixel und 16384 Pixel pro Seite haben.")
            stage = "decode"
            # HEIF's opener selects its primary image and applies container
            # orientation. Remaining EXIF orientation is handled exactly once.
            # Reduce before copying/rotating a 48 MP phone photo. JPEG can use
            # decoder subsampling; TIFF applies its orientation while loading.
            if original.format == "TIFF":
                original.load()
            orientation = original.getexif().get(274, 1)
            bounds = maximum[::-1] if orientation in (5, 6, 7, 8) else maximum
            original.thumbnail(bounds, Image.Resampling.LANCZOS, reducing_gap=3.0)
            image = ImageOps.exif_transpose(original)
            image.thumbnail(maximum, Image.Resampling.LANCZOS, reducing_gap=3.0)
            stage = "profile"
            if profile := image.info.get("icc_profile"):
                mode = "RGBA" if "A" in image.getbands() else "RGB"
                image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                                                  ImageCms.createProfile("sRGB"), outputMode=mode)
            stage = "encode"
            rgba = image.convert("RGBA")
            if preserve_alpha:
                output = BytesIO()
                rgba.save(output, "PNG", optimize=True)
                return output.getvalue()
            rgb = Image.new("RGB", image.size, "#101827")
            rgb.paste(rgba, mask=rgba.getchannel("A"))
            output = BytesIO()
            rgb.save(output, "JPEG", quality=95, subsampling=0, optimize=True)
            return output.getvalue()
    except (OSError, ValueError, SyntaxError, ImageCms.PyCMSError, Image.DecompressionBombError) as error:
        if isinstance(error, ValueError) and str(error).startswith("[photo_"):
            raise
        # Deliberately log only processing metadata, never photo bytes/EXIF/names.
        _LOGGER.warning("Photo import failed: stage=%s format=%s mode=%s error=%s",
                        stage, image_format, image_mode, type(error).__name__)
        if isinstance(error, Image.DecompressionBombError):
            raise ValueError("[photo_dimensions] Das Foto überschreitet die zulässige Bildgröße.") from error
        raise ValueError(f"[photo_decode:{stage}] Das Foto konnte nicht verarbeitet werden ({image_format}, {image_mode}, {type(error).__name__}).") from error
