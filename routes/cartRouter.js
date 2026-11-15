const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier"); 
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary"); 
const Cart = require("../models/Cart");
const VendorProduct = require("../models/VendorProduct"); 
const { authMiddleware } = require("../middleware/authMiddleware"); 

const router = express.Router();

// Multer setup - Using .none() since cart updates/adds are JSON body
const upload = multer(); 

// Cloudinary upload helper (kept for potential image routes)
const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream((err, result) => {
      if (result) resolve(result.secure_url);
      else reject(err);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });

// Validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ✅ GET user's cart
// Authenticated route to fetch the user's cart
router.get("/", authMiddleware, async (req, res) => {
  try {
    // Find the cart associated with the logged-in user's ID
    const cart = await Cart.findOne({ userId: req.user.userId })
      // Populate the 'productId' field within the 'items' array
      .populate({
        path: "items.productId",
        // 🔑 FIX 1: Include the `sizes` array in the populate select fields
        select: "name description price discountedPrice discountPercent category images stock isAvailable bulkPrice bulkMinimumUnits largeQuantityPrice largeQuantityMinimumUnits vendorId sizes"
      })
      .lean(); // Use .lean() for faster read operations

    // If no cart is found for the user, return an empty array
    if (!cart) {
      return res.json({ success: true, items: [] });
    }

    // Filter out any cart items where productId failed to populate (e.g., product deleted)
    const validItems = cart.items.filter(item => item.productId !== null);

    // Respond with the populated and filtered cart items
    res.json({ success: true, items: validItems });
  } catch (error) {
    console.error("Fetch Cart Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch cart. " + error.message });
  }
});

// ✅ ADD or UPDATE item in cart
// Authenticated route to add a new item or update the quantity of an existing item
router.post("/items", authMiddleware, upload.none(), async (req, res) => {
  try {
    // 🔑 FIX 2: Expect size in the request body
    const { productId, quantity, size } = req.body; 

    // Input validation
    if (!isValidObjectId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID provided." });
    }
    const parsedQuantity = parseInt(quantity, 10);
    if (isNaN(parsedQuantity) || parsedQuantity < 0) { 
      return res.status(400).json({ success: false, message: "Invalid quantity provided. Must be a non-negative number." });
    }

    // Find the product to get its details (price, stock, vendorId)
    const product = await VendorProduct.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    // Server-side stock check for the *requested total quantity*
    if (parsedQuantity > product.stock) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} units available for ${product.name}. You requested ${parsedQuantity}.` });
    }

    // Find or create the user's cart
    let cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      cart = new Cart({ userId: req.user.userId, items: [] });
    }

    // 🔑 FIX 3: Use productId AND size (or null if size is undefined/empty string) to find the item.
    // This is the CRITICAL change for variant support.
    const itemSize = size || undefined; 
    const existingItemIndex = cart.items.findIndex(item => 
        item.productId.equals(productId) && (item.size === itemSize)
    );

    if (existingItemIndex !== -1) {
      // Item exists: Update its quantity
      cart.items[existingItemIndex].quantity = parsedQuantity;
      // If quantity becomes 0, remove the item
      if (cart.items[existingItemIndex].quantity === 0) {
        cart.items.splice(existingItemIndex, 1);
      }
    } else {
      // Item does not exist: Add it to the cart
      // Only add if quantity is greater than 0
      if (parsedQuantity > 0) {
        cart.items.push({
          productId,
          quantity: parsedQuantity,
          price: product.discountedPrice || product.price, 
          vendorId: product.vendorId, 
          size: itemSize, // 🔑 FIX 4: Save the size
        });
      }
    }

    await cart.save(); // Save the updated cart

    // After updating, re-fetch the cart with populated data to send back
    // Ensure we use the updated SELECT statement
    const updatedCart = await Cart.findOne({ userId: req.user.userId })
      .populate({
        path: "items.productId",
        select: "name description price discountedPrice discountPercent category images stock isAvailable bulkPrice bulkMinimumUnits largeQuantityPrice largeQuantityMinimumUnits vendorId sizes"
      })
      .lean();

    // Filter out potentially null productIds if some products were deleted
    const updatedValidItems = updatedCart ? updatedCart.items.filter(item => item.productId !== null) : [];

    res.status(200).json({ success: true, message: "Cart item updated successfully.", items: updatedValidItems });
  } catch (error) {
    console.error("Add/Update Cart Item Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update cart. " + error.message });
  }
});

// ❌ REMOVE item from cart
// Authenticated route to remove a specific item/variant from the cart
router.delete("/items/:productId", authMiddleware, async (req, res) => {
  try {
    // 🔑 FIX 5: Expect size via query string for removal
    const { productId } = req.params;
    const { size } = req.query; // Size is optional and pulled from query parameter

    if (!isValidObjectId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID provided." });
    }

    const cart = await Cart.findOne({ userId: req.user.userId });

    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found for this user." });
    }

    // 🔑 FIX 6: Filter out the item based on productId AND size
    const itemSize = size || undefined;
    const initialItemCount = cart.items.length;
    
    // We filter based on the inverse of our unique item condition
    const originalLength = cart.items.length;
    
    cart.items = cart.items.filter(item => 
        // Keep the item UNLESS both productId AND size match the item being deleted
        !(item.productId.equals(productId) && (item.size === itemSize))
    );

    // Check if an item was actually removed
    if (cart.items.length === originalLength) {
        return res.status(404).json({ success: false, message: "Item variant not found in cart." });
    }

    await cart.save(); // Save the updated cart

    // After removal, re-fetch and populate the cart to send the latest state to the frontend
    const updatedCart = await Cart.findOne({ userId: req.user.userId })
      .populate({
        path: "items.productId",
        select: "name description price discountedPrice discountPercent category images stock isAvailable bulkPrice bulkMinimumUnits largeQuantityPrice largeQuantityMinimumUnits vendorId sizes"
      })
      .lean();

    const updatedValidItems = updatedCart ? updatedCart.items.filter(item => item.productId !== null) : [];

    res.json({ success: true, message: "Item removed from cart.", items: updatedValidItems });
  } catch (error) {
    console.error("Remove Item Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to remove item from cart. " + error.message });
  }
});

// ❎ CLEAR entire cart
// Authenticated route to clear all items from the user's cart
router.delete("/clear", authMiddleware, async (req, res) => {
  try {
    // Find and delete the user's cart document
    const deletedCart = await Cart.findOneAndDelete({ userId: req.user.userId });

    if (!deletedCart) {
      return res.status(404).json({ success: false, message: "Cart not found to clear." });
    }

    // On successful deletion, return an empty array to indicate the cart is cleared
    res.json({ success: true, message: "Cart cleared successfully.", items: [] });
  } catch (error) {
    console.error("Clear Cart Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to clear cart. " + error.message });
  }
});

// 🛒 NEW: CLEAR items by vendor ID
// Authenticated route to remove ALL items from a specific vendor in the cart
router.delete("/vendor/:vendorId", authMiddleware, async (req, res) => {
  try {
    const { vendorId } = req.params;

    // 1. Validate the vendor ID (assuming vendorId is a MongoDB ObjectId)
    if (!isValidObjectId(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID provided." });
    }

    // 2. Find the user's cart
    const cart = await Cart.findOne({ userId: req.user.userId });

    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found for this user." });
    }

    // 3. Filter the items array to keep only those items whose vendorId DOES NOT match
    const initialItemCount = cart.items.length;
    cart.items = cart.items.filter(item => item.vendorId.toString() !== vendorId);

    // 4. Check if any items were actually removed
    if (cart.items.length === initialItemCount) {
        // This indicates the cart existed, but no items matched that vendorId
        return res.status(404).json({ success: false, message: "No items found for this vendor in the cart." });
    }

    await cart.save(); // Save the updated cart

    // 5. After removal, re-fetch and populate the cart to send the latest state to the frontend (matching the thunk's expectation)
    const updatedCart = await Cart.findOne({ userId: req.user.userId })
      .populate({
        path: "items.productId",
        select: "name description price discountedPrice discountPercent category images stock isAvailable bulkPrice bulkMinimumUnits largeQuantityPrice largeQuantityMinimumUnits vendorId sizes"
      })
      .lean();

    const updatedValidItems = updatedCart ? updatedCart.items.filter(item => item.productId !== null) : [];

    res.json({ success: true, message: `All items for vendor ${vendorId} removed.`, items: updatedValidItems });
  } catch (error) {
    console.error("Remove Vendor Items Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to remove vendor items. " + error.message });
  }
});

// 🛠️ 1. UPDATE GROUP DETAILS (Name, Description, Image)
router.put("/group/:groupId/update", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description } = req.body;
    const senderInfo = getSenderInfo(req);

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    // Optional: Check if the requester is the group admin
    if (group.admin.toString() !== senderInfo.id.toString()) {
      return res.status(403).json({ success: false, message: "Only the admin can update the group" });
    }

    let updates = { name, description };

    // Handle new image upload
    if (req.file) {
      if (group.groupImagePublicId) {
        await cloudinary.uploader.destroy(group.groupImagePublicId); // Delete old image
      }
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, 'image');
      updates.groupImage = url;
      updates.groupImagePublicId = publicId;
    }

    const updatedGroup = await Group.findByIdAndUpdate(groupId, updates, { new: true });
    
    // Notify group members of the update
    const io = req.app.get("socketio");
    if (io) io.to(`group_${groupId}`).emit("groupUpdated", updatedGroup);

    res.status(200).json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ➕ 2. ADD NEW MEMBERS TO GROUP
router.post("/group/:groupId/add-members", authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    // Expects newMembers: [{ memberId: "...", memberModel: "User/Vendor/DeliveryBoy" }]
    const { newMembers } = req.body; 
    const senderInfo = getSenderInfo(req);

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    // Only admin can add members (Remove this check if anyone can add)
    if (group.admin.toString() !== senderInfo.id.toString()) {
      return res.status(403).json({ success: false, message: "Only the admin can add members" });
    }

    // Filter out members that are already in the group
    const existingMemberIds = group.members.map(m => m.memberId.toString());
    const membersToAdd = newMembers.filter(m => !existingMemberIds.includes(m.memberId));

    if (membersToAdd.length === 0) {
      return res.status(400).json({ success: false, message: "All provided users are already in the group" });
    }

    group.members.push(...membersToAdd);
    await group.save();

    const populatedGroup = await group.populate('members.memberId', 'name shopName profilePic shopImage phone');

    // Notify the group via sockets
    const io = req.app.get("socketio");
    if (io) io.to(`group_${groupId}`).emit("groupMembersAdded", { groupId, membersAdded: membersToAdd });

    res.status(200).json({ success: true, group: populatedGroup });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ➖ 3. KICK / REMOVE MEMBER FROM GROUP
router.delete("/group/:groupId/remove-member/:memberId", authMiddleware, async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const senderInfo = getSenderInfo(req);

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    // Only admin can remove members
    if (group.admin.toString() !== senderInfo.id.toString()) {
      return res.status(403).json({ success: false, message: "Only the admin can remove members" });
    }

    // Prevent admin from removing themselves here (they should use 'leave' instead)
    if (memberId === group.admin.toString()) {
      return res.status(400).json({ success: false, message: "Admin cannot be removed. Transfer ownership or leave the group." });
    }

    group.members = group.members.filter(m => m.memberId.toString() !== memberId);
    await group.save();

    const io = req.app.get("socketio");
    if (io) {
      // Tell everyone in the group the member was removed
      io.to(`group_${groupId}`).emit("memberRemoved", { groupId, memberId });
      // Kick the specific socket connection out of the room so they stop receiving messages
      io.to(memberId).emit("kickedFromGroup", { groupId }); 
    }

    res.status(200).json({ success: true, message: "Member removed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🚪 4. LEAVE GROUP
router.delete("/group/:groupId/leave", authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const senderInfo = getSenderInfo(req);

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    const isMember = group.members.some(m => m.memberId.toString() === senderInfo.id.toString());
    if (!isMember) return res.status(400).json({ success: false, message: "You are not in this group" });

    // If the admin leaves, we need to handle it. 
    // Option A: Delete the group completely.
    // Option B: Assign admin to the next oldest member.
    if (group.admin.toString() === senderInfo.id.toString()) {
      if (group.members.length > 1) {
        // Assign next member as admin
        const nextAdmin = group.members.find(m => m.memberId.toString() !== senderInfo.id.toString());
        group.admin = nextAdmin.memberId;
        group.adminModel = nextAdmin.memberModel;
      } else {
        // Only person left, delete the group and its messages entirely
        await Group.findByIdAndDelete(groupId);
        await Message.deleteMany({ group: groupId });
        return res.status(200).json({ success: true, message: "Group deleted" });
      }
    }

    // Remove the user from the members array
    group.members = group.members.filter(m => m.memberId.toString() !== senderInfo.id.toString());
    await group.save();

    const io = req.app.get("socketio");
    if (io) {
      io.to(`group_${groupId}`).emit("memberLeft", { groupId, memberId: senderInfo.id });
      io.to(senderInfo.id).emit("leftGroup", { groupId }); 
    }

    res.status(200).json({ success: true, message: "You have left the group" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;  