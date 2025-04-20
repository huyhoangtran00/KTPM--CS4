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
    const fs = require('fs');
    const rateLimit = require('express-rate-limit');
    const RedisStore = require('rate-limit-redis');

    // --- Configuration ---
    const port = 8080;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const GOLD_API_URL = 'https://api.gold-api.com/price/';

    const METALS = [
        { "name": "Silver", "symbol": "XAG" },
        { "name": "Gold", "symbol": "XAU" },
        { "name": "Bitcoin", "symbol": "BTC" },
        { "name": "Ethereum", "symbol": "ETH" },
        { "name": "Palladium", "symbol": "XPD" },
        { "name": "Copper", "symbol": "HG" }
    ];

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });




    app.use(bodyParser.json());
    app.use(cors());

    const publisherClient = redis.createClient({ url: redisUrl });
    const subscriberClient = publisherClient.duplicate(); 
    const redisClientForRateLimit = redis.createClient({ url: redisUrl });


    publisherClient.on('error', (err) => console.error('[Redis Publisher] Error:', err));
    subscriberClient.on('error', (err) => console.error('[Redis Subscriber] Error:', err));

    // Circuit Breaker setup
    function getMetalPrice(symbol) {
        return axios.get(`${GOLD_API_URL}${symbol}`);
    }

    const breakerOptions = {
        timeout: 5000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000
    };

    const breaker = new CircuitBreaker(getMetalPrice, breakerOptions);

    breaker.fallback((symbol) => {
        console.warn(`[Circuit Breaker] Fallback: Không thể lấy giá cho ${symbol}.`);
        return { data: { price: "N/A" } };
    });

    breaker.on('open', () => console.warn('[Circuit Breaker] OPEN'));
    breaker.on('halfOpen', () => console.log('[Circuit Breaker] HALF-OPEN'));
    breaker.on('close', () => console.log('[Circuit Breaker] CLOSED'));

    async function addData(key, value) {
    
        console.time(`[addData] ${key} - Thời gian xử lý`);
    
        try {
            await Persistent.write(key, value);
            console.log(`[addData] DB saved: ${key} = ${value}`);
            const startTime = Date.now(); // Thời điểm bắt đầu

            // Ghi cache Redis
            await publisherClient.setEx(`metal:${key}`, 60, String(value));
            console.log(`[addData] Cached metal:${key} for 60 seconds`);
    
            // Đưa dữ liệu vào Redis Pub/Sub
            const message = JSON.stringify({ key, value, serverTime: startTime });
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
            await redisClientForRateLimit.connect()
            console.log('[Redis Rate Limit] Connected successfully.');
            await subscriberClient.connect();
            console.log('[Redis Subscriber] Connected successfully.');


            const limiter = rateLimit({
                store: new RedisStore({
                    sendCommand: (...args) => redisClientForRateLimit.sendCommand(args),
                    prefix: 'ratelimit:', // Redis key prefix
                    expiry: 15 * 60 // 15 minutes in seconds
                }),
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: 100, // limit each IP to 100 requests per windowMs
                message: 'Too many requests from this IP, please try again after 15 minutes',
                standardHeaders: true,
                legacyHeaders: false,
                // Optional: Different rate limiting for different routes
                keyGenerator: (req) => {
                    return `${req.ip}:${req.path}`; // Different limits per route
                },
                handler: (req, res) => {
                    res.status(429).json({
                        error: 'Too many requests',
                        window: '15 minutes',
                        max: '100 requests',
                        remaining: res.getHeader('X-RateLimit-Remaining')
                    });
                }
            });
        
            app.use(limiter); // Áp dụng cho tất cả các route
        
            for (const metal of METALS) {
                const channelName = metal.name; 
                await subscriberClient.subscribe(channelName, (message, channel) => {
                    console.log(`[Redis Subscriber] Message from ${channel}: ${message}`);
                    try {
                        const data = JSON.parse(message);
                        io.emit(data.key, { key: data.key, value: data.value, serverTime : data.serverTime}); 
                    } catch (err) {
                        console.error(`[Redis Subscriber] Failed to parse message from ${channel}`, err);
                    }
                });
                console.log(`[Redis Subscriber] Subscribed to channel: ${channelName}`);
            }

        } catch (err) {
            console.error('[Redis] Failed to connect or subscribe:', err);
            process.exit(1);
        }
    }

    io.on('connection', (socket) => {
        console.log('[Socket.IO] A user connected:', socket.id);
        socket.on('disconnect', () => {
            console.log('[Socket.IO] User disconnected:', socket.id);
        });
    });

    async function fetchAndStoreMetalPrices() {
        console.log('[Metal Price] Bắt đầu cập nhật giá...');

        for (const metal of METALS) {
            try {
                const response = await breaker.fire(metal.symbol);

                let price;
                if (response.data && typeof response.data.price !== 'undefined') {
                    price = response.data.price;
                } else {
                    throw new Error('Cấu trúc response không hợp lệ');
                }

                console.log(`[Metal Price] ${metal.name}: ${price}`);
                await addData(metal.name, price.toString());

            } catch (error) {
                console.error(`[Metal Price] Lỗi khi lấy giá ${metal.name}:`, error.message);
            }

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
            const cachedValue = await publisherClient.get(cacheKey);

            if (cachedValue !== null) {
                console.log(`[Cache] Trả về từ Redis cache: ${cacheKey}`);
                return res.status(200).send(cachedValue);
            }

            const value = await Persistent.view(id);
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
