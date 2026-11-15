const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary"); 
const Status = require("../models/Status");
const { authMiddleware } = require("../middleware/authMiddleware");

const storage = multer.memoryStorage();
const upload = multer({ storage });

const getSenderInfo = (req) => {
    const data = req.user || req.vendor || req.deliveryBoy;
    if (!data) return null;
    const rawRole = data.role || "User";
    return { id: data.userId || data.vendorId || data.deliveryBoyId || data._id, role: rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase() };
};

const uploadToCloudinary = (buffer, messageType) =>
  new Promise((resolve, reject) => {
    const resourceType = messageType === 'video' ? 'video' : 'image';
    const stream = cloudinary.uploader.upload_stream(
      { folder: "bluxury_status", resource_type: resourceType },
      (err, result) => { if (result) resolve({ url: result.secure_url, publicId: result.public_id }); else reject(err); }
    );
    streamifier.createReadStream(buffer).pipe(stream);
});

// 🟢 1. UPLOAD A STATUS (Create)
router.post("/create", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const userInfo = getSenderInfo(req);
    const { caption, messageType } = req.body;

    if (!req.file) return res.status(400).json({ success: false, message: "File required" });

    const { url, publicId } = await uploadToCloudinary(req.file.buffer, messageType || 'image');

    const newStatus = await Status.create({
      author: userInfo.id, authorModel: userInfo.role,
      mediaUrl: url, mediaPublicId: publicId, messageType: messageType || 'image', caption: caption || ""
    });

    res.status(201).json({ success: true, status: newStatus });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔵 2. GET STATUS FEED 
router.get("/feed", authMiddleware, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const statuses = await Status.aggregate([
      { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: "$author", authorModel: { $first: "$authorModel" }, statuses: { $push: "$$ROOT" } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
      { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendorInfo' } },
      { $addFields: { authorDetails: { $cond: { if: { $gt: [{ $size: "$userInfo" }, 0] }, then: { $arrayElemAt: ["$userInfo", 0] }, else: { $arrayElemAt: ["$vendorInfo", 0] } } } } },
      { $project: { _id: 1, authorModel: 1, statuses: 1, authorDetails: { name: 1, shopName: 1, profilePic: 1, shopImage: 1 } } }
    ]);

    res.status(200).json({ success: true, feed: statuses });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 3. GET MY ACTIVE STATUSES (Read/Manage)
router.get("/my-statuses", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const myStatuses = await Status.find({
            author: userInfo.id,
            createdAt: { $gte: twentyFourHoursAgo }
        }).sort({ createdAt: -1 });

        res.status(200).json({ success: true, statuses: myStatuses });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 4. GET STATUS VIEWERS LIST
router.get("/:statusId/viewers", authMiddleware, async (req, res) => {
    try {
        const userInfo = getSenderInfo(req);
        const status = await Status.findById(req.params.statusId);
        
        if (!status) return res.status(404).json({ success: false, message: "Status not found" });
        if (status.author.toString() !== userInfo.id.toString()) return res.status(403).json({ success: false, message: "Unauthorized" });

        // Manually aggregate to populate viewer details across different models
        const populatedStatus = await Status.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(req.params.statusId) } },
            { $unwind: "$viewers" },
            { $lookup: { from: 'users', localField: 'viewers.viewerId', foreignField: '_id', as: 'userViewer' } },
            { $lookup: { from: 'vendors', localField: 'viewers.viewerId', foreignField: '_id', as: 'vendorViewer' } },
            { $addFields: {
                "viewers.details": {
                    $cond: [{ $gt: [{ $size: "$userViewer" }, 0] }, { $arrayElemAt: ["$userViewer", 0] }, { $arrayElemAt: ["$vendorViewer", 0] }]
                }
            }},
            { $project: {
                "viewers.viewerId": 1, "viewers.viewedAt": 1, "viewers.viewerModel": 1,
                "viewers.details.name": 1, "viewers.details.shopName": 1, "viewers.details.profilePic": 1, "viewers.details.shopImage": 1
            }}
        ]);

        const formattedViewers = populatedStatus.map(s => s.viewers);
        res.status(200).json({ success: true, viewers: formattedViewers, viewCount: formattedViewers.length });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🟠 5. MARK STATUS AS VIEWED
router.put("/view/:statusId", authMiddleware, async (req, res) => {
  try {
    const userInfo = getSenderInfo(req);
    await Status.findByIdAndUpdate(req.params.statusId, {
      $addToSet: { viewers: { viewerId: userInfo.id, viewerModel: userInfo.role } }
    });
    res.status(200).json({ success: true });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 🔥 6. UPDATE STATUS CAPTION (Update)
router.put("/:statusId", authMiddleware, async (req, res) => {
    try {
      const userInfo = getSenderInfo(req);
      const { caption } = req.body;
      const status = await Status.findById(req.params.statusId);
      
      if (!status) return res.status(404).json({ message: "Not found" });
      if (status.author.toString() !== userInfo.id.toString()) return res.status(403).json({ message: "Unauthorized" });
  
      status.caption = caption;
      await status.save();
      
      res.status(200).json({ success: true, status });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 🔴 7. DELETE OWN STATUS MANUALLY (Delete)
router.delete("/:statusId", authMiddleware, async (req, res) => {
  try {
    const userInfo = getSenderInfo(req);
    const status = await Status.findById(req.params.statusId);
    
    if (!status) return res.status(404).json({ message: "Not found" });
    if (status.author.toString() !== userInfo.id.toString()) return res.status(403).json({ message: "Unauthorized" });

    if (status.mediaPublicId) {
        await cloudinary.uploader.destroy(status.mediaPublicId, { resource_type: status.messageType === 'video' ? 'video' : 'image' });
    }
    await Status.findByIdAndDelete(req.params.statusId);
    
    res.status(200).json({ success: true, message: "Status deleted" });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;