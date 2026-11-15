const express = require("express");
const router = express.Router();
const multer = require("multer"); 

const { authMiddleware, isVendor, isAdmin } = require("../middleware/authMiddleware");

const {
    placeOrder,
    getUserOrders,
    getVendorOrders,
    getSingleOrder,
    updateOrderStatus,
    uploadOrderImage,
    deleteOrder,
    cancelOrder,
    assignDeliveryBoy,
    getDeliveryBoyOrders,
    getAllSystemOrders,
    adminUpdateOrderStatus,
    createRazorpayPaymentLink,
    handleRazorpayWebhook, 
    placePendingOrder,
    confirmOnlinePayment, // <-- IMPORT THE NEW FUNCTION
} = require("../controllers/orderController");

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// orderRoutes.js (Updated Redirect handler for better client UX)

router.get("/razorpay/payment-success-webhook", (req, res) => {
    const deepLinkScheme = "bluxury"; 
    
    const { 
        razorpay_payment_id,             // The actual Razorpay Payment ID (pay_...)
        razorpay_payment_link_status,    // Status from Razorpay (e.g., 'paid')
        razorpay_external_id,
        order_reference                  // Our MongoDB Order ID (preferred, as set in createRazorpayPaymentLink)
    } = req.query;

    const orderIdToConfirm = order_reference || razorpay_external_id; 
    
    console.log("-----------------------------------------");
    console.log("🔔 Razorpay Redirect Received (Client Notifier):");
    console.log(`- Status: ${razorpay_payment_link_status}`);
    console.log(`- Original Order ID (External ID): ${orderIdToConfirm || 'N/A'}`);
    console.log(`- RZP Payment ID: ${razorpay_payment_id || 'N/A'}`);
    console.log("-----------------------------------------");

    
    // --- SUCCESS PATH: RZP reports PAID ---
    if (razorpay_payment_id && razorpay_payment_link_status === 'paid' && orderIdToConfirm) {
        
        console.log(`✅ Redirecting to mobile app Confirmation Screen with SUCCESS status.`);
        
        // 🔑 CHANGE 1: Use a dedicated confirmation path (e.g., /order/confirm)
        // 🔑 CHANGE 2: Pass the RZP Payment ID explicitly
        const deepLinkUrl = `${deepLinkScheme}://order/confirm?paymentId=${razorpay_payment_id}&referenceId=${orderIdToConfirm}&status=success`;
        
        return res.redirect(deepLinkUrl); 
    }
    
    // --- FAILURE PATH: RZP reports FAILED or status is missing ---
    console.warn(`❌ Razorpay Redirect Failure/Cancellation detected. Redirecting to app failure screen.`);
    
    // Pass the Order ID back even on failure, so the client can clean up AsyncStorage
    const failedOrderIdParam = orderIdToConfirm ? `&referenceId=${orderIdToConfirm}` : '';
    
    // 🔑 CHANGE 3: Redirect failures to the new confirmation screen path
    return res.redirect(`${deepLinkScheme}://order/confirm?status=failed${failedOrderIdParam}`);
});
// ----------------------------------------------------------------------
// 🚨 THIS ROUTE USES RAW BODY, HANDLED BY MIDDLEWARE IN THE MAIN SERVER FILE
router.post("/razorpay/secure-webhook", handleRazorpayWebhook);


// ----------------------------------------------------------------------
// --- CORE ORDER/PAYMENT ROUTES ---
router.post("/pending", authMiddleware, placePendingOrder);
router.post("/create-payment-link", authMiddleware, createRazorpayPaymentLink); 
router.post("/confirm-online-payment", authMiddleware, confirmOnlinePayment); // <-- ADD THIS NEW ROUTE
router.post("/", authMiddleware, placeOrder); 

// --- ORDER FETCH/ACTIONS ---
router.get("/all", authMiddleware, isAdmin, getAllSystemOrders); 
router.get("/user/:userId", authMiddleware, getUserOrders);
router.get("/vendor/:vendorId", authMiddleware, isVendor, getVendorOrders);
router.get("/delivery-boy/:deliveryBoyId", authMiddleware, getDeliveryBoyOrders);
router.get("/:orderId", authMiddleware, getSingleOrder); 

router.patch("/:orderId/cancel", authMiddleware, cancelOrder); 
router.put("/:orderId/upload-image", authMiddleware, upload.single("image"), uploadOrderImage);

router.put("/:orderId/admin-status", authMiddleware, isAdmin, adminUpdateOrderStatus); 
router.delete("/:orderId", authMiddleware, isAdmin, deleteOrder); 
router.put("/:orderId/status", authMiddleware, isVendor, updateOrderStatus); 
// router.post("/:orderId/assign", authMiddleware, isAdmin, assignDeliveryBoy); 
// Use a helper that allows either Admin OR Vendor
router.post(
  "/:orderId/assign", 
  authMiddleware, 
  (req, res, next) => {
    if (req.vendor?.role === 'admin' || req.vendor?.vendorId) {
      next();
    } else {
      res.status(403).json({ message: "Access denied. Admins or Vendors only." });
    }
  }, 
  assignDeliveryBoy
);
module.exports = router;