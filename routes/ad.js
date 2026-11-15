// routes/ad.js
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const adController = require('../controllers/adController');
const { authMiddleware, optionalAuth } = require('../middleware/authMiddleware');
const { uploadAd, uploadStory, uploadMessage } = require('../config/multerR2');

const router = express.Router();

const mapLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const wrapMulter = (uploadFn, name) => (req, res, next) => {
  console.log(`\n🟠[multer:${name}] 🚀 START`);
  uploadFn(req, res, (err) => {
    if (err) {
      console.error(`\n🟠[multer:${name}] ❌ UPLOAD FAILED`);
      console.error(`🟠[multer:${name}] message: ${err?.message}`);
      return res.status(400).json({ success: false, message: err?.message || 'Upload failed' });
    }
    
    console.log(`🟠[multer:${name}] ✅ UPLOAD OK`);
    if (Array.isArray(req.files) && req.files.length > 0) {
      req.files.forEach((f) => console.log(`🟠[multer:${name}] file: field="${f.fieldname}" name="${f.originalname}"`));
    }
    next();
  });
};

const guardId = (req, res, next) => {
  const value = req.params?.id;
  if (value && !mongoose.Types.ObjectId.isValid(String(value))) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  next();
};

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────
router.get('/identities/search', optionalAuth, adController.searchIdentities);
router.post('/identities/resolve', optionalAuth, adController.resolveIdentities);

router.get('/feed', optionalAuth, adController.getPersonalizedFeed);
router.get('/explore', optionalAuth, adController.getExploreFeed);
router.get('/search', optionalAuth, adController.search);

router.get('/hashtags/search', optionalAuth, adController.searchHashtags);
router.get('/hashtags/trending', optionalAuth, adController.getTrendingHashtags);
router.get('/hashtags/:tag/posts', optionalAuth, adController.getPostsByHashtag);

router.get('/analytics/user', authMiddleware, adController.getUserReachAnalytics);
router.get('/analytics/:id', authMiddleware, guardId, adController.getReachAnalytics);

router.get('/', optionalAuth, adController.getAllAds);
router.get('/active', optionalAuth, adController.getActiveAds);
router.get('/map/bounds', mapLimiter, optionalAuth, adController.getStatusesInBounds);

router.get('/my-posts', authMiddleware, adController.getMyPosts);
router.get('/my-archive', authMiddleware, adController.getArchivedPosts);
router.get('/user/:userId', optionalAuth, adController.getPostsByUserId);

router.post('/:id/like', authMiddleware, guardId, adController.toggleLike);
router.post('/:id/save', authMiddleware, guardId, adController.toggleSave);
router.post('/:id/view', optionalAuth, guardId, adController.trackView);
router.post('/:id/share', optionalAuth, guardId, adController.trackShare);
router.post('/:id/archive', authMiddleware, guardId, adController.archivePost);
router.post('/:id/unarchive', authMiddleware, guardId, adController.unarchivePost);
router.post('/:id/pin', authMiddleware, guardId, adController.togglePinPost);

router.get('/:id/comments', optionalAuth, guardId, adController.getComments);
router.post('/:id/comments', authMiddleware, guardId, adController.addComment);
router.delete('/:id/comments/:commentId', authMiddleware, guardId, adController.deleteComment);
router.post('/:id/comments/:commentId/like', authMiddleware, guardId, adController.toggleCommentLike);

router.get('/stories/active', optionalAuth, adController.getActiveStories);
router.get('/stories/my', authMiddleware, adController.getMyStories);
router.get('/stories/user/:userId', optionalAuth, adController.getStoriesByUserId);
router.post('/stories', authMiddleware, wrapMulter(uploadStory, 'story'), adController.createStory);
router.post('/stories/:id/view', authMiddleware, guardId, adController.viewStory);
router.post('/stories/:id/react', authMiddleware, guardId, adController.reactToStory);
router.delete('/stories/:id', authMiddleware, guardId, adController.deleteStory);

router.post('/follow/:userId', authMiddleware, adController.toggleFollow);
router.get('/followers/:userId', optionalAuth, adController.getFollowers);
router.get('/following/check/:userId', optionalAuth, adController.checkFollowing);
router.get('/following/:userId', optionalAuth, adController.getFollowing);
router.get('/suggested-users', optionalAuth, adController.getSuggestedUsers);

router.get('/profile/:userId', optionalAuth, adController.getUserProfile);
router.put('/profile/stats', authMiddleware, adController.updateUserStats);
router.get('/dashboard', authMiddleware, adController.getUserDashboard);

router.get('/highlights/:userId', optionalAuth, adController.getHighlights);
router.post('/highlights', authMiddleware, adController.createHighlight);
router.delete('/highlights/:id', authMiddleware, guardId, adController.deleteHighlight);

router.get('/messages/conversations', authMiddleware, adController.getConversations);
router.post('/messages/conversation', authMiddleware, adController.getOrCreateConversation);
router.post('/messages/send', authMiddleware, wrapMulter(uploadMessage, 'message'), adController.sendMessage);
router.get('/messages/:conversationId', authMiddleware, adController.getMessages);
router.delete('/messages/:id', authMiddleware, guardId, adController.deleteMessage);

router.get('/notifications', authMiddleware, adController.getNotifications);
router.put('/notifications/read', authMiddleware, adController.markNotificationsRead);

router.get('/activity', authMiddleware, adController.getActivity);
router.post('/activity/log', authMiddleware, adController.logActivity);

router.get('/saved/collections', authMiddleware, adController.getSavedCollections);
router.post('/saved/collections', authMiddleware, adController.createSavedCollection);
router.put('/saved/collections/:id', authMiddleware, guardId, adController.updateSavedCollection);
router.delete('/saved/collections/:id', authMiddleware, guardId, adController.deleteSavedCollection);

// ✅ CRUD (using the bulletproof upload)
router.get('/:id/status', optionalAuth, guardId, adController.getAdStatus); // 👈 NEW
router.get('/:id', optionalAuth, guardId, adController.getAdById);
router.post('/', authMiddleware, wrapMulter(uploadAd, 'ad'), adController.createAd);
router.put('/:id', authMiddleware, wrapMulter(uploadAd, 'ad-update'), guardId, adController.updateAd);
router.delete('/:id', authMiddleware, guardId, adController.deleteAd);
router.patch('/:id/toggle', authMiddleware, guardId, adController.toggleAdStatus);

module.exports = router;