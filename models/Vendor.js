// models/Vendor.js
const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    // --- Existing fields ---
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String },
    shopName: { type: String },
    shopImage: { type: String },
    businessType: { type: String },
    gstNo: { type: String, unique: true, sparse: true },
    deliveryRange: { type: Number, default: 0 },
    token: { type: String },
    
    // --- Address with all fields required (including street & colony) ---
    address: {
      latitude:  { type: Number, required: true },
      longitude: { type: Number, required: true },
      pincode:   { type: String, required: true },
      state:     { type: String, required: true },
      district:  { type: String, required: true },
      country:   { type: String, default: "India", required: true },
      street:    { type: String, default: "" },   // NEW: road / street name
      colony:    { type: String, default: "" },   // NEW: neighbourhood / colony
    },

    isApproved: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    pushToken: { type: String, default: null },
    h3Index: { type: String, index: true },

    // --- Subscription Fields ---
    subscriptionStatus: {
      type: String,
      enum: ['inactive', 'trial', 'active', 'expired', 'cancelled', 'pending'],
      default: 'inactive'
    },
    trialStartDate: { type: Date, default: null },
    trialEndDate: { type: Date },
    subscriptionStartDate: { type: Date },
    subscriptionEndDate: { type: Date },
    razorpayCustomerId: { type: String },
    razorpaySubscriptionId: { type: String },
    lastPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },

    // ======== NEW DIRECTORY FIELDS ========
    categories: [{ type: String }],
    operatingHours: {
      monday: { open: String, close: String },
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String },
    },
    services: [String],
    tags: [String],
    isVerified: { type: Boolean, default: false },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    totalViews: { type: Number, default: 0 },
    totalCalls: { type: Number, default: 0 },
    totalLeads: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Index for text search
vendorSchema.index({ shopName: 'text', name: 'text', businessType: 'text' });

module.exports = mongoose.model("Vendor", vendorSchema);