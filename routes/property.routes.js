// routes/property.js
const express = require('express');
const propertyController = require('../controllers/property.controller');
const { upload } = require('../config/multerCloudinary');
const { authMiddleware, isVendor } = require('../middleware/authMiddleware');

const {
  createProperty,
  getAllProperties,
  getProperty,
  updateProperty,
  deleteProperty,
} = propertyController;

const router = express.Router();

const uploadMiddleware = (fieldName, maxCount) => (req, res, next) => {
  console.log('\n📥 [UPLOAD MIDDLEWARE] Request received for', req.method, req.url);
  console.log('📋 Content-Type:', req.headers['content-type']);

  upload.array(fieldName, maxCount)(req, res, (err) => {
    if (err) {
      console.error('🔥 Multer error:', err);
      return res.status(400).json({ status: 'fail', message: err.message });
    }
    console.log('✅ Multer completed. Files:', req.files);
    next();
  });
};

// Public GET
router.route('/').get(getAllProperties);
router.route('/:id').get(getProperty);

// Protected write — vendors only
router.post(
  '/',
  authMiddleware,
  isVendor,
  uploadMiddleware('images', 10),
  createProperty
);

router.patch(
  '/:id',
  authMiddleware,
  isVendor,
  uploadMiddleware('images', 10),
  updateProperty
);

router.delete('/:id', authMiddleware, isVendor, deleteProperty);

module.exports = router;