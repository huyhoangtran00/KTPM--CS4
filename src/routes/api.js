const express = require('express');
const router = express.Router();
const Persistent = require('../lib/db.js');

// Kiểm tra cấu hình để có sử dụng Redis hay không
const { USE_REDIS } = require('../config'); // Đảm bảo đường dẫn đúng
let publisherClient = null; // Đảm bảo publisherClient chưa được khởi tạo ngoài Redis
let redisChannel = 'dataUpdates'; // Đảm bảo sử dụng cùng một kênh

if (USE_REDIS) {
    const { publisherClient: redisPublisher } = require('../redis/publisher');  // Đảm bảo đúng đường dẫn đến redis/publisher.js
    publisherClient = redisPublisher;
}

router.post('/add', async (req, res) => {
    const { key, value } = req.body;
    try {
        const result = await Persistent.write(key, value);

        // Nếu có sử dụng Redis thì publish
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
