// services/hlsWorkerManager.js
const { Worker } = require('worker_threads');
const path = require('path');

const workers = [];
let started = false;

const CONCURRENCY = Math.max(
  1,
  parseInt(process.env.HLS_WORKER_CONCURRENCY || '1', 10)
);

function startWorkers() {
  if (started) return;
  started = true;

  const workerPath = path.join(__dirname, '..', 'workers', 'hlsWorker.js');

  for (let i = 0; i < CONCURRENCY; i++) {
    const worker = new Worker(workerPath, {
      workerData: {
        queueKey: 'hls:queue',
        redisUrl: process.env.REDIS_URL,
        mongoUri: process.env.MONGO_URI,
      },
    });

    worker.on('message', (msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'job:done') {
        const { result } = msg;
        const io = global.io;
        if (io && result) {
          if (result.adId) {
            io.emit('postReady', {
              adId: result.adId,
              hlsUrl: result.hlsUrl,
              videoUrl: result.videoUrl,
              posterUrl: result.posterUrl,
            });
          }
          if (result.storyId) {
            io.emit('storyReady', {
              storyId: result.storyId,
              hlsUrl: result.hlsUrl,
              videoUrl: result.videoUrl,
            });
          }
        }
        console.log(
          `🧵 [hlsWorker#${i}] ✅ ${msg.job?.jobId} done in ${msg.elapsed}ms`
        );
      } else if (msg.type === 'job:error') {
        console.error(
          `🧵 [hlsWorker#${i}] ❌ ${msg.job?.jobId} failed:`,
          msg.error?.message
        );
        const io = global.io;
        if (io && msg.job?.adId) {
          io.emit('postFailed', { adId: msg.job.adId });
        }
      } else if (msg.type === 'worker:crash') {
        console.error(`🧵 [hlsWorker#${i}] 💥 crashed:`, msg.error);
      }
    });

    worker.on('error', (e) => {
      console.error(`🧵 [hlsWorker#${i}] thread error:`, e?.message);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && started) {
        console.warn(`🧵 [hlsWorker#${i}] exited with code ${code}`);
      }
    });

    workers.push(worker);
  }

  console.log(`🧵 [hlsWorkerManager] spawned ${CONCURRENCY} worker(s)`);
}

async function stopWorkers() {
  started = false;
  await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve) => {
          try {
            w.postMessage({ type: 'shutdown' });
            w.once('exit', resolve);
            setTimeout(resolve, 5000);
          } catch {
            resolve();
          }
        })
    )
  );
  workers.length = 0;
  console.log('🧵 [hlsWorkerManager] all workers stopped');
}

module.exports = { startWorkers, stopWorkers };