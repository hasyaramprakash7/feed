// ---------------------------------------------------------------- //
// FILE: /services/otpService.js (NEW FILE)
// ---------------------------------------------------------------- //
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Otp = require("../models/Otp");

// Generates a secure 6-digit OTP
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Creates and stores a hashed OTP
const createOtp = async (identifier) => {
  await Otp.deleteMany({ identifier }); // Invalidate old OTPs
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute expiry

  await Otp.create({ identifier, otpHash, expiresAt });
  return otp; // Return plaintext OTP to be sent via SMS/email
};

// Verifies the submitted OTP
const verifyOtp = async (identifier, submittedOtp) => {
  const otpRecord = await Otp.findOne({ identifier });
  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    return false; // Not found or expired
  }
  
  const isValid = await otpRecord.matchOtp(submittedOtp);
  if (isValid) {
    await Otp.deleteOne({ _id: otpRecord._id }); // Delete after use
  }
  return isValid;
};

module.exports = { createOtp, verifyOtp };
