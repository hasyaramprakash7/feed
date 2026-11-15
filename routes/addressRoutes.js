// ---------------------------------------------------------------- //
// FILE: routes/address.js
// ---------------------------------------------------------------- //
const express = require("express");
const router = express.Router();
const Address = require("../models/Address");
const { authMiddleware } = require("../middleware/authMiddleware");

// ==========================================
// 1. CREATE: Save a new address (Swiggy Standard)
// ==========================================
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { type, addressString, landmark, city, pincode, latitude, longitude, isDefault } = req.body;

    if (!addressString || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "Please provide all required location fields." });
    }

    // 🔥 SWIGGY STANDARD 1: Check how many addresses the user has
    const addressCount = await Address.countDocuments({ user: req.user.userId });
    
    // If it's their very first address, FORCE it to be the default delivery zone
    const makeDefault = isDefault || addressCount === 0;

    // If this is becoming the default, unset any existing defaults
    if (makeDefault && addressCount > 0) {
      await Address.updateMany({ user: req.user.userId }, { isDefault: false });
    }

    const newAddress = new Address({
      user: req.user.userId,
      type: type || "Other",
      addressString,
      landmark,
      city,
      pincode,
      latitude,
      longitude,
      isDefault: makeDefault
    });

    const savedAddress = await newAddress.save();

    res.status(201).json({
      id: savedAddress._id,
      type: savedAddress.type,
      addressString: savedAddress.addressString,
      landmark: savedAddress.landmark,
      city: savedAddress.city,
      pincode: savedAddress.pincode,
      latitude: savedAddress.latitude,
      longitude: savedAddress.longitude,
      isDefault: savedAddress.isDefault
    });
  } catch (error) {
    console.error("Error saving address:", error);
    res.status(500).json({ message: "Server error while saving address." });
  }
});

// ==========================================
// 2. READ: Get ONLY the logged-in user's addresses
// ==========================================
router.get("/", authMiddleware, async (req, res) => {
  try {
    // Lean() for faster JSON parsing, sorted with Default at the very top
    const addresses = await Address.find({ user: req.user.userId })
      .sort({ isDefault: -1, createdAt: -1 }) 
      .lean();

    const formattedAddresses = addresses.map((addr) => ({
      id: addr._id,
      type: addr.type,
      addressString: addr.addressString,
      landmark: addr.landmark,
      city: addr.city,
      pincode: addr.pincode,
      latitude: addr.latitude,
      longitude: addr.longitude,
      isDefault: addr.isDefault
    }));

    res.status(200).json(formattedAddresses);
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ message: "Server error while fetching addresses." });
  }
});

// ==========================================
// 3. UPDATE: Edit an existing address securely
// ==========================================
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { type, addressString, landmark, city, pincode, latitude, longitude, isDefault } = req.body;
    
    const address = await Address.findOne({ _id: req.params.id, user: req.user.userId });

    if (!address) {
      return res.status(404).json({ message: "Address not found or unauthorized." });
    }

    // Unset other defaults if this one is being explicitly made the new default
    if (isDefault) {
      await Address.updateMany({ user: req.user.userId, _id: { $ne: address._id } }, { isDefault: false });
    }

    address.type = type || address.type;
    address.addressString = addressString || address.addressString;
    address.landmark = landmark !== undefined ? landmark : address.landmark;
    address.city = city !== undefined ? city : address.city;
    address.pincode = pincode !== undefined ? pincode : address.pincode;
    address.latitude = latitude !== undefined ? latitude : address.latitude;
    address.longitude = longitude !== undefined ? longitude : address.longitude;
    address.isDefault = isDefault !== undefined ? isDefault : address.isDefault;

    const updatedAddress = await address.save();

    res.status(200).json({
      id: updatedAddress._id,
      type: updatedAddress.type,
      addressString: updatedAddress.addressString,
      landmark: updatedAddress.landmark,
      city: updatedAddress.city,
      pincode: updatedAddress.pincode,
      latitude: updatedAddress.latitude,
      longitude: updatedAddress.longitude,
      isDefault: updatedAddress.isDefault
    });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ message: "Server error while updating address." });
  }
});

// ==========================================
// 4. DELETE: Remove an address (Swiggy Fallback Standard)
// ==========================================
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const deletedAddress = await Address.findOneAndDelete({ 
        _id: req.params.id, 
        user: req.user.userId 
    });

    if (!deletedAddress) {
      return res.status(404).json({ message: "Address not found or unauthorized." });
    }

    // 🔥 SWIGGY STANDARD 2: Auto-Fallback
    // If the user deleted their currently active/default address...
    if (deletedAddress.isDefault) {
      // Find their most recently created remaining address
      const nextAddress = await Address.findOne({ user: req.user.userId }).sort({ createdAt: -1 });
      
      // Automatically make it the new default so they are never left without a delivery zone
      if (nextAddress) {
        nextAddress.isDefault = true;
        await nextAddress.save();
      }
    }
    
    res.status(200).json({ message: "Address removed", id: req.params.id });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ message: "Server error while deleting address." });
  }
});

module.exports = router;