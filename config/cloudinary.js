// config/cloudinary.js
// ⚠️ DEPRECATED — Cloudinary has been removed from this project.
// This file exists ONLY for backwards compatibility so legacy callers
// (utils/cronJobs.js, old controllers, etc.) don't crash.
// All operations are routed to Cloudflare R2 via ./multerR2 → ./r2.

const { deleteFromR2 } = require('./multerR2');

console.log('⚠️  [cloudinary] DEPRECATED — routing all calls to R2');

/**
 * Shape-compatible stub of the old cloudinary SDK.
 * Anything that used to call cloudinary.uploader.destroy(publicId)
 * now deletes the object from R2 instead.
 */
const uploader = {
  async destroy(publicId, _options) {
    try {
      if (!publicId) return { result: 'not found' };
      await deleteFromR2(publicId);
      console.log('🗑️  [cloudinary→R2] destroyed:', publicId);
      return { result: 'ok' };
    } catch (e) {
      console.warn('⚠️  [cloudinary→R2] destroy failed:', e?.message);
      return { result: 'error', error: e?.message };
    }
  },

  async destroy_all(publicIds) {
    if (!Array.isArray(publicIds)) return { deleted: {} };
    const deleted = {};
    for (const id of publicIds) {
      const r = await uploader.destroy(id);
      deleted[id] = r.result;
    }
    return { deleted };
  },

  // Not supported anymore — no-op instead of crash
  async upload() {
    console.warn('⚠️  [cloudinary→R2] upload() is not supported. Use persistFile().');
    return { secure_url: '', public_id: '', resource_type: 'image' };
  },

  async explicit() {
    return { public_id: '', secure_url: '' };
  },
};

const cloudinary = {
  uploader,
  config: () => {},
  url: (publicId) => String(publicId || ''),
  v2: { uploader, config: () => {}, url: (id) => String(id || '') },
  __isStub: true,
  __note: 'Cloudinary removed — stub routes deletes to Cloudflare R2',
};

module.exports = cloudinary;
module.exports.default = cloudinary;