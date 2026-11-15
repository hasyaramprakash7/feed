// routes/vendor.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { isValidObjectId } = require('mongoose');
const multer = require("multer");
const streamifier = require("streamifier");
const twilio = require("twilio");
const h3 = require("h3-js");

const Vendor = require("../models/Vendor");
const Order = require("../models/Order");
const Category = require("../models/Category");
const Review = require("../models/Review");
const PushToken = require('../models/PushToken');

const { authMiddleware, isVendor, isAdmin } = require("../middleware/authMiddleware");
const { generateVendorToken } = require("../utils/generateToken");
const cloudinary = require("../config/cloudinary");

const router = express.Router();

const H3_RESOLUTION = 8;

const twilioClient = twilio(
    (process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID)?.trim(),
    (process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN)?.trim(),
    { accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() }
);
const TWILIO_SERVICE_SID = process.env.TWILIO_SERVICE_SID;

const formatPhone = (phone) => {
    if (!phone.startsWith("+")) {
        return `+91${phone}`;
    }
    return phone;
};

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

// =====================================================================
// 1. SEND OTP
// =====================================================================
router.post("/send-otp", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

    try {
        const formattedPhone = formatPhone(phone);
        const verification = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verifications.create({ to: formattedPhone, channel: "sms" });

        res.status(200).json({ success: true, message: "OTP sent successfully", status: verification.status });
    } catch (error) {
        console.error("Send OTP Error:", error);
        res.status(500).json({ success: false, message: "Failed to send OTP via Twilio" });
    }
});

// =====================================================================
// // 2. VERIFY OTP & LOGIN
// // =====================================================================
// router.post("/login-with-otp", async (req, res) => {
//     const { phone, otp, pushToken } = req.body;
//     if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP required" });

//     try {
//         const formattedPhone = formatPhone(phone);
//         const verificationCheck = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
//             .verificationChecks.create({ to: formattedPhone, code: otp });

//         if (verificationCheck.status !== "approved") {
//             return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
//         }

//         const vendor = await Vendor.findOne({ phone });
//         if (!vendor) {
//             return res.status(404).json({ success: false, message: "No account found with this phone number" });
//         }

//         if (!vendor.isApproved) {
//             return res.status(403).json({ success: false, message: "Your account is not yet approved by an administrator." });
//         }

//         vendor.isOnline = true;
//         if (pushToken && vendor.pushToken !== pushToken) {
//             vendor.pushToken = pushToken;
//         }

//         const updatedVendor = await vendor.save();
//         const token = generateVendorToken(updatedVendor);

//         res.status(200).json({ success: true, message: "Login successful", vendor: updatedVendor, token });
//     } catch (error) {
//         console.error("OTP Login Error:", error);
//         res.status(500).json({ success: false, message: "Failed to verify OTP" });
//     }
// });

// =====================================================================
// 3. VERIFY OTP & REGISTER
// =====================================================================
router.post("/register-with-otp", upload.single("shopImage"), async (req, res) => {
    const { name, email, password, phone, shopName, businessType, gstNo, deliveryRange, address, pushToken, otp } = req.body;

    if (!name || !email || password === undefined || password === null || !phone || !shopName || !businessType || !address || !otp) {
        return res.status(400).json({ success: false, message: "Please fill all required fields and provide OTP" });
    }

    try {
        const formattedPhone = formatPhone(phone);
        const verificationCheck = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verificationChecks.create({ to: formattedPhone, code: otp });

        if (verificationCheck.status !== "approved") {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        const vendorExists = await Vendor.findOne({ $or: [{ email }, { phone }] });
        if (vendorExists) {
            return res.status(400).json({ success: false, message: "Vendor with this email or phone already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let shopImageUrl = "";
        if (req.file) {
            shopImageUrl = await uploadImageToCloudinary(req.file.buffer);
        }

        const parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;

        let parsedCategories = [];
        let parsedServices = [];
        let parsedTags = [];
        let parsedOperatingHours = null;
        let isVerified = false;
        let isPremium = false;

        try {
            if (req.body.categories) parsedCategories = JSON.parse(req.body.categories);
            if (req.body.services) parsedServices = JSON.parse(req.body.services);
            if (req.body.tags) parsedTags = JSON.parse(req.body.tags);
            if (req.body.operatingHours) parsedOperatingHours = JSON.parse(req.body.operatingHours);
            if (req.body.isVerified) isVerified = req.body.isVerified === 'true';
            if (req.body.isPremium) isPremium = req.body.isPremium === 'true';
        } catch (e) {
            console.error("JSON parse error:", e);
            return res.status(400).json({ success: false, message: "Invalid JSON format for directory fields" });
        }

        let h3IndexStr = null;
        if (parsedAddress && parsedAddress.latitude && parsedAddress.longitude) {
            h3IndexStr = h3.latLngToCell(Number(parsedAddress.latitude), Number(parsedAddress.longitude), H3_RESOLUTION);
        }

        const now = new Date();
        const oneYearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

        const newVendor = new Vendor({
            name, email, password: hashedPassword, phone, shopName, businessType,
            gstNo: gstNo || null,
            deliveryRange: Number(deliveryRange) || 0,
            shopImage: shopImageUrl,
            address: {
                latitude: parsedAddress.latitude,
                longitude: parsedAddress.longitude,
                pincode: parsedAddress.pincode || "",
                state: parsedAddress.state || "",
                district: parsedAddress.district || "",
                country: parsedAddress.country || "India",
                street: parsedAddress.street || "",
                colony: parsedAddress.colony || "",
            },
            h3Index: h3IndexStr,
            
            subscriptionStatus: 'active',
            subscriptionStartDate: now,
            subscriptionEndDate: oneYearLater,
            categories: parsedCategories,
            services: parsedServices,
            tags: parsedTags,
            operatingHours: parsedOperatingHours,
            isVerified,
            isPremium,
        });

        await newVendor.save();
        const token = generateVendorToken(newVendor);

        res.status(201).json({ success: true, message: "Vendor registered successfully.", vendor: newVendor, token });
    } catch (error) {
        console.error("Vendor OTP Registration Error:", error);
        res.status(500).json({ success: false, message: "Server error during registration" });
    }
});

// =====================================================================
// 4. STANDARD REGISTRATION
// =====================================================================
router.post("/register", upload.single("shopImage"), async (req, res) => {
    const { name, email, password, phone, shopName, businessType, gstNo, deliveryRange, address, pushToken } = req.body;
    if (!name || !email || password === undefined || password === null || !phone || !shopName || !businessType || !address) {
        return res.status(400).json({ success: false, message: "Please fill all required fields" });
    }

    try {
        const vendorExists = await Vendor.findOne({ email });
        if (vendorExists) {
            return res.status(400).json({ success: false, message: "Vendor with this email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let shopImageUrl = "";
        if (req.file) {
            shopImageUrl = await uploadImageToCloudinary(req.file.buffer);
        }

        const parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;

        let parsedCategories = [];
        let parsedServices = [];
        let parsedTags = [];
        let parsedOperatingHours = null;
        let isVerified = false;
        let isPremium = false;

        try {
            if (req.body.categories) parsedCategories = JSON.parse(req.body.categories);
            if (req.body.services) parsedServices = JSON.parse(req.body.services);
            if (req.body.tags) parsedTags = JSON.parse(req.body.tags);
            if (req.body.operatingHours) parsedOperatingHours = JSON.parse(req.body.operatingHours);
            if (req.body.isVerified) isVerified = req.body.isVerified === 'true';
            if (req.body.isPremium) isPremium = req.body.isPremium === 'true';
        } catch (e) {
            console.error("JSON parse error:", e);
            return res.status(400).json({ success: false, message: "Invalid JSON format for directory fields" });
        }

        let h3IndexStr = null;
        if (parsedAddress && parsedAddress.latitude && parsedAddress.longitude) {
            h3IndexStr = h3.latLngToCell(Number(parsedAddress.latitude), Number(parsedAddress.longitude), H3_RESOLUTION);
        }

        const newVendor = new Vendor({
            name, email, password: hashedPassword, phone, shopName, businessType,
            gstNo: gstNo || null,
            deliveryRange: Number(deliveryRange) || 0,
            shopImage: shopImageUrl,
            address: {
                latitude: parsedAddress.latitude,
                longitude: parsedAddress.longitude,
                pincode: parsedAddress.pincode || "",
                state: parsedAddress.state || "",
                district: parsedAddress.district || "",
                country: parsedAddress.country || "India",
                street: parsedAddress.street || "",
                colony: parsedAddress.colony || "",
            },
            h3Index: h3IndexStr,
            
            categories: parsedCategories,
            services: parsedServices,
            tags: parsedTags,
            operatingHours: parsedOperatingHours,
            isVerified,
            isPremium,
        });

        await newVendor.save();
        const token = generateVendorToken(newVendor);

        res.status(201).json({ success: true, message: "Vendor registered successfully, pending approval.", vendor: newVendor, token });
    } catch (error) {
        console.error("Vendor Registration Error:", error);
        res.status(500).json({ success: false, message: "Server error during registration" });
    }
});

/// routes/vendor.js - FIXED

// =====================================================================
// 5. LOGIN - REMOVE pushToken
// =====================================================================
router.post("/login", async (req, res) => {
    const { identifier, password } = req.body;  // ✅ REMOVED pushToken
    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: "Please provide credentials" });
    }

    try {
        const vendor = await Vendor.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
        if (!vendor) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }
        if (!vendor.isApproved) {
            return res.status(403).json({ success: false, message: "Your account is not yet approved by an administrator." });
        }
        const isMatch = await bcrypt.compare(password, vendor.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        vendor.isOnline = true;
        // ✅ REMOVED pushToken update - will be done via /push/register

        const updatedVendor = await vendor.save();
        const token = generateVendorToken(updatedVendor);
        res.status(200).json({ success: true, message: "Login successful", vendor: updatedVendor, token });
    } catch (error) {
        console.error("Vendor Login Error:", error);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

// =====================================================================
// 2. VERIFY OTP & LOGIN - REMOVE pushToken
// =====================================================================
router.post("/login-with-otp", async (req, res) => {
    const { phone, otp } = req.body;  // ✅ REMOVED pushToken
    if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP required" });

    try {
        const formattedPhone = formatPhone(phone);
        const verificationCheck = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verificationChecks.create({ to: formattedPhone, code: otp });

        if (verificationCheck.status !== "approved") {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        const vendor = await Vendor.findOne({ phone });
        if (!vendor) {
            return res.status(404).json({ success: false, message: "No account found with this phone number" });
        }

        if (!vendor.isApproved) {
            return res.status(403).json({ success: false, message: "Your account is not yet approved by an administrator." });
        }

        vendor.isOnline = true;
        // ✅ REMOVED pushToken update

        const updatedVendor = await vendor.save();
        const token = generateVendorToken(updatedVendor);

        res.status(200).json({ success: true, message: "Login successful", vendor: updatedVendor, token });
    } catch (error) {
        console.error("OTP Login Error:", error);
        res.status(500).json({ success: false, message: "Failed to verify OTP" });
    }
});
// =====================================================================
// 6. UPDATE PUSH TOKEN
// =====================================================================
// routes/vendor.js  →  replace the existing /update-push-token handler
// const PushToken = require('../models/PushToken');

router.put('/update-push-token', authMiddleware, isVendor, async (req, res) => {
  try {
    const vendorId = req.vendor.vendorId;
    const { pushToken, platform, deviceInfo } = req.body;

    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'pushToken required' });
    }

    await PushToken.updateOne(
      { ownerId: String(vendorId), ownerType: 'vendor', token: pushToken },
      {
        $set: {
          platform: platform || 'unknown',
          deviceInfo: deviceInfo || {},
          lastUsed: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'Push token updated' });
  } catch (error) {
    console.error('Update Push Token Error:', error);
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// =====================================================================
// 7. VENDOR PROFILE UPDATE
// =====================================================================
router.put("/update", authMiddleware, isVendor, upload.single("shopImage"), async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;
        const updates = {};

        for (const key in req.body) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) {
                if (key.startsWith("address.")) {
                    if (!updates.address) updates.address = {};
                    updates.address[key.substring(8)] = req.body[key];
                } else {
                    updates[key] = req.body[key];
                }
            }
        }

        if (req.body.address && typeof req.body.address === 'string') {
            try {
                updates.address = JSON.parse(req.body.address);
            } catch (e) {
                console.error("Error parsing address JSON in update", e);
            }
        }

        if (updates.address && updates.address.latitude && updates.address.longitude) {
            updates.h3Index = h3.latLngToCell(Number(updates.address.latitude), Number(updates.address.longitude), H3_RESOLUTION);
        }

        delete updates.password;
        delete updates.isOnline;

        if (updates.deliveryRange !== undefined) {
            const rangeValue = Array.isArray(updates.deliveryRange)
                ? updates.deliveryRange[updates.deliveryRange.length - 1]
                : updates.deliveryRange;
            updates.deliveryRange = Number(rangeValue);
        }

        if (req.file) {
            updates.shopImage = await uploadImageToCloudinary(req.file.buffer);
        }

        const updatedVendor = await Vendor.findByIdAndUpdate(vendorId, { $set: updates }, {
            new: true,
            runValidators: true,
        }).select("-password");

        if (!updatedVendor) {
            return res.status(404).json({ success: false, message: "Vendor not found" });
        }

        res.json({ success: true, message: "Profile updated successfully", vendor: updatedVendor });
    } catch (error) {
        console.error("Vendor Update Error:", error);
        res.status(500).json({ success: false, message: "Server error during update" });
    }
});

// =====================================================================
// 8. LOGOUT
// =====================================================================
router.post("/logout", authMiddleware, isVendor, async (req, res) => {
    try {
        res.status(200).json({ success: true, message: "Logged out successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during logout" });
    }
});

// =====================================================================
// 9. TOGGLE ONLINE STATUS
// =====================================================================
router.put("/status", authMiddleware, isVendor, async (req, res) => {
    const { isOnline } = req.body;
    if (typeof isOnline !== 'boolean') {
        return res.status(400).json({ success: false, message: "Invalid status provided." });
    }
    try {
        const vendor = await Vendor.findByIdAndUpdate(req.vendor.vendorId, { isOnline }, { new: true });
        res.json({ success: true, message: `Status updated`, currentStatus: vendor.isOnline });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error on status update." });
    }
});

// =====================================================================
// 10. GET PROFILE
// =====================================================================
router.get("/profile", authMiddleware, isVendor, async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.vendor.vendorId).select("-password");
        if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
        res.json({ success: true, vendor });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error fetching profile" });
    }
});

// =====================================================================
// 11. GET VENDOR PUSH TOKEN
// =====================================================================
router.get("/:id/push-token", async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
        }
        const vendor = await Vendor.findById(id).select("pushToken");
        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor not found" });
        }
        res.json({ success: true, pushToken: vendor.pushToken });
    } catch (error) {
        console.error("Get Vendor Push Token Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// =====================================================================
// 12. GET ORDERS
// =====================================================================
router.get("/orders", authMiddleware, isVendor, async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;
        const orders = await Order.find({ vendor: vendorId })
            .populate("user", "name phone")
            .populate("items.product", "name price")
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, orders });
    } catch (error) {
        console.error("Vendor Orders Fetch Error:", error);
        res.status(500).json({ success: false, message: "Server error fetching vendor orders" });
    }
});

// =====================================================================
// 13. NEARBY VENDORS (H3)
// =====================================================================
router.get("/nearby", async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Coordinates required" });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const R = 6371;
        const H3_RESOLUTION = 8;

        const userHex = h3.latLngToCell(userLat, userLng, H3_RESOLUTION);
        const searchRadiusInRings = 5;
        const searchHexagons = h3.gridDisk(userHex, searchRadiusInRings);

        let nearbyVendors = await Vendor.find({
            h3Index: { $in: searchHexagons },
            isApproved: true,
            isOnline: true,
        }).select("-password -token -pushToken").lean();

        let filteredVendors = [];

        if (nearbyVendors.length > 0) {
            filteredVendors = nearbyVendors
                .map(v => {
                    if (!v.address?.latitude || !v.address?.longitude) return null;
                    const dLat = (v.address.latitude - userLat) * Math.PI / 180;
                    const dLng = (v.address.longitude - userLng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) ** 2 +
                        Math.cos(userLat * Math.PI / 180) * Math.cos(v.address.latitude * Math.PI / 180) *
                        Math.sin(dLng / 2) ** 2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const distance = R * c;
                    v.distance = distance;
                    return v;
                })
                .filter(v => v !== null && v.distance <= v.deliveryRange)
                .sort((a, b) => a.distance - b.distance);
        }

        if (filteredVendors.length === 0) {
            console.warn('⚠️ H3 found 0 vendors – using fallback Haversine scan');
            const allVendors = await Vendor.find({
                isApproved: true,
                isOnline: true,
                'address.latitude': { $exists: true, $ne: null }
            }).select("-password -token -pushToken").lean();

            filteredVendors = allVendors
                .map(v => {
                    const dLat = (v.address.latitude - userLat) * Math.PI / 180;
                    const dLng = (v.address.longitude - userLng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) ** 2 +
                        Math.cos(userLat * Math.PI / 180) * Math.cos(v.address.latitude * Math.PI / 180) *
                        Math.sin(dLng / 2) ** 2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const distance = R * c;
                    v.distance = distance;
                    return v;
                })
                .filter(v => v.distance <= v.deliveryRange)
                .sort((a, b) => a.distance - b.distance);
        }

        res.status(200).json({
            success: true,
            count: filteredVendors.length,
            vendors: filteredVendors
        });
    } catch (error) {
        console.error("Error in /nearby:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// =====================================================================
// 14. PUBLIC: GET ALL VENDORS
// =====================================================================
router.get("/all", async (req, res) => {
    try {
        const vendors = await Vendor.find({})
            .select("_id shopName shopImage isOnline address deliveryRange isApproved isPremium averageRating reviewCount categories")
            .lean();
        res.status(200).json({ vendors });
    } catch (error) {
        console.error("Fetch All Vendors Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch vendors" });
    }
});

// =====================================================================
// 15. DIRECTORY SEARCH - WITH RADIUS SUPPORT (Haversine, no H3)
// =====================================================================
// =====================================================================
// 15. DIRECTORY SEARCH - WITH RADIUS SUPPORT (Haversine, no H3)
// =====================================================================
router.get("/directory", async (req, res) => {
    try {
        const {
            lat, lng,
            category,
            q,
            minRating,
            premium,
            radius = 10,          // default 10 km
            page = 1,
            limit = 10,
        } = req.query;

        let filter = { isApproved: true };

        // Category filtering (case‑insensitive)
        if (category) {
            if (typeof category === 'string') {
                filter.categories = { $regex: new RegExp(category, 'i') };
            } else if (Array.isArray(category)) {
                filter.$or = category.map(c => ({ categories: { $regex: new RegExp(c, 'i') } }));
            }
        }
        if (premium === 'true') filter.isPremium = true;
        if (minRating) {
            const rating = parseFloat(minRating);
            if (!isNaN(rating)) filter.averageRating = { $gte: rating };
        }
        if (q) {
            const regex = new RegExp(q, 'i');
            filter.$or = filter.$or || [];
            filter.$or.push(
                { shopName: regex },
                { name: regex },
                { businessType: regex },
                { 'address.state': regex },
                { 'address.district': regex },
                { 'address.pincode': regex },
                { categories: { $regex: regex } }
            );
        }

        const maxRadius = parseFloat(radius) > 0 ? parseFloat(radius) : 10;
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const hasLocation = !isNaN(userLat) && !isNaN(userLng);

        let vendors = [];
        const R = 6371; // Earth’s radius in km

        // Fetch all matching vendors (without location filter first)
        let allVendors = await Vendor.find(filter)
            .select("-password -token -pushToken")
            .lean();

        if (hasLocation) {
            // Calculate Haversine distance and filter by radius
            vendors = allVendors
                .map(v => {
                    if (!v.address?.latitude || !v.address?.longitude) return null;
                    const dLat = (v.address.latitude - userLat) * Math.PI / 180;
                    const dLng = (v.address.longitude - userLng) * Math.PI / 180;
                    const a = Math.sin(dLat/2)**2 +
                              Math.cos(userLat * Math.PI/180) * Math.cos(v.address.latitude * Math.PI/180) *
                              Math.sin(dLng/2)**2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    const distance = R * c;
                    v.distance = distance;
                    return v;
                })
                .filter(v => v !== null && v.distance <= maxRadius)
                .sort((a, b) => a.distance - b.distance);
        } else {
            vendors = allVendors.sort((a, b) => b.isPremium - a.isPremium || b.averageRating - a.averageRating);
        }

        // Pagination
        const total = vendors.length;
        const start = (parseInt(page) - 1) * parseInt(limit);
        const paginated = vendors.slice(start, start + parseInt(limit));

        console.log(`🔍 [Directory] Found ${vendors.length} vendors (radius ${maxRadius} km)`);

        res.json({
            status: 'success',
            results: paginated.length,
            total,
            page: parseInt(page),
            data: paginated,
        });
    } catch (error) {
        console.error('Directory search error:', error);
        res.status(500).json({ status: 'fail', message: error.message });
    }
});

// =====================================================================
// 16. ADMIN: APPROVE VENDOR
// =====================================================================
router.put("/admin/approve/:vendorId", authMiddleware, isAdmin, async (req, res) => {
    try {
        const { vendorId } = req.params;
        if (!isValidObjectId(vendorId)) {
            return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
        }
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor not found." });
        }
        vendor.isApproved = true;
        await vendor.save();
        res.status(200).json({
            success: true,
            message: `Vendor '${vendor.shopName}' has been approved.`,
            vendor,
        });
    } catch (error) {
        console.error("Admin Approve Vendor Error:", error);
        res.status(500).json({ success: false, message: "Server error during approval." });
    }
});

module.exports = router;