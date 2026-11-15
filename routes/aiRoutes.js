// my-ecommerce-app/server/routes/aiRoutes.js

const express = require('express');
const { generateProject } = require('../controllers/aiController');
// NOTE: You would typically uncomment this line and use your existing
// authentication middleware (e.g., const { protect } = require('../middleware/authMiddleware');)
// to ensure only authenticated users can access this premium feature.

const router = express.Router();

/**
 * @route   POST /api/ai
 * @desc    Proxies the user's project request/feedback to the Python AI Agent Microservice.
 * @access  Public for now (Should be Private/Protected in production)
 */
router.post('/', generateProject);

module.exports = router;