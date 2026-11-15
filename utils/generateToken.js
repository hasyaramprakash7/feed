// utils/generateToken.js
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const generateVendorToken = (vendor) => {
    console.log("[generateVendorToken] Generating token for vendorId:", vendor._id);
    return jwt.sign(
        {
            vendorId: vendor._id,
            email: vendor.email,
            role: "vendor",
            phone: vendor.phone // ADD THIS LINE
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
};

const generateDeliveryBoyToken = (deliveryBoy) => {
    console.log("[generateDeliveryBoyToken] Generating token for deliveryBoyId:", deliveryBoy._id);
    return jwt.sign(
        {
            deliveryBoyId: deliveryBoy._id,
            phone: deliveryBoy.phone,
            role: "deliveryBoy",
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
};

const generateUserToken = (user) => { // Assuming you have a generateUserToken function
    console.log("[generateUserToken] Generating token for userId:", user._id);
    return jwt.sign(
        {
            userId: user._id,
            email: user.email,
            role: "user",
            phone: user.phone // ADD THIS LINE
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
};


module.exports = {
    generateVendorToken,
    generateDeliveryBoyToken,
    generateUserToken, // Export if you created it
};