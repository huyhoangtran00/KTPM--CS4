// worker.js — Bull queue consumer (Worker)
// Install dependencies:
// npm install bull redis dotenv

require('dotenv').config();
const Queue = require('bull');
const redis = require('redis');
const Persistent = require('./lib/db');

// --- Configuration ---
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAME = 'metal-jobs';

// --- Initialize Bull queue ---
const jobQueue = new Queue(QUEUE_NAME, redisUrl);

// --- Redis publisher for cache and pub/sub ---
const publisherClient = redis.createClient({ url: redisUrl });
publisherClient.on('error', err => console.error('[Redis Publisher] Error:', err));

(async () => {
  await publisherClient.connect();
  console.log('[Worker] Redis publisher connected');

  // Process incoming jobs
  jobQueue.process(async (job) => {
    const { key, value } = job.data;
    console.log(`[Worker] Processing job for ${key}: ${value}`);

    try {
      // 1. Persist to database
      await Persistent.write(key, value);
      console.log(`[Worker] DB saved: ${key} = ${value}`);

      // 2. Cache in Redis
      const cacheKey = `metal:${key}`;
      await publisherClient.setEx(cacheKey, 60, String(value));
      console.log(`[Worker] Cached ${cacheKey}`);

      // 3. Publish to Redis Pub/Sub for real-time updates
      const message = JSON.stringify({ key, value, serverTime: Date.now() });
      await publisherClient.publish(key, message);
      console.log(`[Worker] Published to channel '${key}': ${message}`);

      return Promise.resolve();
    } catch (err) {
      console.error(`[Worker] Error processing ${key}:`, err.message);
      // Throw to let Bull handle retries/failure
      throw err;
    }
  });

  // Event listeners
  jobQueue.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  jobQueue.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} failed:`, err.message);
  });

  console.log(`[Worker] Listening for jobs on queue '${QUEUE_NAME}'`);
})();
