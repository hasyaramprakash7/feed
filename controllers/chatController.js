const Message = require("../models/Message");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const DeliveryBoy = require("../models/DeliveryBoy");
const Group = require("../models/Group"); // <-- New
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const mongoose = require("mongoose");

// --- Helper: Upload to Cloudinary ---
const uploadToCloudinary = (buffer, messageType) => {
  return new Promise((resolve, reject) => {
    const resourceType = (messageType === 'audio' || messageType === 'video') ? 'video' : 'image';
    const stream = cloudinary.uploader.upload_stream(
      { folder: "ecommerce_chat_media", resource_type: resourceType },
      (err, result) => {
        if (result) resolve({ url: result.secure_url, publicId: result.public_id });
        else reject(err);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

const getModelFromRole = (role) => {
  if (role === 'vendor' || role === 'Vendor' || role === 'admin') return 'Vendor';
  if (role === 'deliveryBoy' || role === 'DeliveryBoy') return 'DeliveryBoy';
  return 'User';
};

// 🟢 1. SEND MESSAGE (Updated for Groups)
exports.sendMessage = async (req, res) => {
  try {
    const { receiverId, receiverRole, groupId, messageType, content } = req.body;
    
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const senderId = senderData.userId || senderData.vendorId || senderData.deliveryBoyId;
    const senderRole = senderData.role;
    const senderModel = getModelFromRole(senderRole); 

    const newMessageData = {
      sender: senderId,
      senderModel,
      messageType: messageType || 'text',
      content,
      timestamp: new Date()
    };

    // Handle Group vs 1-on-1
    if (groupId) {
      newMessageData.isGroupMessage = true;
      newMessageData.group = groupId;
      newMessageData.readBy = [senderId]; // Sender read their own message
    } else {
      newMessageData.receiver = receiverId;
      newMessageData.receiverModel = getModelFromRole(receiverRole);
    }

    if (req.file) {
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, newMessageData.messageType);
      newMessageData.mediaUrl = url;
      newMessageData.mediaPublicId = publicId;
    }

    const message = await Message.create(newMessageData);
    const populated = await message.populate('sender', 'name email shopName profilePic shopImage phone');

    // Real-time Socket Emit
    const io = req.app.get("socketio");
    if (io) {
      if (groupId) {
        // Broadcast to group room
        io.to(`group_${groupId}`).emit("newMessage", populated);
      } else {
        io.to(senderId.toString()).emit("newMessage", populated);
        io.to(receiverId.toString()).emit("newMessage", populated);
      }
    }

    res.status(201).json({ success: true, message: populated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🟡 2. GET CONVERSATIONS (Inbox) - Updated to merge 1-on-1 and Groups
exports.getConversations = async (req, res) => {
  try {
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = new mongoose.Types.ObjectId(senderData.userId || senderData.vendorId || senderData.deliveryBoyId);

    // 1. Get 1-on-1 Chats (Your existing exact aggregation)
    const chatList = await Message.aggregate([
      { $match: { isGroupMessage: { $ne: true }, $or: [{ sender: myId }, { receiver: myId }] } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$sender", myId] }, "$receiver", "$sender"] },
          partnerModel: { $first: { $cond: [{ $eq: ["$sender", myId] }, "$receiverModel", "$senderModel"] } },
          lastMessage: { $first: "$content" },
          lastMessageType: { $first: "$messageType" },
          timestamp: { $first: "$timestamp" },
          unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ["$receiver", myId] }, { $eq: ["$read", false] }] }, 1, 0] } }
        }
      }
    ]);

    // Populate 1-on-1 Contacts
    const populatedDirectChats = await Promise.all(chatList.map(async (chat) => {
      let Model;
      const modelName = chat.partnerModel || 'User'; 
      if (modelName === 'User') Model = User;
      else if (modelName === 'Vendor') Model = Vendor;
      else if (modelName === 'DeliveryBoy') Model = DeliveryBoy;

      if (!Model) return null;
      const contact = await Model.findById(chat._id).select("name email shopName profilePic shopImage phone");
      if (!contact) return null; 
      
      return { ...chat, isGroup: false, contact };
    }));

    // 2. Get Group Chats
    const myGroups = await Group.find({ 'members.memberId': myId });
    const groupChats = await Promise.all(myGroups.map(async (group) => {
      const lastMsg = await Message.findOne({ group: group._id }).sort({ timestamp: -1 });
      const unreadCount = await Message.countDocuments({ group: group._id, readBy: { $ne: myId } });
      
      return {
        _id: group._id,
        isGroup: true,
        lastMessage: lastMsg ? lastMsg.content : "No messages yet",
        lastMessageType: lastMsg ? lastMsg.messageType : "text",
        timestamp: lastMsg ? lastMsg.timestamp : group.createdAt,
        unreadCount: unreadCount,
        contact: {
          _id: group._id,
          name: group.name,
          profilePic: group.groupImage,
          role: 'Group',
          members: group.members
        }
      };
    }));

    // 3. Merge and Sort both lists
    let validChats = [...populatedDirectChats.filter(c => c !== null), ...groupChats];
    validChats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.status(200).json({ success: true, chatList: validChats });
  } catch (error) {
    console.error("[Backend] Error in getConversations:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔵 3. GET HISTORY (Updated for Groups)
exports.getHistory = async (req, res) => {
  try {
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = new mongoose.Types.ObjectId(senderData.userId || senderData.vendorId || senderData.deliveryBoyId);
    const partnerId = req.params.partnerId; // Can be UserId or GroupId
    const isGroup = req.query.isGroup === 'true';

    let query = {};
    if (isGroup) {
      query = { group: new mongoose.Types.ObjectId(partnerId) };
    } else {
      query = {
        $or: [
          { sender: myId, receiver: new mongoose.Types.ObjectId(partnerId) },
          { sender: new mongoose.Types.ObjectId(partnerId), receiver: myId }
        ],
        isGroupMessage: { $ne: true }
      };
    }

    const messages = await Message.find(query)
      .sort({ timestamp: 1 })
      .populate('sender', 'name shopName profilePic shopImage') 
      .populate('receiver', 'name shopName profilePic shopImage');

    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟠 4. MARK READ (Updated for Groups)
exports.markRead = async (req, res) => {
  try {
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = senderData.userId || senderData.vendorId || senderData.deliveryBoyId;
    const isGroup = req.body.isGroup === true;

    if (isGroup) {
      // Add user to readBy array for all group messages they haven't read
      await Message.updateMany(
        { group: req.params.partnerId, readBy: { $ne: myId } },
        { $push: { readBy: myId } }
      );
    } else {
      await Message.updateMany(
        { sender: req.params.partnerId, receiver: myId, read: false },
        { $set: { read: true } }
      );
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔥 5. BATCH DELETE (Preserved)
exports.deleteBatch = async (req, res) => {
  try {
    const { ids } = req.body;
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = senderData.userId || senderData.vendorId || senderData.deliveryBoyId;

    const messages = await Message.find({ _id: { $in: ids }, sender: myId });
    if (messages.length === 0) return res.status(404).json({ success: false, message: "No messages found or unauthorized" });

    // Cloudinary Cleanup
    const cloudinaryDeletions = messages
      .filter(m => m.mediaPublicId)
      .map(m => {
        const type = (m.messageType === 'audio' || m.messageType === 'video') ? 'video' : 'image';
        return cloudinary.uploader.destroy(m.mediaPublicId, { resource_type: type });
      });
    
    await Promise.all(cloudinaryDeletions);
    await Message.deleteMany({ _id: { $in: ids }, sender: myId });

    const io = req.app.get("socketio");
    if (io) {
      messages.forEach(m => {
        if (m.isGroupMessage) {
          io.to(`group_${m.group}`).emit("messageDeleted", m._id);
        } else {
          io.to(m.sender.toString()).emit("messageDeleted", m._id);
          io.to(m.receiver.toString()).emit("messageDeleted", m._id);
        }
      });
    }

    res.status(200).json({ success: true, deletedIds: ids });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🧨 6. DELETE FULL CHAT (NEW FEATURE)
exports.deleteFullChat = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const { isGroup } = req.query; 
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = new mongoose.Types.ObjectId(senderData.userId || senderData.vendorId || senderData.deliveryBoyId);

    let messagesToDelete = [];

    if (isGroup === 'true') {
      // Find all messages in the group
      messagesToDelete = await Message.find({ group: partnerId });
      // Security check: Might want to verify if user is group admin before allowing full deletion
      await Message.deleteMany({ group: partnerId });
    } else {
      // Find all 1-on-1 messages between these two users
      messagesToDelete = await Message.find({
        $or: [
          { sender: myId, receiver: partnerId },
          { sender: partnerId, receiver: myId }
        ],
        isGroupMessage: { $ne: true }
      });
      await Message.deleteMany({
        $or: [
          { sender: myId, receiver: partnerId },
          { sender: partnerId, receiver: myId }
        ],
        isGroupMessage: { $ne: true }
      });
    }

    // Cleanup Cloudinary media for deleted messages
    const cloudinaryDeletions = messagesToDelete
      .filter(m => m.mediaPublicId)
      .map(m => {
        const type = (m.messageType === 'audio' || m.messageType === 'video') ? 'video' : 'image';
        return cloudinary.uploader.destroy(m.mediaPublicId, { resource_type: type }).catch(e => console.log("Cloudinary err:", e));
      });
    
    await Promise.all(cloudinaryDeletions);

    // Notify sockets to clear UI
    const io = req.app.get("socketio");
    if (io) {
      if (isGroup === 'true') {
        io.to(`group_${partnerId}`).emit("fullChatDeleted", { partnerId, isGroup: true });
      } else {
        io.to(myId.toString()).emit("fullChatDeleted", { partnerId, isGroup: false });
        io.to(partnerId.toString()).emit("fullChatDeleted", { partnerId: myId.toString(), isGroup: false });
      }
    }

    res.status(200).json({ success: true, message: "Full chat deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 👥 7. CREATE GROUP (NEW)
exports.createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body; // members = [{memberId, memberModel}]
    const senderData = req.user || req.vendor || req.deliveryBoy;
    const myId = senderData.userId || senderData.vendorId || senderData.deliveryBoyId;
    const adminModel = getModelFromRole(senderData.role);

    // Include creator in members array automatically
    const allMembers = [...members, { memberId: myId, memberModel: adminModel }];

    let groupImage = null;
    let groupImagePublicId = null;

    if (req.file) {
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, 'image');
      groupImage = url;
      groupImagePublicId = publicId;
    }

    const newGroup = await Group.create({
      name,
      description,
      admin: myId,
      adminModel,
      members: allMembers,
      groupImage,
      groupImagePublicId
    });

    res.status(201).json({ success: true, group: newGroup });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};