// ---------------------------------------------------------------- //
// FILE: ../routes/auth.js
// ---------------------------------------------------------------- //
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const streamifier = require("streamifier");
const twilio = require("twilio");

const User = require("../models/User");
const AppConfig = require("../models/AppConfig"); 
const Vendor = require("../models/Vendor");
const { authMiddleware } = require("../middleware/authMiddleware");
const PushToken = require('../models/PushToken');

// 🔥 ADD CLOUDINARY CONFIG
const cloudinary = require("../config/cloudinary"); 

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// ==========================================================
// 🔥 TWILIO SETUP (Fixed hidden whitespace issues with .trim())
// ==========================================================
// Using fallback options just in case you are using standard Auth Token instead of API Key
const twilioClient = twilio(
  (process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID)?.trim(),
  (process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN)?.trim(),
  { accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() }
);

const TWILIO_SERVICE_SID = process.env.TWILIO_SERVICE_SID?.trim();

// --- MULTER & CLOUDINARY SETUP ---
const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadImageToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "bluxury_users" }, 
            (err, result) => {
                if (result) {
                    resolve(result.secure_url);
                } else {
                    console.error("Cloudinary upload error:", err);
                    reject(err);
                }
            }
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });
};

const getCloudinaryPublicId = (url) => {
    try {
        const parts = url.split('/');
        const filename = parts.pop().split('.')[0]; 
        const folder = parts.pop(); 
        return `${folder}/${filename}`;
    } catch (error) {
        return null;
    }
};

// 🔥 UNIVERSAL PHONE FORMATTER
const formatPhone = (phone) => {
    if (!phone) return null;
    let cleanPhone = phone.toString().replace(/\D/g, ''); 
    if (cleanPhone.length >= 10) {
        cleanPhone = cleanPhone.slice(-10);
    }
    return `+91${cleanPhone}`;
};

const generateToken = (user) => {
    return jwt.sign(
        { 
            userId: user._id, 
            email: user.email, 
            role: user.role || "user"
        },
        JWT_SECRET,
        { expiresIn: "3000d" }
    );
};

// --- REGISTER ---
router.post("/register", async (req, res) => {
    const { name, email, password, address, phone, pushToken } = req.body;

    if (!name || !email || !password || !address || !phone) {
        return res.status(400).json({ success: false, message: "Please fill all fields" });
    }

    try {
        const formattedPhone = formatPhone(phone);
        const raw10Digits = formattedPhone.replace('+91', '');

        const userExists = await User.findOne({ 
            $or: [{ email }, { phone: formattedPhone }, { phone: raw10Digits }] 
        });

        if (userExists) {
            let message = "User already exists.";
            if (userExists.email === email) message = "A user with this email already exists.";
            else message = "A user with this phone number already exists.";
            return res.status(400).json({ success: false, message });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name, email, password: hashedPassword, address, phone: formattedPhone, pushToken: pushToken || null 
        });

        const token = generateToken(newUser);
        newUser.token = token;
        await newUser.save();

        res.status(201).json({
            success: true, message: "User registered successfully",
            user: {
                id: newUser._id, name: newUser.name, email: newUser.email,
                phone: newUser.phone, address: newUser.address, role: newUser.role, pushToken: newUser.pushToken
            },
            token,
        });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ success: false, message: "Server error during registration" });
    }
});

// --- LOGIN ---
router.post("/login", async (req, res) => {
    const { identifier, password, pushToken } = req.body;

    if (!identifier || !password)
        return res.status(400).json({ success: false, message: "Please provide login credentials" });

    try {
        let searchQuery = [{ email: identifier }];
        
        if (/\d/.test(identifier)) {
            const formattedPhone = formatPhone(identifier);
            const raw10Digits = formattedPhone.replace('+91', '');
            searchQuery.push({ phone: formattedPhone });
            searchQuery.push({ phone: raw10Digits }); 
        }

        const user = await User.findOne({ $or: searchQuery });
        if (!user) return res.status(400).json({ success: false, message: "Invalid credentials" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials" });

        const token = generateToken(user);
        user.token = token;
        
        
        if (!user.phone.startsWith('+91')) user.phone = formatPhone(user.phone);
        
        await user.save();

        res.status(200).json({
            success: true, message: "Login successful",
            user: {
                id: user._id, name: user.name, email: user.email, profilePic: user.profilePic,
                phone: user.phone, address: user.address, role: user.role, pushToken: user.pushToken
            },
            token,
        });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

// --- UPDATE PUSH TOKEN ---
// routes/auth.js

router.put('/update-push-token', authMiddleware, async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    const { pushToken, platform, deviceInfo } = req.body;
    if (!userId || !pushToken) {
      return res.status(400).json({ success: false, message: 'Missing data' });
    }

    await PushToken.updateOne(
      { ownerId: String(userId), ownerType: 'user', token: pushToken },
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

// --- SYNC CONTACTS ---
router.post("/sync-contacts", authMiddleware, async (req, res) => {
  const { phoneNumbers } = req.body; 
  if (!phoneNumbers || !Array.isArray(phoneNumbers)) return res.status(400).json({ success: false, message: "Invalid data" });

  try {
    let searchNumbers = [];
    phoneNumbers.forEach(num => {
      const last10 = num.replace(/\D/g, '').slice(-10);
      if(last10.length === 10) {
        searchNumbers.push(last10);
        searchNumbers.push(`+91${last10}`);
      }
    });

    const matchedUsers = await User.find({ phone: { $in: searchNumbers } }).select('_id name phone profilePic'); 
    const matchedVendors = await Vendor.find({ phone: { $in: searchNumbers } }).select('_id shopName name phone shopImage');

    const registeredContacts = [
      ...matchedUsers.map(u => ({ dbId: u._id, name: u.name, phone: u.phone, role: 'User', image: u.profilePic })),
      ...matchedVendors.map(v => ({ dbId: v._id, name: v.shopName || v.name, phone: v.phone, role: 'Vendor', image: v.shopImage }))
    ];

    res.status(200).json({ success: true, registeredContacts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to sync contacts" });
  }
});

// 🔥 UPDATE PROFILE WITH PHOTO OVERWRITE 🔥
router.put("/update", authMiddleware, upload.single("profilePic"), async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(403).json({ success: false, message: "Unauthorized" });

        const currentUser = await User.findById(userId);
        if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });

        const updates = { ...req.body };
        if (updates.password) delete updates.password;
        if (updates.phone) updates.phone = formatPhone(updates.phone);

        if (updates.address && typeof updates.address === 'string') {
            try { updates.address = JSON.parse(updates.address); } catch (e) { }
        }

        if (req.file) {
            if (currentUser.profilePic && currentUser.profilePic.includes("cloudinary.com")) {
                const publicId = getCloudinaryPublicId(currentUser.profilePic);
                if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
            }
            updates.profilePic = await uploadImageToCloudinary(req.file.buffer);
        }

        if (updates.profilePic === "null" || updates.profilePic === "") {
             if (currentUser.profilePic && currentUser.profilePic.includes("cloudinary.com")) {
                const publicId = getCloudinaryPublicId(currentUser.profilePic);
                if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
             }
             updates.profilePic = null;
        }

        const updatedUser = await User.findByIdAndUpdate(userId, updates, { new: true, runValidators: true }).select("-password");
        res.json({ success: true, message: "User updated", user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: "Update failed" });
    }
});

// --- PROFILE ---
router.get("/profile", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user?.userId).select("-password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- UPDATE PASSWORD ---
router.put("/update-password", authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: "Please provide passwords" });

        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Incorrect current password" });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update password" });
    }
});

// --- FETCH ALL USERS ---
router.get("/all-users", authMiddleware, async (req, res) => {
    try {
        const requesterRole = req.user?.role?.toLowerCase();
        if (requesterRole !== "vendor" && requesterRole !== "admin") {
            return res.status(403).json({ success: false, message: "Access denied." });
        }
        const users = await User.find({ _id: { $ne: req.user.userId } }).select("-password -token").sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: users.length, users });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to retrieve users" });
    }
});

// ==========================================================
// --- 1. SEND OTP ---
// ==========================================================
router.post("/send-otp", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

    try {
        const formattedPhone = formatPhone(phone);
        
        // 🔥 VALIDATION CHECK
        if (!TWILIO_SERVICE_SID || !TWILIO_SERVICE_SID.startsWith("VA")) {
            console.error("❌ TWILIO_SERVICE_SID Error: It is either missing, empty, or incorrectly formatted.");
            return res.status(500).json({ success: false, message: "Server misconfiguration: Invalid Twilio Verify Service SID." });
        }

        console.log(`📡 Sending Twilio OTP to: ${formattedPhone} using Service: ${TWILIO_SERVICE_SID}`);
        
        const verification = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verifications.create({ to: formattedPhone, channel: "sms" });

        res.status(200).json({ success: true, message: "OTP sent successfully", status: verification.status });
    } catch (error) {
        console.error("❌ Send OTP Error:", error.message || error);
        res.status(500).json({ success: false, message: "Failed to send OTP via Twilio. Check server logs." });
    }
});

// ==========================================================
// --- 2. VERIFY OTP & LOGIN ---
// ==========================================================
router.post("/login-with-otp", async (req, res) => {
    const { phone, otp, pushToken } = req.body; 
    if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP required" });

    try {
        const formattedPhone = formatPhone(phone);
        const raw10Digits = formattedPhone.replace('+91', '');

        const verificationCheck = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verificationChecks.create({ to: formattedPhone, code: otp });

        if (verificationCheck.status !== "approved") {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        const user = await User.findOne({ $or: [{ phone: formattedPhone }, { phone: raw10Digits }] });
        if (!user) return res.status(404).json({ success: false, message: "No account found with this phone number" });

        const token = generateToken(user);
        user.token = token;
        
         
        if (!user.phone.startsWith('+91')) user.phone = formattedPhone;

        await user.save();

        res.status(200).json({
            success: true, message: "Login successful",
            user: {
                id: user._id, name: user.name, email: user.email, profilePic: user.profilePic,
                phone: user.phone, address: user.address, role: user.role, pushToken: user.pushToken 
            }, token,
        });
    } catch (error) {
        console.error("OTP Login Error:", error);
        res.status(500).json({ success: false, message: "Failed to verify OTP" });
    }
});

// ==========================================================
// --- 3. VERIFY OTP & REGISTER ---
// ==========================================================
router.post("/register-with-otp", async (req, res) => {
    const { name, email, password, address, phone, otp, pushToken } = req.body; 

    if (!name || !email || !password || !address || !phone || !otp) {
        return res.status(400).json({ success: false, message: "Please fill all fields and provide OTP" });
    }

    try {
        const formattedPhone = formatPhone(phone);
        const raw10Digits = formattedPhone.replace('+91', '');

        const verificationCheck = await twilioClient.verify.v2.services(TWILIO_SERVICE_SID)
            .verificationChecks.create({ to: formattedPhone, code: otp });

        if (verificationCheck.status !== "approved") {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        const userExists = await User.findOne({ $or: [{ email }, { phone: formattedPhone }, { phone: raw10Digits }] });
        if (userExists) return res.status(400).json({ success: false, message: "User already exists." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            name, email, password: hashedPassword, address, phone: formattedPhone
        });
        
        const token = generateToken(newUser);
        newUser.token = token;
        await newUser.save();

        res.status(201).json({
            success: true, message: "User registered successfully",
            user: {
                id: newUser._id, name: newUser.name, email: newUser.email, 
                phone: newUser.phone, address: newUser.address, role: newUser.role, pushToken: newUser.pushToken
            }, token,
        });
    } catch (error) {
        console.error("OTP Register Error:", error);
        res.status(500).json({ success: false, message: "Failed to register user" });
    }
});

// --- REMOVE PUSH TOKEN ON LOGOUT ---
router.post("/remove-push-token", authMiddleware, async (req, res) => {
  try {
    const data = req.user || req.vendor || req.deliveryBoy;
    if (!data) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = data.userId || data.vendorId || data.deliveryBoyId || data._id;
    const role = (data.role || "User").toLowerCase();

    if (role === 'user') await User.findByIdAndUpdate(id, { $unset: { pushToken: "" } });
    else if (role === 'vendor') await Vendor.findByIdAndUpdate(id, { $unset: { pushToken: "" } });

    res.status(200).json({ success: true, message: "Push token removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- GET APP VERSION (GLOBAL CONFIG CHECK) ---
router.get("/app-version", async (req, res) => {
    try {
        let config = await AppConfig.findOne();
        if (!config) {
            config = await AppConfig.create({ latestAndroidVersion: "1.0.0", latestIOSVersion: "1.0.0", forceUpdate: true });
        }
        res.status(200).json({
            success: true, latestAndroidVersion: config.latestAndroidVersion,
            latestIOSVersion: config.latestIOSVersion, forceUpdate: config.forceUpdate
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to check app version" });
    }
});

module.exports = router;