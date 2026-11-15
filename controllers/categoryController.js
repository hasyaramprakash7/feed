const Category = require('../models/Category');

exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ order: 1 });
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, icon, order, isActive, parentCategory } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    // Check duplicate name
    const existing = await Category.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category with this name already exists' });
    }

    // If an image was uploaded, CloudinaryStorage already uploaded it.
    // The URL is available in req.file.path (or req.file.secure_url)
    const imageUrl = req.file ? req.file.path : '';

    const category = new Category({
      name: name.trim(),
      icon: icon || '',
      image: imageUrl,
      order: order ? parseInt(order) : 0,
      isActive: isActive !== undefined ? isActive : true,
      parentCategory: parentCategory || null,
    });
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, order, isActive, parentCategory } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check duplicate name if changed
    if (name && name.trim() !== category.name) {
      const existing = await Category.findOne({ name: name.trim() });
      if (existing && existing._id.toString() !== id) {
        return res.status(400).json({ success: false, message: 'Category with this name already exists' });
      }
    }

    // If a new image is uploaded, use its path; otherwise keep existing
    const imageUrl = req.file ? req.file.path : category.image;

    category.name = name?.trim() || category.name;
    category.icon = icon !== undefined ? icon : category.icon;
    category.image = imageUrl;
    category.order = order !== undefined ? parseInt(order) : category.order;
    category.isActive = isActive !== undefined ? isActive : category.isActive;
    category.parentCategory = parentCategory !== undefined ? parentCategory : category.parentCategory;

    await category.save();
    res.json({ success: true, data: category });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};