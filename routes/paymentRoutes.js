// routes/paymentRoutes.js
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const router = express.Router(); // Create a new Express Router

// IMPORTANT: These should ideally come from environment variables (e.g., .env file)
// and not hardcoded directly in the file.
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID'; // Replace with your actual Test/Live Key ID
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET'; // Replace with your actual Test/Live Key Secret
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'your_webhook_secret_key'; // Use a strong, unique secret

const instance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

// Middleware to protect routes (example: check if user is authenticated)
// You would replace this with your actual authentication middleware
const authenticateUser = (req, res, next) => {
    // For demonstration, let's assume a user ID is passed in headers for testing
    // In a real app, this would verify a JWT token or session
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'Authorization header missing' });
    }
    const token = authHeader.split(' ')[1]; // Assuming "Bearer TOKEN"

    // Simulate token verification. Replace with actual JWT verification.
    if (token) {
        // You would typically decode/verify JWT here to get user details
        req.user = { _id: 'someUserId123' }; // Attach user info to request
        next();
    } else {
        res.status(403).json({ message: 'Invalid or expired token' });
    }
};


// Route to create a Razorpay Order
// This route should be protected, e.g., by checking if the user is logged in
router.post('/create-razorpay-order', authenticateUser, async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt } = req.body; // receipt would be your internal order ID
        const userId = req.user._id; // Get user ID from authenticated request

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Amount is required and must be positive' });
        }
        if (!receipt) {
            return res.status(400).json({ message: 'Receipt ID is required' });
        }

        const options = {
            amount: Math.round(amount * 100), // amount in paisa, ensure it's an integer
            currency: currency,
            receipt: receipt, // Your internal order ID for this specific transaction
            payment_capture: 1 // auto capture
        };

        const razorpayOrder = await instance.orders.create(options);

        // You might want to save razorpayOrder.id and order.receipt to your database
        // for later reconciliation. Link it to your internal user order.
        console.log(`Razorpay order created: ${razorpayOrder.id} for receipt ${receipt}`);

        res.json({
            orderId: razorpayOrder.id,
            currency: razorpayOrder.currency,
            amount: razorpayOrder.amount, // This is already in paisa
            key_id: RAZORPAY_KEY_ID // Send key_id to frontend
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ message: 'Failed to create Razorpay order', error: error.message });
    }
});

// Webhook endpoint to receive payment updates from Razorpay
// This route should be publicly accessible by Razorpay, but protected by signature verification
router.post('/razorpay-webhook', (req, res) => {
    // console.log('Webhook Raw Body:', req.body); // For debugging
    // You might need to use `express.raw({ type: 'application/json' })` or similar
    // if your main app uses `bodyParser.json()` before this router and breaks the raw body.
    // However, if using this router specifically for webhooks, it might be fine.

    const shasum = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET);
    // The `req.rawBody` or similar depends on your body-parser configuration.
    // If you're using `express.json()` globally, `req.body` will already be parsed.
    // Razorpay webhook signature is generated on the RAW body.
    // A common solution is to define a specific body-parser for the webhook route.
    // For example: app.post('/api/razorpay-webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => { ... })
    // and then use req.rawBody or req.body (if `raw` is handled)
    shasum.update(JSON.stringify(req.body)); // This assumes req.body is the raw JSON, if not, adjust.
    const digest = shasum.digest('hex');

    if (digest === req.headers['x-razorpay-signature']) {
        // Payment is genuine
        const event = req.body.event;
        const payload = req.body.payload;

        console.log('Razorpay Webhook Event:', event);
        console.log('Razorpay Webhook Payload:', JSON.stringify(payload, null, 2));

        // --- IMPORTANT: Update your internal order status here ---
        if (event === 'payment.authorized' || event === 'payment.captured') {
            const payment = payload.payment.entity;
            const order = payload.order.entity; // This 'order' entity contains the 'receipt' (your internal order ID)

            console.log(`Payment successful for internal order: ${order.receipt}, Razorpay Payment ID: ${payment.id}`);
            // TODO:
            // 1. Find your internal order by `order.receipt`
            // 2. Update its status to 'paid' or 'completed'
            // 3. Store `payment.id` (Razorpay Payment ID) in your order record
            // 4. Potentially decrement product stock (if not done immediately after order placement)
            // 5. Trigger order fulfillment process (e.g., notify vendor, send email)

        } else if (event === 'payment.failed') {
            const payment = payload.payment.entity;
            const order = payload.order.entity;

            console.log(`Payment failed for internal order: ${order.receipt}, Razorpay Payment ID: ${payment.id}, Error: ${payment.error_description}`);
            // TODO:
            // 1. Find your internal order by `order.receipt`
            // 2. Update its status to 'payment_failed'
            // 3. Log error details

        } else {
            console.log(`Unhandled Razorpay event: ${event}`);
        }
        // ... handle other events like 'refund.processed', 'payment.refunded' etc.
    } else {
        console.warn('Webhook signature mismatch! Incoming signature:', req.headers['x-razorpay-signature'], 'Calculated digest:', digest);
    }

    res.json({ status: 'ok' }); // Always send a 200 OK response to Razorpay
});

module.exports = router; // Export the router