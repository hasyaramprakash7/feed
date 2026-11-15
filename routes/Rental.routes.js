// routes/rental.js
const express = require('express');
const rentalController = require('../controllers/Rental.controller.js');
const { upload } = require('../config/multerCloudinary');
const { authMiddleware, isVendor } = require('../middleware/authMiddleware');

const {
  createRental,
  getAllRentals,
  getRental,
  updateRental,
  deleteRental,
} = rentalController;

const router = express.Router();

// Helper to catch multer errors and log request details
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

// 🔓 Public GET endpoints
router.route('/').get(getAllRentals);
router.route('/:id').get(getRental);

// 🔒 Protected endpoints — only vendors
router.post(
  '/',
  authMiddleware,
  isVendor,
  uploadMiddleware('images', 10),
  createRental
);

router.patch(
  '/:id',
  authMiddleware,
  isVendor,
  uploadMiddleware('images', 10),
  updateRental
);

router.delete('/:id', authMiddleware, isVendor, deleteRental);

module.exports = router;