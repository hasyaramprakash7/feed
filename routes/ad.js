// routes/ad.js
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const adController = require('../controllers/adController');
const {
  authMiddleware,
  optionalAuth,
  isVendor,
} = require('../middleware/authMiddleware');
const {
  uploadAd,
  uploadStory,
  uploadMessage,
} = require('../config/multerR2');

const router = express.Router();

// ═════════════════════════════════════════════════════════
// RATE LIMIT — protect /map/bounds from abuse (Fix 8)
// ═════════════════════════════════════════════════════════
const mapLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many map requests' },
});

// ═════════════════════════════════════════════════════════
// MULTER WRAPPER (unchanged from your existing code)
// ═════════════════════════════════════════════════════════
const wrapMulter = (uploadFn, name) => (req, res, next) => {
  console.log(`\n🟠[multer:${name}] ══════════════════════════════`);
  console.log(`🟠[multer:${name}] 🚀 START`);
  console.log(`🟠[multer:${name}] content-type: ${req.headers['content-type']?.slice(0, 80)}`);
  console.log(`🟠[multer:${name}] content-length: ${req.headers['content-length']} bytes`);

  const t0 = Date.now();

  uploadFn(req, res, (err) => {
    const elapsed = Date.now() - t0;

    if (err) {
      console.error(`\n🟠[multer:${name}] ❌ UPLOAD FAILED in ${elapsed}ms`);
      console.error(`🟠[multer:${name}]    name: ${err?.name}`);
      console.error(`🟠[multer:${name}]    message: ${err?.message}`);
      console.error(`🟠[multer:${name}]    code: ${err?.code}`);

      if (err?.name === 'MulterError') {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `File too large. Max size exceeded for ${err.field || 'field'}.`
            : err.message;
        return res.status(400).json({
          success: false,
          message,
          code: err.code,
          field: err.field,
        });
      }

      if (err?.http_code) {
        return res.status(err.http_code).json({
          success: false,
          message: err.message || 'Cloudinary upload failed',
        });
      }

      return res.status(500).json({
        success: false,
        message: err?.message || 'Upload failed',
      });
    }

    console.log(`🟠[multer:${name}] ✅ UPLOAD OK in ${elapsed}ms`);
    next();
  });
};

// ═════════════════════════════════════════════════════════
// ID VALIDATION
// ═════════════════════════════════════════════════════════
const validateIdParam = (paramName = 'id') => (req, res, next) => {
  const value = req.params?.[paramName];
  if (value && !mongoose.Types.ObjectId.isValid(String(value))) {
    return res
      .status(400)
      .json({ success: false, message: `Invalid ${paramName}` });
  }
  next();
};

const guardId = validateIdParam('id');
const guardUserId = validateIdParam('userId');
const guardCommentId = validateIdParam('commentId');
const guardConversationId = validateIdParam('conversationId');

// ═════════════════════════════════════════════════════════
// IDENTITY ROUTES
// ═════════════════════════════════════════════════════════
router.get('/identities/search', optionalAuth, adController.searchIdentities);
router.post('/identities/resolve', optionalAuth, adController.resolveIdentities);

// ═════════════════════════════════════════════════════════
// FEED
// ═════════════════════════════════════════════════════════
router.get('/feed', optionalAuth, adController.getPersonalizedFeed);
router.get('/explore', optionalAuth, adController.getExploreFeed);
router.get('/search', optionalAuth, adController.search);

// ═════════════════════════════════════════════════════════
// HASHTAGS
// ═════════════════════════════════════════════════════════
router.get('/hashtags/search', optionalAuth, adController.searchHashtags);
router.get('/hashtags/trending', optionalAuth, adController.getTrendingHashtags);
router.get('/hashtags/:tag/posts', optionalAuth, adController.getPostsByHashtag);

// ═════════════════════════════════════════════════════════
// ANALYTICS
// ═════════════════════════════════════════════════════════
router.get('/analytics/user', authMiddleware, adController.getUserReachAnalytics);
router.get('/analytics/:id', authMiddleware, guardId, adController.getReachAnalytics);

// ═════════════════════════════════════════════════════════
// PUBLIC
// ═════════════════════════════════════════════════════════
router.get('/', optionalAuth, adController.getAllAds);
router.get('/active', optionalAuth, adController.getActiveAds);

// ✅ RATE-LIMITED map bounds
router.get(
  '/map/bounds',
  mapLimiter,
  optionalAuth,
  adController.getStatusesInBounds
);

// ═════════════════════════════════════════════════════════
// MY POSTS
// ═════════════════════════════════════════════════════════
router.get('/my-posts', authMiddleware, adController.getMyPosts);
router.get('/my-archive', authMiddleware, adController.getArchivedPosts);
router.get('/user/:userId', optionalAuth, guardUserId, adController.getPostsByUserId);

// ═════════════════════════════════════════════════════════
// ENGAGEMENT
// ═════════════════════════════════════════════════════════
router.post('/:id/like', authMiddleware, guardId, adController.toggleLike);
router.post('/:id/save', authMiddleware, guardId, adController.toggleSave);
router.post('/:id/view', optionalAuth, guardId, adController.trackView);
router.post('/:id/share', optionalAuth, guardId, adController.trackShare);
router.post('/:id/archive', authMiddleware, guardId, adController.archivePost);
router.post('/:id/unarchive', authMiddleware, guardId, adController.unarchivePost);
router.post('/:id/pin', authMiddleware, guardId, adController.togglePinPost);

// ═════════════════════════════════════════════════════════
// COMMENTS
// ═════════════════════════════════════════════════════════
router.get('/:id/comments', optionalAuth, guardId, adController.getComments);
router.post('/:id/comments', authMiddleware, guardId, adController.addComment);
router.delete(
  '/:id/comments/:commentId',
  authMiddleware,
  guardId,
  guardCommentId,
  adController.deleteComment
);
router.post(
  '/:id/comments/:commentId/like',
  authMiddleware,
  guardId,
  guardCommentId,
  adController.toggleCommentLike
);

// ═════════════════════════════════════════════════════════
// STORIES
// ═════════════════════════════════════════════════════════
router.get('/stories/active', optionalAuth, adController.getActiveStories);
router.get('/stories/my', authMiddleware, adController.getMyStories);
router.get(
  '/stories/user/:userId',
  optionalAuth,
  guardUserId,
  adController.getStoriesByUserId
);
router.post(
  '/stories',
  authMiddleware,
  wrapMulter(uploadStory, 'story'),
  adController.createStory
);
router.post('/stories/:id/view', authMiddleware, guardId, adController.viewStory);
router.post(
  '/stories/:id/react',
  authMiddleware,
  guardId,
  adController.reactToStory
);
router.delete('/stories/:id', authMiddleware, guardId, adController.deleteStory);

// ═════════════════════════════════════════════════════════
// FOLLOW
// ═════════════════════════════════════════════════════════
router.post('/follow/:userId', authMiddleware, guardUserId, adController.toggleFollow);
router.get('/followers/:userId', optionalAuth, guardUserId, adController.getFollowers);
router.get(
  '/following/check/:userId',
  optionalAuth,
  guardUserId,
  adController.checkFollowing
);
router.get('/following/:userId', optionalAuth, guardUserId, adController.getFollowing);
router.get('/suggested-users', optionalAuth, adController.getSuggestedUsers);

// ═════════════════════════════════════════════════════════
// PROFILE
// ═════════════════════════════════════════════════════════
router.get('/profile/:userId', optionalAuth, guardUserId, adController.getUserProfile);
router.put('/profile/stats', authMiddleware, adController.updateUserStats);
router.get('/dashboard', authMiddleware, adController.getUserDashboard);

// ═════════════════════════════════════════════════════════
// HIGHLIGHTS
// ═════════════════════════════════════════════════════════
router.get('/highlights/:userId', optionalAuth, guardUserId, adController.getHighlights);
router.post('/highlights', authMiddleware, adController.createHighlight);
router.delete('/highlights/:id', authMiddleware, guardId, adController.deleteHighlight);

// ═════════════════════════════════════════════════════════
// MESSAGES
// ═════════════════════════════════════════════════════════
router.get(
  '/messages/conversations',
  authMiddleware,
  adController.getConversations
);
router.post(
  '/messages/conversation',
  authMiddleware,
  adController.getOrCreateConversation
);
router.post(
  '/messages/send',
  authMiddleware,
  wrapMulter(uploadMessage, 'message'),
  adController.sendMessage
);
router.get(
  '/messages/:conversationId',
  authMiddleware,
  guardConversationId,
  adController.getMessages
);
router.delete('/messages/:id', authMiddleware, guardId, adController.deleteMessage);

// ═════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═════════════════════════════════════════════════════════
router.get('/notifications', authMiddleware, adController.getNotifications);
router.put(
  '/notifications/read',
  authMiddleware,
  adController.markNotificationsRead
);

// ═════════════════════════════════════════════════════════
// ACTIVITY
// ═════════════════════════════════════════════════════════
router.get('/activity', authMiddleware, adController.getActivity);
router.post('/activity/log', authMiddleware, adController.logActivity);

// ═════════════════════════════════════════════════════════
// SAVED COLLECTIONS
// ═════════════════════════════════════════════════════════
router.get('/saved/collections', authMiddleware, adController.getSavedCollections);
router.post('/saved/collections', authMiddleware, adController.createSavedCollection);
router.put(
  '/saved/collections/:id',
  authMiddleware,
  guardId,
  adController.updateSavedCollection
);
router.delete(
  '/saved/collections/:id',
  authMiddleware,
  guardId,
  adController.deleteSavedCollection
);

// ═════════════════════════════════════════════════════════
// CRUD
// ═════════════════════════════════════════════════════════
router.get('/:id', optionalAuth, guardId, adController.getAdById);
router.post(
  '/',
  authMiddleware,
  wrapMulter(uploadAd, 'ad'),
  adController.createAd
);
router.put(
  '/:id',
  authMiddleware,
  wrapMulter(uploadAd, 'ad-update'),
  guardId,
  adController.updateAd
);
router.delete('/:id', authMiddleware, guardId, adController.deleteAd);
router.patch('/:id/toggle', authMiddleware, guardId, adController.toggleAdStatus);

module.exports = router;