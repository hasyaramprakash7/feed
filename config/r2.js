// config/r2.js
// Cloudflare R2 client (S3-compatible) + helpers

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'bluxury-media';
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.warn(
    '⚠️ [R2] Missing R2 credentials in env — uploads will fail. ' +
      'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.'
  );
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: false,
});

const generateKey = (folder, originalName) => {
  const safe = String(originalName || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, '_')
    .slice(0, 60);
  const id = crypto.randomBytes(12).toString('hex');
  return `${folder}/${id}-${safe}`;
};

const uploadBuffer = async (key, buffer, contentType) => {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await r2.send(cmd);
  return publicUrl(key);
};

const uploadStream = async (key, stream, contentType) => {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: stream,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await r2.send(cmd);
  return publicUrl(key);
};

const deleteObject = async (key) => {
  if (!key) return;
  try {
    await r2.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    console.log('🗑️ [R2] Deleted:', key);
  } catch (e) {
    console.error('❌ [R2] deleteObject failed:', e?.message);
  }
};

const headObject = async (key) => {
  try {
    return await r2.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
};

const publicUrl = (key) => {
  if (!R2_PUBLIC_BASE_URL) return `https://${R2_BUCKET}.r2.dev/${key}`;
  return `${R2_PUBLIC_BASE_URL}/${key}`;
};

// Extract key from a public URL (works for both r2.dev and custom domain)
const keyFromUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  try {
    const noQuery = url.split('?')[0];
    if (R2_PUBLIC_BASE_URL && noQuery.startsWith(R2_PUBLIC_BASE_URL)) {
      return noQuery.slice(R2_PUBLIC_BASE_URL.length + 1);
    }
    const r2devMatch = noQuery.match(/^https?:\/\/[^/]+\.r2\.dev\/(.+)$/);
    if (r2devMatch) return r2devMatch[1];
    return '';
  } catch {
    return '';
  }
};

const presignedGet = async (key, expiresIn = 3600) => {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn });
};

module.exports = {
  r2,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  generateKey,
  uploadBuffer,
  uploadStream,
  deleteObject,
  headObject,
  publicUrl,
  keyFromUrl,
  presignedGet,
};