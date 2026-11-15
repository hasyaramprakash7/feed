const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel', 
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['User', 'Vendor', 'DeliveryBoy'],
  },
  
  // --- 1-ON-1 CHAT FIELDS ---
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'receiverModel', 
  },
  receiverModel: {
    type: String,
    enum: ['User', 'Vendor', 'DeliveryBoy'],
  },

  // --- GROUP CHAT FIELDS ---
  isGroupMessage: { type: Boolean, default: false },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  readBy: [{ type: mongoose.Schema.Types.ObjectId }], 

  // --- COMMON FIELDS ---
  messageType: {
    type: String,
    enum: ['text', 'image', 'audio', 'video', 'product'], 
    default: 'text'
  },
  content: {
    type: String,
    required: function() { return this.messageType === 'text'; }
  },
  mediaUrl: { type: String },      
  mediaPublicId: { type: String }, 

  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'VendorProduct', 
    default: null 
  },

  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }, 

  // ==========================================
  // 🔥 WHATSAPP FEATURES
  // ==========================================

  status: { 
    type: String, 
    enum: ['sent', 'delivered', 'read'], 
    default: 'sent' 
  },

  replyTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Message',
    default: null 
  },

  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId },
    emoji: { type: String }, 
    timestamp: { type: Date, default: Date.now }
  }],

  isDeletedForEveryone: { type: Boolean, default: false },
  deletedForMe: [{ type: mongoose.Schema.Types.ObjectId }]
});

module.exports = mongoose.model('Message', MessageSchema);