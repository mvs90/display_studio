"""One-time copy of pre-split LG layouts; originals remain untouched."""

from pathlib import Path
import shutil
from homeassistant.helpers.storage import Store


async def async_import_lg(hass, layouts, source_id):
    if await layouts.store.async_load() is not None:
        return False
    legacy = await Store(hass, 1, f"lg_rs232_ip.{source_id}.layouts").async_load()
    if not legacy:
        return False
    source = Path(hass.config.path(".storage", f"lg_rs232_ip.{source_id}.backgrounds"))
    target = Path(
        hass.config.path(
            ".storage", f"display_studio.{layouts.entry.entry_id}.backgrounds"
        )
    )

    def copy_images():
        if not source.is_dir() or source.is_symlink():
            return
        target.mkdir(parents=True, exist_ok=True)
        for image in source.glob("*.jpg"):
            if (
                not image.is_symlink()
                and len(image.stem) == 64
                and all(c in "0123456789abcdef" for c in image.stem)
            ):
                shutil.copyfile(image, target / image.name)

    await hass.async_add_executor_job(copy_images)
    await layouts.store.async_save(legacy)
    return True
