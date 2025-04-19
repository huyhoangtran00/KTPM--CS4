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

// --- Redis Client Setup ---
// Client for Publishing messages and other commands
const publisherClient = redis.createClient({ url: redisUrl });
// Client dedicated to Subscribing
const subscriberClient = publisherClient.duplicate(); // Duplicate the connection config for the subscriber

publisherClient.on('error', (err) => console.error('[Redis Publisher] Error:', err));
subscriberClient.on('error', (err) => console.error('[Redis Subscriber] Error:', err));

// Function to setup Redis connections and subscriptions
async function setupRedis() {
    try {
        await publisherClient.connect();
        console.log('[Redis Publisher] Connected successfully.');

        await subscriberClient.connect();
        console.log('[Redis Subscriber] Connected successfully.');
        for (const metal of METALS) {
            const channelName = metal.name; // Use the metal name as the channel name`;
            await subscriberClient.subscribe(channelName, (message, channel) => {
                console.log(`[Redis Subscriber] Message from ${channel}: ${message}`);
                try {
                    const data = JSON.parse(message);
                    io.emit(data.key, { key: data.key, value: data.value }); // Optional: Emit per-channel
                } catch (err) {
                    console.error(`[Redis Subscriber] Failed to parse message from ${channel}`, err);
                }
            });
            console.log(`[Redis Subscriber] Subscribed to channel: ${channelName}`);
        }

    } catch (err) {
        console.error('[Redis] Failed to connect or subscribe:', err);
        // Handle connection failure (e.g., exit process, retry logic)
        process.exit(1); // Exit if Redis connection fails on startup
    }
}


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('[Socket.IO] A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('[Socket.IO] User disconnected:', socket.id);
    });
});

// Hàm lấy giá và lưu vào DB (không cần API key)
async function fetchAndStoreMetalPrices() {
    console.log('[Metal Price] Bắt đầu cập nhật giá...');
    
    for (const metal of METALS) {
        try {
            // Gọi API để lấy giá (không cần headers)
            const response = await axios.get(`${GOLD_API_URL}${metal.symbol}`);
            
            // Kiểm tra cấu trúc response và lấy giá
            let price;
            if (response.data && typeof response.data.price !== 'undefined') {
                price = response.data.price;
            } else {
                throw new Error('Cấu trúc response không hợp lệ');
            }
            
            console.log(`[Metal Price] ${metal.name}: ${price}`);
            
            // Lưu vào DB với key là tên loại, value là giá
            await Persistent.write(metal.name, price.toString());
            console.log(`[Metal Price] Đã lưu ${metal.name} vào DB`);
            
            // Gửi thông báo cập nhật qua Redis
            const message = JSON.stringify({ 
                key: metal.name, 
                value: price 
            });
            await publisherClient.publish(metal.name, message);
            console.log(`[Metal Price] Đã gửi cập nhật ${metal.name} qua Redis`);
            
        } catch (error) {
            console.error(`[Metal Price] Lỗi khi lấy giá ${metal.name}:`, error.message);
            // Có thể thêm logic ghi log lỗi chi tiết hơn ở đây
        }
        
        // Tạm dừng giữa các request để tránh bị rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('[Metal Price] Hoàn thành cập nhật giá');
}

// Thiết lập cron job (cập nhật mỗi 5 phút)
cron.schedule('*/1 * * * *', async () => {
    console.log('[Cron] Tự động cập nhật giá');
    await fetchAndStoreMetalPrices();
  });
  
// Publisher: When data is added/updated, publish an event via Redis
app.post('/add', async (req, res) => {
    // Ensure publisher is ready before processing (optional, depends on error handling strategy)
    if (!publisherClient.isReady) {
         console.error("[POST /add] Redis Publisher not ready.");
         return res.status(503).send("Service temporarily unavailable (Redis Publisher).");
    }
    try {
        const { key, value } = req.body;
        console.log(`[POST /add] Received request: key=${key}, value=${value}`);

        // Perform the database write
        const result = await Persistent.write(key, value);
        console.log(`[POST /add] Persistent.write result: ${result}`);
        res.status(200).send(result + " successfully!"); // Send success response FIRST

        // Publish the 'dataUpdated' event via Redis
        const message = JSON.stringify({ key, value }); // Convert data to JSON string
        await publisherClient.publish(key, message);
        console.log(`[Redis Publisher] Published message to channel '${key}': ${message}`);

    } catch (err) {
        console.error("[POST /add] Error:", err);
        res.status(500).send(err.toString());
    }
});

// Get value from database based on key (no changes needed here)
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

// Serve the viewer page (no changes needed here)
app.get('/viewer/:id', (req, res) => {
    const key = req.params.id;
    console.log(`[GET /viewer/${key}] Serving viewer.html`);
    res.sendFile(path.join(__dirname, "viewer.html"));
});

// Serve the add page (no changes needed here)
app.get('/add', (req, res) => {
    console.log(`[GET /add] Serving add.html`);
    res.sendFile(path.join(__dirname, 'add.html'));
});


// --- Start Server ---
// Use an async IIFE (Immediately Invoked Function Expression) to handle async setup
(async () => {
    // Setup Redis connections and subscriptions first
    await setupRedis();
    await fetchAndStoreMetalPrices();

    // Then start the HTTP server
    server.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
        console.log(`Pub/Sub Pattern using Redis integrated.`);
        console.log(` - Redis Publisher: Connected`);
        console.log(` - Redis Subscriber: Connected and listening on channel successfully`);
        console.log(` - Socket.IO: Listening for connections`);
    });
})();