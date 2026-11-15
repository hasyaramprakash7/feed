// models/Lead.js
const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: [true, 'Vendor ID is required'],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },
    type: {
      type: String,
      enum: {
        values: ['call', 'whatsapp', 'email', 'quote', 'view'],
        message: 'Type must be one of: call, whatsapp, email, quote, view',
      },
      default: 'view',
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['new', 'seen', 'replied', 'converted'],
        message: 'Status must be one of: new, seen, replied, converted',
      },
      default: 'new',
      index: true,
    },
    viewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// --- Indexes for better query performance ---
leadSchema.index({ vendor: 1, createdAt: -1 });
leadSchema.index({ user: 1, createdAt: -1 });
leadSchema.index({ status: 1, type: 1 });
leadSchema.index({ createdAt: -1 });

// --- Virtuals ---
leadSchema.virtual('isNew').get(function () {
  return this.status === 'new';
});

leadSchema.virtual('isView').get(function () {
  return this.type === 'view';
});

// --- Methods ---
leadSchema.methods.markAsSeen = async function () {
  if (this.status === 'new') {
    this.status = 'seen';
    await this.save();
  }
  return this;
};

leadSchema.methods.markAsReplied = async function () {
  this.status = 'replied';
  await this.save();
  return this;
};

leadSchema.methods.markAsConverted = async function () {
  this.status = 'converted';
  await this.save();
  return this;
};

// --- Static Methods ---
leadSchema.statics.getVendorStats = async function (vendorId) {
  try {
    console.log(`📊 [Lead.getVendorStats] Fetching stats for vendor: ${vendorId}`);
    
    if (!vendorId) {
      console.log('⚠️ [Lead.getVendorStats] No vendorId provided, returning default stats');
      return {
        total: 0,
        today: 0,
        byType: { call: 0, whatsapp: 0, email: 0, quote: 0, view: 0 },
        byStatus: { new: 0, seen: 0, replied: 0, converted: 0 },
      };
    }

    // Get total count
    const total = await this.countDocuments({ vendor: vendorId });
    console.log(`📊 [Lead.getVendorStats] Total leads: ${total}`);

    // Get today's count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayCount = await this.countDocuments({
      vendor: vendorId,
      createdAt: { $gte: today, $lt: tomorrow },
    });
    console.log(`📊 [Lead.getVendorStats] Today's leads: ${todayCount}`);

    // Get by type
    const byType = await this.aggregate([
      { $match: { vendor: new mongoose.Types.ObjectId(vendorId) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    console.log(`📊 [Lead.getVendorStats] By type raw:`, JSON.stringify(byType));

    // Get by status
    const byStatus = await this.aggregate([
      { $match: { vendor: new mongoose.Types.ObjectId(vendorId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    console.log(`📊 [Lead.getVendorStats] By status raw:`, JSON.stringify(byStatus));

    // Convert to objects
    const typeStats = {};
    byType.forEach((stat) => { 
      if (stat._id) typeStats[stat._id] = stat.count; 
    });

    const statusStats = {};
    byStatus.forEach((stat) => { 
      if (stat._id) statusStats[stat._id] = stat.count; 
    });

    // Ensure all statuses are included even if 0
    const allStatuses = ['new', 'seen', 'replied', 'converted'];
    allStatuses.forEach(status => {
      if (!statusStats[status]) statusStats[status] = 0;
    });

    // Ensure all types are included even if 0
    const allTypes = ['call', 'whatsapp', 'email', 'quote', 'view'];
    allTypes.forEach(type => {
      if (!typeStats[type]) typeStats[type] = 0;
    });

    const result = {
      total,
      today: todayCount,
      byType: typeStats,
      byStatus: statusStats,
    };

    console.log(`📊 [Lead.getVendorStats] Final stats:`, JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('❌ [Lead.getVendorStats] Error:', error);
    // Return default stats instead of throwing
    return {
      total: 0,
      today: 0,
      byType: { call: 0, whatsapp: 0, email: 0, quote: 0, view: 0 },
      byStatus: { new: 0, seen: 0, replied: 0, converted: 0 },
    };
  }
};

module.exports = mongoose.model('Lead', leadSchema);