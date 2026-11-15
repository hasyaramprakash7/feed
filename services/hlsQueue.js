// services/hlsQueue.js
const { redis, QUEUE_KEY } = require('../config/redisClient');

const makeJobId = () =>
  `hls_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function enqueueHlsJob(job) {
  if (!job || !job.kind || !job.sourceUrl) {
    throw new Error('enqueueHlsJob: kind and sourceUrl required');
  }
  const payload = {
    jobId: makeJobId(),
    kind: job.kind,                       // 'ad' | 'story'
    adId: job.adId || null,
    storyId: job.storyId || null,
    sourceUrl: job.sourceUrl,             // R2 URL of raw video
    folder: job.folder || 'bluxury/ads/hls',
    keepUserPoster: !!job.keepUserPoster, // don't overwrite image/thumbnail
    keepUserThumb: !!job.keepUserThumb,   // don't overwrite thumbnailSmall
    queuedAt: new Date().toISOString(),
  };
  await redis.lpush(QUEUE_KEY, JSON.stringify(payload));
  console.log(`📥 [hlsQueue] pushed ${payload.jobId} kind=${payload.kind}`);
  return payload;
}

async function getQueueLength() {
  try {
    return await redis.llen(QUEUE_KEY);
  } catch {
    return -1;
  }
}

module.exports = { enqueueHlsJob, getQueueLength };