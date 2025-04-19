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
                
                await Persistent.write(metal.name, price.toString());
                console.log(`[Metal Price] Đã lưu ${metal.name} vào DB`);
                
                const message = JSON.stringify({ 
                    key: metal.name, 
                    value: price 
                });
                await publisherClient.publish(metal.name, message);
                console.log(`[Metal Price] Đã gửi cập nhật ${metal.name} qua Redis`);
                
            } catch (error) {
                console.error(`[Metal Price] Lỗi khi lấy giá ${metal.name}:`, error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('[Metal Price] Hoàn thành cập nhật giá');
    }

    cron.schedule('*/1 * * * *', async () => {
        console.log('[Cron] Tự động cập nhật giá');
        await fetchAndStoreMetalPrices();
    });
    
    app.post('/add', async (req, res) => {
        if (!publisherClient.isReady) {
            console.error("[POST /add] Redis Publisher not ready.");
            return res.status(503).send("Service temporarily unavailable (Redis Publisher).");
        }
        try {
            const { key, value } = req.body;
            console.log(`[POST /add] Received request: key=${key}, value=${value}`);

            const result = await Persistent.write(key, value);
            console.log(`[POST /add] Persistent.write result: ${result}`);
            res.status(200).send(result + " successfully!"); 
            const message = JSON.stringify({ key, value }); 
            await publisherClient.publish(key, message);
            console.log(`[Redis Publisher] Published message to channel '${key}': ${message}`);

        } catch (err) {
            console.error("[POST /add] Error:", err);
            res.status(500).send(err.toString());
        }
    });

    app.get('/get/:id', async (req, res) => {
        try {
            const id = req.params.id;
            console.log(`[GET /get/${id}] Received request.`);
            const value = await Persistent.view(id);
            res.status(200).send(String(value));
        } catch (err) {
            console.error(`[GET /get/${req.params.id}] Error:`, err);
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