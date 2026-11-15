const mongoose = require("mongoose");

const insuranceProductSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    
    // Core details
    name: { type: String, required: true }, 
    description: { type: String, required: true },

    // Images and icon
    mainImage: { type: String, required: true }, 
    otherImages: [{ type: String }], 
    icon: { type: String, required: true }, 

    // Tags and badges
    badgeText: { 
      type: String, 
      enum: ["Best", "Exclusive for Women Sellers", "N/A"], 
      default: "N/A"
    },
    
    // Product options
    options: {
      isNew: { type: Boolean, default: false },
      isAwardWinning: { type: Boolean, default: false },
      isPopular: { type: Boolean, default: false }, 
    },

    // Contact and executive details
    contactNumber: { type: String, required: true },
    executiveContact: {
      phoneNumber: { type: String, required: true },
      pointOfContact: { type: String, default: "Executive" } 
    },

    // New 3-level category object
    categories: {
      level1: { 
        name: { type: String, required: true },
      },
      level2: {
        name: { type: String, required: true },
      },
      level3: {
        name: { type: String, required: true },
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("InsuranceProduct", insuranceProductSchema);