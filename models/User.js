// ---------------------------------------------------------------- //
// FILE: ../models/User.js (Mongoose User Schema)
// ---------------------------------------------------------------- //
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  password: { 
    type: String, 
    required: true 
  },
  phone: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true 
  },
  profilePic: { 
    type: String, 
    default: null 
  },
  address: {
    latitude: { type: Number },
    longitude: { type: Number },
    pincode: { type: String, trim: true },
    state: { type: String, trim: true },
    district: { type: String, trim: true },
    country: { type: String, trim: true, default: "India" },
  },
  token: { type: String }, // Optional: store last JWT
  pushToken: { type: String, default: null },
  
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);


