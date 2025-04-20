// Install dependencies:
// npm install express body-parser cors socket.io redis axios node-cron opossum bull express-rate-limit rate-limit-redis dotenv

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Persistent = require('./lib/db');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const redis = require('redis');
const axios = require('axios');
const cron = require('node-cron');
const CircuitBreaker = require('opossum');
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Queue = require('bull');

// --- Configuration ---
const port = process.env.PORT || 8080;
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const GOLD_API_URL = 'https://api.gold-api.com/price/';

const METALS = [
  { name: 'Silver', symbol: 'XAG' },
  { name: 'Gold', symbol: 'XAU' },
  { name: 'Bitcoin', symbol: 'BTC' },
  { name: 'Ethereum', symbol: 'ETH' },
  { name: 'Palladium', symbol: 'XPD' },
  { name: 'Copper', symbol: 'HG' }
];

// --- Express & Socket.IO setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(bodyParser.json());
app.use(cors());

// --- Redis clients ---
const publisherClient = redis.createClient({ url: redisUrl });
const subscriberClient = publisherClient.duplicate();
const redisClientForRateLimit = redis.createClient({ url: redisUrl });

publisherClient.on('error', err => console.error('[Redis Publisher] Error:', err));
subscriberClient.on('error', err => console.error('[Redis Subscriber] Error:', err));

// --- Bull Queue for load leveling ---
const jobQueue = new Queue('metal-jobs', redisUrl);

// Processor: consume jobs and call addData
jobQueue.process(async job => {
  const { key, value } = job.data;
  console.log(`[Queue] Processing job for ${key}`);
  try {
    await addData(key, value);
  } catch (err) {
    console.error(`[Queue] Failed job for ${key}:`, err.message);
    throw err;
  }
});

jobQueue.on('completed', job => console.log(`[Queue] Completed job ${job.id}`));
jobQueue.on('failed', (job, err) => console.error(`[Queue] Job ${job.id} failed:`, err.message));

// --- Circuit Breaker setup ---
function getMetalPrice(symbol) {
  return axios.get(`${GOLD_API_URL}${symbol}`);
}
const breakerOptions = { timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 10000 };
const breaker = new CircuitBreaker(getMetalPrice, breakerOptions);
breaker.fallback(symbol => ({ data: { price: 'N/A' } }));
breaker.on('open', () => console.warn('[Circuit Breaker] OPEN'));
breaker.on('halfOpen', () => console.log('[Circuit Breaker] HALF-OPEN'));
breaker.on('close', () => console.log('[Circuit Breaker] CLOSED'));

// --- Core logic: addData writes to DB, cache, pub/sub ---
async function addData(key, value) {
  console.time(`[addData] ${key} processing time`);
  await Persistent.write(key, value);
  console.log(`[addData] DB saved: ${key} = ${value}`);
  const startTime = Date.now();
  await publisherClient.setEx(`metal:${key}`, 60, String(value));
  console.log(`[addData] Cached metal:${key}`);
  const message = JSON.stringify({ key, value, serverTime: startTime });
  await publisherClient.publish(key, message);
  console.log(`[addData] Published to channel ${key}`);
  console.timeEnd(`[addData] ${key} processing time`);
}

// --- Redis Pub/Sub for real-time updates ---
async function setupRedis() {
  await publisherClient.connect();
  console.log('[Redis] Publisher connected');
  await redisClientForRateLimit.connect();
  console.log('[Redis] RateLimit client connected');
  await subscriberClient.connect();
  console.log('[Redis] Subscriber connected');

  // Rate limiter middleware
  const limiter = rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redisClientForRateLimit.sendCommand(args),
      prefix: 'ratelimit:', expiry: 15*60
    }),
    windowMs: 15*60*1000, max: 100,
    message: 'Too many requests, retry later',
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => `${req.ip}:${req.path}`
  });
  app.use(limiter);

  // Subscribe to each metal channel
  for (const m of METALS) {
    await subscriberClient.subscribe(m.name, (msg, channel) => {
      try {
        const data = JSON.parse(msg);
        io.emit(data.key, { key: data.key, value: data.value, serverTime: data.serverTime });
      } catch (e) {
        console.error('[Subscriber] JSON parse error:', e.message);
      }
    });
    console.log(`[Redis] Subscribed to ${m.name}`);
  }
}

// --- Schedule price fetch: enqueue jobs for addData ---
async function enqueuePriceFetch() {
  console.log('[Cron] Enqueueing price-fetch jobs');
  for (const m of METALS) {
    try {
      const resp = await breaker.fire(m.symbol);
      const price = resp.data && resp.data.price != null ? resp.data.price : 'N/A';
      console.log(`[Cron] ${m.name}: ${price}`);
      // enqueue addData job
      await jobQueue.add({ key: m.name, value: String(price) });
    } catch (err) {
      console.error(`[Cron] Error fetching ${m.name}:`, err.message);
    }
    // throttle
  }
}
cron.schedule('*/5 * * * *', enqueuePriceFetch);

// --- Routes ---
app.post('/add', async (req, res) => {
  const { key, value } = req.body;
  console.log(`[POST /add] Received job: ${key} = ${value}`);
  try {
    await jobQueue.add({ key, value });
    res.status(202).json({ status: 'queued' });
  } catch (err) {
    console.error('[POST /add] Queue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/get/:id', async (req, res) => {
  const id = req.params.id;
  const cacheKey = `metal:${id}`;
  try {
    const cache = await publisherClient.get(cacheKey);
    if (cache != null) return res.status(200).send(cache);
    const val = await Persistent.view(id);
    await publisherClient.setEx(cacheKey, 60, String(val));
    res.status(200).send(String(val));
  } catch (err) {
    console.error('[GET /get] Error:', err.message);
    res.status(err.message.includes('not found')?404:500).send(err.message);
  }
});

app.get('/viewer/:id', (req, res) => res.sendFile(path.join(__dirname, 'viewer.html')));
app.get('/add', (req, res) => res.sendFile(path.join(__dirname, 'add.html')));

// --- Startup ---
(async () => {
  await setupRedis();
  // initial price enqueue
  await enqueuePriceFetch();
  server.listen(port, () => console.log(`Server running on http://localhost:${port}`));
})();
