const express = require('express');
const router = express.Router();
const Persistent = require('../lib/db.js');

// Kiểm tra cấu hình để có sử dụng Redis hay không
const { USE_REDIS } = require('../config'); // Đảm bảo đường dẫn đúng
let publisherClient = null; // Đảm bảo publisherClient chưa được khởi tạo ngoài Redis
let redisClient = null; // Đảm bảo redisClient chưa được khởi tạo ngoài Redis
let redisChannel = 'dataUpdates'; // Đảm bảo sử dụng cùng một kênh

if (USE_REDIS) {
    const { publisherClient: redisPublisher } = require('../redis/publisher');  // Đảm bảo đúng đường dẫn đến redis/publisher.js
    publisherClient = redisPublisher;
}

// Cache-aside helper
async function viewWithCache(key) {
    const cacheKey = `data:${key}`;
    try {
        const cachedValue = await redisClient.get(cacheKey);
        if (cachedValue !== null) {
            console.log(`[CACHE] HIT for key: ${key}`);
            return cachedValue;
        }

        console.log(`[CACHE] MISS for key: ${key}`);
        const dbValue = await Persistent.view(key);
        if (dbValue !== null) {
            await redisClient.set(cacheKey, dbValue);
        }
        return dbValue;
    } catch (err) {
        console.error('[CACHE] Redis error:', err);
        return await Persistent.view(key); // fallback nếu Redis lỗi
    }
}

router.post('/add', async (req, res) => {
    const { key, value } = req.body;
    try {
        const result = await Persistent.write(key, value);

        if (USE_REDIS && redisClient) {
            await redisClient.del(`data:${key}`);
            console.log(`[CACHE] Deleted cache for key: ${key}`);
        }

        if (USE_REDIS && publisherClient && publisherClient.isReady) {
            await publisherClient.publish(redisChannel, JSON.stringify({ key, value }));
        }

        res.status(200).send(`${result} successfully!`);
    } catch (err) {
        console.error('[POST /api/add] Error:', err);
        res.status(500).send(err.toString());
    }
});

router.get('/get/:id', async (req, res) => {
    const key = req.params.id;
    try {
        const value = USE_REDIS && redisClient
            ? await viewWithCache(key)
            : await Persistent.view(key);

        res.status(200).send(String(value));
    } catch (err) {
        res.status(err.message.includes('not found') ? 404 : 500).send(err.toString());
    }
});

router.get('/all', async (req, res) => {
    try {
        const allRecords = await Persistent.all();
        res.json(allRecords);
    } catch (err) {
        console.error('[GET /api/all] Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
