    const express = require('express');
    const bodyParser = require('body-parser');
    const path = require('path');
    const Persistent = require('./lib/db'); // Assuming this path is correct
    const cors = require('cors');
    const http = require('http');
    const socketIo = require('socket.io');
    const redis = require('redis'); // Import redis client
    // Thêm các require cần thiết
    const axios = require('axios');
    const cron = require('node-cron');
    // --- Configuration ---
    const port = 8080;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'; // Use REDIS_URL from env if available, otherwise default
    const GOLD_API_URL = 'https://api.gold-api.com/price/';

    // Cấu hình API giá vàng
    const METALS = [
        { "name": "Silver", "symbol": "XAG" },
        { "name": "Gold", "symbol": "XAU" },
        { "name": "Bitcoin", "symbol": "BTC" },
        { "name": "Ethereum", "symbol": "ETH" },
        { "name": "Palladium", "symbol": "XPD" },
        { "name": "Copper", "symbol": "HG" }
    ];




    // --- App and Server Setup ---
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: {
            origin: "*", // Adjust for production
            methods: ["GET", "POST"]
        }
    });

    app.use(bodyParser.json());
    app.use(cors());

    const publisherClient = redis.createClient({ url: redisUrl });
    const subscriberClient = publisherClient.duplicate(); 

    publisherClient.on('error', (err) => console.error('[Redis Publisher] Error:', err));
    subscriberClient.on('error', (err) => console.error('[Redis Subscriber] Error:', err));

    // Hàm xử lý ghi dữ liệu + cập nhật Redis pub/sub + xóa cache
    async function addData(key, value) {
    try {
        // Ghi vào DB
        await Persistent.write(key, value);
        console.log(`[addData] DB saved: ${key} = ${value}`);

        // Xoá cache cũ trong Redis (nếu có)
        await publisherClient.del(`metal:${key}`);
        console.log(`[addData] Cache deleted: metal:${key}`);

        // Gửi pub/sub tới các subscriber
        const message = JSON.stringify({ key, value });
        await publisherClient.publish(key, message);
        console.log(`[addData] Published to Redis channel '${key}': ${message}`);
    } catch (err) {
        console.error(`[addData] Error processing ${key}:`, err.message);
        throw err;
    }
}

    async function setupRedis() {
        try {
            await publisherClient.connect();
            console.log('[Redis Publisher] Connected successfully.');

            await subscriberClient.connect();
            console.log('[Redis Subscriber] Connected successfully.');
            for (const metal of METALS) {
                const channelName = metal.name; 
                await subscriberClient.subscribe(channelName, (message, channel) => {
                    console.log(`[Redis Subscriber] Message from ${channel}: ${message}`);
                    try {
                        const data = JSON.parse(message);
                        io.emit(data.key, { key: data.key, value: data.value }); 
                    } catch (err) {
                        console.error(`[Redis Subscriber] Failed to parse message from ${channel}`, err);
                    }
                });
                console.log(`[Redis Subscriber] Subscribed to channel: ${channelName}`);
            }

        } catch (err) {
            console.error('[Redis] Failed to connect or subscribe:', err);
            process.exit(1); // Exit if Redis connection fails
        }
    }


    // io.on('connection', (socket) => {
    //     console.log('[Socket.IO] A user connected:', socket.id);
    //     socket.on('disconnect', () => {
    //         console.log('[Socket.IO] User disconnected:', socket.id);
    //     });
    // });

    async function fetchAndStoreMetalPrices() {
        console.log('[Metal Price] Bắt đầu cập nhật giá...');
    
        for (const metal of METALS) {
            try {
                const response = await axios.get(`${GOLD_API_URL}${metal.symbol}`);
    
                let price;
                if (response.data && typeof response.data.price !== 'undefined') {
                    price = response.data.price;
                } else {
                    throw new Error('Cấu trúc response không hợp lệ');
                }
    
                console.log(`[Metal Price] ${metal.name}: ${price}`);
    
                // Ghi DB + xoá cache + publish
                await addData(metal.name, price.toString());
    
            } catch (error) {
                console.error(`[Metal Price] Lỗi khi lấy giá ${metal.name}:`, error.message);
            }
    
            // Tạm dừng giữa các lần gọi API (tránh spam)
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    
        console.log('[Metal Price] Hoàn thành cập nhật giá');
    }

    cron.schedule('*/5 * * * *', async () => {
        console.log('[Cron] Tự động cập nhật giá');
        await fetchAndStoreMetalPrices();
    });
    app.post('/add', async (req, res) => {
        try {
            const { key, value } = req.body;
            console.log(`[POST /add] Received: ${key} = ${value}`);
            await addData(key, value);
            res.status(200).send('OK');
        } catch (err) {
            console.error('[POST /add] Error:', err);
            res.status(500).send(err.toString());
        }
    });

    app.get('/get/:id', async (req, res) => {
        const id = req.params.id;
        console.log(`[GET /get/${id}] Received request.`);
    
        const cacheKey = `metal:${id}`;
    
        try {
            // Kiểm tra cache trong Redis
            const cachedValue = await publisherClient.get(cacheKey);
    
            if (cachedValue !== null) {
                console.log(`[Cache] Trả về từ Redis cache: ${cacheKey}`);
                return res.status(200).send(cachedValue);
            }
    
            // Nếu không có cache, đọc từ database
            const value = await Persistent.view(id);
            
            // Lưu vào Redis cache với thời hạn (VD: 1 phút)
            await publisherClient.setEx(cacheKey, 60, String(value));
            console.log(`[Cache] Đã cache ${cacheKey} trong 60 giây`);
    
            res.status(200).send(String(value));
    
        } catch (err) {
            console.error(`[GET /get/${id}] Error:`, err);
            if (err.message && err.message.includes('not found')) {
                res.status(404).send('Key not found');
            } else {
                res.status(500).send(err.toString());
            }
        }
    });

    app.get('/viewer/:id', (req, res) => {
        const key = req.params.id;
        console.log(`[GET /viewer/${key}] Serving viewer.html`);
        res.sendFile(path.join(__dirname, "viewer.html"));
    });

    app.get('/add', (req, res) => {
        console.log(`[GET /add] Serving add.html`);
        res.sendFile(path.join(__dirname, 'add.html'));
    });


    (async () => {
        await setupRedis();
        await fetchAndStoreMetalPrices();

        server.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
            console.log(`Pub/Sub Pattern using Redis integrated.`);
            console.log(` - Redis Publisher: Connected`);
            console.log(` - Redis Subscriber: Connected and listening on channel successfully`);
            console.log(` - Socket.IO: Listening for connections`);
        });
    })();