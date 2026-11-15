const mongoose = require("mongoose");

const vendorProductSchema = new mongoose.Schema(
  {
    vendorId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Vendor", 
      required: true 
    },
    name: { 
      type: String, 
      required: true 
    },
    brandName: { 
      type: String 
    },
    description: { 
      type: String, 
      required: true 
    },
    price: { 
      type: Number, 
      required: true 
    },
    discountedPrice: { 
      type: Number 
    },
    discountPercent: { 
      type: Number 
    },
    category: { 
      type: String, 
      required: true 
    },
    images: [{ 
      type: String, 
      required: true 
    }],
    stock: { 
      type: Number, 
      default: 0 
    },
    isAvailable: { 
      type: Boolean, 
      default: true 
    },

    // NEW FIELD FOR SIZE OPTIONS
    sizes: [{ 
      type: String 
    }], 
    // This array will store strings like ["S", "M", "L", "10.5", "32"]

    // New fields for bulk pricing
    bulkPrice: { 
      type: Number 
    }, 
    bulkMinimumUnits: { 
      type: Number 
    }, 

    // New fields for large quantity pricing (optional, can be an additional tier)
    largeQuantityPrice: { 
      type: Number 
    }, 
    largeQuantityMinimumUnits: { 
      type: Number 
    }, 
  },
  { timestamps: true }
);

module.exports = mongoose.model("VendorProduct", vendorProductSchema);