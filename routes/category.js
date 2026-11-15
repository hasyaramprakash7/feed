const express = require('express');
const categoryController = require('../controllers/categoryController');
const { authMiddleware, isAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../config/multerCloudinary'); // 👈 your shared multer config

const router = express.Router();

// Public – get all active categories
router.get('/', categoryController.getAllCategories);

// Admin only – create, update, delete (with image upload)
router.post('/', authMiddleware, upload.single('image'), categoryController.createCategory);
router.put('/:id', authMiddleware, upload.single('image'), categoryController.updateCategory);
router.delete('/:id', authMiddleware, categoryController.deleteCategory);

module.exports = router;