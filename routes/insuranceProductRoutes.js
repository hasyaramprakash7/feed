const express = require("express");
const { isValidObjectId } = require('mongoose');
const multer = require("multer");
const streamifier = require("streamifier");

// --- Model Imports ---
const InsuranceProduct = require("../models/InsuranceProduct");
const Appointment = require("../models/Appointment"); // Needed for deleting related appointments

// --- Middleware & Util Imports ---
const { authMiddleware, isVendor } = require("../middleware/authMiddleware");
const cloudinary = require("../config/cloudinary");

const router = express.Router();

// --- Multer & Cloudinary Setup ---
const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadImageToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
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
};

// @route   POST /api/products
// @desc    Vendor creates a new insurance product with multiple images
// @access  Private (Vendor specific)
router.post("/", authMiddleware, isVendor, upload.array("images", 10), async (req, res) => {
    const { name, description, badgeText, options, contactNumber, executiveContact, categories } = req.body;
    
    // Validate required fields
    if (!name || !description || !contactNumber || !executiveContact || !categories || !req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: "Missing required fields or images." });
    }

    try {
        // Upload images to Cloudinary
        const imageUrls = [];
        for (const file of req.files) {
            const url = await uploadImageToCloudinary(file.buffer);
            imageUrls.push(url);
        }
        
        // Assign images to mainImage, icon, and otherImages
        const mainImage = imageUrls[0];
        const icon = imageUrls[0];
        const otherImages = imageUrls.slice(1);

        // Parse JSON strings from form data
        const parsedExecutiveContact = JSON.parse(executiveContact);
        const parsedCategories = JSON.parse(categories);
        const parsedOptions = JSON.parse(options);

        const newProduct = new InsuranceProduct({
            vendorId: req.vendor.vendorId,
            name,
            description,
            mainImage,
            otherImages,
            icon,
            badgeText,
            options: parsedOptions,
            contactNumber,
            executiveContact: parsedExecutiveContact,
            categories: parsedCategories
        });

        await newProduct.save();

        res.status(201).json({ success: true, message: "Insurance product created successfully.", product: newProduct });
    } catch (error) {
        console.error("Product Creation Error:", error);
        res.status(500).json({ success: false, message: "Server error during product creation" });
    }
});

// @route   GET /api/products/me
// @desc    Get all insurance products for the authenticated vendor
// @access  Private (Vendor specific)
router.get("/me", authMiddleware, isVendor, async (req, res) => {
    try {
        const products = await InsuranceProduct.find({ vendorId: req.vendor.vendorId });
        res.status(200).json({ success: true, products });
    } catch (error) {
        console.error("Fetch Authenticated Vendor Products Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch your products." });
    }
});

// @route   GET /api/products
// @desc    Get all public insurance products
// @access  Public
router.get("/", async (req, res) => {
    try {
        const products = await InsuranceProduct.find({})
            .populate("vendorId", "shopName shopImage isOnline address"); // Optionally populate vendor details
        res.status(200).json({ success: true, products });
    } catch (error) {
        console.error("Fetch All Products Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch products." });
    }
});

// @route   GET /api/products/vendor/:vendorId
// @desc    Get all insurance products for a specific vendor
// @access  Public (for viewing a vendor's shop)
router.get("/vendor/:vendorId", async (req, res) => {
    const { vendorId } = req.params;
    try {
        if (!isValidObjectId(vendorId)) {
            return res.status(400).json({ success: false, message: "Invalid vendor ID." });
        }
        const products = await InsuranceProduct.find({ vendorId: vendorId });
        res.status(200).json({ success: true, products });
    } catch (error) {
        console.error("Fetch Vendor Products Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch vendor products." });
    }
});

// @route   GET /api/products/:id
// @desc    Get a single insurance product by ID
// @access  Public
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid product ID." });
        }
        const product = await InsuranceProduct.findById(id).populate("vendorId", "name shopName isOnline");
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        res.status(200).json({ success: true, product });
    } catch (error) {
        console.error("Fetch Single Product Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch product." });
    }
});

// @route   PUT /api/products/:id
// @desc    Update an insurance product
// @access  Private (Vendor specific)
// A more robust approach to handle optional image uploads
// on the update endpoint. This handles the case where no new files are uploaded.
router.put("/:id", authMiddleware, isVendor, upload.any(), async (req, res) => {
    const { id } = req.params;
    
    // Create a new object to hold the parsed and updated data
    const updatedData = {};

    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid product ID." });
        }
        const product = await InsuranceProduct.findById(id);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        if (product.vendorId.toString() !== req.vendor.vendorId) {
            return res.status(403).json({ success: false, message: "Forbidden: You can only update your own products." });
        }

        // Check if any new files were uploaded
        if (req.files && req.files.length > 0) {
            const imageUrls = [];
            for (const file of req.files) {
                const url = await uploadImageToCloudinary(file.buffer);
                imageUrls.push(url);
            }
            updatedData.mainImage = imageUrls[0];
            updatedData.icon = imageUrls[0];
            updatedData.otherImages = imageUrls.slice(1);
        } else {
            // If no new files, check for existing image URLs sent from the client
            if (req.body.mainImage) {
                updatedData.mainImage = req.body.mainImage;
            }
            if (req.body.otherImages) {
                updatedData.otherImages = JSON.parse(req.body.otherImages);
            }
        }
        
        // Update the rest of the fields
        if (req.body.name) updatedData.name = req.body.name;
        if (req.body.description) updatedData.description = req.body.description;
        if (req.body.badgeText) updatedData.badgeText = req.body.badgeText;
        if (req.body.contactNumber) updatedData.contactNumber = req.body.contactNumber;
        if (req.body.options) updatedData.options = JSON.parse(req.body.options);
        if (req.body.executiveContact) updatedData.executiveContact = JSON.parse(req.body.executiveContact);
        if (req.body.categories) updatedData.categories = JSON.parse(req.body.categories);
        
        const updatedProduct = await InsuranceProduct.findByIdAndUpdate(id, updatedData, { new: true, runValidators: true });
        res.status(200).json({ success: true, message: "Product updated successfully.", product: updatedProduct });
    } catch (error) {
        console.error("Product Update Error:", error);
        res.status(500).json({ success: false, message: "Server error during update." });
    }
});

// @route   DELETE /api/products/:id
// @desc    Delete an insurance product and its associated appointments
// @access  Private (Vendor specific)
router.delete("/:id", authMiddleware, isVendor, async (req, res) => {
    const { id } = req.params;
    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid product ID." });
        }
        const product = await InsuranceProduct.findById(id);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        // Authorization check: Ensure the vendor owns the product
        if (product.vendorId.toString() !== req.vendor.vendorId) {
            return res.status(403).json({ success: false, message: "Forbidden: You can only delete your own products." });
        }

        // Delete associated appointments
        await Appointment.deleteMany({ insuranceProductId: id });

        // Delete the product itself
        await product.deleteOne();

        res.status(200).json({ success: true, message: "Product and associated appointments deleted successfully." });
    } catch (error) {
        console.error("Product Deletion Error:", error);
        res.status(500).json({ success: false, message: "Server error during deletion." });
    }
});

module.exports = router;