// config/multerCloudinary.js
// ⚠️ DEPRECATED — Cloudinary removed. This shim routes everything to R2.
// Kept ONLY for backward compatibility so legacy callers
// (controllers/property.controller.js, etc.) keep working.

const multer = require('multer');
const r2 = require('./multerR2');
const cloudinary = require('./cloudinary'); // the R2-backed stub

const memoryStorage = multer.memoryStorage();
const DEFAULT_FOLDER = 'bluxury/uploads';

console.log('⚠️  [multerCloudinary] DEPRECATED — routing uploads to R2');

/** Persist one multer file (memoryStorage) to R2, attach Cloudinary-shaped fields */
async function persistOne(f, folder) {
  if (!f || !f.buffer) return;
  try {
    const p = await r2.persistFile(f, folder);
    if (p) {
      f.path = p.path;           // 👈 legacy callers read this
      f.secure_url = p.secure_url;
      f.url = p.url;
      f.filename = p.key;        // 👈 legacy public_id shape
      f.public_id = p.key;
    }
  } catch (e) {
    console.warn('[multerCloudinary] persist failed:', e?.message);
  }
}

/** Wrap a multer method so files are auto-uploaded to R2 after parsing */
function wrapMethod(instance, method, folder) {
  const original = instance[method].bind(instance);
  return (...args) => {
    const mw = original(...args);
    return (req, res, next) => {
      mw(req, res, async (err) => {
        if (err) return next(err);
        try {
          const jobs = [];
          if (req.file) jobs.push(persistOne(req.file, folder));
          if (Array.isArray(req.files)) {
            for (const f of req.files) jobs.push(persistOne(f, folder));
          } else if (req.files && typeof req.files === 'object') {
            for (const arr of Object.values(req.files)) {
              for (const f of arr) jobs.push(persistOne(f, folder));
            }
          }
          await Promise.all(jobs);
          next();
        } catch (e) {
          next(e);
        }
      });
    };
  };
}

function makeUploader(folder = DEFAULT_FOLDER) {
  const base = multer({
    storage: memoryStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  return {
    single: wrapMethod(base, 'single', folder),
    array: wrapMethod(base, 'array', folder),
    fields: wrapMethod(base, 'fields', folder),
    any: wrapMethod(base, 'any', folder),
    none: wrapMethod(base, 'none', folder),
  };
}

// Legacy aliases with sensible R2 folders
const upload = makeUploader('bluxury/uploads');
const uploadCloudinary = upload;
const uploadProperty = makeUploader('bluxury/properties');
const uploadImage = makeUploader('bluxury/images');
const uploadMedia = makeUploader('bluxury/media');

module.exports = {
  // Configurable raw uploaders (caller chains .single/.array/.fields/.any)
  upload,
  uploadCloudinary,
  uploadProperty,
  uploadImage,
  uploadMedia,

  // Pre-configured middleware from multerR2 (adController uses these)
  uploadAd: r2.uploadAd,
  uploadStory: r2.uploadStory,
  uploadMessage: r2.uploadMessage,

  // Persistence helpers
  persistFile: r2.persistFile,
  deleteFromR2: r2.deleteFromR2,
  deleteFromCloudinary: r2.deleteFromR2,
  uploadMultipleToCloudinary: r2.uploadMultipleToCloudinary,
  publicUrl: r2.publicUrl,
  R2_PUBLIC_BASE_URL: r2.R2_PUBLIC_BASE_URL,

  // Stub for legacy cloudinary SDK calls
  cloudinary,
  v2: cloudinary?.v2 || cloudinary,

  // Storage stubs (some old code does multer({ storage: multerStorage }))
  multerStorage: memoryStorage,
  storage: memoryStorage,
};