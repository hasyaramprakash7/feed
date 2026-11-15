const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const VendorProduct = require("../models/VendorProduct");

const { authMiddleware, isVendor, isAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Cloudinary upload helper
const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream((err, result) => {
      if (result) {
        console.log("Image uploaded to Cloudinary:", result.secure_url);
        resolve(result.secure_url);
      } else {
        console.error("Cloudinary upload error:", err);
        reject(err);
      }
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });

// Helper: Validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// --- ROUTES ---

// GET all products of logged-in vendor
router.get("/my-products", authMiddleware, isVendor, async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId;
    console.log("Attempting to fetch products for vendor ID:", vendorId);

    if (!vendorId) {
      console.warn("Unauthorized attempt to fetch my-products: Vendor ID not found in token.");
      return res.status(403).json({ success: false, message: "Vendor authentication required to view your products." });
    }

    if (!isValidObjectId(vendorId)) {
      console.error(`Invalid vendorId received: ${vendorId}`);
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    const products = await VendorProduct.find({ vendorId }).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (error) {
    console.error("Fetch My Products Error:", error.message, error);
    res.status(500).json({ success: false, message: "Server error fetching your products." });
  }
});

// GET all vendor-added products (public route)
router.get("/all", async (req, res) => {
  try {
    const products = await VendorProduct.find().sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (error) {
    console.error("Fetch All Products Error:", error.message, error);
    res.status(500).json({ success: false, message: "Server error fetching all products." });
  }
});

// ✅ NEW: GET products by vendor ID (public)
router.get("/vendor/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { limit = 10 } = req.query;

    if (!isValidObjectId(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    const products = await VendorProduct.find({ vendorId })
      .limit(parseInt(limit, 10))
      .sort({ createdAt: -1 });

    res.json({ success: true, products });
  } catch (error) {
    console.error("Fetch Products by Vendor Error:", error.message, error);
    res.status(500).json({ success: false, message: "Server error fetching vendor products." });
  }
});

// CREATE a product
router.post("/add", authMiddleware, isVendor, upload.array("images", 10), async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId;

    if (!vendorId) {
      console.warn("Unauthorized attempt to add product: Vendor ID not found in token.");
      return res.status(403).json({ success: false, message: "Only authenticated vendors can add products." });
    }

    if (!isValidObjectId(vendorId)) {
      console.error(`Invalid vendorId received for product creation: ${vendorId}`);
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    const {
      name,
      description,
      price,
      discountedPrice,
      discountPercent,
      category,
      stock,
      isAvailable,
      bulkPrice,
      bulkMinimumUnits,
      largeQuantityPrice,
      largeQuantityMinimumUnits,
      sizes,
    } = req.body;

    if (!name || !description || !price || !category) {
      return res.status(400).json({ success: false, message: "Missing required fields: name, description, price, and category are mandatory." });
    }

    // Parse numeric values
    const parsedPrice = parseFloat(price);
    const parsedDiscountedPrice = discountedPrice ? parseFloat(discountedPrice) : undefined;
    const parsedDiscountPercent = discountPercent ? parseFloat(discountPercent) : undefined;
    const parsedStock = stock ? parseInt(stock, 10) : undefined;
    const parsedIsAvailable = typeof isAvailable === 'string' ? (isAvailable === 'true') : isAvailable;

    const parsedBulkPrice = bulkPrice ? parseFloat(bulkPrice) : undefined;
    const parsedBulkMinimumUnits = bulkMinimumUnits ? parseInt(bulkMinimumUnits, 10) : undefined;
    const parsedLargeQuantityPrice = largeQuantityPrice ? parseFloat(largeQuantityPrice) : undefined;
    const parsedLargeQuantityMinimumUnits = largeQuantityMinimumUnits ? parseInt(largeQuantityMinimumUnits, 10) : undefined;

    const parsedSizes = sizes ? sizes.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ success: false, message: "Price must be a positive number." });
    }

    // Bulk/Large Quantity Pricing Validation
    if (parsedBulkMinimumUnits !== undefined && (isNaN(parsedBulkMinimumUnits) || parsedBulkMinimumUnits <= 0)) {
      return res.status(400).json({ success: false, message: "Bulk minimum units must be a positive number." });
    }
    if (parsedBulkPrice !== undefined && (isNaN(parsedBulkPrice) || parsedBulkPrice <= 0)) {
      return res.status(400).json({ success: false, message: "Bulk price must be a positive number." });
    }
    if (parsedLargeQuantityMinimumUnits !== undefined && (isNaN(parsedLargeQuantityMinimumUnits) || parsedLargeQuantityMinimumUnits <= 0)) {
      return res.status(400).json({ success: false, message: "Large quantity minimum units must be a positive number." });
    }
    if (parsedLargeQuantityPrice !== undefined && (isNaN(parsedLargeQuantityPrice) || parsedLargeQuantityPrice <= 0)) {
      return res.status(400).json({ success: false, message: "Large quantity price must be a positive number." });
    }

    if (parsedBulkMinimumUnits !== undefined && parsedLargeQuantityMinimumUnits !== undefined && parsedBulkMinimumUnits >= parsedLargeQuantityMinimumUnits) {
      return res.status(400).json({ success: false, message: "Large quantity minimum units must be greater than bulk minimum units." });
    }

    // Handle multiple image uploads
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer);
        imageUrls.push(url);
      }
    }

    const newProduct = new VendorProduct({
      vendorId,
      name,
      description,
      price: parsedPrice,
      discountedPrice: parsedDiscountedPrice,
      discountPercent: parsedDiscountPercent,
      category,
      stock: parsedStock,
      isAvailable: parsedIsAvailable,
      images: imageUrls,
      sizes: parsedSizes,
      bulkPrice: parsedBulkPrice,
      bulkMinimumUnits: parsedBulkMinimumUnits,
      largeQuantityPrice: parsedLargeQuantityPrice,
      largeQuantityMinimumUnits: parsedLargeQuantityMinimumUnits,
    });

    const savedProduct = await newProduct.save();
    res.status(201).json({ success: true, product: savedProduct, message: "Product added successfully!" });
  } catch (error) {
    console.error("Add Product Error:", error.message, error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "Server error during product creation." });
  }
});

// GET single product (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID format." });
    }

    const product = await VendorProduct.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }
    res.json({ success: true, product });
  } catch (error) {
    console.error("Get Single Product Error:", error.message, error);
    res.status(500).json({ success: false, message: "Server error retrieving product details." });
  }
});

// UPDATE product (only by owner)
router.put("/update/:id", authMiddleware, isVendor, upload.array("images", 10), async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId;
    const { id } = req.params;

    if (!vendorId) {
      console.warn("Unauthorized attempt to update product: Vendor ID not found in token.");
      return res.status(403).json({ success: false, message: "Vendor authentication required to update products." });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID format." });
    }
    if (!isValidObjectId(vendorId)) {
      console.error(`Invalid vendorId for product update: ${vendorId}`);
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    let updates = req.body;

    // Handle numeric and boolean fields from string if they are in updates
    if (updates.price) updates.price = parseFloat(updates.price);
    if (updates.discountedPrice) updates.discountedPrice = parseFloat(updates.discountedPrice);
    if (updates.discountPercent) updates.discountPercent = parseFloat(updates.discountPercent);
    if (updates.stock) updates.stock = parseInt(updates.stock, 10);
    if (typeof updates.isAvailable === 'string') updates.isAvailable = (updates.isAvailable === 'true');

    if (updates.bulkPrice) updates.bulkPrice = parseFloat(updates.bulkPrice);
    if (updates.bulkMinimumUnits) updates.bulkMinimumUnits = parseInt(updates.bulkMinimumUnits, 10);
    if (updates.largeQuantityPrice) updates.largeQuantityPrice = parseFloat(updates.largeQuantityPrice);
    if (updates.largeQuantityMinimumUnits) updates.largeQuantityMinimumUnits = parseInt(updates.largeQuantityMinimumUnits, 10);

    if (updates.sizes !== undefined) {
      updates.sizes = updates.sizes
        ? updates.sizes.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];
    }

    // Optional: Add validation for bulk/large quantity pricing during update
    if (updates.bulkMinimumUnits !== undefined && (isNaN(updates.bulkMinimumUnits) || updates.bulkMinimumUnits <= 0)) {
      return res.status(400).json({ success: false, message: "Bulk minimum units must be a positive number." });
    }
    if (updates.bulkPrice !== undefined && (isNaN(updates.bulkPrice) || updates.bulkPrice <= 0)) {
      return res.status(400).json({ success: false, message: "Bulk price must be a positive number." });
    }
    if (updates.largeQuantityMinimumUnits !== undefined && (isNaN(updates.largeQuantityMinimumUnits) || updates.largeQuantityMinimumUnits <= 0)) {
      return res.status(400).json({ success: false, message: "Large quantity minimum units must be a positive number." });
    }
    if (updates.largeQuantityPrice !== undefined && (isNaN(updates.largeQuantityPrice) || updates.largeQuantityPrice <= 0)) {
      return res.status(400).json({ success: false, message: "Large quantity price must be a positive number." });
    }

    const existingProduct = await VendorProduct.findById(id);
    if (!existingProduct) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const currentBulkMinimumUnits = updates.bulkMinimumUnits !== undefined ? updates.bulkMinimumUnits : existingProduct.bulkMinimumUnits;
    const currentLargeQuantityMinimumUnits = updates.largeQuantityMinimumUnits !== undefined ? updates.largeQuantityMinimumUnits : existingProduct.largeQuantityMinimumUnits;

    if (currentBulkMinimumUnits !== undefined && currentLargeQuantityMinimumUnits !== undefined && currentBulkMinimumUnits >= currentLargeQuantityMinimumUnits) {
      return res.status(400).json({ success: false, message: "Large quantity minimum units must be greater than bulk minimum units." });
    }

    // Handle multiple image uploads for update
    if (req.files && req.files.length > 0) {
      const newImageUrls = [];
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer);
        newImageUrls.push(url);
      }
      updates.images = newImageUrls;
    }

    const updatedProduct = await VendorProduct.findOneAndUpdate(
      { _id: id, vendorId },
      updates,
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ success: false, message: "Product not found or you are not authorized to update it." });
    }

    res.json({ success: true, message: "Product updated successfully!", product: updatedProduct });
  } catch (error) {
    console.error("Update Product Error:", error.message, error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "Server error during product update." });
  }
});

// DELETE product (only by owner)
router.delete("/delete/:id", authMiddleware, isVendor, async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId;
    const { id } = req.params;

    if (!vendorId) {
      console.warn("Unauthorized attempt to delete product: Vendor ID not found in token.");
      return res.status(403).json({ success: false, message: "Vendor authentication required to delete products." });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID format." });
    }
    if (!isValidObjectId(vendorId)) {
      console.error(`Invalid vendorId for product deletion: ${vendorId}`);
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    const deleted = await VendorProduct.findOneAndDelete({
      _id: id,
      vendorId,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Product not found or you are not authorized to delete it." });
    }

    res.json({ success: true, message: "Product deleted successfully!" });
  } catch (error) {
    console.error("Delete Product Error:", error.message, error);
    res.status(500).json({ success: false, message: "Server error during product deletion." });
  }
});

module.exports = router;