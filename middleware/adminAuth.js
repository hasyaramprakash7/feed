const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const protectAdmin = async (req, res, next) => {
    let token;

    console.log('🛡️ [protectAdmin] Checking authorization header...');

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
        console.log('🔑 [protectAdmin] Token extracted:', token.substring(0, 20) + '...'); // log only prefix for security
    } else {
        console.warn('⚠️ [protectAdmin] No token or invalid format in headers.');
        return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ [protectAdmin] Token verified. Decoded payload:', decoded);

        const adminUser = await Admin.findById(decoded.adminId).select('-password');
        if (!adminUser) {
            console.warn('⚠️ [protectAdmin] Admin not found in DB for ID:', decoded.adminId);
            return res.status(401).json({ success: false, message: 'Not authorized, admin user not found' });
        }

        console.log(`👤 [protectAdmin] Admin found: ${adminUser.name} (${adminUser.email}), role: ${adminUser.role}`);
        req.adminId = adminUser._id;
        req.admin = adminUser;

        next();
    } catch (error) {
        console.error('❌ [protectAdmin] Token verification failed:', error.message);
        return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
};
const isAdmin = (req, res, next) => {
    if (req.admin && (req.admin.role === "admin" || req.admin.role === "superadmin")) {
        next();
    } else {
        res.status(403).json({ success: false, message: "Not authorized as an administrator" });
    }
};

const isSuperAdmin = (req, res, next) => {
    console.log('🔍 [isSuperAdmin] Checking admin role...');
    console.log('📋 [isSuperAdmin] req.admin:', req.admin ? req.admin : 'NOT SET');

    if (req.admin && req.admin.role === 'superadmin') {
        console.log('✅ [isSuperAdmin] User is superadmin. Proceeding.');
        next();
    } else {
        console.warn('⚠️ [isSuperAdmin] Access denied. User role is:', req.admin ? req.admin.role : 'undefined');
        res.status(403).json({ success: false, message: 'Not authorized as a superadmin' });
    }
};
module.exports = { protectAdmin, isAdmin, isSuperAdmin };