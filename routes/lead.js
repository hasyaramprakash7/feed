// routes/lead.js
const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { authMiddleware, isVendor } = require('../middleware/authMiddleware');

/**
 * @route   POST /api/leads
 * @desc    Create a new lead (view, call, whatsapp, email, quote)
 * @access  Private (User)
 */
router.post('/', authMiddleware, leadController.createLead);

/**
 * @route   GET /api/leads/vendor
 * @desc    Get all leads for the authenticated vendor with filters
 * @access  Private (Vendor)
 */
router.get('/vendor', authMiddleware, isVendor, leadController.getVendorLeads);

/**
 * @route   GET /api/leads/vendor/stats
 * @desc    Get lead statistics for vendor dashboard
 * @access  Private (Vendor)
 */
router.get('/vendor/stats', authMiddleware, isVendor, leadController.getLeadStats);

/**
 * @route   GET /api/leads/vendor/count
 * @desc    Get total leads count for vendor dashboard
 * @access  Private (Vendor)
 */
router.get('/vendor/count', authMiddleware, isVendor, leadController.getTotalLeadsCount);

/**
 * @route   GET /api/leads/vendor/analytics
 * @desc    Get leads by date range for analytics
 * @access  Private (Vendor)
 */
router.get('/vendor/analytics', authMiddleware, isVendor, leadController.getLeadsByDateRange);

/**
 * @route   PUT /api/leads/:id
 * @desc    Update lead status
 * @access  Private (Vendor)
 */
router.put('/:id', authMiddleware, isVendor, leadController.updateLeadStatus);

/**
 * @route   PATCH /api/leads/bulk
 * @desc    Bulk update lead status
 * @access  Private (Vendor)
 */
router.patch('/bulk', authMiddleware, isVendor, leadController.bulkUpdateLeadStatus);

/**
 * @route   DELETE /api/leads/:id
 * @desc    Delete a lead
 * @access  Private (Vendor)
 */
router.delete('/:id', authMiddleware, isVendor, leadController.deleteLead);

module.exports = router;