// routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');
const { sendDailyNotifications } = require('../services/notificationService');

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

/** Accept both new (ownerId/ownerType) and legacy (userId/role) request shapes. */
function parseOwner(body) {
  const ownerId = body.ownerId || body.userId || null;
  const ownerType = body.ownerType || body.role || 'user';
  return {
    ownerId: ownerId ? String(ownerId) : null,
    ownerType: String(ownerType).toLowerCase(),
  };
}

/** Normalize "vendor"/"Vendor"/"VENDOR" → "vendor". */
const ALLOWED_TYPES = ['user', 'vendor', 'deliveryboy', 'admin'];
function isValidOwnerType(t) {
  return ALLOWED_TYPES.includes(String(t).toLowerCase());
}

// ============================================================
// REGISTER OR REFRESH A PUSH TOKEN
//
// Multi-device safe: each physical device gets its own row.
// Re-registering the same device simply updates lastUsed / platform.
// ============================================================
router.post('/register', async (req, res) => {
  try {
    const { ownerId, ownerType } = parseOwner(req.body);
    const { token, platform, deviceInfo } = req.body;

    if (!ownerId || !token) {
      return res.status(400).json({
        status: 'fail',
        error: 'Missing ownerId (or userId) and token',
      });
    }
    if (!isValidOwnerType(ownerType)) {
      return res.status(400).json({
        status: 'fail',
        error: `Invalid ownerType '${ownerType}'. Allowed: ${ALLOWED_TYPES.join(', ')}`,
      });
    }

    const normalizedType =
      ownerType === 'deliveryboy' ? 'deliveryBoy' : ownerType;

    // Upsert on the compound key → safe to call on every app launch.
    await PushToken.updateOne(
      { ownerId, ownerType: normalizedType, token },
      {
        $set: {
          platform: platform || 'unknown',
          deviceInfo: deviceInfo || {},
          lastUsed: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(
      `✅ [PushRegister] ${normalizedType} ${ownerId} (${token.slice(0, 25)}…)`
    );

    res.status(200).json({
      status: 'success',
      message: 'Push token registered successfully',
    });
  } catch (error) {
    // Race-condition safe: unique index already exists → treat as success.
    if (error.code === 11000) {
      return res.status(200).json({
        status: 'success',
        message: 'Token already registered',
      });
    }
    console.error('Error registering push token:', error);
    res.status(500).json({
      status: 'fail',
      error: error.message,
    });
  }
});

// ============================================================
// UNREGISTER A PUSH TOKEN (on logout for a specific device)
//
// Removes ONLY this (ownerId + role + token) row.
// Other devices belonging to the same owner keep receiving pushes.
// ============================================================
router.delete('/unregister', async (req, res) => {
  try {
    const { ownerId, ownerType } = parseOwner(req.body);
    const { token } = req.body;

    if (!ownerId || !token) {
      return res.status(400).json({
        status: 'fail',
        error: 'Missing ownerId (or userId) and token',
      });
    }

    const normalizedType =
      ownerType === 'deliveryboy' ? 'deliveryBoy' : ownerType;

    const result = await PushToken.deleteOne({
      ownerId,
      ownerType: normalizedType,
      token,
    });

    console.log(
      `🗑️ [PushUnregister] deleted ${result.deletedCount} row(s) for ${normalizedType} ${ownerId}`
    );

    res.status(200).json({
      status: 'success',
      message: 'Push token unregistered successfully',
      deleted: result.deletedCount,
    });
  } catch (error) {
    console.error('Error unregistering push token:', error);
    res.status(500).json({
      status: 'fail',
      error: error.message,
    });
  }
});

// ============================================================
// CLEANUP STALE TOKENS
//
// Removes rows that haven't been used in 30 days.
// Optionally narrow to one owner via `ownerId` / `userId` in the body.
// ============================================================
router.delete('/cleanup', async (req, res) => {
  try {
    const { ownerId } = parseOwner(req.body);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const filter = { lastUsed: { $lt: thirtyDaysAgo } };
    if (ownerId) filter.ownerId = ownerId;

    const result = await PushToken.deleteMany(filter);

    res.status(200).json({
      status: 'success',
      message: `Cleaned up ${result.deletedCount} stale tokens`,
    });
  } catch (error) {
    console.error('Cleanup push tokens error:', error);
    res.status(500).json({
      status: 'fail',
      error: error.message,
    });
  }
});

// ============================================================
// DEBUG: list all tokens for an owner
//
//   GET /push/user/:userId
//   GET /push/vendor/:vendorId
//   GET /push/deliveryBoy/:deliveryBoyId
// ============================================================
router.get('/:ownerType/:ownerId', async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;

    if (!isValidOwnerType(ownerType)) {
      return res.status(400).json({
        status: 'fail',
        error: `Invalid ownerType '${ownerType}'`,
      });
    }

    const normalizedType =
      ownerType.toLowerCase() === 'deliveryboy' ? 'deliveryBoy' : ownerType.toLowerCase();

    const tokens = await PushToken.find({
      ownerId: String(ownerId),
      ownerType: normalizedType,
    }).sort({ lastUsed: -1 });

    res.status(200).json({
      status: 'success',
      count: tokens.length,
      data: tokens,
    });
  } catch (error) {
    console.error('Get owner tokens error:', error);
    res.status(500).json({
      status: 'fail',
      error: error.message,
    });
  }
});

// ============================================================
// TEST SEND NOTIFICATIONS (dev only)
// ============================================================
router.get('/test-send', async (req, res) => {
  try {
    await sendDailyNotifications();
    res.status(200).json({
      status: 'success',
      message: 'Test notifications sent.',
    });
  } catch (error) {
    console.error('Test send error:', error);
    res.status(500).json({
      status: 'fail',
      error: error.message,
    });
  }
});

module.exports = router;