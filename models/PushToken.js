// models/PushToken.js
const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema(
  {
    ownerId: {
      type: String,
      required: true,
      index: true,
    },
    ownerType: {
      type: String,
      enum: ['user', 'vendor', 'deliveryBoy', 'admin'],
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web', 'unknown'],
      default: 'unknown',
    },
    deviceInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

pushTokenSchema.index(
  { ownerId: 1, ownerType: 1, token: 1 },
  { unique: true }
);
pushTokenSchema.index({ ownerId: 1, ownerType: 1 });
pushTokenSchema.index({ lastUsed: 1 });

module.exports =
  mongoose.models.PushToken || mongoose.model('PushToken', pushTokenSchema);