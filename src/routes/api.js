const express = require('express');
const router = express.Router();
const Persistent = require('../lib/db');
const { viewWithCache } = require('../redis/cache');
const { USE_REDIS } = require('../config');

let publisherClient = null;
let redisClient = null;
const redisChannel = 'dataUpdates';

if (USE_REDIS) {
    redisClient = require('../redis/cacheClient');
    const { publisherClient: redisPublisher } = require('../redis/publisher');
    publisherClient = redisPublisher;
}

router.post('/add', async (req, res) => {
    const { key, value } = req.body;
    try {
        const result = await Persistent.write(key, value);

        if (USE_REDIS && redisClient) {
            await redisClient.del(`data:${key}`);
            console.log(`[CACHE] Deleted cache for key: ${key}`);
        }

        if (USE_REDIS && publisherClient?.isReady) {
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
        const value = USE_REDIS
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
