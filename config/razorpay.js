const Razorpay = require("razorpay");
// REMOVED: const config = require("./config"); // No longer needed as we use process.env

const razorpayInstance = new Razorpay({
    // Use environment variables directly
    key_id: process.env.RAZORPAY_KEY_ID, 
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpayInstance;
