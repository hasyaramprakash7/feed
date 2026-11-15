// controllers/leadController.js
const Lead = require('../models/Lead');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const { sendPushNotificationToVendor } = require('../services/notificationService');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Send view notification to vendor and emit socket event
 */
async function sendViewNotification(vendor, user, vendorId, io) {
  try {
    const title = '👀 New Shop View!';
    const body = `${user.name || 'Someone'} viewed your shop "${vendor.shopName || vendor.name}"`;

    console.log(`📤 Sending view notification to vendor ${vendorId}`);
    console.log(`📡 Socket.IO instance available: ${!!io}`);

    // Send push notification
    await sendPushNotificationToVendor(vendorId, title, body, {
      type: 'view',
      vendorId: vendorId,
      userId: user._id,
      leadType: 'view',
      timestamp: new Date().toISOString(),
    });

    // ✅ EMIT SOCKET EVENT FOR VIEW
    if (io) {
      const viewData = {
        _id: `view_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        vendorId: vendorId,
        userId: user._id,
        userName: user.name || 'Someone',
        userPhone: user.phone || '',
        userEmail: user.email || '',
        type: 'view',
        status: 'new',
        message: `${user.name || 'Someone'} viewed your shop "${vendor.shopName || vendor.name}"`,
        createdAt: new Date().toISOString(),
        user: {
          _id: user._id,
          name: user.name || 'Someone',
          phone: user.phone || '',
          email: user.email || '',
        },
        vendor: vendorId
      };
      
      console.log('📡 [Socket] Emitting newView event:', JSON.stringify(viewData));
      io.emit('newView', viewData);
      
      // Also emit as newLead for consistency
      io.emit('newLead', {
        ...viewData,
        type: 'view'
      });
      
      console.log('✅ [Socket] Events emitted successfully');
    } else {
      console.warn('⚠️ Socket.IO instance not available, skipping event emission');
    }

    console.log(`📱 View notification sent to vendor ${vendor.shopName}`);
  } catch (error) {
    console.error('Error sending view notification:', error);
  }
}

/**
 * Send lead notification to vendor and emit socket event
 */
async function sendLeadNotification(vendor, user, lead, io) {
  try {
    const typeLabels = {
      call: '📞 Call Request',
      whatsapp: '💬 WhatsApp Enquiry',
      email: '✉️ Email Enquiry',
      quote: '📝 Quote Request',
    };

    const title = `${typeLabels[lead.type] || 'New Lead'}!`;
    const body = `${user.name || 'Someone'} sent a ${lead.type} enquiry: "${lead.message.substring(0, 60)}${lead.message.length > 60 ? '...' : ''}"`;

    console.log(`📤 Sending lead notification to vendor ${vendor._id}`);

    // Send push notification
    await sendPushNotificationToVendor(vendor._id, title, body, {
      type: 'lead',
      leadId: lead._id,
      vendorId: vendor._id,
      userId: user._id,
      leadType: lead.type,
      timestamp: new Date().toISOString(),
    });

    // ✅ EMIT SOCKET EVENT FOR LEAD
    if (io && lead) {
      const leadData = {
        ...(lead.toObject ? lead.toObject() : lead),
        user: {
          _id: user._id,
          name: user.name || 'Someone',
          phone: user.phone || '',
          email: user.email || '',
        }
      };
      
      console.log(`📡 [Socket] Emitting newLead event for type: ${lead.type}`);
      io.emit('newLead', leadData);
    }

    console.log(`📱 Lead notification sent to vendor ${vendor.shopName}`);
  } catch (error) {
    console.error('Error sending lead notification:', error);
  }
}

// ============================================================
// CONTROLLER FUNCTIONS
// ============================================================

/**
 * Create a new lead
 * POST /api/leads
 */
exports.createLead = async (req, res) => {
  try {
    const { vendorId, message, type, userId, userName, phone } = req.body;
    const authUserId = req.user?.userId;
    
    // ✅ Get io instance from multiple sources
    const io = req.app.get('io') || req.app.get('socketio') || global.io;
    
    console.log(`📝 Creating lead: vendor=${vendorId}, user=${authUserId || userId}, type=${type}`);
    console.log(`📡 Socket.IO instance available: ${!!io}`);

    // Validate vendor exists
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        status: 'fail',
        message: 'Vendor not found',
      });
    }

    // Get or create user object for response
    let user;
    const finalUserId = userId || authUserId;
    
    if (finalUserId) {
      user = await User.findById(finalUserId).select('name phone email profilePic');
    }
    if (!user) {
      user = {
        _id: finalUserId || 'unknown',
        name: userName || req.user?.name || 'Someone',
        phone: phone || '',
        email: '',
        profilePic: null,
      };
    }

    let lead;
    let isDuplicate = false;

    // For 'view' type leads, check for duplicates today
    if (type === 'view' && finalUserId && finalUserId !== 'unknown') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingView = await Lead.findOne({
        vendor: vendorId,
        user: finalUserId,
        type: 'view',
        createdAt: { $gte: today, $lt: tomorrow },
      });

      if (existingView) {
        // Update existing view
        existingView.viewedAt = new Date();
        await existingView.save();
        lead = existingView;
        isDuplicate = true;
        console.log(`🔄 View already exists for today, updated: ${lead._id}`);
        
        // ✅ FIX: Update vendor stats even for duplicate views
        vendor.totalViews = (vendor.totalViews || 0) + 1;
        vendor.totalLeads = (vendor.totalLeads || 0) + 1;
        await vendor.save();
        console.log(`📊 Vendor stats updated: totalViews=${vendor.totalViews}, totalLeads=${vendor.totalLeads}`);
        
        // ✅ Still emit socket event for the view
        await sendViewNotification(vendor, user, vendorId, io);
        
        const populatedLead = await Lead.findById(lead._id)
          .populate('user', 'name phone email profilePic')
          .lean();
          
        return res.status(200).json({
          status: 'success',
          data: populatedLead || lead,
          message: 'View updated',
        });
      }
    }

    if (!isDuplicate) {
      // Create new lead
      const leadData = {
        vendor: vendorId,
        message: message || `${user.name || 'Someone'} ${type === 'view' ? 'viewed your shop' : 'sent an enquiry'}`,
        type: type || 'view',
        status: 'new',
      };

      if (finalUserId && finalUserId !== 'unknown') {
        leadData.user = finalUserId;
      }

      if (type === 'view') {
        leadData.viewedAt = new Date();
      }

      lead = await Lead.create(leadData);
      console.log(`✅ Lead created: ${lead._id}`);

      // Update vendor stats
      vendor.totalLeads = (vendor.totalLeads || 0) + 1;
      if (type === 'view') {
        vendor.totalViews = (vendor.totalViews || 0) + 1;
      } else if (type === 'call') {
        vendor.totalCalls = (vendor.totalCalls || 0) + 1;
      }
      await vendor.save();
      console.log(`📊 Vendor stats updated: totalViews=${vendor.totalViews}, totalCalls=${vendor.totalCalls}, totalLeads=${vendor.totalLeads}`);
    }

    // Populate user data for response
    const populatedLead = await Lead.findById(lead._id)
      .populate('user', 'name phone email profilePic')
      .lean();

    // Ensure user data is present
    if (!populatedLead.user && user) {
      populatedLead.user = user;
    }

    // Send notification and emit socket events
    if (type === 'view') {
      await sendViewNotification(vendor, user, vendorId, io);
    } else {
      await sendLeadNotification(vendor, user, lead, io);
    }

    return res.status(isDuplicate ? 200 : 201).json({
      status: 'success',
      data: populatedLead,
      message: isDuplicate ? 'View updated' : 'Lead created',
    });
  } catch (error) {
    console.error('Create lead error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        status: 'fail',
        message: messages.join(', '),
      });
    }

    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Get all leads for a vendor with filters
 * GET /api/leads/vendor
 */
exports.getVendorLeads = async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId || req.vendor?._id;
    const { status, type, limit = 50, page = 1 } = req.query;

    console.log(`📊 Fetching leads for vendor ${vendorId}, status: ${status}, type: ${type}`);

    const filter = { vendor: vendorId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const parsedLimit = parseInt(limit, 10);

    const [leads, total, stats] = await Promise.all([
      Lead.find(filter)
        .populate('user', 'name phone email profilePic')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit),
      Lead.countDocuments(filter),
      Lead.getVendorStats(vendorId),
    ]);

    console.log(`✅ Found ${leads.length} leads for vendor ${vendorId}`);
    console.log(`📊 Stats: total=${stats.total}, today=${stats.today}`);

    return res.status(200).json({
      status: 'success',
      data: leads,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      },
      stats,
    });
  } catch (error) {
    console.error('Get vendor leads error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Get lead statistics for vendor dashboard
 * GET /api/leads/vendor/stats
 */
exports.getLeadStats = async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId || req.vendor?._id;

    console.log(`📊 Fetching lead stats for vendor ${vendorId}`);

    // ✅ Use the static method from Lead model
    const stats = await Lead.getVendorStats(vendorId);

    // ✅ Log the stats for debugging
    console.log(`✅ Lead stats: total=${stats.total}, today=${stats.today}`);
    console.log(`✅ byStatus:`, JSON.stringify(stats.byStatus));
    console.log(`✅ byType:`, JSON.stringify(stats.byType));

    return res.status(200).json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    console.error('Get lead stats error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Update lead status
 * PUT /api/leads/:id
 */
exports.updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const vendorId = req.vendor?.vendorId || req.vendor?._id;
    const io = req.app.get('io') || req.app.get('socketio') || global.io;

    console.log(`🔄 Updating lead ${id} to status: ${status}`);

    // Validate status
    const validStatuses = ['new', 'seen', 'replied', 'converted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    const lead = await Lead.findById(id).populate('user', 'name phone email');
    if (!lead) {
      return res.status(404).json({
        status: 'fail',
        message: 'Lead not found',
      });
    }

    // Check ownership
    if (lead.vendor.toString() !== vendorId) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to update this lead',
      });
    }

    lead.status = status;
    await lead.save();

    console.log(`✅ Lead ${id} updated to status: ${status}`);

    // Emit socket event for status update
    if (io) {
      io.emit('leadUpdated', {
        leadId: lead._id,
        status: status,
        lead: lead,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: lead,
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Bulk update lead status
 * PATCH /api/leads/bulk
 */
exports.bulkUpdateLeadStatus = async (req, res) => {
  try {
    const { leadIds, status } = req.body;
    const vendorId = req.vendor?.vendorId || req.vendor?._id;
    const io = req.app.get('io') || req.app.get('socketio') || global.io;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'Lead IDs are required',
      });
    }

    // Validate status
    const validStatuses = ['new', 'seen', 'replied', 'converted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    console.log(`🔄 Bulk updating ${leadIds.length} leads to status: ${status}`);

    const result = await Lead.updateMany(
      {
        _id: { $in: leadIds },
        vendor: vendorId,
      },
      { status }
    );

    console.log(`✅ Bulk update completed: ${result.modifiedCount} leads updated`);

    // Emit socket event for bulk update
    if (io) {
      io.emit('leadsBulkUpdated', {
        leadIds: leadIds,
        status: status,
        count: result.modifiedCount,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        modifiedCount: result.modifiedCount,
        status,
      },
    });
  } catch (error) {
    console.error('Bulk update leads error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Get leads by date range (for analytics)
 * GET /api/leads/vendor/analytics
 */
exports.getLeadsByDateRange = async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId || req.vendor?._id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        status: 'fail',
        message: 'Start date and end date are required',
      });
    }

    console.log(`📊 Fetching leads for vendor ${vendorId} from ${startDate} to ${endDate}`);

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const leads = await Lead.find({
      vendor: vendorId,
      createdAt: { $gte: start, $lte: end },
    }).populate('user', 'name phone email');

    console.log(`✅ Found ${leads.length} leads in date range`);

    return res.status(200).json({
      status: 'success',
      data: leads,
      count: leads.length,
    });
  } catch (error) {
    console.error('Get leads by date range error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Get total leads count for vendor (dashboard)
 * GET /api/leads/vendor/count
 */
exports.getTotalLeadsCount = async (req, res) => {
  try {
    const vendorId = req.vendor?.vendorId || req.vendor?._id;

    const [total, newLeads, today] = await Promise.all([
      Lead.countDocuments({ vendor: vendorId }),
      Lead.countDocuments({ vendor: vendorId, status: 'new' }),
      Lead.countDocuments({
        vendor: vendorId,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        total,
        new: newLeads,
        today,
      },
    });
  } catch (error) {
    console.error('Get total leads count error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

/**
 * Delete a lead
 * DELETE /api/leads/:id
 */
exports.deleteLead = async (req, res) => {
  try {
    const { id } = req.params;
    const vendorId = req.vendor?.vendorId || req.vendor?._id;

    console.log(`🗑️ Deleting lead ${id}`);

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        status: 'fail',
        message: 'Lead not found',
      });
    }

    // Check ownership
    if (lead.vendor.toString() !== vendorId) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to delete this lead',
      });
    }

    await lead.deleteOne();

    console.log(`✅ Lead ${id} deleted`);

    return res.status(200).json({
      status: 'success',
      message: 'Lead deleted successfully',
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    return res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};