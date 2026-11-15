// config/redisClient.js
const Redis = require('ioredis');

const globalKey = '__bluxury_redis__';
const blockingKey = '__bluxury_redis_blocking__';

function createClient() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const isUpstash = url.startsWith('rediss://') || url.includes('upstash.io');

  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    keepAlive: 10000, // ⚡ Sends TCP keep-alive every 10s to stop ECONNRESET
    retryStrategy: (times) => Math.min(times * 500, 3000),
    lazyConnect: false,
    tls: isUpstash ? { rejectUnauthorized: false } : undefined,
  });

  client.on('connect', () => {
    console.log('✅ [redis] connected to', url.replace(/\/\/.*@/, '//***@'));
  });
  client.on('ready', () => {
    console.log('✅ [redis] ready');
  });
  client.on('error', (err) => {
    if (err.code === 'ECONNRESET') return; // Ignore transient reset warnings on reconnect
    console.error('❌ [redis] error:', err?.message);
  });
  client.on('close', () => {
    console.warn('⚠️ [redis] connection closed');
  });

  return client;
}

if (!global[globalKey]) {
  global[globalKey] = createClient();
}

if (!global[blockingKey]) {
  global[blockingKey] = createClient();
}

module.exports = {
  redis: global[globalKey],
  blockingRedis: global[blockingKey],
  QUEUE_KEY: 'hls:queue',
  STATUS_KEY_PREFIX: 'hls:job:',
};