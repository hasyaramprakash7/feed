// config/multerR2.js
const multer = require('multer');
const {
  uploadBuffer,
  uploadStream,
  deleteObject,
  keyFromUrl,
  publicUrl,
  R2_PUBLIC_BASE_URL,
} = require('./r2');

const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const uploadAd = multer({
  storage: memoryStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/');
    if (ok) cb(null, true);
    else cb(new Error('Only images and videos are allowed'), false);
  },
}).fields([
  { name: 'media', maxCount: 1 },
  { name: 'poster', maxCount: 1 },
  { name: 'thumbSmall', maxCount: 1 }, // 👈 THIS IS REQUIRED
]);

// ✅ PROOF THAT THE SERVER IS USING THIS FILE
console.log('✅ [multerR2] uploadAd successfully configured with fields: media, poster, thumbSmall');

const uploadStory = multer({
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
}).fields([{ name: 'media', maxCount: 1 }]);

const uploadMessage = multer({
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
}).fields([{ name: 'media', maxCount: 1 }]);

const persistFile = async (file, folder) => {
  if (!file || !file.buffer) return null;
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${file.originalname || 'file'}`;
  const url = await uploadBuffer(key, file.buffer, file.mimetype);
  return { path: url, secure_url: url, url, key, mimetype: file.mimetype, size: file.size, originalname: file.originalname };
};

const deleteFromR2 = async (urlOrKey) => {
  if (!urlOrKey || typeof urlOrKey !== 'string') return;
  const key = urlOrKey.startsWith('http') ? keyFromUrl(urlOrKey) : urlOrKey;
  if (!key) return;
  await deleteObject(key);
};

const deleteFromCloudinary = deleteFromR2;
const cloudinary = { __isR2: true, note: 'Cloudinary removed — using Cloudflare R2 + Bunny CDN' };

const uploadMultipleToCloudinary = async (files) => {
  if (!files) return [];
  const arr = Array.isArray(files) ? files : Object.values(files).flat();
  return arr.filter(Boolean).map((f) => ({
    url: f.path || f.secure_url || f.url,
    publicId: f.key || f.filename,
    resourceType: (f.mimetype || '').startsWith('video/') ? 'video' : 'image',
  }));
};

module.exports = {
  upload, uploadAd, uploadStory, uploadMessage, persistFile, deleteFromR2, deleteFromCloudinary, uploadMultipleToCloudinary, cloudinary, publicUrl, R2_PUBLIC_BASE_URL,
};