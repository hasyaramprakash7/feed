// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────────────────────
// Populate req.identity for every role, plus the role-specific
// bag (req.user / req.vendor / req.deliveryBoy) for backwards
// compatibility with existing controllers.
//
// IMPORTANT: for a vendor token we set req.vendor AND leave
// req.user undefined so that `getActor()` in adController can
// unambiguously pick the vendor identity.
// ─────────────────────────────────────────────────────────────
function attachIdentity(req, decoded) {
  const base = {
    role: decoded.role,
    email: decoded.email,
    phone: decoded.phone,
  };

  switch (decoded.role) {
    case 'user':
      req.user = { userId: decoded.userId, ...base };
      req.identity = { userId: decoded.userId, ...base };
      return true;

    case 'vendor':
    case 'admin':
    case 'suadmin':
      // ✅ Only set req.vendor. Do NOT also set req.user for vendor
      // tokens — that caused ambiguity in getActor().
      req.vendor = {
        vendorId: decoded.vendorId,
        isOnline: decoded.isOnline,
        ...base,
      };
      req.identity = { userId: decoded.vendorId, ...base };
      return true;

    case 'deliveryBoy':
      req.deliveryBoy = { deliveryBoyId: decoded.deliveryBoyId, ...base };
      req.identity = { userId: decoded.deliveryBoyId, ...base };
      return true;

    default:
      return false;
  }
}

exports.authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer')) {
    return res
      .status(401)
      .json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!attachIdentity(req, decoded)) {
      return res
        .status(401)
        .json({ success: false, message: 'Unauthorized: Invalid role' });
    }

    next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, message: 'Not authorized, token failed' });
  }
};

exports.optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer')) return next();

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    attachIdentity(req, decoded); // ignore return value
    next();
  } catch (_) {
    next();
  }
};

exports.isVendor = (req, res, next) => {
  if (
    req.vendor &&
    (req.vendor.role === 'vendor' ||
      req.vendor.role === 'admin' ||
      req.vendor.role === 'suadmin')
  ) {
    next();
  } else {
    res
      .status(403)
      .json({ success: false, message: 'Not authorized as a vendor' });
  }
};

exports.isAdmin = (req, res, next) => {
  if (
    req.vendor &&
    (req.vendor.role === 'admin' || req.vendor.role === 'suadmin')
  ) {
    next();
  } else {
    res
      .status(403)
      .json({ success: false, message: 'Not authorized as an administrator' });
  }
};