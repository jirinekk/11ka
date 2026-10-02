const fs = require('fs');
const path = require('path');

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const PNG_COMPRESSION = 9;

let sharpModule = null;

function getSharp() {
  if (sharpModule !== false && sharpModule !== null) return sharpModule;
  try {
    sharpModule = require('sharp');
    return sharpModule;
  } catch {
    sharpModule = false;
    return null;
  }
}

async function optimizeUploadImage(absolutePath) {
  const sharp = getSharp();
  if (!sharp || !absolutePath || !fs.existsSync(absolutePath)) {
    return { ok: false, skipped: true };
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.jfif'].includes(ext)) {
    return { ok: false, skipped: true };
  }

  const beforeBytes = fs.statSync(absolutePath).size;
  const image = sharp(absolutePath, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const needsResize = (metadata.width || 0) > MAX_WIDTH;
  const targetTooLarge = beforeBytes > 350 * 1024;

  if (!needsResize && !targetTooLarge) {
    return { ok: true, skipped: true, beforeBytes, afterBytes: beforeBytes };
  }

  let pipeline = image.resize({
    width: MAX_WIDTH,
    withoutEnlargement: true,
    fit: 'inside',
  });

  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION, palette: beforeBytes > 1024 * 1024 });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: WEBP_QUALITY });
  } else {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  }

  const buffer = await pipeline.toBuffer();
  if (!buffer.length || buffer.length >= beforeBytes) {
    return { ok: true, skipped: true, beforeBytes, afterBytes: beforeBytes };
  }

  fs.writeFileSync(absolutePath, buffer);
  return { ok: true, skipped: false, beforeBytes, afterBytes: buffer.length };
}

module.exports = {
  MAX_WIDTH,
  optimizeUploadImage,
};
