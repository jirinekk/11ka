const fs = require('fs');
const path = require('path');

const MAX_WIDTH = 2560;
const JPEG_QUALITY = 90;
const WEBP_QUALITY = 90;
const PNG_COMPRESSION = 6;
const RECOMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;

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

function sharpInput(input) {
  const sharp = getSharp();
  if (!sharp) return null;
  return sharp(input, {
    failOn: 'none',
    sequentialRead: true,
    limitInputPixels: 268402689,
  }).rotate();
}

async function toWebJpeg(input, { maxWidth = MAX_WIDTH, quality = JPEG_QUALITY } = {}) {
  const image = sharpInput(input);
  if (!image) return null;
  return image
    .resize({
      width: maxWidth,
      height: maxWidth,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
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
  const image = sharpInput(absolutePath);
  const metadata = await image.metadata();
  const needsResize = (metadata.width || 0) > MAX_WIDTH || (metadata.height || 0) > MAX_WIDTH;
  const targetTooLarge = beforeBytes > RECOMPRESS_OVER_BYTES;

  if (!needsResize && !targetTooLarge) {
    return { ok: true, skipped: true, beforeBytes, afterBytes: beforeBytes };
  }

  let pipeline = image.resize({
    width: MAX_WIDTH,
    height: MAX_WIDTH,
    withoutEnlargement: true,
    fit: 'inside',
  });

  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION, palette: beforeBytes > 2 * 1024 * 1024 });
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
  JPEG_QUALITY,
  optimizeUploadImage,
  toWebJpeg,
};
