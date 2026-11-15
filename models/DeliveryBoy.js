// models/DeliveryBoy.js
const mongoose = require("mongoose");

const deliveryBoySchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String },
    shopName: { type: String },
    shopImage: { type: String },
    businessType: { type: String },
    token: { type: String }, // This might be used for session management on the backend, but often not stored directly in the user model in production. Useful for debugging/testing.

    // Added for dashboard display based on your DeliveryBoyDashboardScreen.tsx
    vehicleNo: { type: String },
    licenseNo: { type: String },

    address: {
        latitude: { type: Number },
        longitude: { type: Number },
        pincode: { type: String },
        state: { type: String },
        district: { type: String },
        country: { type: String, default: "India" },
    },

    isApproved: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },

    // ✅ New: Store order references
    assignedOrders: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order"
        }
    ],
    pushToken: { type: String, default: null },
    
}, { timestamps: true });

module.exports = mongoose.model("DeliveryBoy", deliveryBoySchema);