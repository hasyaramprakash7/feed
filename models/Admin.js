const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ["admin", "superadmin"], default: "admin" }, // Added 'superadmin' role
  token: { type: String }, // optional: store JWT token
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("Admin", adminSchema);