// controllers/adController.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  Ad,
  Story,
  Highlight,
  Follow,
  UserStats,
  VendorStats,
  AdMessage,
  Conversation,
  Notification,
  Activity,
  SavedCollection,
  ReachAnalytics,
  Hashtag,
  UserInterest,
  IDENTITY_TYPES,
} = require('../models/Ad');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const {
  deleteFromR2,
  persistFile,
  publicUrl,
} = require('../config/multerR2');
const {
  processVideoFromFile,
  processVideoFromUrl,
} = require('../services/hlsService');
const {
  sendPushNotificationToOwner,
} = require('../services/notificationService');

// ═════════════════════════════════════════════════════════
// BOOT CHECK
// ═════════════════════════════════════════════════════════
console.log('══════════ CONTROLLER BOOT CHECK ══════════');
console.log('Ad          :', typeof Ad);
console.log('Follow      :', typeof Follow);
console.log('UserStats   :', typeof UserStats);
console.log('VendorStats :', typeof VendorStats);
console.log('Vendor      :', typeof Vendor);
console.log('User        :', typeof User);
console.log('Notification:', typeof Notification);
console.log('Conversation:', typeof Conversation);
console.log('════════════════════════════════════════════');

// ═════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const COMMENT_MAX_LENGTH = 1000;
const MESSAGE_MAX_LENGTH = 2000;
const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000;

// Map-bounds pins
const MAP_PIN_HARD_CAP = 50;
const MAP_BOUNDS_CACHE_TTL_MS = 20_000;
const MAP_BOUNDS_CACHE_MAX = 500;

// ✅ Slim owner payload — map only needs name + avatar
const MAP_OWNER_FIELDS_VENDOR = 'shopName name avatar logo shopImage';
const MAP_OWNER_FIELDS_USER = 'name avatar profilePic';

// Full payload — for feed/profile endpoints
const VENDOR_POPULATE_FIELDS =
  'name shopName phone address businessType shopImage averageRating reviewCount isOnline isVerified isPremium deliveryRange avatar logo profileImage username followersCount followingCount';
const USER_POPULATE_FIELDS = 'name avatar phone profilePic username';

// ═════════════════════════════════════════════════════════
// SAFE HELPERS
// ═════════════════════════════════════════════════════════
const toStr = (v) => (v == null ? '' : String(v));
const eqId = (a, b) => toStr(a) === toStr(b);
const isValidId = (id) => !!id && mongoose.Types.ObjectId.isValid(String(id));

const clampPagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE)
  );
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

const normalizePhone = (phone) => {
  if (!phone) return '';
  return String(phone).replace(/^\+91/, '').replace(/\D/g, '');
};

const isAdmin = (vendor) => {
  if (!vendor) return false;
  const phone = normalizePhone(vendor.phone);
  return (
    vendor.role === 'admin' ||
    vendor.role === 'suadmin' ||
    phone === '7893828468'
  );
};

const pickBestAvatar = (...candidates) => {
  let fallback = '';
  for (const c of candidates) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const s = c.trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (!fallback) fallback = s;
  }
  return fallback;
};

// ✅ Only https URLs are renderable
const isRenderableUrl = (u) =>
  typeof u === 'string' && /^https?:\/\//i.test(u) && u.length > 12;

// ✅ Rewrite a full-size thumb URL to a small thumb URL.
// Supports Cloudinary, Cloudflare Images, imgproxy. Falls back to
// the original URL when none match.
const toSmallThumbUrl = (url) => {
  if (!isRenderableUrl(url)) return '';
  try {
    // Cloudinary: /upload/xxx → /upload/w_120,h_120,c_fill,q_70/xxx
    if (url.includes('cloudinary.com') && url.includes('/upload/')) {
      if (/\/upload\/(w_\d+|c_fill)/.test(url)) return url; // already transformed
      return url.replace('/upload/', '/upload/w_120,h_120,c_fill,q_70/');
    }
    // Cloudflare Images: /imagedelivery.net/<account>/<id>/public → /.../w=120,h=120,fit=cover
    if (url.includes('imagedelivery.net')) {
      if (/\/w=\d+/.test(url)) return url;
      return url.replace(/\/[^/]+$/, '/w=120,h=120,fit=cover');
    }
    // imgproxy
    if (process.env.IMGPROXY_BASE) {
      return `${process.env.IMGPROXY_BASE}/rs:fill:120:120/plain/${encodeURIComponent(url)}`;
    }
    // R2 — assume publicUrl already serves from a path we can transform
    // via Cloudflare Polish / Image Resizing. Skip if no IMGPROXY.
    return url;
  } catch {
    return url;
  }
};

const fail = (res, err, fallback = 'Something went wrong') => {
  console.error('══════════ CONTROLLER ERROR ══════════');
  console.error('❌ name       :', err?.name);
  console.error('❌ message    :', err?.message);
  console.error('❌ code       :', err?.code);
  console.error('❌ statusCode :', err?.statusCode);
  console.error('❌ http_code  :', err?.http_code);

  if (err?.errors && typeof err.errors === 'object') {
    console.error('❌ Mongoose validation errors:');
    Object.keys(err.errors).forEach((key) => {
      console.error(`   → ${key}:`, err.errors[key]?.message);
    });
  }
  if (err?.name === 'CastError') {
    console.error('❌ CastError path:', err.path, 'value:', err.value);
  }
  if (err?.code === 11000) {
    console.error('❌ Duplicate key:', err.keyPattern, err.keyValue);
  }
  console.error('❌ stack      :');
  console.error(err?.stack);
  console.error('══════════════════════════════════════');

  const status = err?.statusCode || err?.http_code || 500;
  const message =
    typeof err?.message === 'string'
      ? err.message
      : err?.expose && typeof err.message === 'string'
      ? err.message
      : fallback;

  if (!res.headersSent) {
    res.status(status).json({ success: false, message });
  }
};

// ═════════════════════════════════════════════════════════
// IDENTITY RESOLUTION
// ═════════════════════════════════════════════════════════
const resolveIdentity = async (id, hintType) => {
  if (!isValidId(id)) return null;

  const tryVendor = async () => {
    const v = await Vendor.findById(id).select(
      'shopName name avatar logo shopImage profilePic username phone businessType isOnline followersCount followingCount'
    );
    const vs =
      (await VendorStats.findOne({
        identityId: id,
        identityType: 'Vendor',
      }).lean()) || (await VendorStats.findOne({ vendorId: id }).lean());
    if (!v && !vs) return null;
    const avatar = pickBestAvatar(
      v?.avatar,
      v?.logo,
      v?.shopImage,
      v?.profilePic,
      vs?.avatar,
      vs?.logo,
      vs?.shopImage
    );
    return {
      id: new mongoose.Types.ObjectId(id),
      type: 'Vendor',
      name: vs?.shopName || v?.shopName || vs?.name || v?.name || 'Vendor',
      username: vs?.username || v?.username || '',
      avatar,
      bio: vs?.bio || '',
      website: vs?.website || '',
      category: vs?.category || v?.businessType || '',
      phone: vs?.phone || v?.phone || '',
      isOnline: !!(vs?.isOnline || v?.isOnline),
      followersCount:
        (typeof vs?.followersCount === 'number' && vs.followersCount) ||
        (typeof v?.followersCount === 'number' && v.followersCount) ||
        0,
      followingCount:
        (typeof vs?.followingCount === 'number' && vs.followingCount) ||
        (typeof v?.followingCount === 'number' && v.followingCount) ||
        0,
    };
  };

  const tryUser = async () => {
    const u = await User.findById(id).select(
      'name avatar profilePic username phone followersCount followingCount'
    );
    const us =
      (await UserStats.findOne({
        identityId: id,
        identityType: 'User',
      }).lean()) || (await UserStats.findOne({ userId: id }).lean());
    if (!u && !us) return null;
    const avatar = pickBestAvatar(
      u?.profilePic,
      u?.avatar,
      us?.avatar,
      us?.profilePic
    );
    return {
      id: new mongoose.Types.ObjectId(id),
      type: 'User',
      name: us?.name || u?.name || 'User',
      username: us?.username || u?.username || '',
      avatar,
      bio: us?.bio || '',
      website: us?.website || '',
      category: us?.category || '',
      phone: us?.phone || u?.phone || '',
      isOnline: !!us?.isOnline,
      followersCount:
        (typeof us?.followersCount === 'number' && us.followersCount) ||
        (typeof u?.followersCount === 'number' && u.followersCount) ||
        0,
      followingCount:
        (typeof us?.followingCount === 'number' && us.followingCount) ||
        (typeof u?.followingCount === 'number' && u.followingCount) ||
        0,
    };
  };

  if (hintType === 'Vendor') return tryVendor();
  if (hintType === 'User') return tryUser();
  const v = await tryVendor();
  if (v) return v;
  return tryUser();
};
const getActor = (req) => {
  const vendorId = req.vendor?.vendorId;
  if (vendorId) return { id: vendorId, type: 'Vendor' };
  const userId = req.user?.userId || req.user?._id || req.user?.id;
  if (userId) return { id: userId, type: 'User' };
  return null;
};

const ownsAd = (req, ad) => {
  if (!ad) return false;
  const vendorId = req.vendor?.vendorId;
  const userId = req.user?.userId || req.user?._id || req.user?.id;
  if (vendorId && eqId(ad.vendorId, vendorId)) return true;
  if (userId && eqId(ad.userId, userId)) return true;
  if (ad.ownerId) {
    if (vendorId && eqId(ad.ownerId, vendorId)) return true;
    if (userId && eqId(ad.ownerId, userId)) return true;
  }
  return false;
};

const isAdminReq = (req) => isAdmin(req.vendor);

// ═════════════════════════════════════════════════════════
// DECORATION
// ═════════════════════════════════════════════════════════
const decorateAds = (ads, viewerId, viewerType) => {
  if (!Array.isArray(ads)) return [];
  const vId = toStr(viewerId);
  return ads.map((ad) => {
    const obj = ad?.toObject ? ad.toObject() : { ...(ad || {}) };
    if (vId) {
      obj.likedByMe = Array.isArray(obj.likes)
        ? obj.likes.some((l) => eqId(l?.identityId, vId))
        : false;
      obj.savedByMe = Array.isArray(obj.savedBy)
        ? obj.savedBy.some((s) => eqId(s?.identityId, vId))
        : false;
    } else {
      obj.likedByMe = false;
      obj.savedByMe = false;
    }
    delete obj.likes;
    delete obj.savedBy;
    if (!obj.ownerId && obj.vendorId) obj.ownerId = obj.vendorId;
    if (!obj.ownerId && obj.userId) obj.ownerId = obj.userId;
    if (!obj.ownerType) {
      obj.ownerType = obj.postType === 'vendor' ? 'Vendor' : 'User';
    }
    return obj;
  });
};

// ═════════════════════════════════════════════════════════
// STORAGE HELPERS
// ═════════════════════════════════════════════════════════
const writeBufferToTemp = async (buffer, filename) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-'));
  const filePath = path.join(tmpDir, filename || 'video.mp4');
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, tmpDir };
};

const cleanupTemp = async (tmpDir) => {
  try {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  } catch {}
};

const buildPosterFromVideo = (videoUrl) => {
  if (!videoUrl) return '';
  try {
    return videoUrl.replace(/-video\.mp4(\?.*)?$/, '-poster.jpg');
  } catch {
    return '';
  }
};

const resolveImageForVideo = (posterFile, bodyImage, videoUrl) => {
  if (posterFile?.path) return posterFile.path;
  if (bodyImage) return bodyImage;
  return buildPosterFromVideo(videoUrl);
};

// ═════════════════════════════════════════════════════════
// STATS HELPERS (unchanged)
// ═════════════════════════════════════════════════════════
const getOrCreateUserStats = async (userId, userInfo = {}) => {
  let stats = await UserStats.findOne({
    identityId: userId,
    identityType: 'User',
  });
  if (!stats) {
    stats = new UserStats({
      identityId: userId,
      identityType: 'User',
      name: userInfo.name || '',
      username: userInfo.username || '',
      bio: userInfo.bio || '',
      avatar: userInfo.avatar || userInfo.profilePic || '',
      phone: userInfo.phone || '',
      email: userInfo.email || '',
    });
    try {
      await stats.save();
    } catch (e) {
      if (e?.code === 11000) {
        stats = await UserStats.findOne({
          identityId: userId,
          identityType: 'User',
        });
      } else {
        throw e;
      }
    }
  }
  return stats;
};

const getOrCreateVendorStats = async (vendorId, vendorInfo = {}) => {
  let stats = await VendorStats.findOne({
    identityId: vendorId,
    identityType: 'Vendor',
  });
  if (!stats) {
    stats = new VendorStats({
      identityId: vendorId,
      identityType: 'Vendor',
      shopName: vendorInfo.shopName || vendorInfo.name || '',
      name: vendorInfo.name || vendorInfo.shopName || '',
      username: vendorInfo.username || '',
      bio: vendorInfo.bio || '',
      website: vendorInfo.website || '',
      avatar: pickBestAvatar(
        vendorInfo.avatar,
        vendorInfo.logo,
        vendorInfo.shopImage
      ),
      logo: vendorInfo.logo || '',
      shopImage: vendorInfo.shopImage || '',
      phone: vendorInfo.phone || '',
      email: vendorInfo.email || '',
      category: vendorInfo.businessType || vendorInfo.category || '',
      businessType: vendorInfo.businessType || vendorInfo.category || '',
      address: vendorInfo.address || {},
    });
    try {
      await stats.save();
    } catch (e) {
      if (e?.code === 11000) {
        stats = await VendorStats.findOne({
          identityId: vendorId,
          identityType: 'Vendor',
        });
      } else {
        throw e;
      }
    }
  }
  return stats;
};

const updateStats = async (id, type, updates = {}) => {
  if (!id || !type) return;
  const incFields = {};
  Object.keys(updates).forEach((key) => {
    if (typeof updates[key] === 'number' && updates[key] !== 0) {
      incFields[key] = updates[key];
    }
  });
  if (Object.keys(incFields).length === 0) return;

  const Model = type === 'Vendor' ? VendorStats : UserStats;

  try {
    await Model.findOneAndUpdate(
      { identityId: id, identityType: type },
      {
        $inc: incFields,
        $setOnInsert: { identityId: id, identityType: type },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.error('❌ updateStats failed:', e?.name, '-', e?.message);
  }
};

// ═════════════════════════════════════════════════════════
// REACH ANALYTICS
// ═════════════════════════════════════════════════════════
const updateReachAnalytics = async (adId, userId, updates = {}) => {
  if (!adId || !isValidId(userId)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const incFields = {};
  Object.keys(updates).forEach((key) => {
    if (typeof updates[key] === 'number' && updates[key] !== 0) {
      incFields[key] = updates[key];
    }
  });
  if (Object.keys(incFields).length === 0) return;
  try {
    await ReachAnalytics.findOneAndUpdate(
      { adId, userId, date: today },
      { $inc: incFields },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.error('❌ updateReachAnalytics failed:', e.message);
  }
};

const trackDemographics = async (adId, userId, ageGroup, gender) => {
  if (!adId || !isValidId(userId)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const update = {};
  if (
    ageGroup &&
    ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'].includes(ageGroup)
  ) {
    update[`demographics.ageGroups.${ageGroup}`] = 1;
  }
  if (gender && ['male', 'female', 'other'].includes(gender)) {
    update[`demographics.gender.${gender}`] = 1;
  }
  if (Object.keys(update).length === 0) return;
  try {
    await ReachAnalytics.findOneAndUpdate(
      { adId, userId, date: today },
      { $inc: update },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.error('❌ trackDemographics failed:', e.message);
  }
};

// ═════════════════════════════════════════════════════════
// HASHTAG HELPERS
// ═════════════════════════════════════════════════════════
const extractHashtags = (text) => {
  if (!text) return [];
  const hashtagRegex = /#[\w\u0590-\u05ff]+/g;
  const matches = String(text).match(hashtagRegex);
  return matches
    ? [...new Set(matches.map((tag) => tag.slice(1).toLowerCase()))]
    : [];
};

const updateHashtags = async (tags, increment = 1) => {
  if (!Array.isArray(tags) || tags.length === 0) return;
  const bulkOps = tags.map((tag) => ({
    updateOne: {
      filter: { tag: String(tag).toLowerCase() },
      update: {
        $inc: { postsCount: increment, reachCount: increment },
        $set: { lastUsedAt: new Date() },
      },
      upsert: true,
    },
  }));
  try {
    await Hashtag.bulkWrite(bulkOps, { ordered: false });
  } catch (e) {
    console.error('❌ updateHashtags failed:', e.message);
  }
};

// ═════════════════════════════════════════════════════════
// USER INTEREST HELPERS (unchanged)
// ═════════════════════════════════════════════════════════
const updateUserInterest = async (
  identityId,
  identityType,
  category,
  tags,
  interactedId,
  interactedType,
  contentType
) => {
  if (!identityId || !identityType) return;
  const query = { userId: identityId, userType: identityType };
  const setOnInsert = { userId: identityId, userType: identityType };
  try {
    if (category) {
      const bumped = await UserInterest.findOneAndUpdate(
        { ...query, 'categories.name': category },
        { $inc: { 'categories.$.score': 1 } },
        { new: true }
      );
      if (!bumped) {
        await UserInterest.findOneAndUpdate(
          query,
          {
            $push: { categories: { name: category, score: 1 } },
            $setOnInsert: setOnInsert,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
    }
    if (Array.isArray(tags) && tags.length > 0) {
      for (const rawTag of tags) {
        const tag = String(rawTag).toLowerCase();
        if (!tag) continue;
        const bumped = await UserInterest.findOneAndUpdate(
          { ...query, 'tags.name': tag },
          { $inc: { 'tags.$.score': 1 } },
          { new: true }
        );
        if (!bumped) {
          await UserInterest.findOneAndUpdate(
            query,
            {
              $push: { tags: { name: tag, score: 1 } },
              $setOnInsert: setOnInsert,
            },
            { upsert: true, setDefaultsOnInsert: true }
          );
        }
      }
    }
    if (interactedId && interactedType) {
      const bumped = await UserInterest.findOneAndUpdate(
        {
          ...query,
          interactedUsers: {
            $elemMatch: {
              identityId: interactedId,
              identityType: interactedType,
            },
          },
        },
        { $inc: { 'interactedUsers.$.score': 1 } },
        { new: true }
      );
      if (!bumped) {
        await UserInterest.findOneAndUpdate(
          query,
          {
            $push: {
              interactedUsers: {
                identityId: interactedId,
                identityType: interactedType,
                score: 1,
              },
            },
            $setOnInsert: setOnInsert,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
    }
    const typeMap = {
      image: 'image',
      video: 'video',
      reel: 'reel',
      carousel: 'carousel',
    };
    const contentPatch = {};
    if (contentType && typeMap[contentType]) {
      contentPatch[`contentTypes.${typeMap[contentType]}`] = 1;
    }
    await UserInterest.findOneAndUpdate(
      query,
      {
        $set: { lastUpdatedAt: new Date(), ...contentPatch },
        $setOnInsert: setOnInsert,
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.error('❌ updateUserInterest failed:', e.message);
  }
};

// ═════════════════════════════════════════════════════════
// MAP BOUNDS CACHE (LRU-ish)
// ═════════════════════════════════════════════════════════
const boundsCache = new Map(); // key -> { data, expiresAt }

const getCacheKey = (neLat, neLng, swLat, swLng) =>
  [
    neLat.toFixed(3),
    neLng.toFixed(3),
    swLat.toFixed(3),
    swLng.toFixed(3),
  ].join('|');

const cacheGet = (key) => {
  const entry = boundsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    boundsCache.delete(key);
    return null;
  }
  return entry.data;
};

const cacheSet = (key, data) => {
  boundsCache.set(key, {
    data,
    expiresAt: Date.now() + MAP_BOUNDS_CACHE_TTL_MS,
  });
  if (boundsCache.size > MAP_BOUNDS_CACHE_MAX) {
    const firstKey = boundsCache.keys().next().value;
    if (firstKey) boundsCache.delete(firstKey);
  }
};

// ═════════════════════════════════════════════════════════
// SERVER-SIDE GRID CLUSTERING
// Collapses nearby pins into one representative so 50 raw pins
// in a dense area become ~8–15 clustered pins for the frontend.
// ═════════════════════════════════════════════════════════
const CLUSTER_CELL_DEG = 0.002; // ~200m at equator

const clusterPins = (pins) => {
  if (!Array.isArray(pins) || pins.length <= 1) return pins;

  const buckets = new Map();
  for (const p of pins) {
    const cx = Math.floor(p.lng / CLUSTER_CELL_DEG);
    const cy = Math.floor(p.lat / CLUSTER_CELL_DEG);
    const key = `${cx}_${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }

  const clustered = [];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      clustered.push({ ...group[0], clusterCount: 1 });
      continue;
    }

    // Pick the newest as the visual representative
    const sorted = [...group].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const primary = sorted[0];

    // Average centroid
    const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
    const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;

    clustered.push({
      ...primary,
      lat,
      lng,
      clusterCount: group.length,
      childrenIds: group.map((p) => p._id),
    });
  }

  // Newest-first again after clustering
  clustered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return clustered;
};

// ═════════════════════════════════════════════════════════
// GET /ads/map/bounds
//
// Fixes applied here:
//   ✅ Fix 1 — thumb URL rewritten to ~120px via toSmallThumbUrl
//   ✅ Fix 2 — 15s Cache-Control + 20s server LRU cache
//   ✅ Fix 3 — slim owner payload (name + avatar only)
//   ✅ Fix 4 — server-side grid clustering
//   ✅ Fix 5 — while HLS is 'processing', don't send broken poster
//   ✅ Fix 7 — GeoJSON $geoWithin uses 2dsphere index
//   ✅ No placeholders: drop any pin with no media
// ═════════════════════════════════════════════════════════
exports.getStatusesInBounds = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { ne_lat, ne_lng, sw_lat, sw_lng, limit } = req.query;

    const neLat = parseFloat(ne_lat);
    const neLng = parseFloat(ne_lng);
    const swLat = parseFloat(sw_lat);
    const swLng = parseFloat(sw_lng);

    if ([neLat, neLng, swLat, swLng].some((n) => Number.isNaN(n))) {
      return res.status(400).json({
        success: false,
        message: 'ne_lat, ne_lng, sw_lat, sw_lng required',
      });
    }

    const cap = Math.min(
      MAP_PIN_HARD_CAP,
      Number(limit) > 0 ? Number(limit) : MAP_PIN_HARD_CAP
    );
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ✅ Server-side cache lookup (Fix 2)
    const cacheKey = getCacheKey(neLat, neLng, swLat, swLng);
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'private, max-age=15');
      res.set('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    // ✅ GeoJSON $geoWithin (uses 2dsphere index) — Fix 7
    const filter = {
      isActive: true,
      isDeleted: { $ne: true },
      mediaType: { $in: ['video', 'image'] },
      postKind: 'story',    
      createdAt: { $gte: since },
      'location.coordinates': {
        $geoWithin: {
          $box: [
            [swLng, swLat],
            [neLng, neLat],
          ],
        },
      },
    };

    // ✅ Slim select + slim owner populate (Fix 3)
    const ads = await Ad.find(filter)
      .select(
        'title image video hlsUrl thumbnail thumbnailSmall mediaType postKind ' +
          'location userId vendorId ownerId postType userName vendorName userAvatar ' +
          'likesCount viewsCount createdAt hlsStatus'
      )
      .populate('vendorId', MAP_OWNER_FIELDS_VENDOR)
      .populate('userId', MAP_OWNER_FIELDS_USER)
      .sort({ createdAt: -1 })
      .limit(cap * 4) // over-fetch so clustering can still hit `cap`
      .lean();

    // ✅ Build pins — drop any without real renderable media
    const rawPins = ads
      .map((ad) => {
        const isVendor = ad.postType === 'vendor';
        const owner = isVendor ? ad.vendorId : ad.userId;
        const ownerId =
          (isVendor ? ad.vendorId?._id : ad.userId?._id) ||
          ad.ownerId ||
          (isVendor ? ad.vendorId : ad.userId);

        // ✅ Fix 5: while HLS is processing, don't trust the guessed poster
        const hlsPending = ad.hlsStatus === 'processing';

        const candidateThumbRaw =
          ad.thumbnailSmall || ad.thumbnail || ad.image || '';
        const candidateThumb = hlsPending
          ? '' // don't send a poster that doesn't exist yet
          : toSmallThumbUrl(candidateThumbRaw);

        const candidateVideo = ad.hlsUrl || ad.video || '';

        const thumbOk = isRenderableUrl(candidateThumb);
        const videoOk = isRenderableUrl(candidateVideo);

        // ✅ No placeholders — drop the pin if it has nothing to render
        if (!thumbOk && !videoOk) return null;

        return {
          _id: String(ad._id),
          lat: ad.location?.latitude,
          lng: ad.location?.longitude,
          placeName: ad.location?.name || '',
          mediaType: ad.mediaType,
          thumb: thumbOk ? candidateThumb : '',
          hasHls: !!ad.hlsUrl && isRenderableUrl(ad.hlsUrl),
          video: videoOk && ad.video ? ad.video : '',
          hlsUrl: ad.hlsUrl && isRenderableUrl(ad.hlsUrl) ? ad.hlsUrl : '',
          postKind: ad.postKind,
          title: ad.title || '',
          likesCount: ad.likesCount || 0,
          viewsCount: ad.viewsCount || 0,
          createdAt: ad.createdAt,
          owner: {
            id: String(ownerId || ''),
            type: isVendor ? 'Vendor' : 'User',
            name:
              (isVendor ? ad.vendorName : ad.userName) ||
              owner?.shopName ||
              owner?.name ||
              'Someone',
            avatar:
              ad.userAvatar ||
              owner?.avatar ||
              owner?.logo ||
              owner?.shopImage ||
              owner?.profilePic ||
              '',
          },
        };
      })
      .filter((p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));

    // ✅ Cluster (Fix 4)
    const clustered = clusterPins(rawPins);

    // ✅ Apply hard cap AFTER clustering
    const finalPins = clustered.slice(0, cap);

    const payload = {
      success: true,
      count: finalPins.length,
      cap,
      raw: rawPins.length,
      data: finalPins,
      viewer: viewer ? { id: String(viewer.id), type: viewer.type } : null,
    };

    // ✅ Cache + headers (Fix 2)
    cacheSet(cacheKey, payload);
    res.set('Cache-Control', 'private, max-age=15');
    res.set('X-Cache', 'MISS');

    console.log(
      `📍 [map/bounds] ads=${ads.length} pins=${rawPins.length} ` +
        `clustered=${finalPins.length} cap=${cap}`
    );

    res.status(200).json(payload);
  } catch (err) {
    fail(res, err, 'Failed to load map statuses');
  }
};

// ═════════════════════════════════════════════════════════
// PUSH WRAPPERS
// ═════════════════════════════════════════════════════════
const sendPushToOwnerRole = async (ownerId, ownerRole, payload) => {
  if (!ownerId) return;
  try {
    await sendPushNotificationToOwner(
      String(ownerId),
      ownerRole || 'user',
      payload?.title || 'BLuxury',
      payload?.body || '',
      payload?.data || {}
    );
  } catch (e) {
    console.error('   ❌ push failed:', e?.message);
  }
};

// ═════════════════════════════════════════════════════════
// CREATE POST
// ✅ Fix 1: generate a small thumbnail at upload time
// ✅ Fix 5: don't set poster URL from video guess
// ═════════════════════════════════════════════════════════
exports.createAd = async (req, res) => {
  const TAG = '🟢[createAd]';
  const t0 = Date.now();

  let tmpDirForBg = null;
  let tempFilePathForBg = null;

  try {
    console.log(`\n${TAG} ══════════════════════════════════════════════════`);
    console.log(`${TAG} 🚀 START`);

    const mediaFile = req.files?.media?.[0];
    const posterFile = req.files?.poster?.[0];
    const smallFile = req.files?.thumbSmall?.[0];

    if (!mediaFile) {
      return res
        .status(400)
        .json({ success: false, message: 'Media file is required' });
    }

    const actor = getActor(req);
    if (!actor || !isValidId(actor.id)) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required to create a post' });
    }

    const {
      title,
      description,
      category,
      link,
      isActive,
      isProductAd,
      mediaType,
      postKind,
      tags,
      location,
      audio,
      collaborators,
      taggedUsers,
    } = req.body;

    const isVideo =
      mediaType === 'video' ||
      (mediaFile.mimetype && mediaFile.mimetype.startsWith('video/'));

    let videoUrl = '';
    let imageUrl = '';
    let thumbnailSmallUrl = '';
    let hlsUrl = '';

    if (isVideo) {
      const rawVideo = await persistFile(mediaFile, 'bluxury/ads/raw');
      videoUrl = rawVideo?.path || '';

      if (!videoUrl) {
        return res
          .status(500)
          .json({ success: false, message: 'Video upload failed' });
      }

      // ⚠️ We deliberately DON'T guess the poster URL here.
      // The HLS background job writes the real poster when done.

      const ext = (mediaFile.originalname || 'video.mp4')
        .split('.')
        .pop()
        .toLowerCase();
      const tmp = await writeBufferToTemp(
        mediaFile.buffer,
        `bg-${Date.now()}.${ext || 'mp4'}`
      );
      tmpDirForBg = tmp.tmpDir;
      tempFilePathForBg = tmp.filePath;
    } else {
      const persisted = await persistFile(mediaFile, 'bluxury/ads');
      imageUrl = persisted?.path || '';
    }

    if (posterFile) {
      const persistedPoster = await persistFile(
        posterFile,
        'bluxury/ads/posters'
      );
      if (persistedPoster?.path) imageUrl = persistedPoster.path;
    }

    // ✅ Fix 1: client can upload a small thumb separately (fast path)
    if (smallFile) {
      const persistedSmall = await persistFile(
        smallFile,
        'bluxury/ads/thumbs'
      );
      if (persistedSmall?.path) thumbnailSmallUrl = persistedSmall.path;
    }

    const postType = actor.type === 'Vendor' ? 'vendor' : 'user';
    const kind = postKind || 'post';
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = Array.isArray(tags) ? tags : JSON.parse(tags);
      } catch {
        parsedTags = [];
      }
    }
    const hashtagsFromText = extractHashtags(description || '');
    const allHashtags = [
      ...new Set([
        ...parsedTags.map((t) => String(t).toLowerCase()),
        ...hashtagsFromText,
      ]),
    ];

    let parsedLocation = {};
    let parsedAudio = {};
    let parsedCollaborators = [];
    let parsedTaggedUsers = [];
    try {
      parsedLocation = location
        ? typeof location === 'string'
          ? JSON.parse(location)
          : location
        : {};
    } catch {}
    try {
      parsedAudio = audio
        ? typeof audio === 'string'
          ? JSON.parse(audio)
          : audio
        : {};
    } catch {}
    try {
      parsedCollaborators = collaborators
        ? typeof collaborators === 'string'
          ? JSON.parse(collaborators)
          : collaborators
        : [];
    } catch {}
    try {
      parsedTaggedUsers = taggedUsers
        ? typeof taggedUsers === 'string'
          ? JSON.parse(taggedUsers)
          : taggedUsers
        : [];
    } catch {}

    let vendorId = null;
    let userId = null;
    let vendorName = '';
    let userName = '';
    let userAvatar = '';
    if (actor.type === 'Vendor') {
      vendorId = actor.id;
      const v = await Vendor.findById(actor.id).select(
        'shopName name shopImage logo avatar'
      );
      vendorName = v?.shopName || v?.name || 'Vendor';
    } else {
      userId = actor.id;
      const u = await User.findById(actor.id).select('name profilePic avatar');
      userName = u?.name || 'User';
      userAvatar = pickBestAvatar(u?.profilePic, u?.avatar);
    }

    const adPayload = {
      title: title || '',
      description: description || '',
      category: category || '',
      tags: allHashtags,
      image: imageUrl,
      video: videoUrl,
      hlsUrl,
      hlsStatus: isVideo ? 'processing' : 'none',
      thumbnail: imageUrl,
      thumbnailSmall: thumbnailSmallUrl,
      mediaType: isVideo ? 'video' : 'image',
      postKind: kind,
      isReel: kind === 'reel',
      isStory: kind === 'story',
      link: link || '',
      isActive: isActive !== undefined ? isActive === 'true' : true,
      isProductAd:
        isProductAd !== undefined ? isProductAd === 'true' : false,
      location: parsedLocation,
      audio: parsedAudio,
      collaborators: parsedCollaborators,
      taggedUsers: parsedTaggedUsers,
      postType,
      ownerId: actor.id,
      ...(vendorId && { vendorId, vendorName }),
      ...(userId && { userId, userName, userAvatar }),
    };

    const ad = new Ad(adPayload);
    const validationErr = ad.validateSync();
    if (validationErr) {
      if (tmpDirForBg) await cleanupTemp(tmpDirForBg);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.keys(validationErr.errors).reduce((acc, k) => {
          acc[k] = validationErr.errors[k]?.message;
          return acc;
        }, {}),
      });
    }

    await ad.save();
    console.log(`${TAG} ✅ Ad saved ${ad._id}`);

    try {
      await updateStats(actor.id, actor.type, {
        postsCount: 1,
        ...(kind === 'reel' && { reelsCount: 1 }),
      });
    } catch (e) {
      console.error(`${TAG} ⚠️ stats:`, e.message);
    }
    if (allHashtags.length > 0) {
      try {
        await updateHashtags(allHashtags, 1);
      } catch (e) {
        console.error(`${TAG} ⚠️ hashtags:`, e.message);
      }
    }
    if (category) {
      try {
        await updateUserInterest(
          actor.id,
          actor.type,
          category,
          allHashtags,
          null,
          null,
          isVideo ? 'video' : 'image'
        );
      } catch (e) {
        console.error(`${TAG} ⚠️ interest:`, e.message);
      }
    }

    const io = req.app.get('io');
    if (io) {
      try {
        io.emit('newPost', {
          postId: ad._id,
          userId: actor.id,
          userType: actor.type,
          postKind: kind,
        });
      } catch {}
    }

    if (isVideo && tempFilePathForBg && tmpDirForBg) {
      const adId = String(ad._id);
      const bgLocalPath = tempFilePathForBg;
      const bgTmpDir = tmpDirForBg;

      tmpDirForBg = null;
      tempFilePathForBg = null;

      setImmediate(async () => {
        const BG = '🎬[createAd:bg]';
        const bgT0 = Date.now();
        try {
          console.log(`${BG} starting HLS for ad ${adId}`);
          const hlsResult = await processVideoFromFile(
            bgLocalPath,
            'bluxury/ads/hls'
          );

          const patch = {
            hlsUrl: hlsResult.hlsUrl || '',
            hlsStatus: hlsResult.hlsUrl ? 'ready' : 'failed',
          };

          // ✅ Fix 5: only set poster AFTER HLS has generated the real file
          if (hlsResult.posterUrl) {
            patch.image = hlsResult.posterUrl;
            patch.thumbnail = hlsResult.posterUrl;
            patch.thumbnailSmall = toSmallThumbUrl(hlsResult.posterUrl);
          }

          await Ad.findByIdAndUpdate(adId, { $set: patch });
          console.log(
            `${BG} ✅ HLS done for ${adId} in ${Date.now() - bgT0}ms`
          );
        } catch (e) {
          console.error(`${BG} ❌ HLS failed for ${adId}:`, e?.message);
          try {
            await Ad.findByIdAndUpdate(adId, {
              $set: { hlsStatus: 'failed' },
            });
          } catch {}
        } finally {
          await cleanupTemp(bgTmpDir);
        }
      });
    }

    const populated = await Ad.findById(ad._id)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .lean();

    console.log(
      `${TAG} ✅ SUCCESS in ${Date.now() - t0}ms (HLS running in background)`
    );
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (tmpDirForBg) {
      await cleanupTemp(tmpDirForBg).catch(() => {});
    }
    console.error(`${TAG} ❌ FAILED:`, err?.message);
    fail(res, err, 'Failed to create post');
  }
};



// ═════════════════════════════════════════════════════════
// CREATE STORY
// ═════════════════════════════════════════════════════════
exports.createStory = async (req, res) => {
  const TAG = '🟣[createStory]';
  try {
    const { caption, adId, mediaType } = req.body;
    const mediaFile = req.files?.media?.[0];

    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Auth required' });
    }
    if (!mediaFile) {
      return res
        .status(400)
        .json({ success: false, message: 'Media is required' });
    }

    const profile = await resolveIdentity(actor.id, actor.type);
    const isVideo =
      mediaType === 'video' ||
      (mediaFile.mimetype && mediaFile.mimetype.startsWith('video/'));

    let media = '';
    let hlsUrl = '';
    let tmpDir = null;

    if (isVideo) {
      const ext = (mediaFile.originalname || 'video.mp4')
        .split('.')
        .pop()
        .toLowerCase();
      const tmp = await writeBufferToTemp(
        mediaFile.buffer,
        `story.${ext || 'mp4'}`
      );
      tmpDir = tmp.tmpDir;
      const { hlsUrl: hls, videoUrl: mp4 } = await processVideoFromFile(
        tmp.filePath,
        'bluxury/stories'
      );
      media = mp4;
      hlsUrl = hls;
    } else {
      const persisted = await persistFile(mediaFile, 'bluxury/stories');
      media = persisted?.path || '';
    }
    if (tmpDir) await cleanupTemp(tmpDir);

    const story = new Story({
      userId: actor.id,
      userType: actor.type,
      userName: profile?.name || 'Someone',
      userAvatar: profile?.avatar || '',
      media,
      mediaType: isVideo ? 'video' : 'image',
      caption: caption || '',
      adId: adId && isValidId(adId) ? adId : null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...(hlsUrl && { hlsUrl }),
    });
    await story.save();

    await updateStats(actor.id, actor.type, { storiesCount: 1 });

    const io = req.app.get('io');
    if (io) {
      io.emit('newStory', {
        storyId: story._id,
        userId: actor.id,
        userType: actor.type,
        userName: profile?.name || 'Someone',
      });
    }

    res.status(201).json({ success: true, data: story });
  } catch (err) {
    console.error(`${TAG} ❌`, err?.message);
    fail(res, err, 'Failed to create story');
  }
};

// ═════════════════════════════════════════════════════════
// FEED & LISTS
// ═════════════════════════════════════════════════════════
// controllers/adController.js — replace the getPersonalizedFeed export

exports.getPersonalizedFeed = async (req, res) => {
  const TAG = "📰[feed]";
  try {
    const viewer = getActor(req);
    const { page = 1, limit = 20, type } = req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);

    console.log(`${TAG} req`, {
      viewer: viewer ? `${viewer.type}:${viewer.id}` : "anon",
      page: pageNum,
      limit: limitNum,
      type: type || "all",
    });

    const userInterest = viewer
      ? await UserInterest.findOne({
          userId: viewer.id,
          userType: viewer.type,
        }).lean()
      : null;

    let followingVendorIds = [];
    let followingUserIds = [];
    if (viewer) {
      const follows = await Follow.find({
        followerId: viewer.id,
        followerType: viewer.type,
        status: "accepted",
      })
        .select("followingId followingType")
        .lean();
      follows.forEach((f) => {
        if (f.followingType === "Vendor") followingVendorIds.push(f.followingId);
        else followingUserIds.push(f.followingId);
      });
    }

    const baseFilter = {
      isActive: true,
      isDeleted: { $ne: true },
      postKind: type === "reel" ? "reel" : { $in: ["post", "reel"] },
    };

    // ✅ Use a literal Date instead of $$NOW (MongoDB 4.2+ only)
    const NOW = new Date();
    const interestNames =
      userInterest && Array.isArray(userInterest.categories)
        ? userInterest.categories.map((c) => c.name)
        : [];

    // ✅ Everything numeric is guarded with $ifNull so a missing
    //    createdAt / counter can't blow up the pipeline.
    const pipeline = [
      { $match: baseFilter },
      {
        $addFields: {
          __now: NOW,
          __createdAtSafe: { $ifNull: ["$createdAt", NOW] },
          __likes: { $ifNull: ["$likesCount", 0] },
          __comments: { $ifNull: ["$commentsCount", 0] },
          __shares: { $ifNull: ["$sharesCount", 0] },
          __saves: { $ifNull: ["$savesCount", 0] },
          __views: { $ifNull: ["$viewsCount", 0] },
        },
      },
      {
        $addFields: {
          engagementScore: {
            $add: [
              { $multiply: ["$__likes", 1] },
              { $multiply: ["$__comments", 2] },
              { $multiply: ["$__shares", 3] },
              { $multiply: ["$__saves", 2] },
              { $multiply: ["$__views", 0.1] },
            ],
          },
          daysSinceCreation: {
            $divide: [
              { $subtract: ["$__now", "$__createdAtSafe"] },
              1000 * 60 * 60 * 24,
            ],
          },
          isFollowing: {
            $cond: [
              {
                $or: [
                  { $in: ["$vendorId", followingVendorIds] },
                  { $in: ["$userId", followingUserIds] },
                ],
              },
              1.5,
              1.0,
            ],
          },
          interestMatch: {
            $cond: [
              interestNames.length > 0,
              {
                $cond: [
                  { $in: ["$category", interestNames] },
                  1.3,
                  1.0,
                ],
              },
              1.0,
            ],
          },
        },
      },
      {
        $addFields: {
          finalScore: {
            $multiply: [
              { $add: ["$engagementScore", 1] },
              {
                $divide: [
                  1,
                  { $add: [1, { $multiply: ["$daysSinceCreation", 0.1] }] },
                ],
              },
              "$isFollowing",
              "$interestMatch",
            ],
          },
        },
      },
      { $sort: { finalScore: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
    ];

    let ads;
    try {
      ads = await Ad.aggregate(pipeline);
    } catch (e) {
      console.error(`${TAG} ❌ aggregation failed`);
      console.error(`${TAG}    code     :`, e?.code);
      console.error(`${TAG}    codeName :`, e?.codeName);
      console.error(`${TAG}    message  :`, e?.message);
      console.error(`${TAG}    errInfo  :`, e?.errInfo);
      return res.status(500).json({
        success: false,
        message: `Feed aggregation failed: ${e?.message || "unknown"}`,
      });
    }

    const populatedAds = ads.length
      ? await Ad.populate(ads, [
          { path: "vendorId", select: VENDOR_POPULATE_FIELDS },
          { path: "userId", select: USER_POPULATE_FIELDS },
        ])
      : [];

    const total = await Ad.countDocuments(baseFilter);

    console.log(`${TAG} ok`, {
      returned: populatedAds.length,
      total,
    });

    res.status(200).json({
      success: true,
      data: decorateAds(populatedAds, viewer?.id, viewer?.type),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: skip + ads.length < total,
      },
    });
  } catch (err) {
    console.error(`${TAG} ❌ FATAL`);
    console.error(`${TAG}    name    :`, err?.name);
    console.error(`${TAG}    message :`, err?.message);
    console.error(`${TAG}    stack   :`, err?.stack);
    fail(res, err, "Failed to load feed");
  }
};

exports.getExploreFeed = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { page = 1, limit = 30 } = req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const filter = {
      isActive: true,
      isDeleted: { $ne: true },
      postKind: { $in: ['post', 'reel'] },
    };
    const [ads, total] = await Promise.all([
      Ad.find(filter)
        .populate('vendorId', VENDOR_POPULATE_FIELDS)
        .populate('userId', USER_POPULATE_FIELDS)
        .sort({ trendingScore: -1, engagementScore: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ad.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: decorateAds(ads, viewer?.id, viewer?.type),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: skip + ads.length < total,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load explore');
  }
};

exports.getAllAds = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { isActive, search, vendorId, userId, postType, postKind } = req.query;
    const filter = { isDeleted: { $ne: true } };
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (postType && ['user', 'vendor'].includes(postType))
      filter.postType = postType;
    if (postKind) filter.postKind = postKind;

    const orClauses = [];
    if (vendorId && isValidId(vendorId)) orClauses.push({ vendorId });
    if (userId && isValidId(userId)) orClauses.push({ userId });
    if (search && search.trim()) {
      const regex = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      orClauses.push(
        { title: regex },
        { description: regex },
        { category: regex },
        { tags: regex }
      );
    }
    if (orClauses.length) filter.$or = orClauses;

    const ads = await Ad.find(filter)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.status(200).json({
      success: true,
      data: decorateAds(ads, viewer?.id, viewer?.type),
    });
  } catch (err) {
    fail(res, err, 'Failed to load posts');
  }
};

exports.getActiveAds = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { search, vendorId, userId, sort, postType, postKind, page, limit } =
      req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const filter = { isActive: true, isDeleted: { $ne: true } };
    if (postType && ['user', 'vendor'].includes(postType))
      filter.postType = postType;
    if (postKind) filter.postKind = postKind;

    const orClauses = [];
    if (vendorId && isValidId(vendorId)) orClauses.push({ vendorId });
    if (userId && isValidId(userId)) orClauses.push({ userId });
    if (search && search.trim()) {
      const regex = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      orClauses.push(
        { title: regex },
        { description: regex },
        { category: regex },
        { tags: regex }
      );
    }
    if (orClauses.length) filter.$or = orClauses;

    const sortMap = {
      recent: { createdAt: -1 },
      trending: { trendingScore: -1, engagementScore: -1, createdAt: -1 },
      top: { likesCount: -1, createdAt: -1 },
      reach: { reachCount: -1, createdAt: -1 },
      engagement: { engagementScore: -1, createdAt: -1 },
    };
    const sortOrder = sortMap[sort] || sortMap.recent;

    const [ads, total] = await Promise.all([
      Ad.find(filter)
        .populate('vendorId', VENDOR_POPULATE_FIELDS)
        .populate('userId', USER_POPULATE_FIELDS)
        .sort(sortOrder)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ad.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: decorateAds(ads, viewer?.id, viewer?.type),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: skip + ads.length < total,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load active posts');
  }
};

exports.getMyPosts = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Auth required' });
    }
    const filter =
      actor.type === 'Vendor'
        ? { vendorId: actor.id, isDeleted: { $ne: true } }
        : { userId: actor.id, isDeleted: { $ne: true } };
    const ads = await Ad.find(filter)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({
      success: true,
      data: decorateAds(ads, actor.id, actor.type),
    });
  } catch (err) {
    fail(res, err, 'Failed to load your posts');
  }
};

exports.getPostsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid user id' });
    }
    const viewer = getActor(req);
    const target = await resolveIdentity(userId);
    if (!target) return res.status(200).json({ success: true, data: [] });
    const filter =
      target.type === 'Vendor'
        ? { vendorId: target.id, isActive: true, isDeleted: { $ne: true } }
        : { userId: target.id, isActive: true, isDeleted: { $ne: true } };
    const ads = await Ad.find(filter)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({
      success: true,
      data: decorateAds(ads, viewer?.id, viewer?.type),
    });
  } catch (err) {
    fail(res, err, 'Failed to load user posts');
  }
};

exports.getAdById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const ad = await Ad.findById(id)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .populate('comments.userId', 'name phone avatar profilePic')
      .populate('comments.replies.userId', 'name avatar profilePic')
      .lean();
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const viewer = getActor(req);
    res.status(200).json({
      success: true,
      data: decorateAds([ad], viewer?.id, viewer?.type)[0],
    });
  } catch (err) {
    fail(res, err, 'Failed to load post');
  }
};

exports.updateAd = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const {
      title,
      description,
      category,
      link,
      isActive,
      isProductAd,
      mediaType,
      postKind,
      tags,
      location,
      audio,
      commentsDisabled,
      hideLikeCount,
    } = req.body;

    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not allowed to edit this post' });
    }

    const oldTags = [...(ad.tags || [])];
    const mediaFile = req.files?.media?.[0];
    const posterFile = req.files?.poster?.[0];

    if (mediaFile) {
      const isVideo =
        mediaType === 'video' ||
        (mediaFile.mimetype && mediaFile.mimetype.startsWith('video/'));
      if (isVideo) {
        if (ad.video) await deleteFromR2(ad.video).catch(() => {});
        if (ad.hlsUrl) await deleteFromR2(ad.hlsUrl).catch(() => {});
        const ext = (mediaFile.originalname || 'video.mp4')
          .split('.')
          .pop()
          .toLowerCase();
        const tmp = await writeBufferToTemp(
          mediaFile.buffer,
          `update.${ext || 'mp4'}`
        );
        try {
          const { hlsUrl, videoUrl, posterUrl } = await processVideoFromFile(
            tmp.filePath,
            'bluxury/ads'
          );
          ad.video = videoUrl;
          ad.hlsUrl = hlsUrl;
          ad.hlsStatus = hlsUrl ? 'ready' : 'failed';
          ad.mediaType = 'video';
          if (posterUrl) {
            ad.image = posterUrl;
            ad.thumbnail = posterUrl;
          } else if (posterFile) {
            const p = await persistFile(posterFile, 'bluxury/ads/posters');
            ad.image = p?.path || ad.image;
            ad.thumbnail = ad.image;
          }
        } finally {
          await cleanupTemp(tmp.tmpDir);
        }
      } else {
        if (ad.image) await deleteFromR2(ad.image).catch(() => {});
        if (ad.video) await deleteFromR2(ad.video).catch(() => {});
        if (ad.hlsUrl) await deleteFromR2(ad.hlsUrl).catch(() => {});
        const persisted = await persistFile(mediaFile, 'bluxury/ads');
        ad.image = persisted?.path || '';
        ad.thumbnail = ad.image;
        ad.video = '';
        ad.hlsUrl = '';
        ad.hlsStatus = 'none';
        ad.mediaType = 'image';
      }
    } else if (posterFile && ad.mediaType === 'video') {
      if (ad.image) await deleteFromR2(ad.image).catch(() => {});
      const p = await persistFile(posterFile, 'bluxury/ads/posters');
      ad.image = p?.path || ad.image;
      ad.thumbnail = ad.image;
    }

    if (title !== undefined) ad.title = title;
    if (description !== undefined) {
      ad.description = description;
      const hashtagsFromText = extractHashtags(description);
      const currentTags = new Set(ad.tags || []);
      hashtagsFromText.forEach((t) => currentTags.add(t));
      ad.tags = Array.from(currentTags);
    }
    if (category !== undefined) ad.category = category;
    if (link !== undefined) ad.link = link;
    if (isActive !== undefined) ad.isActive = isActive === 'true';
    if (isProductAd !== undefined) ad.isProductAd = isProductAd === 'true';
    if (commentsDisabled !== undefined)
      ad.commentsDisabled = commentsDisabled === 'true';
    if (hideLikeCount !== undefined)
      ad.hideLikeCount = hideLikeCount === 'true';
    if (tags !== undefined) {
      let newTags = [];
      try {
        newTags = Array.isArray(tags) ? tags : JSON.parse(tags);
      } catch {
        newTags = [];
      }
      ad.tags = newTags.map((t) => String(t).toLowerCase());
    }
    if (location !== undefined)
      ad.location =
        typeof location === 'string' ? JSON.parse(location) : location;
    if (audio !== undefined)
      ad.audio = typeof audio === 'string' ? JSON.parse(audio) : audio;
    if (postKind !== undefined) {
      ad.postKind = postKind;
      ad.isReel = postKind === 'reel';
      ad.isStory = postKind === 'story';
    }

    await ad.save();

    const removedTags = oldTags.filter((t) => !(ad.tags || []).includes(t));
    const addedTags = (ad.tags || []).filter((t) => !oldTags.includes(t));
    if (removedTags.length > 0) await updateHashtags(removedTags, -1);
    if (addedTags.length > 0) await updateHashtags(addedTags, 1);

    const populated = await Ad.findById(ad._id)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .lean();

    res.status(200).json({ success: true, data: populated });
  } catch (err) {
    fail(res, err, 'Failed to update post');
  }
};

exports.deleteAd = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not allowed to delete this post' });
    }
    if (ad.image) await deleteFromR2(ad.image).catch(() => {});
    if (ad.video) await deleteFromR2(ad.video).catch(() => {});
    if (ad.hlsUrl) await deleteFromR2(ad.hlsUrl).catch(() => {});
    if (ad.tags && ad.tags.length > 0) await updateHashtags(ad.tags, -1);

    ad.isDeleted = true;
    ad.isActive = false;
    await ad.save();

    const owner = ad.ownerId
      ? { id: ad.ownerId, type: ad.postType === 'vendor' ? 'Vendor' : 'User' }
      : ad.vendorId
      ? { id: ad.vendorId, type: 'Vendor' }
      : ad.userId
      ? { id: ad.userId, type: 'User' }
      : null;
    if (owner) {
      await updateStats(owner.id, owner.type, {
        postsCount: -1,
        ...(ad.isReel && { reelsCount: -1 }),
      });
    }
    res.status(200).json({ success: true, message: 'Post deleted' });
  } catch (err) {
    fail(res, err, 'Failed to delete post');
  }
};

exports.toggleAdStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (isActive === undefined) {
      return res
        .status(400)
        .json({ success: false, message: 'isActive required' });
    }
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not allowed' });
    }
    ad.isActive = !!isActive;
    await ad.save();
    const populated = await Ad.findById(ad._id)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .lean();
    res.status(200).json({ success: true, data: populated });
  } catch (err) {
    fail(res, err, 'Failed to toggle post');
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required to like' });
    }
    const ad = await Ad.findById(id).select(
      'likes likesCount userId vendorId ownerId category tags mediaType postKind postType'
    );
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const alreadyLiked = (ad.likes || []).some((l) =>
      eqId(l?.identityId, actor.id)
    );
    const update = alreadyLiked
      ? {
          $pull: { likes: { identityId: actor.id } },
          $inc: { likesCount: -1 },
        }
      : {
          $addToSet: {
            likes: { identityId: actor.id, identityType: actor.type },
          },
          $inc: { likesCount: 1 },
        };
    const updated = await Ad.findByIdAndUpdate(id, update, {
      new: true,
      select: 'likesCount userId vendorId ownerId postType',
    });
    if (updated.likesCount < 0) {
      updated.likesCount = 0;
      await updated.save();
    }
    const ownerId = ad.ownerId || ad.vendorId || ad.userId;
    const ownerType = ad.postType === 'vendor' ? 'Vendor' : 'User';
    if (ownerId) {
      await updateStats(ownerId, ownerType, {
        totalLikesCount: alreadyLiked ? -1 : 1,
      });
    }
    if (!alreadyLiked) {
      await updateReachAnalytics(id, ownerId, { likes: 1 });
      if (ownerId && !eqId(ownerId, actor.id)) {
        const actorProfile = await resolveIdentity(actor.id, actor.type);
        if (ownerType === 'User') {
          try {
            await Notification.create({
              userId: ownerId,
              userType: 'User',
              type: 'like',
              actorId: actor.id,
              actorType: actor.type,
              actorName: actorProfile?.name || 'Someone',
              actorAvatar: actorProfile?.avatar || '',
              adId: id,
            });
          } catch (e) {
            console.error('❌ Notification.create like failed:', e.message);
          }
        }
        await sendPushToOwnerRole(
          ownerId,
          ownerType === 'Vendor' ? 'vendor' : 'user',
          {
            title: 'New like ❤️',
            body: `${actorProfile?.name || 'Someone'} liked your post`,
            data: { type: 'like', adId: String(id) },
          }
        );
      }
      if (ad.category) {
        await updateUserInterest(
          actor.id,
          actor.type,
          ad.category,
          ad.tags,
          ownerId,
          ownerType,
          ad.mediaType
        );
      }
    }
    const io = req.app.get('io');
    if (io) {
      io.emit('postLiked', {
        postId: id,
        userId: actor.id,
        userType: actor.type,
        liked: !alreadyLiked,
        likesCount: updated.likesCount,
      });
    }
    res.status(200).json({
      success: true,
      data: {
        adId: id,
        liked: !alreadyLiked,
        likesCount: updated.likesCount,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to toggle like');
  }
};

exports.toggleSave = async (req, res) => {
  try {
    const { id } = req.params;
    const { collectionId } = req.body;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required to save' });
    }
    const ad = await Ad.findById(id).select('savedBy savesCount');
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const alreadySaved = (ad.savedBy || []).some((s) =>
      eqId(s?.identityId, actor.id)
    );
    const update = alreadySaved
      ? {
          $pull: { savedBy: { identityId: actor.id } },
          $inc: { savesCount: -1 },
        }
      : {
          $addToSet: {
            savedBy: { identityId: actor.id, identityType: actor.type },
          },
          $inc: { savesCount: 1 },
        };
    const updated = await Ad.findByIdAndUpdate(id, update, {
      new: true,
      select: 'savedBy savesCount',
    });
    if (updated.savesCount < 0) {
      updated.savesCount = 0;
      await updated.save();
    }
    if (!alreadySaved && collectionId && isValidId(collectionId)) {
      await SavedCollection.findByIdAndUpdate(
        collectionId,
        { $addToSet: { posts: id }, $inc: { postsCount: 1 } },
        { new: true }
      );
    } else if (alreadySaved && collectionId && isValidId(collectionId)) {
      await SavedCollection.findByIdAndUpdate(
        collectionId,
        { $pull: { posts: id }, $inc: { postsCount: -1 } },
        { new: true }
      );
    }
    if (!alreadySaved) {
      await updateReachAnalytics(id, actor.id, { saves: 1 });
    }
    const io = req.app.get('io');
    if (io) {
      io.emit('postSaved', {
        postId: id,
        userId: actor.id,
        saved: !alreadySaved,
        savesCount: updated.savesCount,
      });
    }
    res.status(200).json({
      success: true,
      data: {
        adId: id,
        saved: !alreadySaved,
        savesCount: updated.savesCount,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to toggle save');
  }
};

exports.trackView = async (req, res) => {
  try {
    const { id } = req.params;
    const { ageGroup, gender, location, source } = req.body;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const actor = getActor(req);
    let alreadyCounted = false;
    if (actor) {
      try {
        const recent = await Activity.findOne({
          userId: actor.id,
          userType: actor.type,
          type: 'reel_watched',
          adId: id,
          createdAt: { $gte: new Date(Date.now() - VIEW_DEDUP_WINDOW_MS) },
        })
          .select('_id')
          .lean();
        alreadyCounted = !!recent;
      } catch (e) {
        console.error('❌ dedup check failed:', e.message);
      }
    }
    if (alreadyCounted) {
      const existing = await Ad.findById(id)
        .select('viewsCount reachCount impressionsCount')
        .lean();
      return res.status(200).json({
        success: true,
        data: {
          adId: id,
          viewsCount: existing?.viewsCount || 0,
          reachCount: existing?.reachCount || 0,
          impressionsCount: existing?.impressionsCount || 0,
          deduplicated: true,
        },
      });
    }
    const updated = await Ad.findByIdAndUpdate(
      id,
      { $inc: { viewsCount: 1, reachCount: 1, impressionsCount: 1 } },
      {
        new: true,
        select:
          'viewsCount reachCount impressionsCount userId vendorId ownerId postType',
      }
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const ownerId = updated.ownerId || updated.vendorId || updated.userId;
    const ownerType = updated.postType === 'vendor' ? 'Vendor' : 'User';
    if (ownerId) {
      await updateStats(ownerId, ownerType, {
        totalViewsCount: 1,
        viewsLast30Days: 1,
        reachLast30Days: 1,
      });
      await updateReachAnalytics(id, ownerId, { views: 1, impressions: 1 });
      if (ageGroup || gender) await trackDemographics(id, ownerId, ageGroup, gender);
      if (source) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sourceMap = {
          home: 'trafficSources.home',
          explore: 'trafficSources.explore',
          profile: 'trafficSources.profile',
          hashtags: 'trafficSources.hashtags',
          search: 'trafficSources.search',
        };
        if (sourceMap[source]) {
          try {
            await ReachAnalytics.findOneAndUpdate(
              { adId: id, userId: ownerId, date: today },
              { $inc: { [sourceMap[source]]: 1 } },
              { upsert: true, setDefaultsOnInsert: true }
            );
          } catch (e) {
            console.error('❌ trackView source failed:', e.message);
          }
        }
      }
    }
    if (actor) {
      try {
        await Activity.create({
          userId: actor.id,
          userType: actor.type,
          type: 'reel_watched',
          adId: id,
          metadata: { source, timestamp: new Date() },
        });
      } catch (e) {
        console.error('❌ Activity.create trackView failed:', e.message);
      }
    }
    res.status(200).json({
      success: true,
      data: {
        adId: id,
        viewsCount: updated.viewsCount,
        reachCount: updated.reachCount,
        impressionsCount: updated.impressionsCount,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to track view');
  }
};

exports.trackShare = async (req, res) => {
  try {
    const { id } = req.params;
    const { shareType } = req.body;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const updated = await Ad.findByIdAndUpdate(
      id,
      { $inc: { sharesCount: 1, reachCount: 1 } },
      {
        new: true,
        select: 'sharesCount reachCount userId vendorId ownerId postType',
      }
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const ownerId = updated.ownerId || updated.vendorId || updated.userId;
    const ownerType = updated.postType === 'vendor' ? 'Vendor' : 'User';
    if (ownerId) {
      await updateStats(ownerId, ownerType, { totalSharesCount: 1 });
      await updateReachAnalytics(id, ownerId, { shares: 1 });
    }
    const actor = getActor(req);
    if (actor) {
      try {
        await Activity.create({
          userId: actor.id,
          userType: actor.type,
          type: 'share',
          adId: id,
          metadata: { shareType },
        });
      } catch (e) {
        console.error('❌ Activity.create trackShare failed:', e.message);
      }
    }
    res.status(200).json({
      success: true,
      data: { adId: id, sharesCount: updated.sharesCount },
    });
  } catch (err) {
    fail(res, err, 'Failed to track share');
  }
};

exports.getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const ad = await Ad.findById(id).select('comments').lean();
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }

    const identityKeys = new Set();
    (ad.comments || []).forEach((c) => {
      if (c.userId) identityKeys.add(`${c.userType || 'User'}:${c.userId}`);
      (c.replies || []).forEach((r) => {
        if (r.userId) identityKeys.add(`${r.userType || 'User'}:${r.userId}`);
      });
    });

    const identityMap = {};
    await Promise.all(
      [...identityKeys].map(async (key) => {
        const [type, identId] = key.split(':');
        try {
          const identity = await resolveIdentity(identId, type);
          if (identity)
            identityMap[key] = {
              avatar: identity.avatar,
              name: identity.name,
            };
        } catch (e) {}
      })
    );

    const actor = getActor(req);
    let comments = [...(ad.comments || [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((c) => {
        const obj = { ...c };
        const key = `${obj.userType || 'User'}:${obj.userId}`;
        const fresh = identityMap[key];
        if (fresh) {
          obj.userAvatar = pickBestAvatar(fresh.avatar, obj.userAvatar);
          obj.userName = fresh.name || obj.userName;
        }
        obj.likedByMe = actor
          ? (obj.likes || []).some((l) => eqId(l?.identityId, actor.id))
          : false;
        delete obj.likes;

        if (Array.isArray(obj.replies)) {
          obj.replies = obj.replies.map((r) => {
            const rKey = `${r.userType || 'User'}:${r.userId}`;
            const rFresh = identityMap[rKey];
            return rFresh
              ? {
                  ...r,
                  userAvatar: pickBestAvatar(rFresh.avatar, r.userAvatar),
                  userName: rFresh.name || r.userName,
                }
              : r;
          });
        }
        return obj;
      });

    if (before) {
      const cutoff = new Date(before);
      comments = comments.filter((c) => new Date(c.createdAt) < cutoff);
    }
    comments = comments.slice(0, Number(limit));

    res.status(200).json({
      success: true,
      data: comments,
      count: ad.comments.length,
    });
  } catch (err) {
    fail(res, err, 'Failed to load comments');
  }
};
exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, parentId } = req.body;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required to comment' });
    }
    if (!text || !text.trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'Comment text is required' });
    }
    if (text.length > COMMENT_MAX_LENGTH) {
      return res
        .status(400)
        .json({ success: false, message: 'Comment too long' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (ad.commentsDisabled) {
      return res
        .status(403)
        .json({ success: false, message: 'Comments are disabled' });
    }
    const profile = await resolveIdentity(actor.id, actor.type);
    const comment = {
      userId: actor.id,
      userType: actor.type,
      userName: profile?.name || 'Someone',
      userAvatar: profile?.avatar || '',
      text: text.trim(),
      likes: [],
      likesCount: 0,
      parentId: parentId || null,
    };
    ad.comments.push(comment);
    ad.commentsCount = ad.comments.length;
    await ad.save();

    const ownerId = ad.ownerId || ad.vendorId || ad.userId;
    const ownerType = ad.postType === 'vendor' ? 'Vendor' : 'User';
    if (ownerId) {
      await updateStats(ownerId, ownerType, { totalCommentsCount: 1 });
      await updateReachAnalytics(id, ownerId, { comments: 1 });
    }
    if (ad.category) {
      await updateUserInterest(
        actor.id,
        actor.type,
        ad.category,
        ad.tags,
        ownerId,
        ownerType,
        ad.mediaType
      );
    }
    if (ownerId && !eqId(ownerId, actor.id)) {
      if (ownerType === 'User') {
        try {
          await Notification.create({
            userId: ownerId,
            userType: 'User',
            type: 'comment',
            actorId: actor.id,
            actorType: actor.type,
            actorName: profile?.name || 'Someone',
            actorAvatar: profile?.avatar || '',
            adId: id,
            text: text.trim().slice(0, 100),
          });
        } catch (e) {
          console.error('❌ Notification.create comment failed:', e.message);
        }
      }
      await sendPushToOwnerRole(
        ownerId,
        ownerType === 'Vendor' ? 'vendor' : 'user',
        {
          title: 'New comment 💬',
          body: `${profile?.name || 'Someone'}: ${text.trim().slice(0, 80)}`,
          data: { type: 'comment', adId: String(id) },
        }
      );
    }
    try {
      await Activity.create({
        userId: actor.id,
        userType: actor.type,
        type: 'commented',
        adId: id,
        targetId: ownerId,
        targetType: ownerType,
      });
    } catch (e) {
      console.error('❌ Activity.create comment failed:', e.message);
    }
    const saved = ad.comments[ad.comments.length - 1];
    const savedObj = saved.toObject();
    savedObj.likedByMe = false;
    delete savedObj.likes;
    const io = req.app.get('io');
    if (io) {
      io.emit('newComment', {
        postId: id,
        comment: savedObj,
        commentsCount: ad.commentsCount,
      });
    }
    res.status(201).json({
      success: true,
      data: savedObj,
      commentsCount: ad.commentsCount,
    });
  } catch (err) {
    fail(res, err, 'Failed to add comment');
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    if (!isValidId(id) || !isValidId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const comment = ad.comments.id(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: 'Comment not found' });
    }
    const isOwnComment = eqId(comment.userId, actor.id);
    const canManagePost = ownsAd(req, ad) || isAdminReq(req);
    if (!isOwnComment && !canManagePost) {
      return res
        .status(403)
        .json({ success: false, message: 'Not allowed' });
    }
    ad.comments = ad.comments.filter(
      (c) => !eqId(c._id, commentId) && !eqId(c.parentId, commentId)
    );
    ad.commentsCount = ad.comments.length;
    await ad.save();
    const ownerId = ad.ownerId || ad.vendorId || ad.userId;
    const ownerType = ad.postType === 'vendor' ? 'Vendor' : 'User';
    if (ownerId) {
      await updateStats(ownerId, ownerType, { totalCommentsCount: -1 });
    }
    const io = req.app.get('io');
    if (io) {
      io.emit('commentDeleted', {
        postId: id,
        commentId,
        commentsCount: ad.commentsCount,
      });
    }
    res.status(200).json({
      success: true,
      message: 'Comment deleted',
      commentsCount: ad.commentsCount,
    });
  } catch (err) {
    fail(res, err, 'Failed to delete comment');
  }
};

exports.toggleCommentLike = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    if (!isValidId(id) || !isValidId(commentId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    const comment = ad.comments.id(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: 'Comment not found' });
    }
    const alreadyLiked = (comment.likes || []).some((l) =>
      eqId(l?.identityId, actor.id)
    );
    if (alreadyLiked) {
      comment.likes = comment.likes.filter(
        (l) => !eqId(l?.identityId, actor.id)
      );
    } else {
      comment.likes.push({
        identityId: actor.id,
        identityType: actor.type,
      });
    }
    comment.likesCount = comment.likes.length;
    await ad.save();
    res.status(200).json({
      success: true,
      data: {
        commentId,
        liked: !alreadyLiked,
        likesCount: comment.likesCount,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to like comment');
  }
};

exports.getReachAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { period = '30d' } = req.query;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid post id' });
    }
    const ad = await Ad.findById(id).lean();
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    const startDate = new Date();
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const analytics = await ReachAnalytics.find({
      adId: id,
      date: { $gte: startDate },
    })
      .sort({ date: 1 })
      .lean();
    const totals = analytics.reduce(
      (acc, day) => ({
        views: acc.views + (day.views || 0),
        uniqueViews: acc.uniqueViews + (day.uniqueViews || 0),
        reach: acc.reach + (day.reach || 0),
        impressions: acc.impressions + (day.impressions || 0),
        likes: acc.likes + (day.likes || 0),
        comments: acc.comments + (day.comments || 0),
        shares: acc.shares + (day.shares || 0),
        saves: acc.saves + (day.saves || 0),
        profileVisits: acc.profileVisits + (day.profileVisits || 0),
        followerGrowth: acc.followerGrowth + (day.followerGrowth || 0),
      }),
      {
        views: 0,
        uniqueViews: 0,
        reach: 0,
        impressions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        profileVisits: 0,
        followerGrowth: 0,
      }
    );
    const demographics = {
      ageGroups: {},
      gender: { male: 0, female: 0, other: 0 },
      topLocations: {},
    };
    analytics.forEach((day) => {
      if (day.demographics) {
        Object.entries(day.demographics.ageGroups || {}).forEach(
          ([key, val]) => {
            demographics.ageGroups[key] =
              (demographics.ageGroups[key] || 0) + (val || 0);
          }
        );
        Object.entries(day.demographics.gender || {}).forEach(
          ([key, val]) => {
            demographics.gender[key] =
              (demographics.gender[key] || 0) + (val || 0);
          }
        );
        (day.demographics.topLocations || []).forEach((loc) => {
          demographics.topLocations[loc.name] =
            (demographics.topLocations[loc.name] || 0) + (loc.count || 0);
        });
      }
    });
    demographics.topLocations = Object.entries(demographics.topLocations)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const trafficSources = analytics.reduce(
      (acc, day) => {
        if (day.trafficSources) {
          acc.home += day.trafficSources.home || 0;
          acc.explore += day.trafficSources.explore || 0;
          acc.profile += day.trafficSources.profile || 0;
          acc.hashtags += day.trafficSources.hashtags || 0;
          acc.search += day.trafficSources.search || 0;
          acc.other += day.trafficSources.other || 0;
        }
        return acc;
      },
      { home: 0, explore: 0, profile: 0, hashtags: 0, search: 0, other: 0 }
    );
    res.status(200).json({
      success: true,
      data: {
        adId: id,
        period,
        totals,
        demographics,
        trafficSources,
        dailyData: analytics,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load analytics');
  }
};

exports.getUserReachAnalytics = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { period = '30d' } = req.query;
    const startDate = new Date();
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const analytics = await ReachAnalytics.find({
      userId: actor.id,
      userType: actor.type,
      date: { $gte: startDate },
    })
      .sort({ date: 1 })
      .lean();
    const totals = analytics.reduce(
      (acc, day) => ({
        views: acc.views + (day.views || 0),
        reach: acc.reach + (day.reach || 0),
        impressions: acc.impressions + (day.impressions || 0),
        likes: acc.likes + (day.likes || 0),
        comments: acc.comments + (day.comments || 0),
        shares: acc.shares + (day.shares || 0),
        saves: acc.saves + (day.saves || 0),
        profileVisits: acc.profileVisits + (day.profileVisits || 0),
        followerGrowth: acc.followerGrowth + (day.followerGrowth || 0),
      }),
      {
        views: 0,
        reach: 0,
        impressions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        profileVisits: 0,
        followerGrowth: 0,
      }
    );
    const dailyMap = {};
    analytics.forEach((day) => {
      const key = day.date.toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = {
          views: 0,
          reach: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
        };
      }
      dailyMap[key].views += day.views || 0;
      dailyMap[key].reach += day.reach || 0;
      dailyMap[key].likes += day.likes || 0;
      dailyMap[key].comments += day.comments || 0;
      dailyMap[key].shares += day.shares || 0;
      dailyMap[key].saves += day.saves || 0;
    });
    res.status(200).json({
      success: true,
      data: {
        period,
        totals,
        dailyData: Object.entries(dailyMap).map(([date, data]) => ({
          date,
          ...data,
        })),
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load analytics');
  }
};

exports.getActiveStories = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { limit = 50 } = req.query;
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
      isHighlight: false,
    })
      .sort({ createdAt: -1 })
      .limit(Math.min(100, Number(limit) || 50))
      .lean();
    const grouped = {};
    stories.forEach((story) => {
      const uid = toStr(story.userId);
      if (!grouped[uid]) {
        grouped[uid] = {
          userId: uid,
          userType: story.userType || 'User',
          userName: story.userName || 'Someone',
          userAvatar: story.userAvatar || '',
          stories: [],
          hasUnseen: false,
        };
      }
      const hasSeen = viewer
        ? (story.viewers || []).some((v) => eqId(v?.identityId, viewer.id))
        : false;
      grouped[uid].stories.push({ ...story, hasSeen });
      if (!hasSeen) grouped[uid].hasUnseen = true;
    });
    const result = Object.values(grouped).sort(
      (a, b) => (b.hasUnseen ? 1 : 0) - (a.hasUnseen ? 1 : 0)
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    fail(res, err, 'Failed to load stories');
  }
};

exports.getMyStories = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const stories = await Story.find({
      userId: actor.id,
      userType: actor.type,
      expiresAt: { $gt: new Date() },
      isHighlight: false,
    })
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: stories });
  } catch (err) {
    fail(res, err, 'Failed to load your stories');
  }
};

exports.getStoriesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const stories = await Story.find({
      userId,
      expiresAt: { $gt: new Date() },
      isHighlight: false,
    })
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: stories });
  } catch (err) {
    fail(res, err, 'Failed to load stories');
  }
};

exports.viewStory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid story id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const story = await Story.findById(id);
    if (!story) {
      return res
        .status(404)
        .json({ success: false, message: 'Story not found' });
    }
    const alreadyViewed = (story.viewers || []).some((v) =>
      eqId(v?.identityId, actor.id)
    );
    if (!alreadyViewed) {
      story.viewers.push({
        identityId: actor.id,
        identityType: actor.type,
      });
      story.viewersCount = story.viewers.length;
      await story.save();
      await updateStats(story.userId, story.userType || 'User', {
        totalViewsCount: 1,
      });
      if (!eqId(story.userId, actor.id)) {
        const actorProfile = await resolveIdentity(actor.id, actor.type);
        try {
          await Notification.create({
            userId: story.userId,
            userType: story.userType || 'User',
            type: 'story_view',
            actorId: actor.id,
            actorType: actor.type,
            actorName: actorProfile?.name || 'Someone',
            actorAvatar: actorProfile?.avatar || '',
            storyId: id,
          });
        } catch (e) {
          console.error('❌ Notification.create viewStory failed:', e.message);
        }
      }
    }
    res.status(200).json({
      success: true,
      data: { storyId: id, viewersCount: story.viewersCount },
    });
  } catch (err) {
    fail(res, err, 'Failed to view story');
  }
};

exports.reactToStory = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid story id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const story = await Story.findById(id);
    if (!story) {
      return res
        .status(404)
        .json({ success: false, message: 'Story not found' });
    }
    story.reactions = (story.reactions || []).filter(
      (r) => !eqId(r?.identityId, actor.id)
    );
    story.reactions.push({
      identityId: actor.id,
      identityType: actor.type,
      emoji: emoji || '❤️',
    });
    await story.save();
    if (!eqId(story.userId, actor.id)) {
      const actorProfile = await resolveIdentity(actor.id, actor.type);
      try {
        await Notification.create({
          userId: story.userId,
          userType: story.userType || 'User',
          type: 'story_reaction',
          actorId: actor.id,
          actorType: actor.type,
          actorName: actorProfile?.name || 'Someone',
          actorAvatar: actorProfile?.avatar || '',
          storyId: id,
          text: emoji || '❤️',
        });
      } catch (e) {
        console.error('❌ Notification.create reactToStory failed:', e.message);
      }
      await sendPushToOwnerRole(
        story.userId,
        (story.userType || 'User') === 'Vendor' ? 'vendor' : 'user',
        {
          title: 'Story reaction',
          body: `${actorProfile?.name || 'Someone'} reacted ${
            emoji || '❤️'
          } to your story`,
          data: { type: 'story_reaction', storyId: String(id) },
        }
      );
    }
    res.status(200).json({ success: true, data: story });
  } catch (err) {
    fail(res, err, 'Failed to react to story');
  }
};

exports.deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid story id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const story = await Story.findById(id);
    if (!story) {
      return res
        .status(404)
        .json({ success: false, message: 'Story not found' });
    }
    if (!eqId(story.userId, actor.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    if (story.media) await deleteFromR2(story.media).catch(() => {});
    if (story.hlsUrl) await deleteFromR2(story.hlsUrl).catch(() => {});
    await Story.findByIdAndDelete(id);
    await updateStats(actor.id, actor.type, { storiesCount: -1 });
    res.status(200).json({ success: true, message: 'Story deleted' });
  } catch (err) {
    fail(res, err, 'Failed to delete story');
  }
};

exports.toggleFollow = async (req, res) => {
  try {
    const { userId: targetId } = req.params;
    if (!isValidId(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid target id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    if (eqId(actor.id, targetId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Cannot follow yourself' });
    }
    const [target, follower] = await Promise.all([
      resolveIdentity(targetId),
      resolveIdentity(actor.id, actor.type),
    ]);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: 'Target not found' });
    }
    if (!follower) {
      return res
        .status(404)
        .json({ success: false, message: 'Follower not found' });
    }
    const existing = await Follow.findOne({
      followerId: actor.id,
      followerType: actor.type,
      followingId: target.id,
      followingType: target.type,
    });
    if (existing) {
      await Follow.findByIdAndDelete(existing._id);
      await Promise.all([
        updateStats(actor.id, actor.type, { followingCount: -1 }),
        updateStats(target.id, target.type, { followersCount: -1 }),
      ]);
      try {
        await Notification.deleteMany({
          userId: target.id,
          userType: target.type,
          type: 'follow',
          actorId: actor.id,
          actorType: actor.type,
        });
      } catch (e) {
        console.error('❌ Notification.deleteMany:', e?.message);
      }
      const io = req.app.get('io');
      if (io) {
        io.to(toStr(target.id)).emit('unfollowed', {
          userId: actor.id,
          userType: actor.type,
          userName: follower.name,
        });
      }
      return res.status(200).json({
        success: true,
        data: { following: false, message: 'Unfollowed' },
      });
    }
    const follow = new Follow({
      followerId: actor.id,
      followerType: actor.type,
      followerName: follower.name,
      followerAvatar: follower.avatar,
      followingId: target.id,
      followingType: target.type,
      followingName: target.name,
      followingAvatar: target.avatar,
      status: 'accepted',
    });
    await follow.save();
    await Promise.all([
      updateStats(actor.id, actor.type, { followingCount: 1 }),
      updateStats(target.id, target.type, { followersCount: 1 }),
    ]);
    if (target.type === 'User') {
      try {
        await Notification.create({
          userId: target.id,
          userType: 'User',
          type: 'follow',
          actorId: actor.id,
          actorType: actor.type,
          actorName: follower.name,
          actorAvatar: follower.avatar,
        });
      } catch (e) {
        console.error('❌ Notification.create:', e?.message);
      }
    }
    await sendPushToOwnerRole(
      target.id,
      target.type === 'Vendor' ? 'vendor' : 'user',
      {
        title: 'New follower 👤',
        body: `${follower.name} started following you`,
        data: { type: 'follow', actorId: String(actor.id) },
      }
    );
    await updateUserInterest(
      actor.id,
      actor.type,
      null,
      null,
      target.id,
      target.type,
      null
    );
    const io = req.app.get('io');
    if (io) {
      io.to(toStr(target.id)).emit('newFollower', {
        userId: actor.id,
        userType: actor.type,
        userName: follower.name,
        userAvatar: follower.avatar,
      });
    }
    res.status(200).json({
      success: true,
      data: { following: true, message: 'Following' },
    });
  } catch (err) {
    console.error('❌ TOGGLE FOLLOW:', err?.name, '-', err?.message);
    fail(res, err, 'Failed to toggle follow');
  }
};

exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const target = await resolveIdentity(userId);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: 'Profile not found' });
    }
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const query = {
      followingId: userId,
      followingType: target.type,
      status: 'accepted',
    };
    const [follows, total] = await Promise.all([
      Follow.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Follow.countDocuments(query),
    ]);
    const viewer = getActor(req);
    let followingSet = new Set();
    if (viewer) {
      const mine = await Follow.find({
        followerId: viewer.id,
        followerType: viewer.type,
      })
        .select('followingId followingType')
        .lean();
      mine.forEach((f) =>
        followingSet.add(`${f.followingType}:${f.followingId}`)
      );
    }
    const data = (
      await Promise.all(
        follows.map(async (f) => {
          const identity = await resolveIdentity(f.followerId, f.followerType);
          if (!identity) return null;
          return {
            _id: identity.id,
            name: f.followerName || identity.name,
            avatar: pickBestAvatar(f.followerAvatar, identity.avatar),
            username: identity.username,
            type: identity.type,
            isFollowing: followingSet.has(`${identity.type}:${identity.id}`),
            followedAt: f.createdAt,
          };
        })
      )
    ).filter(Boolean);
    res.status(200).json({
      success: true,
      data,
      pagination: { page: pageNum, limit: limitNum, total },
    });
  } catch (err) {
    fail(res, err, 'Failed to load followers');
  }
};

exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const target = await resolveIdentity(userId);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: 'Profile not found' });
    }
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const query = {
      followerId: userId,
      followerType: target.type,
      status: 'accepted',
    };
    const [follows, total] = await Promise.all([
      Follow.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Follow.countDocuments(query),
    ]);
    const data = (
      await Promise.all(
        follows.map(async (f) => {
          const identity = await resolveIdentity(f.followingId, f.followingType);
          if (!identity) return null;
          return {
            _id: identity.id,
            name: f.followingName || identity.name,
            avatar: pickBestAvatar(f.followingAvatar, identity.avatar),
            username: identity.username,
            type: identity.type,
            isFollowing: true,
            followedAt: f.createdAt,
          };
        })
      )
    ).filter(Boolean);
    res.status(200).json({
      success: true,
      data,
      pagination: { page: pageNum, limit: limitNum, total },
    });
  } catch (err) {
    fail(res, err, 'Failed to load following');
  }
};

exports.checkFollowing = async (req, res) => {
  try {
    const { userId: targetId } = req.params;
    if (!isValidId(targetId)) {
      return res.status(200).json({ success: true, data: { following: false } });
    }
    const actor = getActor(req);
    if (!actor) {
      return res.status(200).json({ success: true, data: { following: false } });
    }
    const target = await resolveIdentity(targetId);
    if (!target) {
      return res.status(200).json({ success: true, data: { following: false } });
    }
    const existing = await Follow.findOne({
      followerId: actor.id,
      followerType: actor.type,
      followingId: target.id,
      followingType: target.type,
    });
    res.status(200).json({
      success: true,
      data: { following: !!existing },
    });
  } catch (err) {
    fail(res, err, 'Failed to check following');
  }
};

exports.getSuggestedUsers = async (req, res) => {
  try {
    const viewer = getActor(req);
    const { limit = 20 } = req.query;
    const cap = Math.min(50, Number(limit) || 20);
    let excludeIds = [];
    if (viewer) {
      const following = await Follow.find({
        followerId: viewer.id,
        followerType: viewer.type,
      })
        .select('followingId')
        .lean();
      excludeIds = following.map((f) => f.followingId);
      excludeIds.push(viewer.id);
    }
    const excludeObjectIds = excludeIds
      .filter((id) => isValidId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const vendors = await Vendor.find({ _id: { $nin: excludeObjectIds } })
      .select(
        'shopName name avatar logo shopImage followersCount isOnline username phone'
      )
      .sort({ followersCount: -1 })
      .limit(cap)
      .lean();
    const topStats = await UserStats.find({ userId: { $nin: excludeObjectIds } })
      .sort({ followersCount: -1 })
      .limit(cap)
      .lean();
    const users = await User.find({
      _id: { $in: topStats.map((s) => s.userId) },
    })
      .select('name avatar profilePic username phone')
      .lean();
    const userMap = {};
    users.forEach((u) => (userMap[toStr(u._id)] = u));
    const userRows = topStats
      .map((s) => {
        const u = userMap[toStr(s.userId)];
        if (!u) return null;
        return {
          _id: u._id,
          name: u.name,
          avatar: pickBestAvatar(u.profilePic, u.avatar),
          username: u.username,
          phone: u.phone || '',
          followersCount: s.followersCount,
          type: 'User',
          isFollowing: false,
        };
      })
      .filter(Boolean);
    const vendorRows = vendors.map((v) => ({
      _id: v._id,
      name: v.shopName || v.name || 'Vendor',
      avatar: pickBestAvatar(v.avatar, v.logo, v.shopImage),
      username: v.username,
      phone: v.phone || '',
      followersCount: v.followersCount || 0,
      isOnline: v.isOnline || false,
      type: 'Vendor',
      isFollowing: false,
    }));
    const combined = [...vendorRows, ...userRows]
      .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))
      .slice(0, cap);
    res.status(200).json({ success: true, data: combined });
  } catch (err) {
    fail(res, err, 'Failed to load suggestions');
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const target = await resolveIdentity(userId);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: 'Profile not found' });
    }

    /* Pull the freshest live avatar straight from the source model */
    let liveAvatar = '';
    if (target.type === 'Vendor') {
      const v = await Vendor.findById(target.id).select(
        'avatar logo shopImage profilePic'
      );
      liveAvatar = pickBestAvatar(
        v?.avatar,
        v?.logo,
        v?.shopImage,
        v?.profilePic
      );
    } else {
      const u = await User.findById(target.id).select('avatar profilePic');
      liveAvatar = pickBestAvatar(u?.profilePic, u?.avatar);
    }

    let stats;
    if (target.type === 'Vendor') {
      stats = await getOrCreateVendorStats(target.id, {
        shopName: target.name,
        avatar: liveAvatar || target.avatar,
        username: target.username,
        bio: target.bio,
        website: target.website,
        category: target.category,
        phone: target.phone,
      });
    } else {
      stats = await getOrCreateUserStats(target.id, {
        name: target.name,
        avatar: liveAvatar || target.avatar,
        username: target.username,
        bio: target.bio,
        website: target.website,
        phone: target.phone,
      });
    }

    const postFilter =
      target.type === 'Vendor'
        ? { vendorId: target.id }
        : { userId: target.id };

    const [posts, reels] = await Promise.all([
      Ad.countDocuments({
        ...postFilter,
        isActive: true,
        isDeleted: { $ne: true },
        postKind: 'post',
      }),
      Ad.countDocuments({
        ...postFilter,
        isActive: true,
        isDeleted: { $ne: true },
        postKind: 'reel',
      }),
    ]);

    const viewer = getActor(req);
    let isFollowing = false;
    let isMe = false;
    if (viewer) {
      isMe = eqId(viewer.id, target.id);
      if (!isMe) {
        const f = await Follow.findOne({
          followerId: viewer.id,
          followerType: viewer.type,
          followingId: target.id,
          followingType: target.type,
        });
        isFollowing = !!f;
        try {
          await Activity.create({
            userId: viewer.id,
            userType: viewer.type,
            type: 'profile_visited',
            targetId: target.id,
            targetType: target.type,
            targetName: target.name,
            targetAvatar: target.avatar,
          });
        } catch (e) {
          console.error('❌ Activity profile visit:', e.message);
        }
      }
    }

    const statsObj = stats.toObject();

    res.status(200).json({
      success: true,
      data: {
        ...statsObj,
        postsCount: posts,
        reelsCount: reels,
        avatar: pickBestAvatar(
          liveAvatar,
          statsObj.avatar,
          target.avatar,
          statsObj.logo,
          statsObj.shopImage
        ),
        name: statsObj.shopName || statsObj.name || target.name,
        user: {
          _id: target.id,
          name: target.name,
          username: target.username,
          avatar: pickBestAvatar(liveAvatar, target.avatar, statsObj.avatar),
          type: target.type,
        },
        isFollowing,
        isMe,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load profile');
  }
};
exports.updateUserStats = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }

    const {
      name,
      username,
      bio,
      website,
      avatar,
      phone,
      email,
      isPrivate,
      isBusiness,
      category,
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = String(name);
    if (username !== undefined)
      updates.username = String(username).toLowerCase();
    if (bio !== undefined) updates.bio = String(bio);
    if (website !== undefined) updates.website = String(website);
    if (avatar !== undefined && typeof avatar === 'string') {
      const trimmed = avatar.trim();
      if (!trimmed || /^https?:\/\//i.test(trimmed)) {
        updates.avatar = trimmed;
      }
    }
    if (phone !== undefined) updates.phone = String(phone);
    if (email !== undefined) updates.email = String(email);
    if (isPrivate !== undefined)
      updates.isPrivate = isPrivate === true || isPrivate === 'true';
    if (isBusiness !== undefined)
      updates.isBusiness = isBusiness === true || isBusiness === 'true';
    if (category !== undefined) updates.category = String(category);

    if (updates.avatar === undefined) {
      try {
        if (actor.type === 'Vendor') {
          const v = await Vendor.findById(actor.id).select(
            'avatar logo shopImage profilePic'
          );
          const fresh = pickBestAvatar(
            v?.avatar,
            v?.logo,
            v?.shopImage,
            v?.profilePic
          );
          if (fresh) updates.avatar = fresh;
        } else {
          const u = await User.findById(actor.id).select('avatar profilePic');
          const fresh = pickBestAvatar(u?.profilePic, u?.avatar);
          if (fresh) updates.avatar = fresh;
        }
      } catch (e) {
        console.warn('[updateUserStats] avatar sync skipped:', e?.message);
      }
    }

    const Model = actor.type === 'Vendor' ? VendorStats : UserStats;

    const stats = await Model.findOneAndUpdate(
      { identityId: actor.id, identityType: actor.type },
      {
        $set: updates,
        $setOnInsert: { identityId: actor.id, identityType: actor.type },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log('✅ [updateUserStats]', {
      identityId: String(actor.id),
      identityType: actor.type,
      fields: Object.keys(updates),
      avatarSynced: !!updates.avatar,
    });

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ [updateUserStats]', err?.name, '-', err?.message);
    fail(res, err, 'Failed to update stats');
  }
};

exports.getUserDashboard = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const stats =
      actor.type === 'Vendor'
        ? await getOrCreateVendorStats(actor.id)
        : await getOrCreateUserStats(actor.id);
    const postFilter =
      actor.type === 'Vendor'
        ? { vendorId: actor.id }
        : { userId: actor.id };
    const recentPosts = await Ad.find({
      ...postFilter,
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select(
        'title image viewsCount likesCount commentsCount sharesCount reachCount engagementScore trendingScore createdAt'
      )
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const analytics = await ReachAnalytics.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(actor.id),
          userType: actor.type,
          date: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$views' },
          totalReach: { $sum: '$reach' },
          totalLikes: { $sum: '$likes' },
          totalComments: { $sum: '$comments' },
          totalShares: { $sum: '$shares' },
          totalSaves: { $sum: '$saves' },
          totalProfileVisits: { $sum: '$profileVisits' },
          totalFollowerGrowth: { $sum: '$followerGrowth' },
        },
      },
    ]);
    const analytics30Days = analytics[0] || {
      totalViews: 0,
      totalReach: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      totalProfileVisits: 0,
      totalFollowerGrowth: 0,
    };
    res.status(200).json({
      success: true,
      data: { stats, recentPosts, analytics30Days },
    });
  } catch (err) {
    fail(res, err, 'Failed to load dashboard');
  }
};

exports.getHighlights = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const target = await resolveIdentity(userId);
    const userType = target?.type || 'User';
    const highlights = await Highlight.find({ userId, userType })
      .populate('stories')
      .sort({ order: 1, createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: highlights });
  } catch (err) {
    fail(res, err, 'Failed to load highlights');
  }
};

exports.createHighlight = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { name, coverImage, storyIds } = req.body;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: 'Name required' });
    }
    const highlight = new Highlight({
      userId: actor.id,
      userType: actor.type,
      name,
      coverImage: coverImage || '',
      stories: Array.isArray(storyIds) ? storyIds : [],
      storiesCount: (storyIds || []).length,
    });
    await highlight.save();
    await updateStats(actor.id, actor.type, { highlightsCount: 1 });
    res.status(201).json({ success: true, data: highlight });
  } catch (err) {
    fail(res, err, 'Failed to create highlight');
  }
};

exports.deleteHighlight = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const highlight = await Highlight.findById(id);
    if (!highlight) {
      return res
        .status(404)
        .json({ success: false, message: 'Highlight not found' });
    }
    if (!eqId(highlight.userId, actor.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    await Highlight.findByIdAndDelete(id);
    await updateStats(actor.id, actor.type, { highlightsCount: -1 });
    res.status(200).json({ success: true, message: 'Highlight deleted' });
  } catch (err) {
    fail(res, err, 'Failed to delete highlight');
  }
};

exports.getConversations = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const conversations = await Conversation.find({
      'participants.identityId': actor.id,
      'participants.identityType': actor.type,
    })
      .sort({ isPinned: -1, lastMessageAt: -1 })
      .limit(50)
      .lean();

    const otherKeys = new Set();
    conversations.forEach((c) => {
      const other = c.participants.find(
        (p) => !(eqId(p.identityId, actor.id) && p.identityType === actor.type)
      );
      if (other) otherKeys.add(`${other.identityType}:${other.identityId}`);
    });

    const avatarMap = {};
    await Promise.all(
      [...otherKeys].map(async (key) => {
        const [type, id] = key.split(':');
        try {
          const identity = await resolveIdentity(id, type);
          if (identity?.avatar) avatarMap[key] = identity.avatar;
        } catch (e) {}
      })
    );

    const data = conversations.map((c) => {
      const other = c.participants.find(
        (p) => !(eqId(p.identityId, actor.id) && p.identityType === actor.type)
      );
      const unread = c.unreadCounts?.find(
        (u) => eqId(u.identityId, actor.id) && u.identityType === actor.type
      );
      const otherKey = other
        ? `${other.identityType}:${other.identityId}`
        : null;
      const freshAvatar = otherKey
        ? pickBestAvatar(avatarMap[otherKey], other.avatar)
        : c.groupAvatar;

      return {
        _id: c._id,
        participant: other
          ? {
              userId: other.identityId,
              userType: other.identityType,
              name: other.name,
              avatar: freshAvatar,
              phone: other.phone || '',
            }
          : {
              userId: null,
              userType: null,
              name: c.groupName,
              avatar: c.groupAvatar,
              phone: '',
            },
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        unreadCount: unread?.count || 0,
        isGroup: c.isGroup,
        isPinned: c.isPinned,
        isMuted: c.isMuted,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    fail(res, err, 'Failed to load conversations');
  }
};

exports.getOrCreateConversation = async (req, res) => {
  try {
    const { targetUserId, targetUserType } = req.body;
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    if (!targetUserId || !isValidId(targetUserId)) {
      return res
        .status(400)
        .json({ success: false, message: 'targetUserId required' });
    }
    const target = await resolveIdentity(targetUserId, targetUserType);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: 'Target not found' });
    }
    let conversation = await Conversation.findOne({
      isGroup: false,
      $expr: { $eq: [{ $size: '$participants' }, 2] },
      participants: {
        $all: [
          {
            $elemMatch: {
              identityId: actor.id,
              identityType: actor.type,
            },
          },
          {
            $elemMatch: {
              identityId: target.id,
              identityType: target.type,
            },
          },
        ],
      },
    });
    if (conversation) {
      return res.status(200).json({ success: true, data: conversation });
    }
    const actorProfile = await resolveIdentity(actor.id, actor.type);
    conversation = new Conversation({
      participants: [
        {
          identityId: actor.id,
          identityType: actor.type,
          name: actorProfile?.name || 'User',
          avatar: actorProfile?.avatar || '',
          phone: actorProfile?.phone || '',
        },
        {
          identityId: target.id,
          identityType: target.type,
          name: target.name,
          avatar: target.avatar,
          phone: target.phone || '',
        },
      ],
      unreadCounts: [
        { identityId: actor.id, identityType: actor.type, count: 0 },
        { identityId: target.id, identityType: target.type, count: 0 },
      ],
    });
    await conversation.save();
    res.status(201).json({ success: true, data: conversation });
  } catch (err) {
    fail(res, err, 'Failed to open conversation');
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    if (!isValidId(conversationId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid conversation id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res
        .status(404)
        .json({ success: false, message: 'Conversation not found' });
    }
    const isParticipant = conversation.participants.some(
      (p) => eqId(p.identityId, actor.id) && p.identityType === actor.type
    );
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const messages = await AdMessage.find({
      conversationId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const senderKeys = new Set(
      messages.map((m) => `${m.senderType}:${m.senderId}`)
    );
    const identityMap = {};
    await Promise.all(
      [...senderKeys].map(async (key) => {
        const [type, id] = key.split(':');
        try {
          const identity = await resolveIdentity(id, type);
          if (identity)
            identityMap[key] = {
              avatar: identity.avatar,
              name: identity.name,
            };
        } catch (e) {}
      })
    );

    const enriched = messages.map((m) => {
      const key = `${m.senderType}:${m.senderId}`;
      const fresh = identityMap[key];
      return {
        ...m,
        senderAvatar: pickBestAvatar(fresh?.avatar, m.senderAvatar),
        senderName: fresh?.name || m.senderName,
      };
    });

    await AdMessage.updateMany(
      {
        conversationId,
        receiverId: actor.id,
        receiverType: actor.type,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );
    await Conversation.updateOne(
      {
        _id: conversationId,
        unreadCounts: {
          $elemMatch: {
            identityId: actor.id,
            identityType: actor.type,
          },
        },
      },
      { $set: { 'unreadCounts.$.count': 0 } }
    );

    res.status(200).json({
      success: true,
      data: enriched.reverse(),
      pagination: { page: pageNum, limit: limitNum },
    });
  } catch (err) {
    fail(res, err, 'Failed to load messages');
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const {
      conversationId,
      text,
      receiverId,
      receiverType,
      media,
      mediaType,
      sharedAdId,
    } = req.body;
    const mediaFile = req.files?.media?.[0];
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    let convo = null;
    if (conversationId && isValidId(conversationId)) {
      convo = await Conversation.findById(conversationId);
    } else if (receiverId && isValidId(receiverId)) {
      const target = await resolveIdentity(receiverId, receiverType);
      if (!target) {
        return res
          .status(404)
          .json({ success: false, message: 'Receiver not found' });
      }
      convo = await Conversation.findOne({
        isGroup: false,
        $expr: { $eq: [{ $size: '$participants' }, 2] },
        participants: {
          $all: [
            {
              $elemMatch: {
                identityId: actor.id,
                identityType: actor.type,
              },
            },
            {
              $elemMatch: {
                identityId: target.id,
                identityType: target.type,
              },
            },
          ],
        },
      });
      if (!convo) {
        const actorProfile = await resolveIdentity(actor.id, actor.type);
        convo = new Conversation({
          participants: [
            {
              identityId: actor.id,
              identityType: actor.type,
              name: actorProfile?.name || 'User',
              avatar: actorProfile?.avatar || '',
              phone: actorProfile?.phone || '',
            },
            {
              identityId: target.id,
              identityType: target.type,
              name: target.name,
              avatar: target.avatar,
              phone: target.phone || '',
            },
          ],
          unreadCounts: [
            { identityId: actor.id, identityType: actor.type, count: 0 },
            { identityId: target.id, identityType: target.type, count: 0 },
          ],
        });
        await convo.save();
      }
    }
    if (!convo) {
      return res
        .status(404)
        .json({ success: false, message: 'Conversation not found' });
    }
    const actorProfile = await resolveIdentity(actor.id, actor.type);
    const other = convo.participants.find(
      (p) => !eqId(p.identityId, actor.id) || p.identityType !== actor.type
    );
    if (!other) {
      return res
        .status(400)
        .json({ success: false, message: 'No receiver' });
    }
    if (text && String(text).length > MESSAGE_MAX_LENGTH) {
      return res
        .status(400)
        .json({ success: false, message: 'Message too long' });
    }
    let uploadedMediaUrl = media || '';
    let uploadedMediaType = mediaType || 'none';
    if (mediaFile) {
      const persisted = await persistFile(mediaFile, 'bluxury/messages');
      uploadedMediaUrl = persisted?.path || '';
      uploadedMediaType = (mediaFile.mimetype || '').startsWith('video/')
        ? 'video'
        : 'image';
    }
    const message = new AdMessage({
      conversationId: convo._id,
      senderId: actor.id,
      senderType: actor.type,
      senderName: actorProfile?.name || 'User',
      senderAvatar: actorProfile?.avatar || '',
      receiverId: other.identityId,
      receiverType: other.identityType,
      text: text || '',
      media: uploadedMediaUrl,
      mediaType: uploadedMediaType,
      sharedAdId: sharedAdId && isValidId(sharedAdId) ? sharedAdId : null,
    });
    await message.save();
    convo.lastMessage = {
      text: text || (mediaFile ? '📷 Media' : ''),
      senderId: actor.id,
      senderType: actor.type,
      senderName: actorProfile?.name || 'User',
      createdAt: new Date(),
      mediaType: message.mediaType,
    };
    convo.lastMessageAt = new Date();
    const unreadIdx = convo.unreadCounts.findIndex(
      (u) =>
        eqId(u.identityId, other.identityId) &&
        u.identityType === other.identityType
    );
    if (unreadIdx !== -1) {
      convo.unreadCounts[unreadIdx].count += 1;
    } else {
      convo.unreadCounts.push({
        identityId: other.identityId,
        identityType: other.identityType,
        count: 1,
      });
    }
    await convo.save();
    if (other.identityType === 'User') {
      try {
        await Notification.create({
          userId: other.identityId,
          userType: 'User',
          type: 'message',
          actorId: actor.id,
          actorType: actor.type,
          actorName: actorProfile?.name || 'User',
          actorAvatar: actorProfile?.avatar || '',
          conversationId: convo._id,
          messageId: message._id,
          text: (text || '📷 Media').slice(0, 100),
        });
      } catch (e) {
        console.error('❌ Notification.create message failed:', e.message);
      }
    }
    await sendPushToOwnerRole(
      other.identityId,
      other.identityType === 'Vendor' ? 'vendor' : 'user',
      {
        title: actorProfile?.name || 'New message',
        body: text || (mediaFile ? '📷 Media' : 'New message'),
        data: {
          type: 'chat',
          conversationId: String(convo._id),
          messageId: String(message._id),
          senderId: String(actor.id),
          senderName: actorProfile?.name || 'User',
          senderType: actor.type,
        },
      }
    );
    const io = req.app.get('io');
    if (io) {
      io.to(toStr(other.identityId)).emit('newMessage', {
        conversationId: convo._id,
        message: message.toObject(),
      });
    }
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    fail(res, err, 'Failed to send message');
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid message id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const message = await AdMessage.findById(id);
    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: 'Message not found' });
    }
    if (!eqId(message.senderId, actor.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    message.isDeleted = true;
    message.text = 'This message was deleted';
    message.media = '';
    await message.save();
    const io = req.app.get('io');
    if (io) {
      io.to(toStr(message.receiverId)).emit('messageDeleted', {
        messageId: id,
        conversationId: message.conversationId,
      });
    }
    res.status(200).json({ success: true, message: 'Message deleted' });
  } catch (err) {
    fail(res, err, 'Failed to delete message');
  }
};

exports.searchIdentities = async (req, res) => {
  try {
    const { q, limit = 30 } = req.query;
    if (!q || !String(q).trim()) {
      return res.status(200).json({ success: true, data: [] });
    }
    const raw = String(q).trim();
    const phoneDigits = raw.replace(/^\+91/, '').replace(/\D/g, '');
    const isPhoneQuery =
      phoneDigits.length >= 6 && /^[0-9+\-() ]+$/.test(raw);
    const cap = Math.min(50, Number(limit) || 30);
    const safeQ = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safeQ, 'i');
    const orUser = [{ name: regex }, { username: regex }, { email: regex }];
    const orVendor = [
      { shopName: regex },
      { name: regex },
      { ownerName: regex },
      { username: regex },
      { email: regex },
    ];
    if (phoneDigits) {
      orUser.push({ phone: { $regex: phoneDigits, $options: 'i' } });
      orVendor.push({ phone: { $regex: phoneDigits, $options: 'i' } });
    }
    const [users, vendors] = await Promise.all([
      User.find({ $or: orUser })
        .select('name username avatar profilePic phone email')
        .limit(cap)
        .lean(),
      Vendor.find({ $or: orVendor })
        .select(
          'shopName name ownerName username avatar logo shopImage profileImage profilePic phone email'
        )
        .limit(cap)
        .lean(),
    ]);
    const userRows = users.map((u) => ({
      _id: String(u._id),
      name: u.name || 'User',
      username: u.username || '',
      avatar: pickBestAvatar(u.avatar, u.profilePic),
      phone: u.phone || '',
      type: 'User',
    }));
    const vendorRows = vendors.map((v) => ({
      _id: String(v._id),
      name: v.shopName || v.name || v.ownerName || 'Vendor',
      username: v.username || '',
      avatar: pickBestAvatar(
        v.avatar,
        v.logo,
        v.shopImage,
        v.profileImage,
        v.profilePic
      ),
      phone: v.phone || '',
      type: 'Vendor',
    }));
    let combined = [...vendorRows, ...userRows];
    if (isPhoneQuery && phoneDigits) {
      combined = combined.filter((row) => {
        const d = String(row.phone || '')
          .replace(/^\+91/, '')
          .replace(/\D/g, '');
        return d.includes(phoneDigits);
      });
    }
    res.status(200).json({ success: true, data: combined.slice(0, cap) });
  } catch (err) {
    console.error('❌ searchIdentities failed:', err?.message);
    fail(res, err, 'Search failed');
  }
};

exports.resolveIdentities = async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(200).json({ success: true, data: {} });
    }
    const clean = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => String(id))
      .slice(0, 100);
    if (clean.length === 0) {
      return res.status(200).json({ success: true, data: {} });
    }
    const [users, vendors] = await Promise.all([
      User.find({ _id: { $in: clean } })
        .select('name username avatar profilePic phone')
        .lean(),
      Vendor.find({ _id: { $in: clean } })
        .select(
          'shopName name ownerName username avatar logo shopImage profileImage profilePic phone businessType'
        )
        .lean(),
    ]);
    const out = {};
    users.forEach((u) => {
      out[String(u._id)] = {
        _id: String(u._id),
        name: u.name || 'User',
        username: u.username || '',
        avatar: pickBestAvatar(u.avatar, u.profilePic),
        phone: u.phone || '',
        type: 'User',
      };
    });
    vendors.forEach((v) => {
      out[String(v._id)] = {
        _id: String(v._id),
        name: v.shopName || v.name || v.ownerName || 'Vendor',
        username: v.username || '',
        avatar: pickBestAvatar(
          v.avatar,
          v.logo,
          v.shopImage,
          v.profileImage,
          v.profilePic
        ),
        phone: v.phone || '',
        type: 'Vendor',
      };
    });
    res.status(200).json({ success: true, data: out });
  } catch (err) {
    console.error('❌ resolveIdentities failed:', err?.message);
    fail(res, err, 'Resolve failed');
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { page = 1, limit = 50 } = req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: actor.id, userType: actor.type })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments({
        userId: actor.id,
        userType: actor.type,
        isRead: false,
      }),
    ]);

    const actorKeys = new Set(
      notifications
        .filter((n) => n.actorId)
        .map((n) => `${n.actorType || 'User'}:${n.actorId}`)
    );
    const identityMap = {};
    await Promise.all(
      [...actorKeys].map(async (key) => {
        const [type, id] = key.split(':');
        try {
          const identity = await resolveIdentity(id, type);
          if (identity)
            identityMap[key] = {
              avatar: identity.avatar,
              name: identity.name,
            };
        } catch (e) {}
      })
    );

    const data = notifications.map((n) => {
      if (!n.actorId) return n;
      const key = `${n.actorType || 'User'}:${n.actorId}`;
      const fresh = identityMap[key];
      if (!fresh) return n;
      return {
        ...n,
        actorAvatar: pickBestAvatar(fresh.avatar, n.actorAvatar),
        actorName: fresh.name || n.actorName,
      };
    });

    res.status(200).json({
      success: true,
      data,
      unreadCount,
    });
  } catch (err) {
    fail(res, err, 'Failed to load notifications');
  }
};
exports.markNotificationsRead = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { notificationIds } = req.body;
    const filter = {
      userId: actor.id,
      userType: actor.type,
      isRead: false,
    };
    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      filter._id = { $in: notificationIds };
    }
    await Notification.updateMany(filter, {
      $set: { isRead: true, isSeen: true },
    });
    res.status(200).json({ success: true, message: 'Marked as read' });
  } catch (err) {
    fail(res, err, 'Failed to mark notifications');
  }
};

exports.getActivity = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { page = 1, limit = 50, type } = req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const filter = { userId: actor.id, userType: actor.type };
    if (type) filter.type = type;
    const activities = await Activity.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();
    res.status(200).json({ success: true, data: activities });
  } catch (err) {
    fail(res, err, 'Failed to load activity');
  }
};

exports.logActivity = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { type, adId, targetUserId, targetUserType, metadata } = req.body;
    let targetName = '';
    let targetAvatar = '';
    if (targetUserId && isValidId(targetUserId)) {
      const t = await resolveIdentity(targetUserId, targetUserType);
      targetName = t?.name || '';
      targetAvatar = t?.avatar || '';
    }
    const activity = new Activity({
      userId: actor.id,
      userType: actor.type,
      type,
      adId: adId && isValidId(adId) ? adId : null,
      targetId: targetUserId && isValidId(targetUserId) ? targetUserId : null,
      targetType: targetUserType || 'User',
      targetName,
      targetAvatar,
      metadata: metadata || {},
    });
    await activity.save();
    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    fail(res, err, 'Failed to log activity');
  }
};

exports.getSavedCollections = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const collections = await SavedCollection.find({
      userId: actor.id,
      userType: actor.type,
    })
      .populate('posts', 'image video thumbnail mediaType')
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: collections });
  } catch (err) {
    fail(res, err, 'Failed to load collections');
  }
};

exports.createSavedCollection = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { name, isPrivate } = req.body;
    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'Name required' });
    }
    const collection = new SavedCollection({
      userId: actor.id,
      userType: actor.type,
      name: String(name).trim(),
      isPrivate: isPrivate !== undefined ? isPrivate === 'true' : true,
      posts: [],
      postsCount: 0,
    });
    await collection.save();
    res.status(201).json({ success: true, data: collection });
  } catch (err) {
    fail(res, err, 'Failed to create collection');
  }
};

exports.updateSavedCollection = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const { name, isPrivate, coverImage } = req.body;
    const collection = await SavedCollection.findById(id);
    if (!collection) {
      return res
        .status(404)
        .json({ success: false, message: 'Collection not found' });
    }
    if (!eqId(collection.userId, actor.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    if (name !== undefined) collection.name = name;
    if (isPrivate !== undefined)
      collection.isPrivate = isPrivate === 'true';
    if (coverImage !== undefined) collection.coverImage = coverImage;
    await collection.save();
    res.status(200).json({ success: true, data: collection });
  } catch (err) {
    fail(res, err, 'Failed to update collection');
  }
};

exports.deleteSavedCollection = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const collection = await SavedCollection.findById(id);
    if (!collection) {
      return res
        .status(404)
        .json({ success: false, message: 'Collection not found' });
    }
    if (!eqId(collection.userId, actor.id)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    if (collection.isDefault) {
      return res
        .status(400)
        .json({ success: false, message: 'Cannot delete default' });
    }
    await SavedCollection.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: 'Collection deleted' });
  } catch (err) {
    fail(res, err, 'Failed to delete collection');
  }
};

exports.searchHashtags = async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q) {
      return res
        .status(400)
        .json({ success: false, message: 'Search query required' });
    }
    const safeQ = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hashtags = await Hashtag.find({
      tag: { $regex: `^${safeQ.toLowerCase()}`, $options: 'i' },
      isBlocked: false,
      isBanned: false,
    })
      .sort({ postsCount: -1, trendingScore: -1 })
      .limit(Math.min(50, Number(limit) || 20))
      .lean();
    res.status(200).json({ success: true, data: hashtags });
  } catch (err) {
    fail(res, err, 'Failed to search hashtags');
  }
};

exports.getTrendingHashtags = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const hashtags = await Hashtag.find({
      isBlocked: false,
      isBanned: false,
    })
      .sort({ trendingScore: -1, postsCount: -1 })
      .limit(Math.min(50, Number(limit) || 20))
      .lean();
    res.status(200).json({ success: true, data: hashtags });
  } catch (err) {
    fail(res, err, 'Failed to load trending hashtags');
  }
};

exports.getPostsByHashtag = async (req, res) => {
  try {
    const { tag } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const { pageNum, limitNum, skip } = clampPagination(page, limit);
    const viewer = getActor(req);
    const filter = {
      tags: tag.toLowerCase(),
      isActive: true,
      isDeleted: { $ne: true },
    };
    const [ads, total] = await Promise.all([
      Ad.find(filter)
        .populate('userId', USER_POPULATE_FIELDS)
        .populate('vendorId', VENDOR_POPULATE_FIELDS)
        .sort({ engagementScore: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ad.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: decorateAds(ads, viewer?.id, viewer?.type),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        hasMore: skip + ads.length < total,
      },
    });
  } catch (err) {
    fail(res, err, 'Failed to load hashtag posts');
  }
};

exports.search = async (req, res) => {
  try {
    const { q, type = 'all', limit = 20 } = req.query;
    const viewer = getActor(req);
    if (!q || !q.trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'Search query required' });
    }
    const safeQ = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safeQ, 'i');
    const cap = Math.min(50, Number(limit) || 20);
    const results = { users: [], vendors: [], posts: [], hashtags: [] };
    if (type === 'all' || type === 'users') {
      const [users, vendors] = await Promise.all([
        User.find({ $or: [{ name: regex }, { username: regex }] })
          .select('name username avatar profilePic')
          .limit(cap)
          .lean(),
        Vendor.find({
          $or: [{ shopName: regex }, { name: regex }, { username: regex }],
        })
          .select('shopName name username avatar logo shopImage isOnline')
          .limit(cap)
          .lean(),
      ]);
      results.users = users.map((u) => ({
        _id: u._id,
        name: u.name,
        username: u.username,
        avatar: pickBestAvatar(u.profilePic, u.avatar),
        type: 'User',
      }));
      results.vendors = vendors.map((v) => ({
        _id: v._id,
        name: v.shopName || v.name,
        username: v.username,
        avatar: pickBestAvatar(v.avatar, v.logo, v.shopImage),
        isOnline: v.isOnline || false,
        type: 'Vendor',
      }));
    }
    if (type === 'all' || type === 'posts') {
      const posts = await Ad.find({
        isActive: true,
        isDeleted: { $ne: true },
        $or: [{ title: regex }, { description: regex }, { tags: regex }],
      })
        .populate('userId', USER_POPULATE_FIELDS)
        .populate('vendorId', VENDOR_POPULATE_FIELDS)
        .limit(cap)
        .lean();
      results.posts = decorateAds(posts, viewer?.id, viewer?.type);
    }
    if (type === 'all' || type === 'hashtags') {
      results.hashtags = await Hashtag.find({
        tag: regex,
        isBlocked: false,
        isBanned: false,
      })
        .sort({ postsCount: -1 })
        .limit(cap)
        .lean();
    }
    res.status(200).json({ success: true, data: results });
  } catch (err) {
    fail(res, err, 'Failed to search');
  }
};

exports.archivePost = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    ad.isArchived = true;
    ad.isActive = false;
    await ad.save();
    res.status(200).json({ success: true, message: 'Post archived', data: ad });
  } catch (err) {
    fail(res, err, 'Failed to archive post');
  }
};

exports.unarchivePost = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid id' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    ad.isArchived = false;
    ad.isActive = true;
    await ad.save();
    res
      .status(200)
      .json({ success: true, message: 'Post unarchived', data: ad });
  } catch (err) {
    fail(res, err, 'Failed to unarchive post');
  }
};

exports.getArchivedPosts = async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, message: 'Auth required' });
    }
    const filter =
      actor.type === 'Vendor'
        ? { vendorId: actor.id, isArchived: true, isDeleted: { $ne: true } }
        : { userId: actor.id, isArchived: true, isDeleted: { $ne: true } };
    const ads = await Ad.find(filter)
      .populate('vendorId', VENDOR_POPULATE_FIELDS)
      .populate('userId', USER_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({
      success: true,
      data: decorateAds(ads, actor.id, actor.type),
    });
  } catch (err) {
    fail(res, err, 'Failed to load archived posts');
  }
};

exports.togglePinPost = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const ad = await Ad.findById(id);
    if (!ad) {
      return res
        .status(404)
        .json({ success: false, message: 'Post not found' });
    }
    if (!ownsAd(req, ad) && !isAdminReq(req)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not allowed' });
    }

    ad.isPinned = !ad.isPinned;
    await ad.save();

    if (ad.userId) {
      if (ad.isPinned) {
        await UserStats.findOneAndUpdate(
          { identityId: ad.userId, identityType: 'User' },
          {
            $addToSet: { pinnedPosts: id },
            $setOnInsert: {
              identityId: ad.userId,
              identityType: 'User',
            },
          },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((e) =>
          console.warn('pin UserStats failed:', e?.message)
        );
      } else {
        await UserStats.findOneAndUpdate(
          { identityId: ad.userId, identityType: 'User' },
          { $pull: { pinnedPosts: id } }
        ).catch(() => {});
      }
    } else if (ad.vendorId) {
      if (ad.isPinned) {
        await VendorStats.findOneAndUpdate(
          { identityId: ad.vendorId, identityType: 'Vendor' },
          {
            $addToSet: { pinnedPosts: id },
            $setOnInsert: {
              identityId: ad.vendorId,
              identityType: 'Vendor',
            },
          },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((e) =>
          console.warn('pin VendorStats failed:', e?.message)
        );
      } else {
        await VendorStats.findOneAndUpdate(
          { identityId: ad.vendorId, identityType: 'Vendor' },
          { $pull: { pinnedPosts: id } }
        ).catch(() => {});
      }
    }

    res.status(200).json({
      success: true,
      message: ad.isPinned ? 'Post pinned' : 'Post unpinned',
      data: { isPinned: ad.isPinned },
    });
  } catch (err) {
    fail(res, err, 'Failed to pin post');
  }
};

module.exports = exports;