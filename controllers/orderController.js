const Order = require("../models/Order");
const VendorProduct = require("../models/VendorProduct");
const User = require("../models/User");
const DeliveryBoy = require("../models/DeliveryBoy");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary"); 
const streamifier = require("streamifier"); // Assuming streamifier is required here
const razorpay = require("../config/razorpay");
const crypto = require('crypto');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const uploadToCloudinary = (buffer) =>
    new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: "image" },
            (err, result) => {
                if (result) {
                    console.log("✅ Image uploaded to Cloudinary:", result.secure_url);
                    resolve(result.secure_url);
                } else {
                    console.error("❌ Cloudinary upload error:", err);
                    reject(err);
                }
            }
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });

// @desc    Place temporary order with pending_payment status (Online Payment Flow)
exports.placePendingOrder = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔑 PLACE PENDING ORDER: Initiated.`);
    
    try {
        const userId = req.user?.userId;
        if (!userId) {
            console.error(`❌ Blocked: User ID missing from token.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: User ID not found." });
        }

        const { address, items, total, paymentMethod } = req.body;
        
        console.log(`📋 User ID: ${userId}, Payment Method: ${paymentMethod}, Total: ${total}`);

        if (paymentMethod !== 'Online Payment') {
            console.error(`❌ Blocked: Incorrect payment method (${paymentMethod}).`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "This endpoint is only for online payment initiation." });
        }

        if (!address || !items || items.length === 0 || !total) {
            console.error(`❌ Blocked: Missing mandatory fields in request body.`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Missing required order fields (top-level)." });
        }

        const parsedItems = Array.isArray(items) ? items : JSON.parse(items);
        
        // 🚨 DEBUG LOG: Show incoming items array 🚨
        console.log(`\n*** DEBUG: Incoming Order Items ***`);
        console.log(JSON.stringify(parsedItems, null, 2));
        console.log(`***********************************\n`);
        
        console.log(`📦 Verifying ${parsedItems.length} order items...`);

        const itemsWithDetails = await Promise.all(
            parsedItems.map(async (item) => {
                const product = await VendorProduct.findById(item.productId).select("name images vendorId");
                if (!product) {
                    console.error(`❌ Product verification failed for ID: ${item.productId}`);
                    throw new Error(`Product with ID ${item.productId} not found.`);
                }
                if (!product.vendorId || !isValidObjectId(product.vendorId)) {
                    console.error(`❌ Vendor ID validation failed for product ID: ${item.productId}`);
                    throw new Error(`Vendor ID missing or invalid for product ${item.productId}.`);
                }
                return {
                    productId: product._id,
                    name: product.name,
                    quantity: item.quantity,
                    price: item.price,
                    productImage: product.images && product.images.length > 0 ? product.images[0] : null,
                    vendorId: product.vendorId,
                    // 🎯 CONDITIONAL ADDITION OF OPTIONAL SIZE FIELD
                    ...(item.size && { size: item.size }), 
                };
            })
        );
        
        const pendingOrder = new Order({
            userId,
            address,
            items: itemsWithDetails,
            total,
            status: "pending_payment", 
            paymentMethod,
            orderImage: [], 
        });

        await pendingOrder.save();
        console.log("✅ Pending order successfully created. ID (receipt):", pendingOrder._id);
        console.log(`======================================================`);
        
        res.status(201).json({ 
            success: true, 
            order: pendingOrder, 
            receiptId: pendingOrder._id.toString()
        });
        
    } catch (err) {
        console.error("❌ Pending order creation failed:", err);
        let message = "Pending order creation failed";
        if (err.name === 'ValidationError') { message = "Validation Error: One or more required fields are missing or invalid."; } 
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: message, error: err.message });
    }
};

// @desc    Create Razorpay Payment Link (Modified to rely on an existing Order ID as receipt)
exports.createRazorpayPaymentLink = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔑 CREATE PAYMENT LINK: Initiated.`);

    try {
        const { amount, currency = "INR", receipt, customerDetails } = req.body;
        console.log(`📋 Receipt ID (Order): ${receipt}, Amount: ${amount}`);

        if (!amount || amount <= 0 || !receipt || !isValidObjectId(receipt) || !customerDetails || !customerDetails.contact) {
            console.error(`❌ Blocked: Missing/invalid input fields.`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Missing required fields for Payment Link: amount, valid receipt (Order ID), or customer contact." });
        }
        
        const pendingOrder = await Order.findById(receipt).select('status');
        if (!pendingOrder || pendingOrder.status !== 'pending_payment') {
            console.error(`⚠️ Blocked: Order status is not 'pending_payment' for ID: ${receipt}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid or non-pending order ID provided as receipt. Please re-initiate the order." });
        }

        const amountInPaisa = Math.round(amount * 100); 
        
const baseUrl = process.env.RAZORPAY_CALLBACK_URL || "https://bluxurybackend.onrender.com/api/orders/razorpay/payment-success-webhook";        const dynamicCallbackUrl = `${baseUrl}?order_reference=${receipt}`;
        console.log(`🌐 Callback URL set to: ${dynamicCallbackUrl}`);

        const paymentLinkOptions = {
            amount: amountInPaisa, 
            currency: currency,
            reference_id: receipt, 
            description: `GrocerEase Order Payment for ID: ${receipt}`,
            expire_by: Math.floor(Date.now() / 1000) + (30 * 60),
            customer: customerDetails,
            notify: { sms: true, email: true },
            callback_url: dynamicCallbackUrl, 
            callback_method: 'get',
        };

        const paymentLink = await razorpay.paymentLink.create(paymentLinkOptions);
        
        console.log("✅ Razorpay Payment Link Created. Link ID:", paymentLink.id);
        console.log(`======================================================`);
        
        res.status(201).json({ 
            success: true, 
            paymentLinkUrl: paymentLink.short_url, 
            paymentLinkId: paymentLink.id,
            orderId: receipt,
            currency: paymentLink.currency,
            amount: paymentLink.amount / 100 
        });

    } catch (err) {
        const errorDetail = err.error || err;
        console.error("❌ Razorpay Payment Link creation failed:", errorDetail.description || errorDetail.message || errorDetail);
        const statusCode = (errorDetail.code === "BAD_REQUEST_ERROR") ? 400 : 500;
        console.log(`======================================================`);
        res.status(statusCode).json({ 
            success: false, 
            message: "Failed to create online payment link on server. Please try again.", 
            error: errorDetail.description || errorDetail.message
        });
    }
};

// @desc    Handle Razorpay Server-to-Server Webhook
exports.handleRazorpayWebhook = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔔 WEBHOOK RECEIVE: Processing incoming notification.`);
    
    // ⚠️ 1. SIGNATURE VERIFICATION
    const signature = req.headers['x-razorpay-signature'];
    const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET; 
    
    const rawBodyBuffer = req.body; 
    const rawBodyString = rawBodyBuffer.toString('utf8'); 
    let eventBody;

    if (!signature || !WEBHOOK_SECRET) {
        console.error("❌ Webhook Configuration Missing: Secret or Signature header missing.");
        console.log(`======================================================`);
        return res.status(403).send("Configuration Missing");
    }

    try {
        const expectedSignature = crypto.createHmac('sha256', WEBHOOK_SECRET)
            .update(rawBodyString)
            .digest('hex');

        if (signature !== expectedSignature) {
            console.error("❌ Webhook Signature Mismatch: Request blocked.");
            console.log(`======================================================`);
            return res.status(403).send("Invalid Signature"); 
        }

        eventBody = JSON.parse(rawBodyString);
        console.log(`✅ Signature Verified. Event Type: ${eventBody.event}`);

    } catch (err) {
        console.error("❌ Webhook Validation/Parsing Failed:", err.message);
        console.log(`======================================================`);
        return res.status(403).send("Validation Failed.");
    }

    // 2. PROCESS THE EVENT
    const event = eventBody.event; 
    
    if (event !== 'payment_link.paid') {
        console.log(`🔔 Webhook acknowledged non-paid event: ${event}. Ignoring.`);
        console.log(`======================================================`);
        return res.status(200).send(`Acknowledged event: ${event}`);
    }

    try {
        const paymentLinkDetails = eventBody.payload.payment_link.entity;
        const paymentDetails = eventBody.payload.payment.entity;
        
        const orderId = paymentLinkDetails.reference_id; 
        const paymentId = paymentDetails.id; 

        console.log(`📋 Paid Event Data: Order ID=${orderId}, Payment ID=${paymentId}`);

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Webhook: Invalid MongoDB Order ID received: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).send("Invalid Order ID in reference_id"); 
        }

        // 3. Find and update the order
        const updatedOrder = await Order.findOneAndUpdate(
            { _id: orderId, status: 'pending_payment' },
            { 
                status: 'processing', 
                paymentId: paymentId,
                updatedAt: Date.now(),
            },
            { new: true }
        );

        if (updatedOrder) {
            console.log(`✅ Webhook SUCCESS: Order ${orderId} finalized to 'processing'.`);
        } else {
            console.warn(`⚠️ Webhook: Order ${orderId} not found or already processed. Ignoring.`);
        }
        console.log(`======================================================`);
        
    } catch (err) {
        console.error("❌ Razorpay Webhook processing failed during DB update:", err.message);
        console.log(`======================================================`);
        return res.status(500).send("Server error during processing.");
    }
    
    return res.status(200).send("OK");
};


// @desc    Client-side fallback to confirm and finalize payment for a pending order (SECURED)
exports.confirmOnlinePayment = async (req, res) => {
    // --- 0. Initialization & Request Dump ---
    const startTime = Date.now();
    console.log(`\n======================================================`);
    console.log(`🔑 MANUAL CONFIRMATION CHECK: Initiated at ${new Date().toISOString()}`);
    console.log(`🔑 MANUAL CONFIRMATION CHECK: Incoming Body: ${JSON.stringify(req.body)}`);

    try {
        const userId = req.user?.userId;
        const { orderId, paymentId } = req.body; 

        // --- 1. Basic Validation and Authorization ---
        console.log(`📋 Auth User ID: ${userId}`);
        
        if (!userId) {
            console.error(`❌ Blocked (403): User ID missing from token. Aborting.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: User ID not found." });
        }
        if (!isValidObjectId(orderId) || !paymentId || paymentId.length < 10) {
            console.error(`❌ Blocked (400): Invalid ID format. Order ID: ${orderId}, RZP ID: ${paymentId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid Order ID or missing/short Payment ID." });
        }

        // 2. Find and Validate Order Status
        const order = await Order.findOne({ _id: orderId, userId: userId });

        if (!order) {
            console.error(`❌ Blocked (404): Order not found (ID: ${orderId}) or User ID mismatch (User: ${userId}).`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found or does not belong to user." });
        }

        if (order.status === 'processing' || order.status === 'placed') {
            const duration = (Date.now() - startTime);
            console.log(`🔔 Order ${orderId} already finalized. Status: ${order.status}. Returning success (Duration: ${duration}ms).`);
            console.log(`======================================================`);
            return res.status(200).json({ 
                success: true, 
                message: "Order already finalized.", 
                order: order 
            });
        }
        
        if (order.status !== 'pending_payment') {
            console.warn(`⚠️ Blocked (400): Order ${orderId} is in status ${order.status}. Must be 'pending_payment'.`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: `Order is in status: ${order.status}. Cannot finalize.` });
        }

        // --- 3. CRITICAL SECURITY STEP: Verify Payment with Razorpay ---
        console.log(`🔎 Order ${orderId} is 'pending_payment'. Starting Razorpay API fetch for Payment ID: ${paymentId}...`);

        let paymentDetails;
        try {
            paymentDetails = await razorpay.payments.fetch(paymentId);
            console.log(`✅ Razorpay Fetch Successful. RZP status received.`);
        } catch (error) {
            const errorDetail = error.error || error;
            console.error(`❌ Razorpay Fetch Failed for Payment ID ${paymentId}:`);
            console.error(`   - RZP Error Code: ${errorDetail.code || 'N/A'}`);
            console.error(`   - RZP Description: ${errorDetail.description || errorDetail.message || 'Unknown RZP Error'}`);
            console.log(`======================================================`);
            return res.status(400).json({ 
                success: false, 
                message: "Payment verification failed. RZP Payment ID is invalid or failed RZP API fetch.",
                errorDetails: errorDetail.description || errorDetail.message
            });
        }

        // 4. Status and Amount Checks
        const requiredAmountInPaisa = Math.round(order.total * 100);
        
        console.log(`📊 RZP Verification Checks:`);
        console.log(`   - RZP Status: ${paymentDetails.status} (Expected: 'captured')`);
        console.log(`   - RZP Amount: ${paymentDetails.amount} paisa (Expected: ${requiredAmountInPaisa} paisa)`);
        
        if (paymentDetails.status !== 'captured') {
            console.warn(`⚠️ Blocked (400): RZP Status check failed. ID ${paymentId} status is '${paymentDetails.status}'.`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Payment status is not confirmed (Status: " + paymentDetails.status + ")." });
        }

        if (paymentDetails.amount !== requiredAmountInPaisa) {
            console.warn(`⚠️ Blocked (400): Amount mismatch. RZP: ${paymentDetails.amount} paisa. DB Order: ${requiredAmountInPaisa} paisa. Possible fraud.`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Payment amount mismatch. Possible fraud attempt." });
        }
        
        // --- 5. Finalize DB Update ---
        console.log(`✅ Payment ID ${paymentId} verified and Captured. Finalizing Order DB update...`);

        order.status = 'processing';
        order.paymentId = paymentId; 
        await order.save();

        const populatedOrder = await Order.findById(order._id)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");

        const duration = (Date.now() - startTime);
        console.log(`✅ Order ${orderId} manually finalized as 'processing'. Duration: ${duration}ms.`);
        console.log(`======================================================`);

        res.status(200).json({ 
            success: true, 
            message: "Order successfully confirmed and placed!", 
            order: populatedOrder 
        });

    } catch (err) {
        // --- 6. Generic Catch Block Failure ---
        const duration = (Date.now() - startTime);
        console.error(`\n❌ CRITICAL FAILURE (500): Client confirmation for Order ${req.body?.orderId || 'N/A'} failed during DB operation or unhandled code (Duration: ${duration}ms):`);
        console.error(`   - Error Name: ${err.name}`);
        console.error(`   - Error Message: ${err.message}`);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to finalize order on server.", error: err.message });
    }
};

// @desc    Place Order (COD ONLY)
exports.placeOrder = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔑 PLACE COD ORDER: Initiated.`);
    try {
        const userId = req.user?.userId;
        if (!userId) {
            console.error(`❌ Blocked: User ID missing from token.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: User ID not found." });
        }

        const { address, items, total, paymentMethod } = req.body;
        console.log(`📋 User ID: ${userId}, Payment Method: ${paymentMethod}, Total: ${total}`);

        if (paymentMethod === 'Online Payment') {
            console.warn("⚠️ Blocked: Attempted to place Online Payment order via COD endpoint.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Online payment orders must use the two-step pending order and webhook flow." });
        }

        if (!address || !items || items.length === 0 || !total || !paymentMethod) {
            console.warn("⚠️ Blocked: Missing required fields in request body.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Missing required order fields (top-level)." });
        }
        
        const parsedItems = Array.isArray(items) ? items : JSON.parse(items);
        
        // 🚨 DEBUG LOG: Show incoming items array 🚨
        console.log(`\n*** DEBUG: Incoming COD Order Items ***`);
        console.log(JSON.stringify(parsedItems, null, 2));
        console.log(`****************************************\n`);

        console.log(`📦 Verifying ${parsedItems.length} order items...`);

        const itemsWithDetails = await Promise.all(
            parsedItems.map(async (item) => {
                const product = await VendorProduct.findById(item.productId).select("name images vendorId");
                if (!product) { throw new Error(`Product with ID ${item.productId} not found.`); }
                if (!product.vendorId || !isValidObjectId(product.vendorId)) { throw new Error(`Vendor ID missing or invalid for product ${item.productId}.`); }
                return {
                    productId: product._id,
                    name: product.name,
                    quantity: item.quantity,
                    price: item.price,
                    productImage: product.images && product.images.length > 0 ? product.images[0] : null,
                    vendorId: product.vendorId,
                    // 🎯 CONDITIONAL ADDITION OF OPTIONAL SIZE FIELD
                    ...(item.size && { size: item.size }), 
                };
            })
        );

        const newOrder = new Order({
            userId,
            address,
            items: itemsWithDetails,
            total,
            status: "placed", // Always 'placed' for COD
            paymentMethod,
            orderImage: [], 
        });

        await newOrder.save();
        console.log("✅ COD Order successfully created:", newOrder._id);
        console.log(`======================================================`);
        res.status(201).json({ success: true, order: newOrder });
    } catch (err) {
        console.error("❌ COD Order creation failed:", err);
        let message = "Order creation failed";
        let errorDetails = {};
        if (err.name === 'ValidationError') {
            message = "Validation Error: One or more required fields are missing or invalid.";
            for (let field in err.errors) { errorDetails[field] = err.errors[field].message; }
        } else if (err.message.includes("Product with ID")) { message = err.message; } 
        console.log(`======================================================`);
        res.status(500).json({ success: false, message, error: Object.keys(errorDetails).length > 0 ? errorDetails : err.message });
    }
};

// @desc    Get orders for a specific user
exports.getUserOrders = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔎 GET USER ORDERS: Initiated.`);
    try {
        const requestedUserId = req.params.userId;
        const authenticatedUserId = req.user?.userId;

        console.log(`📋 Requested User ID: ${requestedUserId}, Auth User ID: ${authenticatedUserId}`);

        // Authorization check
        if (!authenticatedUserId || authenticatedUserId !== requestedUserId) {
            console.warn(`⚠️ Authorization Failed: User ${authenticatedUserId} attempted to view orders for ${requestedUserId}.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Not authorized to view these orders." });
        }

        if (!isValidObjectId(requestedUserId)) {
            console.warn("⚠️ Invalid user ID format:", requestedUserId);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid user ID" });
        }

        const orders = await Order.find({ userId: requestedUserId })
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone")
            .sort({ createdAt: -1 });

        console.log(`📦 Found ${orders.length} orders for user ${requestedUserId}`);
        console.log(`======================================================`);
        res.json({ success: true, orders });
    } catch (err) {
        console.error("❌ Error fetching user orders:", err);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to fetch user orders", error: err.message });
    }
};

// @desc    Get orders for the authenticated vendor
// orderController.js (Only the modified function is shown)

// @desc    Get orders for the authenticated vendor
exports.getVendorOrders = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔎 GET VENDOR ORDERS: Initiated.`);
    try {
        const authenticatedVendorId = req.vendor?.vendorId;
        console.log(`📋 Auth Vendor ID: ${authenticatedVendorId}`);

        if (!authenticatedVendorId) {
            console.warn(`⚠️ Authorization Failed: No authenticated vendor ID found in token.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Not authorized. Vendor ID missing from token." });
        }

        const orders = await Order.find({ "items.vendorId": authenticatedVendorId })
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone")
            .sort({ createdAt: -1 });

        console.log(`📦 Found ${orders.length} orders for authenticated vendor.`);

        const vendorSpecificOrders = orders.map(order => {
            const orderObject = order.toObject();

            const vendorItems = orderObject.items
                .filter(item => item.vendorId?.toString() === authenticatedVendorId.toString())
                .map(item => ({ // <--- ADDED MAPPING TO INCLUDE SIZE
                    ...item,
                    size: item.size || undefined, // Ensure size is explicitly included
                }));


            const vendorTotal = vendorItems.reduce((acc, item) => acc + (item.quantity * item.price), 0);

            return {
                ...orderObject,
                items: vendorItems,
                vendorTotal: vendorTotal,
            };
        });
        console.log(`======================================================`);

        res.status(200).json({ success: true, orders: vendorSpecificOrders });
    } catch (error) {
        console.error("❌ Error fetching vendor-specific orders:", error);
        console.log(`======================================================`);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
// @desc    Get a specific order
exports.getSingleOrder = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔎 SINGLE ORDER FETCH CHECK: Initiated at ${new Date().toISOString()}`);

    try {
        const { orderId } = req.params;
        console.log(`🔍 Target Order ID: ${orderId}`);

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        // Fetch the order (RAW) for authorization check
        const order = await Order.findById(orderId);

        if (!order) {
            console.warn(`⚠️ Order not found in DB: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        
        // Extract Auth Context and Order Data
        const authenticatedUser = req.user;
        const authenticatedVendor = req.vendor;
        const authenticatedDeliveryBoy = req.deliveryBoy;
        
        let isAuthorized = false;
        const orderUserIdString = order.userId ? order.userId.toString() : 'N/A'; 

        console.log(`\n📋 Auth Context Check:`);
        console.log(`   - Order Owner ID (Raw DB): ${orderUserIdString}`);
        console.log(`   - Auth User Present (req.user): ${!!authenticatedUser}`);
        
        // 3. Authorization Checks
        
        // A. User owns the order
        if (authenticatedUser && authenticatedUser.userId) {
            const authUserIdString = authenticatedUser.userId.toString(); 
            console.log(`   - Auth User ID (JWT Payload): ${authUserIdString}`);

            if (orderUserIdString === authUserIdString) {
                console.log(`✅ Auth Check 1 (User): MATCH FOUND. User ${authUserIdString} owns the order.`);
                isAuthorized = true;
            } else {
                 console.log(`❌ Auth Check 1 (User): Mismatch. JWT ID (${authUserIdString}) != Order Owner ID.`);
            }
        }
        
        // B. Vendor is involved in the order
        if (!isAuthorized && authenticatedVendor && authenticatedVendor.vendorId) {
            const authVendorIdString = authenticatedVendor.vendorId.toString();
            const isVendorInvolved = order.items.some(item => item.vendorId && item.vendorId.toString() === authVendorIdString);
            
            if (isVendorInvolved) {
                console.log(`✅ Auth Check 2 (Vendor): MATCH FOUND. Vendor ${authVendorIdString} is involved.`);
                isAuthorized = true;
            } else {
                console.log(`❌ Auth Check 2 (Vendor): Vendor ID is not associated with any item in the order.`);
            }
        }
        
        // C. Delivery Boy Access
        if (!isAuthorized && authenticatedDeliveryBoy) {
            console.log(`✅ Auth Check 3 (Delivery Boy): Access granted.`);
            isAuthorized = true;
        }
        
        // D. Admin Access
        if (!isAuthorized && authenticatedVendor && authenticatedVendor.role === 'admin') {
            console.log(`✅ Auth Check 4 (Admin): Access granted.`);
            isAuthorized = true;
        }

        // --- 4. Final Authorization Decision ---
        if (!isAuthorized) {
            const authId = authenticatedUser?.userId || authenticatedVendor?.vendorId || authenticatedDeliveryBoy?.deliveryBoyId || 'N/A';
            const authType = authenticatedUser ? 'User' : authenticatedVendor ? 'Vendor' : authenticatedDeliveryBoy ? 'DeliveryBoy' : 'None';
            
            console.warn(`\n🛑 FINAL BLOCK: 403 DENIED.`);
            console.warn(`   - Reason: Failed all ${authType} checks.`);
            console.warn(`   - Auth ID: ${authId}, Expected Owner: ${orderUserIdString}`);
            return res.status(403).json({ success: false, message: "Not authorized to view this order." });
        }

        // 5. Populate and Respond (Only run if authorized)
        console.log(`\n✅ 200 OK: Access granted. Populating order data for response...`);
        
        // Re-fetch/Populate the order only AFTER authorization succeeds
        const populatedOrder = await Order.findById(orderId)
             .populate("userId", "name email")
             .populate("deliveryBoy", "name email phone");

        console.log(`✅ Order successfully fetched and populated.`);
        console.log(`======================================================`);

        res.json({ success: true, order: populatedOrder });
    } catch (err) {
        console.error(`\n❌ CRITICAL ERROR fetching single order:`, err);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to fetch order", error: err.message });
    }
};

// @desc    Update order status (for vendor)
exports.updateOrderStatus = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🔄 VENDOR UPDATE STATUS: Initiated.`);
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        const vendorId = req.vendor?.vendorId; 

        console.log(`📋 Order ID: ${orderId}, New Status: ${status}, Auth Vendor ID: ${vendorId}`);

        if (!vendorId) {
            console.warn("⚠️ Blocked: Vendor ID missing from token.");
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: Vendor ID not found." });
        }

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }
        if (!status || typeof status !== "string") {
            console.error("❌ Blocked: Invalid status provided.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid status provided." });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`⚠️ Blocked: Order not found: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Ensure the vendor is part of this order's items
        const isAuthorizedVendor = order.items.some(item => item.vendorId.toString() === vendorId.toString());
        if (!isAuthorizedVendor) {
            console.warn(`⚠️ Blocked: Vendor ${vendorId} is not associated with any item in order ${orderId}.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Not authorized to update this order." });
        }

        order.status = status;
        const updatedOrder = await order.save();

        // Populate after save to return full object
        const populatedOrder = await Order.findById(updatedOrder._id)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");

        console.log("✅ Order status updated successfully:", orderId, "=>", status);
        console.log(`======================================================`);
        res.json({ success: true, order: populatedOrder });
    } catch (err) {
        console.error("❌ Error updating order status:", err);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to update status", error: err.message });
    }
};

// @desc    Upload image to order
exports.uploadOrderImage = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`📷 UPLOAD ORDER IMAGE: Initiated.`);
    try {
        const { orderId } = req.params;
        const authenticatedDeliveryBoyId = req.deliveryBoy?.deliveryBoyId;
        const isAdminUser = req.vendor?.role === 'admin';
        console.log(`📋 Order ID: ${orderId}, Auth DB ID: ${authenticatedDeliveryBoyId}, Is Admin: ${isAdminUser}`);


        if (!authenticatedDeliveryBoyId && !isAdminUser) {
            console.warn("⚠️ Blocked: Not authorized. Requires Delivery Boy or Admin role.");
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: Requires Delivery Boy or Admin role." });
        }

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }
        if (!req.file) {
            console.error("❌ Blocked: No image file provided.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "No image file provided" });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`⚠️ Blocked: Order not found: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Additional authorization: DB can only upload for assigned orders
        if (authenticatedDeliveryBoyId && (!order.deliveryBoy || order.deliveryBoy.toString() !== authenticatedDeliveryBoyId.toString())) {
            console.warn(`⚠️ Blocked: DB ${authenticatedDeliveryBoyId} not assigned to order ${orderId}.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Not authorized to upload image for this order." });
        }

        const imageUrl = await uploadToCloudinary(req.file.buffer);

        // $push to add to the array of images
        order.orderImage.push(imageUrl);
        const updatedOrder = await order.save();

        // Populate after save to return full object
        const populatedOrder = await Order.findById(updatedOrder._id)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");

        console.log("✅ Image uploaded and order updated:", updatedOrder._id);
        console.log(`======================================================`);
        res.json({ success: true, message: "Order image uploaded successfully", order: populatedOrder });
    } catch (error) {
        console.error("❌ Upload Order Image Error:", error.message);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to upload order image", error: error.message });
    }
};

// @desc    Delete order
exports.deleteOrder = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🗑️ DELETE ORDER: Initiated.`);
    try {
        const { orderId } = req.params;
        const isAdminUser = req.vendor?.role === 'admin';
        console.log(`📋 Order ID: ${orderId}, Is Admin: ${isAdminUser}`);

        if (!isAdminUser) {
            console.warn("⚠️ Blocked: Not authorized. Requires Admin role.");
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: Requires Admin role." });
        }

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        const deletedOrder = await Order.findByIdAndDelete(orderId);
        if (!deletedOrder) {
            console.warn(`⚠️ Order not found for deletion: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        console.log("✅ Order deleted:", orderId);
        console.log(`======================================================`);
        res.json({ success: true, message: "Order deleted", order: deletedOrder });
    } catch (err) {
        console.error("❌ Error deleting order:", err);
        console.log(`======================================================`);
        res.status(500).json({ success: false, message: "Failed to delete order", error: err.message });
    }
};

// @desc    Cancel an order
exports.cancelOrder = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`❌ CANCEL ORDER: Initiated.`);
    try {
        const orderId = req.params.orderId;
        const authenticatedUserId = req.user?.userId;
        const isAdminUser = req.vendor?.role === 'admin';
        console.log(`📋 Order ID: ${orderId}, Auth User ID: ${authenticatedUserId}, Is Admin: ${isAdminUser}`);

        if (!authenticatedUserId && !isAdminUser) {
            console.warn("⚠️ Blocked: Not authorized. Requires User or Admin role.");
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Unauthorized: Requires User or Admin role." });
        }

        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`⚠️ Blocked: Order not found: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ message: "Order not found" });
        }

        // Authorization check
        if (!isAdminUser && order.userId.toString() !== authenticatedUserId) {
            console.warn(`⚠️ Blocked: User ${authenticatedUserId} attempted to cancel order ${orderId} which is not theirs.`);
            console.log(`======================================================`);
            return res.status(403).json({ success: false, message: "Not authorized to cancel this order." });
        }

        if (["delivered", "cancelled", "shipped"].includes(order.status)) {
            console.warn(`⚠️ Blocked: Cannot cancel order in status ${order.status}.`);
            console.log(`======================================================`);
            return res.status(400).json({ message: "Order cannot be cancelled at this stage" });
        }

        order.status = "cancelled";
        await order.save();

        const updatedOrder = await Order.findById(orderId)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");
        
        console.log(`✅ Order ${orderId} cancelled successfully.`);
        console.log(`======================================================`);

        res.json({ order: updatedOrder });
    } catch (error) {
        console.error("❌ Error cancelling order:", error);
        console.log(`======================================================`);
        res.status(500).json({ message: "Server error cancelling order" });
    }
};

// @desc    Assign delivery boy to an order
exports.assignDeliveryBoy = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🛵 ASSIGN DELIVERY BOY: Initiated.`);
    const { orderId } = req.params;
    const { deliveryBoyId } = req.body;
    console.log(`📋 Order ID: ${orderId}, DB ID: ${deliveryBoyId}`);


    try {
        if (
            !isValidObjectId(orderId) ||
            !isValidObjectId(deliveryBoyId)
        ) {
            console.error("❌ Blocked: Invalid ID format.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid IDs" });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`⚠️ Blocked: Order not found: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const deliveryBoy = await DeliveryBoy.findById(deliveryBoyId);
        if (!deliveryBoy) {
            console.warn(`⚠️ Blocked: Delivery boy not found: ${deliveryBoyId}`);
            console.log(`======================================================`);
            return res.status(404).json({ success: false, message: "Delivery boy not found" });
        }

        order.deliveryBoy = deliveryBoyId;
        await order.save();

        // Add order to delivery boy's assigned orders
        await DeliveryBoy.findByIdAndUpdate(
            deliveryBoyId,
            { $addToSet: { assignedOrders: order._id } },
            { new: true }
        );

        // Return the updated order with deliveryBoy populated
        const populatedOrder = await Order.findById(order._id)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");
        
        console.log(`✅ Delivery boy ${deliveryBoyId} assigned to order ${orderId}.`);
        console.log(`======================================================`);

        return res.status(200).json({
            success: true,
            message: "Delivery boy assigned successfully",
            order: populatedOrder,
        });

    } catch (error) {
        console.error("❌ Error assigning delivery boy:", error);
        console.log(`======================================================`);
        return res.status(500).json({
            success: false,
            message: "Server error assigning delivery boy",
        });
    }
};

// @desc    Get all orders assigned to a specific delivery boy
exports.getDeliveryBoyOrders = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`🚚 GET DB ORDERS: Initiated.`);
    const requestedDeliveryBoyId = req.params.deliveryBoyId;
    const authenticatedDeliveryBoyId = req.deliveryBoy?.deliveryBoyId;
    const isAdminUser = req.vendor?.role === 'admin';
    console.log(`📋 Requested ID: ${requestedDeliveryBoyId}, Auth ID: ${authenticatedDeliveryBoyId}, Admin: ${isAdminUser}`);

    // Authorization: Delivery Boy can only see their own orders, Admin can see all
    if (!isAdminUser && (!authenticatedDeliveryBoyId || authenticatedDeliveryBoyId !== requestedDeliveryBoyId)) {
        console.warn(`⚠️ Authorization Failed: Attempt to view unassigned orders.`);
        console.log(`======================================================`);
        return res.status(403).json({ success: false, message: "Not authorized to view these orders." });
    }

    try {
        if (!isValidObjectId(requestedDeliveryBoyId)) {
            console.error("❌ Blocked: Invalid deliveryBoyId format.");
            console.log(`======================================================`);
            return res.status(400).json({ message: "Invalid deliveryBoyId" });
        }

        const orders = await Order.find({ deliveryBoy: new mongoose.Types.ObjectId(requestedDeliveryBoyId) })
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone")
            .sort({ createdAt: -1 });

        console.log(`📦 Found ${orders.length} orders for Delivery Boy ${requestedDeliveryBoyId}.`);
        console.log(`======================================================`);

        return res.status(200).json({ success: true, orders });
    } catch (err) {
        console.error("❌ Error fetching delivery boy orders:", err.message);
        console.log(`======================================================`);
        return res.status(500).json({ message: "Server error while fetching orders" });
    }
};

// @desc    Get all system orders (for Admin)
exports.getAllSystemOrders = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`👑 GET ALL SYSTEM ORDERS (Admin): Initiated.`);
    const isAdminUser = req.vendor?.role === 'admin';

    if (!isAdminUser) {
        console.warn("⚠️ Blocked: Not authorized. Requires Admin role.");
        console.log(`======================================================`);
        return res.status(403).json({ success: false, message: "Unauthorized: Requires Admin role." });
    }

    try {
        const orders = await Order.find()
            .populate('userId', 'name email')
            .populate('deliveryBoy', 'name email phone')
            .populate('items.productId', 'name images') 
            .populate('items.vendorId', 'shopName email'); 
        
        console.log(`📦 Found ${orders.length} total orders.`);
        console.log(`======================================================`);

        res.json({ success: true, orders });
    } catch (error) {
        console.error('❌ Error fetching all system orders (Admin):', error);
        console.log(`======================================================`);
        res.status(500).json({ message: 'Server error fetching all orders' });
    }
};

// @desc    Admin update any order status
exports.adminUpdateOrderStatus = async (req, res) => {
    console.log(`\n======================================================`);
    console.log(`👑 ADMIN UPDATE STATUS: Initiated.`);
    const { orderId } = req.params;
    const { status } = req.body; 
    const isAdminUser = req.vendor?.role === 'admin';
    console.log(`📋 Order ID: ${orderId}, New Status: ${status}, Is Admin: ${isAdminUser}`);


    if (!isAdminUser) {
        console.warn("⚠️ Blocked: Not authorized. Requires Admin role.");
        console.log(`======================================================`);
        return res.status(403).json({ success: false, message: "Unauthorized: Requires Admin role." });
    }

    try {
        if (!isValidObjectId(orderId)) {
            console.error(`❌ Blocked: Invalid Order ID format: ${orderId}`);
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }
        if (!status || typeof status !== "string") {
            console.error("❌ Blocked: Invalid status provided.");
            console.log(`======================================================`);
            return res.status(400).json({ success: false, message: "Invalid status provided." });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`⚠️ Blocked: Order not found: ${orderId}`);
            console.log(`======================================================`);
            return res.status(404).json({ message: 'Order not found' });
        }

        // Admin can update any order's status
        order.status = status;
        const updatedOrder = await order.save();

        // Populate after save to return full object
        const populatedOrder = await Order.findById(updatedOrder._id)
            .populate("userId", "name email")
            .populate("deliveryBoy", "name email phone");

        console.log(`✅ Order status updated by admin: ${orderId} => ${status}`);
        console.log(`======================================================`);

        res.json({ success: true, message: 'Order status updated by admin', order: populatedOrder });
    } catch (error) {
        console.error(`❌ Error admin updating order ${orderId}:`, error);
        console.log(`======================================================`);
        res.status(500).json({ message: 'Server error updating order status' });
    }
};