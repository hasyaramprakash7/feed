const cron = require('node-cron');
const Status = require('../models/Status');
const cloudinary = require('../config/cloudinary');
const { sendDailyNotifications } = require('../services/notificationService');

const startCronJobs = () => {
  // ----------------------------------------------------------
  // 1. Status Cleanup – runs every hour
  // ----------------------------------------------------------
  cron.schedule('0 * * * *', async () => {
    console.log('⏳ Running Status Cleanup Job...');
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let totalDeleted = 0;
      let hasMore = true;
      const BATCH_SIZE = 50;

      while (hasMore) {
        const expiredStatuses = await Status.find({ createdAt: { $lte: twentyFourHoursAgo } })
          .select('_id mediaPublicId messageType')
          .limit(BATCH_SIZE);

        if (expiredStatuses.length === 0) {
          hasMore = false;
          break;
        }

        const statusIdsToDelete = [];
        const cloudinaryPromises = [];

        for (const status of expiredStatuses) {
          statusIdsToDelete.push(status._id);
          if (status.mediaPublicId) {
            const resType = status.messageType === 'video' ? 'video' : 'image';
            cloudinaryPromises.push(
              cloudinary.uploader.destroy(status.mediaPublicId, { resource_type: resType })
                .catch(err => console.error(`[Cloudinary Error] Failed to delete ${status.mediaPublicId}:`, err))
            );
          }
        }

        await Promise.all(cloudinaryPromises);
        await Status.deleteMany({ _id: { $in: statusIdsToDelete } });
        totalDeleted += expiredStatuses.length;

        // Short pause between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`🧹 Cleanup Complete: Deleted ${totalDeleted} expired statuses from DB & Cloudinary.`);
    } catch (error) {
      console.error('❌ Error during status cleanup:', error);
    }
  });

  // ----------------------------------------------------------
  // 2. Daily Product/Property/Rental Notifications
  //    Runs at 6:00, 10:00, 14:00, 18:00, 22:00 every day
  // ----------------------------------------------------------
  cron.schedule('0 6,10,14,18,22 * * *', async () => {
    try {
      await sendDailyNotifications();
    } catch (error) {
      console.error('❌ Notification cron job error:', error);
    }
  });

  console.log('✅ Notification cron job scheduled (5 times/day: 6,10,14,18,22).');
};

module.exports = startCronJobs;