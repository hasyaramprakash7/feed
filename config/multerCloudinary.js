// config/multerCloudinary.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'djce5sfs6',
  api_key: process.env.CLOUDINARY_API_KEY || '399935783536349',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'gzem1Q53gEqOCVdIYT9dMRyKaGk',
});

// ═════════════════════════════════════════════════════════
// GENERIC UPLOAD
// ═════════════════════════════════════════════════════════
const genericStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');
    return {
      folder: 'bluxury/general',
      resource_type: isVideo ? 'video' : isAudio ? 'video' : 'image',
      allowed_formats: [
        'jpg', 'jpeg', 'png', 'webp', 'gif',
        'mp4', 'mov', 'avi', 'mkv', 'webm',
        'mp3', 'm4a', 'wav',
      ],
    };
  },
});

const upload = multer({
  storage: genericStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ═════════════════════════════════════════════════════════
// AD UPLOAD — HLS eager transform
// ✅ REMOVED allowed_formats (Cloudinary auto-detects)
// ═════════════════════════════════════════════════════════
const adStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');

    if (isVideo) {
      console.log(`📤 [Ad Storage] Video upload: ${file.originalname} (${file.mimetype})`);
      return {
        folder: 'bluxury/ads',
        resource_type: 'video',
        eager: [
          { format: 'm3u8', streaming_profile: 'hd' },
          { format: 'mp4', video_codec: 'h264' },
        ],
        eager_async: false,
        transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
      };
    }

    console.log(`📤 [Ad Storage] Image upload: ${file.originalname}`);
    return {
      folder: 'bluxury/ads',
      resource_type: 'image',
      transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
    };
  },
});

const uploadAd = multer({
  storage: adStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // ✅ 200 MB
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/');
    if (ok) {
      console.log(`📤 [Ad Multer] ALLOW: ${file.originalname} (${file.mimetype})`);
      cb(null, true);
    } else {
      console.log(`📤 [Ad Multer] REJECT: ${file.originalname} (${file.mimetype})`);
      cb(new Error('Only images and videos are allowed'), false);
    }
  },
}).fields([
  { name: 'media', maxCount: 1 },
  { name: 'poster', maxCount: 1 },
]);

// ═════════════════════════════════════════════════════════
// STORY UPLOAD — HLS eager transform
// ✅ REMOVED allowed_formats
// ═════════════════════════════════════════════════════════
const storyStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');

    if (isVideo) {
      console.log(`📤 [Story Storage] Video upload: ${file.originalname}`);
      return {
        folder: 'bluxury/stories',
        resource_type: 'video',
        eager: [{ format: 'm3u8', streaming_profile: 'hd' }],
        eager_async: false,
        transformation: [{ quality: 'auto:good' }],
      };
    }

    console.log(`📤 [Story Storage] Image upload: ${file.originalname}`);
    return {
      folder: 'bluxury/stories',
      resource_type: 'image',
      transformation: [{ quality: 'auto:good' }],
    };
  },
});

const uploadStory = multer({
  storage: storyStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // ✅ 100 MB
}).fields([{ name: 'media', maxCount: 1 }]);

// ═════════════════════════════════════════════════════════
// MESSAGE UPLOAD — HLS eager for video
// ✅ REMOVED allowed_formats
// ═════════════════════════════════════════════════════════
const messageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');

    if (isVideo) {
      console.log(`📤 [Message Storage] Video: ${file.originalname}`);
      return {
        folder: 'bluxury/messages',
        resource_type: 'video',
        eager: [{ format: 'm3u8', streaming_profile: 'hd' }],
        eager_async: false,
      };
    }

    if (isAudio) {
      console.log(`📤 [Message Storage] Audio: ${file.originalname}`);
      return {
        folder: 'bluxury/messages',
        resource_type: 'video',
      };
    }

    console.log(`📤 [Message Storage] Image: ${file.originalname}`);
    return {
      folder: 'bluxury/messages',
      resource_type: 'image',
    };
  },
});

const uploadMessage = multer({
  storage: messageStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
}).fields([{ name: 'media', maxCount: 1 }]);

// ═════════════════════════════════════════════════════════
// DELETE FROM CLOUDINARY
// ═════════════════════════════════════════════════════════
const deleteFromCloudinary = async (url) => {
  if (!url || typeof url !== 'string') return;
  try {
    if (!url.includes('res.cloudinary.com')) return;
    const resourceType = url.includes('/video/upload/') ? 'video' : 'image';
    const parts = url.split('/upload/');
    if (parts.length < 2) return;
    let publicId = parts[1];
    publicId = publicId.replace(/^v\d+\//, '');
    publicId = publicId.replace(/\.[a-z0-9]+$/i, '');
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
    console.log('🗑️ Deleted from Cloudinary:', publicId);
  } catch (err) {
    console.error('❌ deleteFromCloudinary error:', err?.message);
  }
};

// ═════════════════════════════════════════════════════════
// HELPER — extract Cloudinary URLs from req.files
// ═════════════════════════════════════════════════════════
const uploadMultipleToCloudinary = async (files) => {
  if (!files) return [];

  let arr = [];
  if (Array.isArray(files)) {
    arr = files;
  } else if (typeof files === 'object') {
    arr = Object.values(files).flat();
  }

  return arr
    .filter(Boolean)
    .map((f) => ({
      url: f.path || f.secure_url || f.url,
      publicId: f.filename || f.public_id,
      resourceType:
        (f.mimetype || '').startsWith('video/') ? 'video' : 'image',
    }));
};

// ═════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════
module.exports = {
  cloudinary,
  upload,
  uploadAd,
  uploadStory,
  uploadMessage,
  deleteFromCloudinary,
  uploadMultipleToCloudinary,
};