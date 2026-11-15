// ---------------------------------------------------------------- //
// FILE: /models/Otp.js (NEW FILE)
// ---------------------------------------------------------------- //
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const OtpSchema = new mongoose.Schema({
  identifier: { // Can be email or phone
    type: String,
    required: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
}, { timestamps: true });

// TTL index to auto-delete documents after they expire
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to compare entered OTP
OtpSchema.methods.matchOtp = async function(enteredOtp) {
    return await bcrypt.compare(enteredOtp, this.otpHash);
};


module.exports = mongoose.model("Otp", OtpSchema);

