const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  avatarUrl: { type: String }, // Group icon
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'adminModel',
  },
  adminModel: { type: String, enum: ['User', 'Vendor', 'DeliveryBoy'] },
  members: [{
    memberId: { type: mongoose.Schema.Types.ObjectId, refPath: 'members.memberModel' },
    memberModel: { type: String, enum: ['User', 'Vendor', 'DeliveryBoy'] },
    joinedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Group', GroupSchema);