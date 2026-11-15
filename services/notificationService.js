// services/notificationService.js
const { Expo } = require('expo-server-sdk');
const PushToken = require('../models/PushToken');
const Vendor = require('../models/Vendor');
const User = require('../models/User');

const expo = new Expo();

// ═════════════════════════════════════════════════════════
// DIAGNOSTIC HELPER
// Lists every token we know about for a given owner, split by
// role, so you can see exactly what's stored in each collection.
// ═════════════════════════════════════════════════════════
async function getPushTokens(ownerId, ownerType = 'user') {
  const normalizedType =
    String(ownerType).toLowerCase() === 'deliveryboy'
      ? 'deliveryBoy'
      : String(ownerType).toLowerCase();

  console.log('──────────────────────────────────────────────');
  console.log(
    `🔍 getPushTokens called for ${normalizedType}:`,
    String(ownerId)
  );

  const uid = String(ownerId);
  const tokens = new Set();

  // 1) PushToken collection (multi-device, canonical source)
  try {
    const rows = await PushToken.find({
      ownerId: uid,
      ownerType: normalizedType,
    }).lean();

    console.log(`   PushToken collection: ${rows.length} row(s)`);
    rows.forEach((r) => {
      console.log(
        `     • token=${r.token?.slice(0, 30)}... platform=${r.platform} lastUsed=${r.lastUsed}`
      );
      if (r.token) tokens.add(r.token);
    });
  } catch (e) {
    console.error('   ❌ PushToken query error:', e.message);
  }

  // 2) Legacy single-field fallback (only for user / vendor)
  try {
    if (normalizedType === 'user') {
      const user = await User.findById(uid).select('pushToken name').lean();
      if (user) {
        console.log(
          `   User doc: name=${user.name} legacyPushToken=${user.pushToken ? user.pushToken.slice(0, 30) + '...' : 'none'}`
        );
        if (user.pushToken) tokens.add(user.pushToken);
      }
    } else if (normalizedType === 'vendor') {
      const vendor = await Vendor.findById(uid)
        .select('pushToken shopName')
        .lean();
      if (vendor) {
        console.log(
          `   Vendor doc: shopName=${vendor.shopName} legacyPushToken=${vendor.pushToken ? vendor.pushToken.slice(0, 30) + '...' : 'none'}`
        );
        if (vendor.pushToken) tokens.add(vendor.pushToken);
      }
    }
  } catch (e) {
    // Not a user/vendor — safe to ignore
  }

  const result = [...tokens].filter(Boolean);
  console.log(`   ➡️ Total unique tokens for ${normalizedType} ${uid}: ${result.length}`);
  result.forEach((t) => console.log(`     ✔️ ${t.slice(0, 40)}...`));
  console.log('──────────────────────────────────────────────');

  return result;
}

// ═════════════════════════════════════════════════════════
// LOW-LEVEL SEND — takes a raw list of tokens
// ═════════════════════════════════════════════════════════
async function _sendToTokens(tokens, title, body, data = {}, ownerType = 'user') {
  if (!tokens || tokens.length === 0) return;

  // Pick Android channel based on data.type
  const channelId =
    data.type === 'lead' || data.type === 'view'
      ? 'lead-notifications'
      : data.type === 'call'
      ? 'call-notifications'
      : data.type === 'whatsapp'
      ? 'whatsapp-notifications'
      : 'high-priority-chat';

  const role = ownerType === 'vendor' ? 'vendor' : 'user';

  const messages = tokens
    .filter((token) => {
      const valid = Expo.isExpoPushToken(token);
      if (!valid) console.warn(`⚠️ Not a valid Expo token: ${token}`);
      return valid;
    })
    .map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: {
        ...data,
        role, // ← used by the app to switch profile before navigating
        timestamp: new Date().toISOString(),
      },
      priority: 'high',
      channelId,
      badge: 1,
      _displayInForeground: true,
    }));

  if (messages.length === 0) {
    console.log('ℹ️ No valid Expo tokens to send to');
    return;
  }

  console.log(
    `📤 Sending ${messages.length} push message(s), channelId=${channelId}, role=${role}`
  );

  const chunks = expo.chunkPushNotifications(messages);
  const ticketIds = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      tickets.forEach((ticket, i) => {
        const tok = chunk[i]?.to;
        console.log(
          `🎫 Ticket for ${tok?.slice(0, 30)}...`,
          JSON.stringify(ticket)
        );

        if (ticket.status === 'ok' && ticket.id) {
          ticketIds.push({ id: ticket.id, token: tok });
        } else if (ticket.status === 'error') {
          console.warn(
            '❌ TICKET ERROR:',
            'token:', tok,
            'message:', ticket.message,
            'details:', JSON.stringify(ticket.details)
          );

          if (ticket.details?.error === 'DeviceNotRegistered' && tok) {
            PushToken.deleteMany({ token: tok }).catch(() => {});
          }
        }
      });
    } catch (chunkError) {
      console.error('❌ Chunk send failed:', chunkError);
    }
  }

  // Fetch receipts after 15s to catch silent failures
  if (ticketIds.length > 0) {
    setTimeout(async () => {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(
          ticketIds.map((t) => t.id)
        );
        for (const [id, receipt] of Object.entries(receipts)) {
          const match = ticketIds.find((t) => t.id === id);
          console.log(
            `📬 Receipt for ${match?.token?.slice(0, 30)}...`,
            JSON.stringify(receipt)
          );

          if (receipt.status === 'error') {
            console.warn(
              '❌ RECEIPT ERROR:',
              'message:', receipt.message,
              'details:', JSON.stringify(receipt.details)
            );

            if (
              receipt.details?.error === 'DeviceNotRegistered' &&
              match?.token
            ) {
              PushToken.deleteMany({ token: match.token }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error('❌ Receipt fetch failed:', e.message);
      }
    }, 15000);
  }
}

// ═════════════════════════════════════════════════════════
// PUBLIC API — send to an owner by role
// ═════════════════════════════════════════════════════════
async function sendPushNotificationToOwner(
  ownerId,
  ownerType,
  title,
  body,
  data = {}
) {
  if (!ownerId) {
    console.warn('⚠️ sendPushNotificationToOwner: ownerId is required');
    return;
  }

  const normalizedType =
    String(ownerType).toLowerCase() === 'deliveryboy'
      ? 'deliveryBoy'
      : String(ownerType).toLowerCase();

  console.log(
    `📤 [Notification] Sending to ${normalizedType} ${ownerId}: "${title}"`
  );

  const tokens = await getPushTokens(ownerId, normalizedType);

  if (tokens.length === 0) {
    console.log(`ℹ️ No push tokens found for ${normalizedType} ${ownerId}`);
    return;
  }

  await _sendToTokens(tokens, title, body, data, normalizedType);
}

// Backwards-compatible wrappers -----------------------------------
async function sendPushNotificationToUser(userId, title, body, data = {}) {
  return sendPushNotificationToOwner(userId, 'user', title, body, {
    ...data,
    userId: String(userId),
  });
}

async function sendPushNotificationToVendor(vendorId, title, body, data = {}) {
  return sendPushNotificationToOwner(vendorId, 'vendor', title, body, {
    ...data,
    vendorId: String(vendorId),
  });
}

// ═════════════════════════════════════════════════════════
// BROADCAST — to many vendors (or many users)
// ═════════════════════════════════════════════════════════
async function sendPushNotificationToVendors(vendorIds, title, body, data = {}) {
  if (!Array.isArray(vendorIds) || vendorIds.length === 0) return;
  console.log(`📤 Broadcasting to ${vendorIds.length} vendors...`);
  for (const vid of vendorIds) {
    await sendPushNotificationToVendor(vid, title, body, data);
  }
}

// ═════════════════════════════════════════════════════════
// DAILY DIGEST (cron)
// ═════════════════════════════════════════════════════════
async function sendDailyNotifications() {
  try {
    console.log('📅 [Daily Notification] Starting daily notification job...');

    const vendors = await Vendor.find({
      isApproved: true,
      isOnline: true,
      subscriptionStatus: { $in: ['active', 'trial'] },
    }).select('_id shopName');

    if (vendors.length === 0) {
      console.log('ℹ️ No active vendors found for daily notifications');
      return;
    }

    for (const v of vendors) {
      await sendPushNotificationToVendor(
        v._id.toString(),
        '📊 Daily Update',
        'Check your latest leads and views for today!',
        { type: 'daily_update' }
      );
    }

    console.log('✅ [Daily Notification] Sent to', vendors.length, 'vendors');
  } catch (error) {
    console.error('❌ Error sending daily notifications:', error);
  }
}

module.exports = {
  // New API
  sendPushNotificationToOwner,

  // Backwards-compatible names (existing callers keep working)
  sendPushNotificationToUser,
  sendPushNotificationToVendor,
  sendPushNotificationToVendors,

  sendDailyNotifications,
  getPushTokens,
};