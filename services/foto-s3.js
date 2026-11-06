const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const S3_PREFIX = 's3://';
const CACHE_DIR = path.join(__dirname, '..', 'storage', 'foto-cache');
const S3_READ_TIMEOUT_MS = 25000;
const S3_BLOCK_MS = 20 * 1000;

function hasS3Store() {
  return Boolean(
    process.env.STORAGE_S3_ENDPOINT &&
      process.env.STORAGE_S3_ACCESS_KEY_ID &&
      process.env.STORAGE_S3_SECRET_ACCESS_KEY &&
      (process.env.STORAGE_S3_BUCKET || 'fotky')
  );
}

function s3Bucket() {
  return process.env.STORAGE_S3_BUCKET || 'fotky';
}

function isS3Path(value) {
  return String(value || '').startsWith(S3_PREFIX);
}

function s3KeyFromPath(value) {
  const raw = String(value || '');
  if (!isS3Path(raw)) return raw;
  const without = raw.slice(S3_PREFIX.length);
  const slash = without.indexOf('/');
  return slash === -1 ? without : without.slice(slash + 1);
}

function s3PathFromKey(key) {
  return `${S3_PREFIX}${s3Bucket()}/${key}`;
}

let cachedClient;
let s3BlockedUntil = 0;

function s3IsBlocked() {
  return Date.now() < s3BlockedUntil;
}

function markS3Blocked(reason) {
  s3BlockedUntil = Date.now() + S3_BLOCK_MS;
  console.error('[11ka] foto S3 pauza:', reason || 'SlowDown');
}

function s3Client() {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.STORAGE_S3_ENDPOINT;
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Úložiště fotek není nastavené.');
  }
  cachedClient = new S3Client({
    region: process.env.STORAGE_S3_REGION || 'eu-central-1',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  return cachedClient;
}

function cacheFile(pathOrKey) {
  const hash = crypto.createHash('sha1').update(String(pathOrKey || '')).digest('hex');
  return path.join(CACHE_DIR, hash);
}

function readDiskCache(pathOrKey) {
  try {
    const file = cacheFile(pathOrKey);
    const metaFile = `${file}.json`;
    if (!fs.existsSync(file) || !fs.existsSync(metaFile)) return null;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return { buf: fs.readFileSync(file), contentType: meta.contentType || 'image/jpeg' };
  } catch {
    return null;
  }
}

function writeDiskCache(pathOrKey, hit) {
  if (!hit || !hit.buf) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = cacheFile(pathOrKey);
    fs.writeFileSync(file, hit.buf);
    fs.writeFileSync(`${file}.json`, JSON.stringify({ contentType: hit.contentType || 'image/jpeg' }));
  } catch (err) {
    console.error('[11ka] foto cache write failed:', err && err.message);
  }
}

async function putS3Object(key, body, contentType) {
  await s3Client().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return s3PathFromKey(key);
}

async function presignS3Get(pathOrKey, expiresIn = 6 * 60 * 60) {
  const key = s3KeyFromPath(pathOrKey);
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
    }),
    { expiresIn }
  );
}

async function readS3Bytes(pathOrKey) {
  const cached = readDiskCache(pathOrKey);
  if (cached) return cached;
  if (s3IsBlocked()) return null;
  const key = s3KeyFromPath(pathOrKey);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), S3_READ_TIMEOUT_MS);
  try {
    const result = await s3Client().send(
      new GetObjectCommand({
        Bucket: s3Bucket(),
        Key: key,
      }),
      { abortSignal: ac.signal }
    );
    if (!result.Body) return null;
    const buf = Buffer.from(await result.Body.transformToByteArray());
    const hit = { buf, contentType: result.ContentType || undefined };
    writeDiskCache(pathOrKey, hit);
    return hit;
  } catch (err) {
    const msg = String((err && err.message) || err || '');
    if (/SlowDown|currently blocked/i.test(msg)) {
      markS3Blocked(msg.slice(0, 120));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fotoUpstreamBase() {
  return String(process.env.FOTO_11KA_URL || 'https://fotak-11ka.vercel.app').replace(/\/$/, '');
}

function fotoUpstreamFallbacks() {
  const primary = fotoUpstreamBase();
  const extra = ['https://fotak-11ka.vercel.app', 'https://foto.11ka.cz'];
  return [...new Set([primary, ...extra])];
}

function fotoUpstreamKey() {
  return String(process.env.FOTO_11KA_KEY || process.env.ELEVENKA_API_KEY || process.env.FOTO_PUBLIC_KEY || '').trim();
}

async function readRemotePublicMedia(photoId, variant) {
  const key = fotoUpstreamKey();
  if (!key) return null;
  const v = encodeURIComponent(variant || 'thumb');
  const id = encodeURIComponent(photoId);
  for (const base of fotoUpstreamFallbacks()) {
    const url = `${base}/api/public/media/${id}?v=${v}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        headers: { 'x-11ka-key': key, Accept: 'image/*' },
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const type = String(res.headers.get('content-type') || '');
      if (!type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 32) continue;
      return { buf, contentType: type || 'image/jpeg' };
    } catch {
      /* try next host */
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

function newObjectKey(folder, filename) {
  const safe = String(filename || 'foto')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-80);
  return `${folder.replace(/\/+$/, '')}/${crypto.randomUUID()}-${safe}`;
}

module.exports = {
  hasS3Store,
  isS3Path,
  s3KeyFromPath,
  s3PathFromKey,
  putS3Object,
  readS3Bytes,
  presignS3Get,
  readDiskCache,
  writeDiskCache,
  newObjectKey,
  fotoUpstreamBase,
  fotoUpstreamKey,
  readRemotePublicMedia,
  s3IsBlocked,
};
