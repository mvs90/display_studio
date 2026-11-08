/* Shared Photos import for enrollment and backgrounds. No external services. */
const MAX_BYTES = 20 * 1024 * 1024;
const errorText = error => (typeof error?.body === 'string' ? error.body : error?.body?.message) || error?.message || String(error);

export async function photoBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(Error('[photo_read] Das Foto konnte nicht gelesen werden. Bitte lade das Original in Fotos vollständig und wähle es erneut.'));
    reader.readAsDataURL(blob);
  });
}

async function nativePhoto(file, maximum, preserveAlpha) {
  // Only photographic raster formats: do not introduce SVG/remote resources.
  // Content is authoritative; Photos can supply a missing/wrong MIME type.
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(bytes);
  const raster = (bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (bytes[0] === 0x89 && ascii.slice(1, 8) === 'PNG\r\n\x1a\n') || /^(II\x2a\x00|MM\x00\x2a)/.test(ascii) ||
    (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') ||
    (ascii.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1|avif|avis/.test(ascii.slice(8)));
  if (!raster) throw Error('unsupported');
  const url = URL.createObjectURL(file), image = new Image();
  let timer, canvas;
  try {
    image.src = url;
    await Promise.race([image.decode(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('decode timeout')), 15000);
    })]);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 64000000 || Math.max(width, height) > 16384)
      throw Error('[photo_dimensions] Das Foto darf höchstens 64 Megapixel und 16384 Pixel pro Seite haben.');
    const ratio = Math.min(1, maximum[0] / width, maximum[1] / height);
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d', {colorSpace: 'srgb'});
    if (!context) throw Error('canvas unavailable');
    if(!preserveAlpha){context.fillStyle = '#101827'; context.fillRect(0, 0, canvas.width, canvas.height);}
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Safari's decoder applies Photos orientation and color management. The
    // canvas strips EXIF/location metadata before the bounded server import.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime=preserveAlpha?'image/png':'image/jpeg';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.95));
    if (!blob || blob.type !== mime || blob.size > MAX_BYTES) throw Error('encode failed');
    return blob;
  } finally {
    clearTimeout(timer); image.src = ''; URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function uploadPhoto(file, maximum, upload, preserveAlpha=false) {
  if (!file.size) throw Error('[photo_size] Das ausgewählte Foto ist leer. Bitte lade das Original in Fotos vollständig und wähle es erneut.');
  if (file.size > MAX_BYTES) throw Error('[photo_size] Das Foto darf höchstens 20 MiB groß sein.');
  try { return await upload(file); }
  catch (error) {
    // A format decoder failure is retryable. Never retry face validation,
    // permissions, size limits, storage or network failures as an image import.
    if (!/^\[photo_decode:/.test(errorText(error))) throw error;
    let converted;
    try { converted = await nativePhoto(file, maximum, preserveAlpha); }
    catch (nativeError) {
      if (nativeError.message.startsWith('[photo_dimensions]')) throw nativeError;
      throw Error(errorText(error) + ' Auch der Browser konnte das Foto nicht öffnen. Bitte exportiere das Original als JPEG aus Fotos.');
    }
    return upload(converted);
  }
}
