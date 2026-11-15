const mongoose = require('mongoose');

const StatusSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'authorModel',
  },
  authorModel: {
    type: String,
    required: true,
    enum: ['User', 'Vendor', 'DeliveryBoy'],
  },
  mediaUrl: { type: String, required: true },
  mediaPublicId: { type: String, required: true },
  messageType: { type: String, enum: ['image', 'video'], required: true },
  caption: { type: String, default: "" },
  
  viewers: [{
    viewerId: { type: mongoose.Schema.Types.ObjectId },
    viewerModel: { type: String, enum: ['User', 'Vendor', 'DeliveryBoy'] },
    viewedAt: { type: Date, default: Date.now }
  }],

  // 🔥 REMOVED the MongoDB TTL "expires" flag. 
  // We handle deletion manually via our Cron Job to clean Cloudinary.
  createdAt: { type: Date, default: Date.now }
});

// ⚡ THE CPU SAVER: This index is mandatory for the Cron Job
// It allows MongoDB to find expired statuses instantly without scanning the whole database.
StatusSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Status', StatusSchema);