const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const streamifier = require("streamifier");

const DeliveryBoy = require("../models/DeliveryBoy");
const { authMiddleware } = require("../middleware/authMiddleware");
const cloudinary = require("../config/cloudinary");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const storage = multer.memoryStorage();
const upload = multer({ storage });

const generateToken = (deliveryBoy) => {
    return jwt.sign(
        { deliveryBoyId: deliveryBoy._id, email: deliveryBoy.email, role: "deliveryBoy" },
        JWT_SECRET,
        { expiresIn: "3000d" }
    );
};

// --- REGISTER ---
router.post("/register", upload.single("shopImage"), async (req, res) => {
    // 🔥 UPDATED: Added pushToken
    const { name, email, password, phone, shopName, businessType, vehicleNo, licenseNo, address, pushToken } = req.body;

    if (!name || !email || !password || !phone || !address || !shopName || !businessType || !vehicleNo || !licenseNo) {
        return res.status(400).json({ success: false, message: "Please fill all required fields" });
    }

    try {
        const existing = await DeliveryBoy.findOne({ email });
        if (existing) {
            return res.status(400).json({ success: false, message: "Delivery Boy already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        let shopImageUrl = "";
        if (req.file) {
            const streamUpload = () =>
                new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream((error, result) => {
                        if (result) resolve(result);
                        else reject(error);
                    });
                    streamifier.createReadStream(req.file.buffer).pipe(stream);
                });

            const result = await streamUpload();
            shopImageUrl = result.secure_url;
        }

        const newBoy = new DeliveryBoy({
            name, email, password: hashedPassword, phone, shopName, businessType, vehicleNo, licenseNo,
            shopImage: shopImageUrl,
            address: JSON.parse(address),
            pushToken: pushToken || null // 🔥 Save Token
        });

        await newBoy.save();
        const token = generateToken(newBoy);

        const responsePayload = {
            id: newBoy._id, name: newBoy.name, email: newBoy.email, phone: newBoy.phone,
            shopName: newBoy.shopName, businessType: newBoy.businessType, vehicleNo: newBoy.vehicleNo,
            licenseNo: newBoy.licenseNo, shopImage: newBoy.shopImage, address: newBoy.address,
            isApproved: newBoy.isApproved, isAvailable: newBoy.isAvailable, pushToken: newBoy.pushToken
        };

        res.status(201).json({
            success: true,
            message: "Delivery boy registered successfully",
            deliveryBoy: responsePayload,
            token,
        });
    } catch (error) {
        console.error("DeliveryBoy Registration Error:", error);
        res.status(500).json({ success: false, message: "Server error during registration" });
    }
});

// --- LOGIN ---
router.post("/login", async (req, res) => {
    // 🔥 UPDATED: Added pushToken
    const { email, password, pushToken } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Please provide email and password" });
    }

    try {
        const deliveryBoy = await DeliveryBoy.findOne({ email });
        if (!deliveryBoy) {
            return res.status(400).json({ success: false, message: "Invalid email or password" });
        }

        const isMatch = await bcrypt.compare(password, deliveryBoy.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Invalid email or password" });
        }

        if (pushToken && deliveryBoy.pushToken !== pushToken) {
            deliveryBoy.pushToken = pushToken; // 🔥 Update token if needed
            await deliveryBoy.save();
        }

        const token = generateToken(deliveryBoy);

        const responsePayload = {
            id: deliveryBoy._id, name: deliveryBoy.name, email: deliveryBoy.email, phone: deliveryBoy.phone,
            shopName: deliveryBoy.shopName, businessType: deliveryBoy.businessType, vehicleNo: deliveryBoy.vehicleNo,
            licenseNo: deliveryBoy.licenseNo, shopImage: deliveryBoy.shopImage, address: deliveryBoy.address,
            isApproved: deliveryBoy.isApproved, isAvailable: deliveryBoy.isAvailable, pushToken: deliveryBoy.pushToken
        };

        res.status(200).json({
            success: true,
            message: "Login successful",
            deliveryBoy: responsePayload,
            token,
        });
    } catch (error) {
        console.error("DeliveryBoy Login Error:", error);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

// 🔥 NEW: Dedicated route to update push token silently
router.put("/update-push-token", authMiddleware, async (req, res) => {
    try {
        const deliveryBoyId = req.deliveryBoy?.deliveryBoyId;
        const { pushToken } = req.body;

        if (!deliveryBoyId) return res.status(403).json({ success: false, message: "Unauthorized" });

        await DeliveryBoy.findByIdAndUpdate(deliveryBoyId, { pushToken }, { new: true });
        res.json({ success: true, message: "Push token updated successfully" });
    } catch (error) {
        console.error("Update Push Token Error:", error);
        res.status(500).json({ success: false, message: "Update failed" });
    }
});

// --- UPDATE PROFILE ---
router.put("/update", authMiddleware, upload.single("shopImage"), async (req, res) => {
    const deliveryBoyId = req.deliveryBoy?.deliveryBoyId;

    if (!deliveryBoyId) {
        return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const { name, phone, shopName, businessType, vehicleNo, licenseNo, address, ...otherUpdates } = req.body;
    const updates = { name, phone, shopName, businessType, vehicleNo, licenseNo, address, ...otherUpdates };

    if (updates.password) delete updates.password;

    if (updates.address && typeof updates.address === 'string') {
        try {
            updates.address = JSON.parse(updates.address);
        } catch {
            return res.status(400).json({ success: false, message: "Invalid address format" });
        }
    }

    if (req.file) {
        const streamUpload = () =>
            new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream((error, result) => {
                    if (result) resolve(result);
                    else reject(error);
                });
                streamifier.createReadStream(req.file.buffer).pipe(stream);
            });

        try {
            const result = await streamUpload();
            updates.shopImage = result.secure_url;
        } catch (error) {}
    }

    try {
        const updated = await DeliveryBoy.findByIdAndUpdate(deliveryBoyId, updates, {
            new: true,
            runValidators: true,
        }).select("-password");

        if (!updated) {
            return res.status(404).json({ success: false, message: "Delivery Boy not found" });
        }
        res.json({ success: true, message: "Profile updated", deliveryBoy: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during update" });
    }
});

// --- GET PROFILE ---
router.get("/profile", authMiddleware, async (req, res) => {
    const deliveryBoyId = req.deliveryBoy?.deliveryBoyId;
    if (!deliveryBoyId) return res.status(403).json({ success: false, message: "Unauthorized" });

    try {
        const deliveryBoy = await DeliveryBoy.findById(deliveryBoyId).select("-password");
        if (!deliveryBoy) return res.status(404).json({ success: false, message: "Delivery Boy not found" });

        res.json({ success: true, deliveryBoy });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- GET ALL DELIVERY BOYS ---
router.get("/all", async (req, res) => {
    try {
        const all = await DeliveryBoy.find({}, "_id name phone isAvailable");
        res.status(200).json(all);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch delivery boys" });
    }
});

// --- TOGGLE AVAILABILITY ---
router.patch("/toggle-availability", authMiddleware, async (req, res) => {
    const deliveryBoyId = req.deliveryBoy?.deliveryBoyId;
    if (!deliveryBoyId) return res.status(403).json({ success: false, message: "Unauthorized" });

    try {
        const deliveryBoy = await DeliveryBoy.findById(deliveryBoyId);
        if (!deliveryBoy) return res.status(404).json({ success: false, message: "Not found" });

        deliveryBoy.isAvailable = !deliveryBoy.isAvailable;
        await deliveryBoy.save();

        res.json({
            success: true,
            message: `Availability set to ${deliveryBoy.isAvailable}`,
            isAvailable: deliveryBoy.isAvailable,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- Get all orders assigned to a specific delivery boy ---
router.get("/:id/orders", authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const deliveryBoy = await DeliveryBoy.findById(id).populate({
            path: "assignedOrders",
            populate: { path: "userId", select: "name email" },
        });

        if (!deliveryBoy) return res.status(404).json({ message: "Delivery boy not found" });
        return res.json({ success: true, orders: deliveryBoy.assignedOrders });
    } catch (err) {
        return res.status(500).json({ message: "Server error while fetching orders" });
    }
});

module.exports = router;