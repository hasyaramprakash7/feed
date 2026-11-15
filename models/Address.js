// ---------------------------------------------------------------- //
// FILE: models/Address.js
// ---------------------------------------------------------------- //
const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    // Link the address to the specific user
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true // Speeds up finding addresses for a specific user
    },
    // Home, Work, Other, etc.
    type: { 
      type: String, 
      enum: ["Home", "Work", "Other", "Current Location"], 
      default: "Other" 
    },
    // The readable string (e.g., "123 Main St, Visakhapatnam")
    addressString: { 
      type: String, 
      required: true,
      trim: true 
    },
    // 🔥 UBER/SWIGGY STANDARD: Break out specific geo-data for regional queries
    landmark: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      trim: true,
      index: true // 🔥 Allows hyper-fast searching by delivery zone/pincode
    },
    // Exact GPS coordinates for the Delivery Boy & Vendor H3 calculations
    latitude: { 
      type: Number, 
      required: true 
    },
    longitude: { 
      type: Number, 
      required: true 
    },
    // Tracks the user's primary/default delivery zone
    isDefault: { 
      type: Boolean, 
      default: false 
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Address", addressSchema);