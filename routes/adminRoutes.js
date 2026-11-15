const express = require("express");
const router = express.Router();
const { protectAdmin, isSuperAdmin } = require("../middleware/adminAuth");

const {
    registerAdmin, loginAdmin, getAdminProfile, updateAdminProfile,
    getAllAdmins, getAdminById, updateAdminById, deleteAdmin,
    getPlatformAnalytics,
    toggleVendorApproval, toggleDeliveryBoyApproval,
    getAllUsers, getUserById, updateUser, deleteUser,
    getAllVendors, getVendorById, updateVendor, deleteVendor,
    getAllDeliveryBoys, getDeliveryBoyById, updateDeliveryBoy, deleteDeliveryBoy,
    getAllProducts, getProductById, updateProduct, deleteProduct,
    getAllOrders, getOrderById, updateOrder, deleteOrder,
} = require("../controllers/adminController");

// Public Auth Routes
// routes/admin.js
router.post("/register", registerAdmin); 
router.post("/login", loginAdmin);

// Admin Self-Profile Routes
router.get("/profile", protectAdmin, getAdminProfile);
router.put("/profile", protectAdmin, updateAdminProfile);

// -- SUPERADMIN PROTECTED ROUTES --

// Analytics
router.get("/analytics/income", protectAdmin, isSuperAdmin, getPlatformAnalytics);

// Approvals
router.put("/vendors/:id/approve", protectAdmin, isSuperAdmin, toggleVendorApproval);
router.put("/delivery-boys/:id/approve", protectAdmin, isSuperAdmin, toggleDeliveryBoyApproval);

// Users Management
router.get("/users", protectAdmin, isSuperAdmin, getAllUsers);
router.get("/users/:id", protectAdmin, isSuperAdmin, getUserById);
router.put("/users/:id", protectAdmin, isSuperAdmin, updateUser);
router.delete("/users/:id", protectAdmin, isSuperAdmin, deleteUser);

// Vendors Management
router.get("/vendors", protectAdmin, isSuperAdmin, getAllVendors);
router.get("/vendors/:id", protectAdmin, isSuperAdmin, getVendorById);
router.put("/vendors/:id", protectAdmin, isSuperAdmin, updateVendor);
router.delete("/vendors/:id", protectAdmin, isSuperAdmin, deleteVendor);

// Delivery Boys Management
router.get("/delivery-boys", protectAdmin, isSuperAdmin, getAllDeliveryBoys);
router.get("/delivery-boys/:id", protectAdmin, isSuperAdmin, getDeliveryBoyById);
router.put("/delivery-boys/:id", protectAdmin, isSuperAdmin, updateDeliveryBoy);
router.delete("/delivery-boys/:id", protectAdmin, isSuperAdmin, deleteDeliveryBoy);

// Products Management
router.get("/products", protectAdmin, isSuperAdmin, getAllProducts);
router.get("/products/:id", protectAdmin, isSuperAdmin, getProductById);
router.put("/products/:id", protectAdmin, isSuperAdmin, updateProduct);
router.delete("/products/:id", protectAdmin, isSuperAdmin, deleteProduct);

// Orders Management
router.get("/orders", protectAdmin, isSuperAdmin, getAllOrders);
router.get("/orders/:id", protectAdmin, isSuperAdmin, getOrderById);
router.put("/orders/:id", protectAdmin, isSuperAdmin, updateOrder);
router.delete("/orders/:id", protectAdmin, isSuperAdmin, deleteOrder);

// Superadmin Admin Entity Management
router.get("/", protectAdmin, isSuperAdmin, getAllAdmins);
router.post("/", protectAdmin, isSuperAdmin, registerAdmin); // Superadmin creating sub-admin
router.get("/:id", protectAdmin, isSuperAdmin, getAdminById);
router.put("/:id", protectAdmin, isSuperAdmin, updateAdminById);
router.delete("/:id", protectAdmin, isSuperAdmin, deleteAdmin);

module.exports = router;