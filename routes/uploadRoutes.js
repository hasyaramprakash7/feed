const express = require('express');
const multer = require('multer');
const { uploadAdImage } = require('../controllers/uploadController');

const router = express.Router();

// Use memory storage (same as vendorProduct)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /api/upload – expects a single file field named "image"
router.post('/', upload.single('image'), uploadAdImage);

module.exports = router;