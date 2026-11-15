const mongoose = require('mongoose');

const productViewSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'productType' },
  productType: { type: String, enum: ['Property', 'Rental'], required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  viewerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  viewerName: { type: String, required: true },
  viewerPhone: { type: String, required: true },
  viewedAt: { type: Date, default: Date.now },
});

// Index for vendor queries
productViewSchema.index({ vendorId: 1, viewedAt: -1 });
productViewSchema.index({ productId: 1 });

module.exports = mongoose.model('ProductView', productViewSchema);