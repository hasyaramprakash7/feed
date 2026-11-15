const Admin = require("../models/Admin");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const DeliveryBoy = require("../models/DeliveryBoy");
const Order = require("../models/Order");
const VendorProduct = require("../models/VendorProduct");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// --- ADMIN AUTH ---

exports.registerAdmin = async (req, res) => {
    console.log('📥 [registerAdmin] Request body:', req.body);
    try {
        const { name, email, password, phone, role } = req.body;
        // Validate required fields
        if (!name || !email || !password) {
            console.warn('⚠️ [registerAdmin] Missing required fields.');
            return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
        }

        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            console.warn('⚠️ [registerAdmin] Admin already exists with email:', email);
            return res.status(400).json({ success: false, message: 'Admin email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = await Admin.create({
            name,
            email,
            password: hashedPassword,
            phone,
            role: role || 'admin',
            isActive: true
        });

        console.log('✅ [registerAdmin] New admin created:', newAdmin.email, 'role:', newAdmin.role);
        res.status(201).json({
            success: true,
            message: 'Admin registered.',
            admin: {
                _id: newAdmin._id,
                name: newAdmin.name,
                email: newAdmin.email,
                phone: newAdmin.phone,
                role: newAdmin.role,
                isActive: newAdmin.isActive
            }
        });
    } catch (err) {
        console.error('❌ [registerAdmin] Error:', err.message);
        res.status(500).json({ success: false, message: 'Registration failed', error: err.message });
    }
};

exports.loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        if (!admin) return res.status(404).json({ message: "Admin not found." });

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });

        if (!admin.isActive) return res.status(403).json({ message: "Account is inactive." });

        const token = jwt.sign(
            { adminId: admin._id, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        admin.token = token;
        await admin.save();

        res.json({ message: "Login successful.", token, admin });
    } catch (err) {
        res.status(500).json({ message: "Login failed", error: err.message });
    }
};

exports.getAdminProfile = async (req, res) => {
    try {
        const admin = await Admin.findById(req.adminId).select("-password -token");
        if (!admin) return res.status(404).json({ message: "Profile not found." });
        res.json({ admin });
    } catch (err) {
        res.status(500).json({ message: "Error fetching profile", error: err.message });
    }
};

exports.updateAdminProfile = async (req, res) => {
    try {
        const updates = { ...req.body };
        delete updates.role;
        delete updates.isActive;

        if (updates.password && updates.password.trim() !== "") {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password;
        }

        const updatedAdmin = await Admin.findByIdAndUpdate(req.adminId, { $set: updates }, { new: true }).select("-password -token");
        res.json({ message: "Profile updated.", admin: updatedAdmin });
    } catch (err) {
        res.status(500).json({ message: "Update failed", error: err.message });
    }
};

// --- ADMIN MANAGEMENT (Superadmin) ---

exports.getAllAdmins = async (req, res) => {
    try {
        const admins = await Admin.find().select("-password -token");
        res.json({ admins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getAdminById = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id).select("-password -token");
        if (!admin) return res.status(404).json({ message: "Admin not found" });
        res.json({ admin });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateAdminById = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.password && updates.password.trim() !== "") {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password;
        }

        const updatedAdmin = await Admin.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select("-password -token");
        res.json({ message: "Admin updated.", admin: updatedAdmin });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteAdmin = async (req, res) => {
    try {
        await Admin.findByIdAndDelete(req.params.id);
        res.json({ message: "Admin deleted." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- USERS ---

exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select("-password");
        res.json({ users });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password");
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json({ user });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateUser = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.password && updates.password.trim() !== "") {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password;
        }
        const updatedUser = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-password");
        res.json({ message: "User updated", user: updatedUser });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteUser = async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: "User deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// --- VENDORS ---

exports.getAllVendors = async (req, res) => {
    try {
        const vendors = await Vendor.find().select("-password");
        res.json({ vendors });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getVendorById = async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.params.id).select("-password");
        res.json({ vendor });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateVendor = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.password && updates.password.trim() !== "") {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password;
        }
        const updatedVendor = await Vendor.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-password");
        res.json({ message: "Vendor updated", vendor: updatedVendor });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteVendor = async (req, res) => {
    try {
        await Vendor.findByIdAndDelete(req.params.id);
        res.json({ message: "Vendor deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.toggleVendorApproval = async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) return res.status(404).json({ message: "Vendor not found" });

        vendor.isApproved = !vendor.isApproved;
        await vendor.save();
        res.json({ message: `Vendor ${vendor.isApproved ? "Approved" : "Disapproved"}`, vendor });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// --- DELIVERY BOYS ---

exports.getAllDeliveryBoys = async (req, res) => {
    try {
        const boys = await DeliveryBoy.find().select("-password");
        res.json({ boys });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getDeliveryBoyById = async (req, res) => {
    try {
        const boy = await DeliveryBoy.findById(req.params.id).select("-password");
        res.json({ deliveryBoy: boy });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateDeliveryBoy = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.password && updates.password.trim() !== "") {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password;
        }
        const updatedBoy = await DeliveryBoy.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-password");
        res.json({ message: "Delivery Boy updated", deliveryBoy: updatedBoy });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteDeliveryBoy = async (req, res) => {
    try {
        await DeliveryBoy.findByIdAndDelete(req.params.id);
        res.json({ message: "Delivery Boy deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.toggleDeliveryBoyApproval = async (req, res) => {
    try {
        const boy = await DeliveryBoy.findById(req.params.id);
        if (!boy) return res.status(404).json({ message: "Delivery Boy not found" });

        boy.isApproved = !boy.isApproved;
        if (!boy.isApproved) boy.isAvailable = false;

        await boy.save();
        res.json({
            message: `Delivery Boy ${boy.isApproved ? "Approved" : "Disapproved"}`,
            deliveryBoy: boy
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- PRODUCTS ---

exports.getAllProducts = async (req, res) => {
    try {
        const products = await VendorProduct.find().populate("vendorId");
        res.json({ products });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getProductById = async (req, res) => {
    try {
        const product = await VendorProduct.findById(req.params.id).populate("vendorId");
        res.json({ product });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateProduct = async (req, res) => {
    try {
        const updatedProduct = await VendorProduct.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ message: "Product updated", product: updatedProduct });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteProduct = async (req, res) => {
    try {
        await VendorProduct.findByIdAndDelete(req.params.id);
        res.json({ message: "Product deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// --- ORDERS ---

exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find().populate("userId deliveryBoy items.productId");
        res.json({ orders });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate("userId deliveryBoy items.productId");
        res.json({ order });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateOrder = async (req, res) => {
    try {
        const updatedOrder = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ message: "Order updated", order: updatedOrder });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteOrder = async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        res.json({ message: "Order deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// --- ANALYTICS ---

exports.getPlatformAnalytics = async (req, res) => {
    try {
        const orders = await Order.find().populate("items.productId");
        let totalPlatformIncome = 0;
        const vendorIncomes = {};

        for (const order of orders) {
            if (order.totalAmount) totalPlatformIncome += order.totalAmount;
            for (const item of order.items) {
                if (item.productId?.vendorId) {
                    const vId = item.productId.vendorId.toString();
                    const revenue = (item.quantity || 1) * (item.price || 0);
                    vendorIncomes[vId] = (vendorIncomes[vId] || 0) + revenue;
                }
            }
        }

        const gstIncome = totalPlatformIncome * 0.18;
        const platformFeeIncome = totalPlatformIncome * 0.10;
        const remainingVendorIncome = totalPlatformIncome - gstIncome - platformFeeIncome;

        const vendorIds = Object.keys(vendorIncomes);
        const vendors = await Vendor.find({ _id: { $in: vendorIds } }).select("name");
        
        const vendorIncomeDetails = vendors.map(v => ({
            _id: v._id,
            name: v.name,
            income: vendorIncomes[v._id.toString()] || 0
        }));

        res.json({
            totalPlatformIncome,
            gstIncome,
            platformFeeIncome,
            remainingVendorIncome,
            vendorIncomeDetails
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};