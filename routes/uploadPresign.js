// routes/uploadPresign.js
const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: false,
});

const ALLOWED_TYPES = ['video/', 'image/'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

router.post('/presign', authMiddleware, async (req, res) => {
  try {
    const { contentType, fileSize } = req.body;

    if (!contentType || !fileSize) {
      return res.status(400).json({
        success: false,
        message: 'contentType and fileSize are required',
      });
    }

    if (!ALLOWED_TYPES.some((p) => contentType.startsWith(p))) {
      return res.status(400).json({
        success: false,
        message: 'Only images and videos are allowed',
      });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
      });
    }

    const isVideo = contentType.startsWith('video/');
    const folder = isVideo ? 'bluxury/ads/raw' : 'bluxury/ads';
    const ext = (contentType.split('/')[1] || 'bin')
      .split(';')[0]
      .replace(/[^a-z0-9]/gi, '');

    const key = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    // Presigned URL valid for 15 minutes
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 900 });

    const publicUrl = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;

    console.log(`[presign] ${isVideo ? 'VIDEO' : 'IMAGE'} → ${key}`);

    res.json({
      success: true,
      uploadUrl,
      key,
      publicUrl,
      expiresIn: 900,
    });
  } catch (err) {
    console.error('[presign] error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
    });
  }
});

module.exports = router;