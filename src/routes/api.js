const express = require('express');
const router = express.Router();
const Persistent = require('../lib/db.js');
const { publisherClient } = require('../redis/publisher');
const redisChannel = 'dataUpdates';

router.post('/add', async (req, res) => {
    if (!publisherClient.isReady) return res.status(503).send("Redis not ready.");
    const { key, value } = req.body;
    try {
        const result = await Persistent.write(key, value);
        await publisherClient.publish(redisChannel, JSON.stringify({ key, value }));
        res.status(200).send(`${result} successfully!`);
    } catch (err) {
        console.error('[POST /api/add] Error:', err);
        res.status(500).send(err.toString());
    }
});

router.get('/get/:id', async (req, res) => {
    try {
        const value = await Persistent.view(req.params.id);
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
