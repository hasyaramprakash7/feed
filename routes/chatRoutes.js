const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary"); 
const Message = require("../models/Message");
const Group = require("../models/Group");
const User = require("../models/User"); 
const Vendor = require("../models/Vendor"); 
const { authMiddleware } = require("../middleware/authMiddleware");

const { Expo } = require('expo-server-sdk');
let expo = new Expo();

const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToCloudinary = (buffer, messageType) =>
  new Promise((resolve, reject) => {
    const resourceType = messageType === 'audio' ? 'video' : 'image';
    const stream = cloudinary.uploader.upload_stream(
      { folder: "bluxury_chat_media", resource_type: resourceType },
      (err, result) => {
        if (result) resolve({ url: result.secure_url, publicId: result.public_id });
        else reject(err);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

const getSenderInfo = (req) => {
    const data = req.user || req.vendor || req.deliveryBoy;
    if (!data) return null;
    const rawRole = data.role || "User";
    const normalizedRole = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();
    return { id: data.userId || data.vendorId || data.deliveryBoyId || data._id, role: normalizedRole };
};

// 🟢 1. SEND MESSAGE 
router.post("/send", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const { receiverId, messageType, content, receiverModel, replyTo, isGroupMessage, groupId } = req.body;
    const senderInfo = getSenderInfo(req);
    if (!senderInfo) return res.status(401).json({ success: false, message: "Unauthorized" });

    const finalReceiverModel = receiverModel || (senderInfo.role === 'User' ? 'Vendor' : 'User');
    const newMessageData = {
      sender: senderInfo.id, senderModel: senderInfo.role,
      messageType: messageType || 'text', content: content,
      replyTo: replyTo || null, timestamp: new Date()
    };

    if (isGroupMessage === 'true' || isGroupMessage === true) {
      newMessageData.isGroupMessage = true;
      newMessageData.group = groupId;
      newMessageData.readBy = [senderInfo.id]; // Sender has implicitly read it
    } else {
      newMessageData.receiver = receiverId;
      newMessageData.receiverModel = finalReceiverModel; 
    }

    if (req.file) {
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, messageType);
      newMessageData.mediaUrl = url; newMessageData.mediaPublicId = publicId;
    }

    let message = await Message.create(newMessageData);
    if (message.replyTo) {
      message = await Message.findById(message._id).populate('replyTo', 'content messageType sender mediaUrl');
    }

    const io = req.app.get("socketio");
    if (io) {
      if (newMessageData.isGroupMessage) {
        // 🔥 FIX: Emitting to group_ID based on your index.js setup
        io.to(`group_${groupId}`).emit("newMessage", message);
      } else {
        io.to(senderInfo.id.toString()).emit("newMessage", message);
        io.to(receiverId.toString()).emit("newMessage", message);
      }
    }

    res.status(201).json({ success: true, message });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔵 2. GET 1-ON-1 CONVERSATION HISTORY
router.get("/:partnerId/messages", authMiddleware, async (req, res) => {
  try {
    const senderInfo = getSenderInfo(req);
    const messages = await Message.find({
      isGroupMessage: false,
      $or: [
        { sender: senderInfo.id, receiver: req.params.partnerId },
        { sender: req.params.partnerId, receiver: senderInfo.id },
      ],
      deletedForMe: { $ne: senderInfo.id } 
    }).populate('replyTo', 'content messageType sender mediaUrl').sort({ timestamp: 1 });

    const formattedMessages = messages.map(msg => {
      if (msg.isDeletedForEveryone) { msg.content = "🚫 This message was deleted"; msg.mediaUrl = null; }
      return msg;
    });

    res.status(200).json({ success: true, messages: formattedMessages });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 🔥 3. GET GROUP CONVERSATION HISTORY (NEW)
router.get("/group/:groupId/messages", authMiddleware, async (req, res) => {
    try {
      const senderInfo = getSenderInfo(req);
      
      // Verify user is in the group first
      const group = await Group.findById(req.params.groupId);
      if (!group || !group.members.some(m => m.memberId.toString() === senderInfo.id.toString())) {
          return res.status(403).json({ success: false, message: "Not a member of this group" });
      }

      const messages = await Message.find({
        isGroupMessage: true, group: req.params.groupId,
        deletedForMe: { $ne: senderInfo.id } 
      }).populate('replyTo', 'content messageType sender mediaUrl').sort({ timestamp: 1 });
  
      const formattedMessages = messages.map(msg => {
        if (msg.isDeletedForEveryone) { msg.content = "🚫 This message was deleted"; msg.mediaUrl = null; }
        return msg;
      });
  
      res.status(200).json({ success: true, messages: formattedMessages });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 🟠 4. MARK 1-ON-1 READ
router.put("/read-all/:partnerId", authMiddleware, async (req, res) => {
  try {
    const senderInfo = getSenderInfo(req);
    await Message.updateMany(
      { sender: req.params.partnerId, receiver: senderInfo.id, read: false },
      { $set: { read: true, status: 'read' } }
    );
    const io = req.app.get("socketio");
    if (io) io.to(req.params.partnerId).emit("messagesSeen", { by: senderInfo.id });
    res.status(200).json({ success: true });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 5. MARK GROUP MESSAGES READ (NEW)
router.put("/group/:groupId/read-all", authMiddleware, async (req, res) => {
    try {
      const senderInfo = getSenderInfo(req);
      await Message.updateMany(
        { isGroupMessage: true, group: req.params.groupId, readBy: { $ne: senderInfo.id } },
        { $addToSet: { readBy: senderInfo.id } } // Add user to readBy array
      );
      res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔴 6. DELETE MESSAGE (Handles both 1-on-1 and Group)
router.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const userInfo = getSenderInfo(req);
    const { deleteType } = req.query; // 'me' or 'everyone'
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: "Not found" });

    const io = req.app.get("socketio");

    if (deleteType === 'everyone') {
      if (message.sender.toString() !== userInfo.id.toString()) return res.status(403).json({ message: "Unauthorized" });
      
      message.isDeletedForEveryone = true;
      if (message.mediaPublicId) {
        const resType = message.messageType === 'audio' ? 'video' : 'image';
        await cloudinary.uploader.destroy(message.mediaPublicId, { resource_type: resType });
        message.mediaPublicId = null;
      }
      await message.save();

      if (io) {
        if (message.isGroupMessage) io.to(`group_${message.group}`).emit("messageUpdated", message);
        else {
            io.to(message.receiver.toString()).emit("messageUpdated", message);
            io.to(message.sender.toString()).emit("messageUpdated", message);
        }
      }
    } else {
      message.deletedForMe.push(userInfo.id);
      await message.save();
      if (io) io.to(userInfo.id.toString()).emit("messageDeletedLocally", req.params.id);
    }
    res.status(200).json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 🟡 7. REACT TO MESSAGE 
router.post("/messages/:id/react", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const { emoji } = req.body; 
        const message = await Message.findById(req.params.id);

        if (!message) return res.status(404).json({ message: "Message not found" });

        message.reactions = message.reactions.filter(r => r.userId.toString() !== userInfo.id.toString());
        if (emoji) message.reactions.push({ userId: userInfo.id, emoji });
        await message.save();

        const io = req.app.get("socketio");
        if (io) {
            if(message.isGroupMessage) io.to(`group_${message.group}`).emit("messageUpdated", message);
            else {
                io.to(message.sender.toString()).emit("messageUpdated", message);
                io.to(message.receiver.toString()).emit("messageUpdated", message);
            }
        }
        res.status(200).json({ success: true, message });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🟣 8. GET UNIFIED CHAT LIST (Groups + 1-on-1 Mixed like WhatsApp)
router.get("/list/conversations", authMiddleware, async (req, res) => {
  try {
    const senderInfo = getSenderInfo(req);
    const myObjectId = new mongoose.Types.ObjectId(senderInfo.id);

    // 1. Get 1-on-1 Chats
    const oneOnOneChats = await Message.aggregate([
      { $match: { isGroupMessage: false, $or: [{ sender: myObjectId }, { receiver: myObjectId }] } },
      { $sort: { timestamp: -1 } },
      { $group: {
          _id: { $cond: [{ $eq: ["$sender", myObjectId] }, "$receiver", "$sender"] },
          lastMessage: { $first: "$content" }, lastMessageType: { $first: "$messageType" },
          timestamp: { $first: "$timestamp" },
          partnerModel: { $first: { $cond: [{ $eq: ["$sender", myObjectId] }, "$receiverModel", "$senderModel"] } },
          unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ["$receiver", myObjectId] }, { $eq: ["$read", false] }] }, 1, 0] } }
      }},
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
      { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendorInfo' } },
      { $project: {
          _id: 1, isGroup: { $literal: false }, lastMessage: 1, lastMessageType: 1, timestamp: 1, unreadCount: 1,
          contact: {
              $let: {
                  vars: { info: { $cond: [{ $gt: [{ $size: "$userInfo" }, 0] }, { $arrayElemAt: ["$userInfo", 0] }, { $arrayElemAt: ["$vendorInfo", 0] }] } },
                  in: { _id: "$$info._id", name: "$$info.name", shopName: "$$info.shopName", profilePic: { $ifNull: ["$$info.profilePic", "$$info.shopImage"] }, role: "$partnerModel" }
              }
          }
      }}
    ]);

    // 2. Get Group Chats
    const userGroups = await Group.find({ "members.memberId": myObjectId });
    const groupChats = await Promise.all(userGroups.map(async (group) => {
        const lastMsg = await Message.findOne({ isGroupMessage: true, group: group._id }).sort({ timestamp: -1 });
        const unreadCount = await Message.countDocuments({ isGroupMessage: true, group: group._id, readBy: { $ne: myObjectId } });
        
        return {
            _id: group._id, isGroup: true,
            lastMessage: lastMsg ? lastMsg.content : "Group created",
            lastMessageType: lastMsg ? lastMsg.messageType : "text",
            timestamp: lastMsg ? lastMsg.timestamp : group.createdAt,
            unreadCount: unreadCount,
            contact: { _id: group._id, name: group.name, profilePic: group.avatarUrl, role: "Group" }
        };
    }));

    // 3. Merge and Sort by timestamp
    const combinedChatList = [...oneOnOneChats, ...groupChats].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({ success: true, chatList: combinedChatList });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;