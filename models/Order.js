// models/Order.js
const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    deliveryBoy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
        required: false,
    },

    address: {
        fullName: { type: String, required: true },
        street: { type: String, required: true },
        street2: { type: String },
        landmark: { type: String },
        city: { type: String, required: true },
        state: { type: String, required: true },
        zipCode: { type: String, required: true },
        country: { type: String, default: "India" },
        phone: { type: String, required: true },
        latitude: { type: Number },
        longitude: { type: Number },
    },

    items: [
        {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: "VendorProduct", required: true },
            name: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
            price: { type: Number, required: true, min: 0 },
            productImage: { type: String },
            vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
            size: { type: String }, 
        },
    ],

    total: { type: Number, required: true, min: 0 },
    status: {
        type: String,
        // 🎯 ADDED: pending_payment status
        enum: ["pending_payment", "placed", "processing", "shipped", "delivered", "cancelled", "returned"],
        default: "placed",
    },
    paymentMethod: {
        type: String,
        enum: ["COD", "Online Payment"],
        required: true,
    },
    paymentId: { type: String }, // Added paymentId field
    orderImage: [{ type: String }], 

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// Update `updatedAt` on save
orderSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});
orderSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: Date.now() });
    next();
});

module.exports = mongoose.model("Order", orderSchema);