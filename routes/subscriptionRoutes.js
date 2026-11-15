const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Vendor = require('../models/Vendor');
const { authMiddleware, isVendor } = require('../middleware/authMiddleware');

console.log('🔧 Loading subscriptionRoutes...');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_PLAN_ID = process.env.RAZORPAY_PLAN_ID;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

console.log('📌 RAZORPAY_KEY_ID:', RAZORPAY_KEY_ID ? '✅ present' : '❌ missing');
console.log('📌 RAZORPAY_KEY_SECRET:', RAZORPAY_KEY_SECRET ? '✅ present' : '❌ missing');
console.log('📌 RAZORPAY_PLAN_ID:', RAZORPAY_PLAN_ID ? '✅ present' : '❌ missing');
console.log('📌 RAZORPAY_WEBHOOK_SECRET:', RAZORPAY_WEBHOOK_SECRET ? '✅ present' : '❌ missing');

let razorpayInstance = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });
  console.log('✅ Razorpay initialized');
} else {
  console.warn('⚠️ Razorpay keys missing – paid subscription features disabled');
}

const checkRazorpay = (req, res, next) => {
  if (!razorpayInstance) {
    return res.status(503).json({
      success: false,
      message: 'Payment service unavailable. Please contact support.'
    });
  }
  if (!RAZORPAY_PLAN_ID) {
    return res.status(500).json({
      success: false,
      message: 'Subscription plan not configured. Please contact support.'
    });
  }
  next();
};

const router = express.Router();

// ----- Health check -----
router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'Subscription router is alive!' });
});

// ----- Get current subscription status -----
router.get('/status', authMiddleware, isVendor, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor.vendorId).select(
      'subscriptionStatus trialStartDate trialEndDate subscriptionStartDate subscriptionEndDate razorpaySubscriptionId'
    );
    res.json({ success: true, subscription: vendor });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching subscription' });
  }
});

// ----- Start 3‑month free trial -----
router.post('/start-trial', authMiddleware, isVendor, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    if (vendor.subscriptionStatus !== 'inactive' && vendor.subscriptionStatus !== 'expired') {
      return res.status(400).json({ success: false, message: 'Trial not available' });
    }
    const trialEnd = new Date();
    trialEnd.setMonth(trialEnd.getMonth() + 3);
    vendor.subscriptionStatus = 'trial';
    vendor.trialStartDate = new Date();
    vendor.trialEndDate = trialEnd;
    await vendor.save();
    res.json({ success: true, message: '3‑month free trial started!', trialEnd });
  } catch (error) {
    console.error('Start trial error:', error);
    res.status(500).json({ success: false, message: 'Failed to start trial' });
  }
});

// ----- Create paid subscription (Razorpay) -----
router.post('/subscribe', authMiddleware, isVendor, checkRazorpay, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    if (vendor.subscriptionStatus === 'active' || vendor.subscriptionStatus === 'trial') {
      return res.status(400).json({ success: false, message: 'Already subscribed or in trial' });
    }
    if (!vendor.email) return res.status(400).json({ success: false, message: 'Vendor email is required' });
    if (!vendor.phone) return res.status(400).json({ success: false, message: 'Vendor phone is required' });

    let customerId = vendor.razorpayCustomerId;
    if (!customerId) {
      try {
        const customer = await razorpayInstance.customers.create({
          name: vendor.name || 'Vendor',
          email: vendor.email,
          contact: vendor.phone,
          notes: { vendorId: vendor._id.toString() }
        });
        customerId = customer.id;
        vendor.razorpayCustomerId = customerId;
        await vendor.save();
        console.log('✅ Razorpay customer created:', customerId);
      } catch (customerError) {
        console.error('❌ Razorpay customer creation failed:', customerError);
        if (customerError.error?.code === 'BAD_REQUEST_ERROR' &&
            customerError.error?.description === 'Customer already exists for the merchant') {
          console.log('🔄 Customer already exists, fetching existing ID...');
          try {
            const customers = await razorpayInstance.customers.all({ count: 100 });
            const existing = customers.items.find(c =>
              c.email === vendor.email || c.contact === vendor.phone
            );
            if (existing) {
              customerId = existing.id;
              vendor.razorpayCustomerId = customerId;
              await vendor.save();
              console.log('✅ Existing customer found:', customerId);
            } else {
              throw new Error('Could not find existing customer');
            }
          } catch (fetchError) {
            console.error('❌ Failed to fetch existing customer:', fetchError);
            return res.status(500).json({ success: false, message: 'Failed to retrieve existing customer' });
          }
        } else {
          const errorMsg = customerError.error?.description || customerError.message || 'Customer creation failed';
          return res.status(500).json({ success: false, message: errorMsg });
        }
      }
    }

    try {
      console.log('📤 Creating subscription with plan:', RAZORPAY_PLAN_ID);
      // 🔥 FIX: Set start_at to NOW so subscription activates immediately after payment
      const subscription = await razorpayInstance.subscriptions.create({
        plan_id: RAZORPAY_PLAN_ID,
        customer_notify: 1,
        quantity: 1,
        total_count: 12,
        start_at: Math.floor(Date.now() / 1000), // immediate
        notes: { vendorId: vendor._id.toString() }
      });
      console.log('✅ Subscription created:', subscription.id);
      vendor.razorpaySubscriptionId = subscription.id;
      vendor.subscriptionStatus = 'pending';
      await vendor.save();
      res.json({
        success: true,
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url,
      });
    } catch (subscriptionError) {
      console.error('❌ Razorpay subscription creation failed:', subscriptionError);
      const errorMsg = subscriptionError.error?.description || subscriptionError.message || 'Subscription creation failed';
      res.status(500).json({ success: false, message: errorMsg });
    }
  } catch (error) {
    console.error('❌ Subscription creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create subscription' });
  }
});

// ----- Manual verification endpoint (fallback) -----
router.post('/verify-subscription', authMiddleware, isVendor, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor.vendorId);
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    if (!vendor.razorpaySubscriptionId) {
      return res.status(400).json({ success: false, message: 'No subscription ID found' });
    }

    const subscription = await razorpayInstance.subscriptions.fetch(vendor.razorpaySubscriptionId);
    console.log('📡 Subscription status from Razorpay:', subscription.status);

    let newStatus = vendor.subscriptionStatus;
    let statusUpdated = false;

    if (subscription.status === 'active') {
      newStatus = 'active';
      if (!vendor.subscriptionStartDate) {
        vendor.subscriptionStartDate = new Date();
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        vendor.subscriptionEndDate = end;
      }
      statusUpdated = true;
    } else if (subscription.status === 'cancelled') {
      newStatus = 'cancelled';
      statusUpdated = true;
    } else if (subscription.status === 'expired') {
      newStatus = 'expired';
      statusUpdated = true;
    } else if (subscription.status === 'pending') {
      newStatus = 'pending';
      statusUpdated = true;
    }

    if (statusUpdated && newStatus !== vendor.subscriptionStatus) {
      vendor.subscriptionStatus = newStatus;
      await vendor.save();
      console.log(`✅ Vendor ${vendor._id} status updated to ${newStatus} via manual verification`);
    }

    res.json({
      success: true,
      subscriptionStatus: vendor.subscriptionStatus,
      razorpayStatus: subscription.status,
    });
  } catch (error) {
    console.error('❌ Verify subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify subscription: ' + (error.error?.description || error.message)
    });
  }
});

// ----- Force active (temporary debug) -----
router.post('/force-active', authMiddleware, isVendor, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    vendor.subscriptionStatus = 'active';
    vendor.subscriptionStartDate = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    vendor.subscriptionEndDate = end;
    await vendor.save();
    res.json({ success: true, message: 'Status forced to active' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// WEBHOOK ROUTER – MUST use express.raw before parsing
// ============================================================
const webhookRouter = express.Router();

webhookRouter.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // 🔥 CRITICAL FIX: Convert buffer to UTF-8 string for signature verification
  const rawBody = req.body.toString('utf8');
  const signature = req.headers['x-razorpay-signature'];

  console.log('📨 Webhook received!');
  console.log('📨 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📨 Raw Body (first 200 chars):', rawBody.substring(0, 200));

  // Verify signature using the raw string
  if (RAZORPAY_WEBHOOK_SECRET) {
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('⚠️ Webhook signature mismatch');
      console.warn('Expected:', expectedSignature);
      console.warn('Received:', signature);
      return res.status(400).json({ message: 'Invalid signature' });
    }
    console.log('✅ Webhook signature verified');
  } else {
    console.warn('⚠️ No RAZORPAY_WEBHOOK_SECRET set – skipping verification');
  }

  // Parse JSON after verification
  let webhookBody;
  try {
    webhookBody = JSON.parse(rawBody);
  } catch (e) {
    console.error('❌ Invalid JSON in webhook body');
    return res.status(400).json({ message: 'Invalid JSON' });
  }

  const event = webhookBody.event;
  const payload = webhookBody.payload;
  console.log(`📌 Event: ${event}`);

  // Extract subscription ID robustly
  let subscriptionId = null;
  if (payload?.subscription?.entity?.id) {
    subscriptionId = payload.subscription.entity.id;
  } else if (payload?.payment?.entity?.subscription_id) {
    subscriptionId = payload.payment.entity.subscription_id;
  } else if (payload?.subscription?.id) {
    subscriptionId = payload.subscription.id;
  } else if (webhookBody.subscription_id) {
    subscriptionId = webhookBody.subscription_id;
  }

  if (!subscriptionId) {
    console.warn('⚠️ No subscription ID found in webhook payload');
    return res.status(200).send('OK');
  }

  console.log(`🔍 Looking for subscription: ${subscriptionId}`);
  const vendor = await Vendor.findOne({ razorpaySubscriptionId: subscriptionId });
  if (!vendor) {
    console.warn(`⚠️ No vendor found for subscription ${subscriptionId}`);
    return res.status(200).send('OK');
  }

  console.log(`👤 Vendor found: ${vendor._id}, current status: ${vendor.subscriptionStatus}`);
  let statusUpdated = false;

  // --- Handle all relevant events ---
  switch (event) {
    case 'subscription.activated':
      vendor.subscriptionStatus = 'active';
      vendor.subscriptionStartDate = new Date();
      const end = new Date();
      end.setMonth(end.getMonth() + 1);
      vendor.subscriptionEndDate = end;
      statusUpdated = true;
      console.log('✅ Subscription activated');
      break;

    case 'subscription.charged':
      vendor.lastPaymentDate = new Date();
      vendor.subscriptionStatus = 'active';
      statusUpdated = true;
      console.log('✅ Subscription charged (payment successful)');
      break;

    case 'subscription.pending':
      vendor.subscriptionStatus = 'pending';
      statusUpdated = true;
      console.log('⏳ Subscription is pending (awaiting payment)');
      break;

    case 'subscription.cancelled':
      vendor.subscriptionStatus = 'cancelled';
      vendor.subscriptionEndDate = new Date();
      statusUpdated = true;
      console.log('❌ Subscription cancelled');
      break;

    case 'subscription.expired':
      vendor.subscriptionStatus = 'expired';
      statusUpdated = true;
      console.log('⏰ Subscription expired');
      break;

    case 'subscription.halted':
      vendor.subscriptionStatus = 'expired'; // or 'halted' – treat as expired
      statusUpdated = true;
      console.log('⛔ Subscription halted (payment failures)');
      break;

    case 'subscription.paused':
      // Keep active but you could add a paused flag
      console.log('⏸️ Subscription paused');
      // No status change
      break;

    case 'subscription.resumed':
      vendor.subscriptionStatus = 'active';
      statusUpdated = true;
      console.log('▶️ Subscription resumed');
      break;

    case 'payment.authorized':
    case 'payment.captured':
      if (vendor.subscriptionStatus === 'pending') {
        vendor.subscriptionStatus = 'active';
        vendor.subscriptionStartDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);
        vendor.subscriptionEndDate = endDate;
        vendor.lastPaymentDate = new Date();
        statusUpdated = true;
        console.log('✅ Payment captured – subscription marked active');
      }
      break;

    default:
      console.log(`ℹ️ Unhandled webhook event: ${event}`);
  }

  if (statusUpdated) {
    await vendor.save();
    console.log(`💾 Vendor ${vendor._id} status updated to ${vendor.subscriptionStatus}`);
  } else {
    console.log('ℹ️ No status change required');
  }

  res.status(200).send('OK');
});

console.log('✅ subscriptionRoutes loaded successfully');
module.exports = {
  router,
  webhookRouter
};