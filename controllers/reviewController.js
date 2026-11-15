// controllers/reviewController.js
const Review = require('../models/Review');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const {
  sendPushNotificationToVendor,
} = require('../services/notificationService');

// ═════════════════════════════════════════════════════════
// GET VENDOR REVIEWS (public)
// ═════════════════════════════════════════════════════════
exports.getVendorReviews = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ vendor: vendorId })
      .populate('user', 'name profilePic')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ vendor: vendorId });
    res.json({
      status: 'success',
      results: reviews.length,
      total,
      page,
      data: reviews,
    });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};

// ═════════════════════════════════════════════════════════
// CREATE REVIEW + PUSH NOTIFICATION TO VENDOR
// ═════════════════════════════════════════════════════════
exports.createReview = async (req, res) => {
  try {
    const { vendorId, rating, comment, images, isVerified } = req.body;
    const userId = req.user.userId;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res
        .status(404)
        .json({ status: 'fail', message: 'Vendor not found' });
    }

    const review = await Review.create({
      vendor: vendorId,
      user: userId,
      rating,
      comment,
      images: images || [],
      isVerified: isVerified || false,
    });

    // Recalculate vendor rating stats
    const stats = await Review.aggregate([
      { $match: { vendor: vendor._id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (stats.length > 0) {
      vendor.averageRating = Math.round(stats[0].avg * 10) / 10;
      vendor.reviewCount = stats[0].count;
    } else {
      vendor.averageRating = 0;
      vendor.reviewCount = 0;
    }
    await vendor.save();

    // 🔔 Send push notification to the vendor
    try {
      const reviewer = await User.findById(userId).select('name');
      const reviewerName = reviewer?.name || 'Someone';
      const starCount = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
      const stars = '⭐'.repeat(starCount);

      const trimmedComment = (comment || '').trim();
      const preview =
        trimmedComment.length > 80
          ? trimmedComment.slice(0, 80) + '...'
          : trimmedComment || 'No comment';

      console.log(
        `📤 [Review] Sending review push to vendor ${vendorId} from ${reviewerName}`
      );

      await sendPushNotificationToVendor(
        String(vendor._id),
        `${stars} New Review`,
        `${reviewerName} rated you ${rating}/5: ${preview}`,
        {
          type: 'review',
          reviewId: String(review._id),
          vendorId: String(vendor._id),
          userId: String(userId),
          rating: Number(rating),
          timestamp: new Date().toISOString(),
        }
      );

      console.log(`✅ [Review] Push sent to vendor ${vendorId}`);
    } catch (pushErr) {
      console.error('❌ [Review] Push notification failed:', pushErr);
      // Do not fail the request — the review was saved successfully
    }

    res.status(201).json({ status: 'success', data: review });
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

// ═════════════════════════════════════════════════════════
// UPDATE REVIEW
// ═════════════════════════════════════════════════════════
exports.updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { rating, comment, images } = req.body;

    const review = await Review.findById(id);
    if (!review) {
      return res
        .status(404)
        .json({ status: 'fail', message: 'Review not found' });
    }
    if (review.user.toString() !== userId) {
      return res
        .status(403)
        .json({ status: 'fail', message: 'Not authorized to edit this review' });
    }

    review.rating = rating || review.rating;
    review.comment = comment || review.comment;
    review.images = images || review.images;
    review.updatedAt = new Date();
    await review.save();

    const vendor = await Vendor.findById(review.vendor);
    const stats = await Review.aggregate([
      { $match: { vendor: vendor._id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (stats.length > 0) {
      vendor.averageRating = Math.round(stats[0].avg * 10) / 10;
      vendor.reviewCount = stats[0].count;
    } else {
      vendor.averageRating = 0;
      vendor.reviewCount = 0;
    }
    await vendor.save();

    res.json({ status: 'success', data: review });
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

// ═════════════════════════════════════════════════════════
// DELETE REVIEW
// ═════════════════════════════════════════════════════════
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const review = await Review.findById(id);
    if (!review) {
      return res
        .status(404)
        .json({ status: 'fail', message: 'Review not found' });
    }
    if (review.user.toString() !== userId) {
      return res
        .status(403)
        .json({
          status: 'fail',
          message: 'Not authorized to delete this review',
        });
    }

    await review.deleteOne();

    const vendor = await Vendor.findById(review.vendor);
    const stats = await Review.aggregate([
      { $match: { vendor: vendor._id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (stats.length > 0) {
      vendor.averageRating = Math.round(stats[0].avg * 10) / 10;
      vendor.reviewCount = stats[0].count;
    } else {
      vendor.averageRating = 0;
      vendor.reviewCount = 0;
    }
    await vendor.save();

    res.status(204).json({ status: 'success', data: null });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};