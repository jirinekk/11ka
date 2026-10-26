const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const S3_PREFIX = 's3://';

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
  });
  return cachedClient;
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

async function readS3Bytes(pathOrKey) {
  const key = s3KeyFromPath(pathOrKey);
  const result = await s3Client().send(
    new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
    })
  );
  if (!result.Body) return null;
  const buf = Buffer.from(await result.Body.transformToByteArray());
  return { buf, contentType: result.ContentType || undefined };
}

function newObjectKey(folder, filename) {
  const safe = String(filename || 'foto')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-80);
  return `${folder.replace(/\/+$/, '')}/${crypto.randomUUID()}-${safe}`;
}

function fotoUpstreamBase() {
  return String(process.env.FOTO_11KA_URL || 'https://fotak-11ka.vercel.app').replace(/\/$/, '');
}

function fotoUpstreamKey() {
  return String(process.env.FOTO_11KA_KEY || process.env.ELEVENKA_API_KEY || process.env.FOTO_PUBLIC_KEY || '').trim();
}

async function readRemotePublicMedia(photoId, variant) {
  const key = fotoUpstreamKey();
  if (!key) return null;
  const url = `${fotoUpstreamBase()}/api/public/media/${encodeURIComponent(photoId)}?v=${encodeURIComponent(variant || 'thumb')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'x-11ka-key': key, Accept: 'image/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get('content-type') || 'image/jpeg' };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  hasS3Store,
  isS3Path,
  s3KeyFromPath,
  s3PathFromKey,
  putS3Object,
  readS3Bytes,
  newObjectKey,
  fotoUpstreamBase,
  fotoUpstreamKey,
  readRemotePublicMedia,
};
