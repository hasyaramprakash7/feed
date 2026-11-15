const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Group = require("../models/Group");
const Message = require("../models/Message"); // Needed to delete group messages
const { authMiddleware } = require("../middleware/authMiddleware");

const getSenderInfo = (req) => {
    const data = req.user || req.vendor || req.deliveryBoy;
    if (!data) return null;
    const rawRole = data.role || "User";
    return {
        id: data.userId || data.vendorId || data.deliveryBoyId || data._id,
        role: rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase()
    };
};

// 🟢 1. CREATE A GROUP
router.post("/create", authMiddleware, async (req, res) => {
    try {
        const { name, description, avatarUrl, initialMembers } = req.body;
        const creator = getSenderInfo(req);
        if (!creator) return res.status(401).json({ success: false, message: "Unauthorized" });

        let membersList = [{ memberId: creator.id, memberModel: creator.role }];
        
        if (initialMembers && Array.isArray(initialMembers)) {
            initialMembers.forEach(m => {
                if (m.id && m.role && m.id.toString() !== creator.id.toString()) {
                    membersList.push({ memberId: m.id, memberModel: m.role });
                }
            });
        }

        const newGroup = await Group.create({
            name, description: description || "", avatarUrl: avatarUrl || null,
            admin: creator.id, adminModel: creator.role, members: membersList
        });

        const io = req.app.get("socketio");
        if (io) {
            membersList.forEach(m => {
                io.to(m.memberId.toString()).emit("addedToGroup", newGroup);
            });
        }

        res.status(201).json({ success: true, group: newGroup, message: "Group created successfully!" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔵 2. GET MY GROUPS
router.get("/my-groups", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        if (!userInfo) return res.status(401).json({ success: false, message: "Unauthorized" });

        const groups = await Group.find({ "members.memberId": userInfo.id }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, groups });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🟣 3. GET SINGLE GROUP DETAILS
router.get("/:groupId", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const { groupId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(groupId)) return res.status(400).json({ success: false, message: "Invalid Group ID" });

        const group = await Group.findById(groupId)
            .populate('admin', 'name shopName profilePic shopImage phone')
            .populate('members.memberId', 'name shopName profilePic shopImage phone');

        if (!group) return res.status(404).json({ success: false, message: "Group not found" });

        const isMember = group.members.some(m => m.memberId?._id?.toString() === userInfo.id.toString());
        if (!isMember) return res.status(403).json({ success: false, message: "You are not a member of this group" });

        res.status(200).json({ success: true, group });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 4. UPDATE GROUP DETAILS (CRUD)
router.put("/:groupId/update", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const { name, description, avatarUrl } = req.body;
        const group = await Group.findById(req.params.groupId);

        if (!group) return res.status(404).json({ message: "Group not found" });
        if (group.admin.toString() !== userInfo.id.toString()) {
            return res.status(403).json({ message: "Only admin can update group info" });
        }

        if (name) group.name = name;
        if (description !== undefined) group.description = description;
        if (avatarUrl) group.avatarUrl = avatarUrl;

        await group.save();

        const io = req.app.get("socketio");
        if (io) io.to(`group_${req.params.groupId}`).emit("groupUpdated", group);

        res.status(200).json({ success: true, group });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 5. DELETE GROUP (CRUD)
router.delete("/:groupId/delete", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const group = await Group.findById(req.params.groupId);

        if (!group) return res.status(404).json({ message: "Group not found" });
        if (group.admin.toString() !== userInfo.id.toString()) {
            return res.status(403).json({ message: "Only admin can delete the group" });
        }

        // Delete all messages associated with this group
        await Message.deleteMany({ isGroupMessage: true, group: req.params.groupId });
        
        // Delete the group itself
        await Group.findByIdAndDelete(req.params.groupId);

        const io = req.app.get("socketio");
        if (io) io.to(`group_${req.params.groupId}`).emit("groupDeleted", req.params.groupId);

        res.status(200).json({ success: true, message: "Group and all messages deleted" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🟠 6. ADD MEMBER TO GROUP
router.post("/:groupId/add", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const { memberId, memberModel } = req.body;
        const group = await Group.findById(req.params.groupId);

        if (group.admin.toString() !== userInfo.id.toString()) return res.status(403).json({ message: "Only admin can add members" });
        if (group.members.some(m => m.memberId.toString() === memberId)) return res.status(400).json({ message: "Already in group" });

        group.members.push({ memberId, memberModel });
        await group.save();

        const io = req.app.get("socketio");
        if (io) {
            io.to(memberId).emit("addedToGroup", group);
            io.to(`group_${req.params.groupId}`).emit("groupUpdated", group);
        }

        res.status(200).json({ success: true, group });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔴 7. REMOVE MEMBER FROM GROUP
router.post("/:groupId/remove", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const { memberId } = req.body;
        const group = await Group.findById(req.params.groupId);

        if (group.admin.toString() !== userInfo.id.toString()) return res.status(403).json({ message: "Only admin can remove members" });

        group.members = group.members.filter(m => m.memberId.toString() !== memberId);
        await group.save();

        const io = req.app.get("socketio");
        if (io) {
            io.to(memberId).emit("removedFromGroup", req.params.groupId);
            io.to(`group_${req.params.groupId}`).emit("groupUpdated", group);
        }

        res.status(200).json({ success: true, group });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🟡 8. LEAVE GROUP
router.post("/:groupId/leave", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const group = await Group.findById(req.params.groupId);

        if (group.admin.toString() === userInfo.id.toString()) {
            return res.status(400).json({ message: "Admin cannot leave. Transfer admin rights or delete group." });
        }

        group.members = group.members.filter(m => m.memberId.toString() !== userInfo.id.toString());
        await group.save();

        const io = req.app.get("socketio");
        if (io) io.to(`group_${req.params.groupId}`).emit("groupUpdated", group);

        res.status(200).json({ success: true, message: "Left group successfully" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;