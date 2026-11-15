const express = require('express');
const router = express.Router();
const ProductView = require('../models/ProductView');
const PushToken = require('../models/PushToken');
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

// --- Record a product view (called from frontend) ---
router.post('/record', async (req, res) => {
  try {
    const { productId, productType, viewerUserId, viewerName, viewerPhone, vendorId } = req.body;
    console.log('📝 Recording product view:', { productId, productType, vendorId, viewerName });

    if (!productId || !productType || !viewerUserId || !vendorId) {
      console.error('❌ Missing required fields:', { productId, productType, viewerUserId, vendorId });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save view record
    const view = await ProductView.create({
      productId,
      productType,
      vendorId,
      viewerUserId,
      viewerName: viewerName || 'User',
      viewerPhone: viewerPhone || 'N/A',
    });
    console.log(`✅ View saved with ID: ${view._id}`);

    // --- Send push notification to vendor ---
    console.log(`🔍 Looking for push tokens for vendor ${vendorId}`);
    const tokens = await PushToken.find({ userId: vendorId }).distinct('token');
    console.log(`📱 Found ${tokens.length} push token(s) for vendor ${vendorId}`);
    console.log('📱 Tokens:', tokens);

    if (tokens.length > 0) {
      // Fetch product title dynamically
      let productTitle = 'Product';
      try {
        if (productType === 'Property') {
          const Property = require('../models/Property.model');
          const property = await Property.findById(productId).select('title');
          if (property) productTitle = property.title;
        } else if (productType === 'Rental') {
          const Rental = require('../models/Rental.model');
          const rental = await Rental.findById(productId).select('title');
          if (rental) productTitle = rental.title;
        }
        console.log(`📦 Product title: "${productTitle}"`);
      } catch (err) {
        console.warn('⚠️ Could not fetch product title:', err.message);
      }

      // Filter valid Expo tokens
      const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));
      console.log(`✅ ${validTokens.length} valid Expo push tokens out of ${tokens.length}`);

      if (validTokens.length === 0) {
        console.warn('⚠️ No valid Expo push tokens found (invalid format)');
        // Optionally delete invalid tokens from DB
      }

      const messages = validTokens.map(token => ({
        to: token,
        sound: 'default',
        title: '👀 New Product View',
        body: `${viewerName} viewed your "${productTitle}"`,
        data: {
          type: 'product_view',
          productId,
          productType,
          viewerUserId,
          vendorId,
        },
        priority: 'high',
      }));

      console.log(`📨 Prepared ${messages.length} push messages`);

      if (messages.length > 0) {
        const chunks = expo.chunkPushNotifications(messages);
        console.log(`📦 Sending ${chunks.length} chunk(s)`);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          try {
            console.log(`📤 Sending chunk ${i+1} with ${chunk.length} messages...`);
            const receipts = await expo.sendPushNotificationsAsync(chunk);
            console.log(`✅ Chunk ${i+1} sent successfully. Receipts:`, receipts);

            // Handle invalid tokens
            for (const receipt of receipts) {
              if (receipt.status === 'error') {
                console.warn(`⚠️ Receipt error:`, receipt);
                if (receipt.details && receipt.details.error === 'DeviceNotRegistered') {
                  const invalidToken = chunk.find((msg) => msg.to === receipt.to)?.to;
                  if (invalidToken) {
                    console.log(`🗑️ Removing invalid token: ${invalidToken}`);
                    await PushToken.deleteOne({ token: invalidToken });
                  }
                }
              }
            }
          } catch (error) {
            console.error(`❌ Error sending chunk ${i+1}:`, error);
          }
        }
      }
    } else {
      console.warn(`⚠️ No push tokens found for vendor ${vendorId}, skipping push notification`);
    }

    // --- Emit real‑time event via Socket.IO ---
    const io = req.app.get('socketio');
    if (io) {
      console.log(`📡 Emitting real-time event via Socket.IO to vendor ${vendorId}`);
      // Fetch full product details for the socket payload
      let productData = null;
      try {
        if (productType === 'Property') {
          const Property = require('../models/Property.model');
          productData = await Property.findById(productId)
            .select('title images minPriceCr maxPriceCr propertyType');
        } else if (productType === 'Rental') {
          const Rental = require('../models/Rental.model');
          productData = await Rental.findById(productId)
            .select('title images monthlyRent rentalType');
        }
        console.log(`📦 Product data fetched for socket: ${productData ? 'yes' : 'no'}`);
      } catch (err) {
        console.warn('Could not fetch product data for socket emit:', err);
      }

      const viewPayload = {
        _id: view._id,
        productId: view.productId,
        productType: view.productType,
        vendorId: view.vendorId,
        viewerUserId: view.viewerUserId,
        viewerName: view.viewerName,
        viewerPhone: view.viewerPhone,
        viewedAt: view.viewedAt,
        product: productData,
      };

      // Emit to the vendor's personal room
      io.to(vendorId.toString()).emit('newProductView', viewPayload);
      console.log(`✅ Emitted newProductView to vendor ${vendorId}`);
    } else {
      console.warn('⚠️ Socket.IO not available, skipping real‑time emit');
    }

    res.status(201).json({ success: true, view });
  } catch (error) {
    console.error('❌ Error recording product view:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Get views for a vendor (with product details) ---
router.get('/vendor/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log(`📋 Fetching views for vendor ${vendorId}, page ${page}, limit ${limit}`);

    const views = await ProductView.find({ vendorId })
      .sort({ viewedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const enrichedViews = await Promise.all(views.map(async (view) => {
      let product = null;
      if (view.productType === 'Property') {
        const Property = require('../models/Property.model');
        product = await Property.findById(view.productId)
          .select('title images minPriceCr maxPriceCr propertyType');
      } else if (view.productType === 'Rental') {
        const Rental = require('../models/Rental.model');
        product = await Rental.findById(view.productId)
          .select('title images monthlyRent rentalType');
      }
      return { ...view, product };
    }));

    const total = await ProductView.countDocuments({ vendorId });

    console.log(`✅ Returning ${enrichedViews.length} views (total ${total})`);

    res.status(200).json({
      success: true,
      data: enrichedViews,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('❌ Error fetching vendor views:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;