const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { setupRedis, publisherClient } = require('./redis/publisher');
const { initSubscriber } = require('./redis/subscriber');
const setupSocketIO = require('./sockets/io');
const apiRoutes = require('./routes/api');
const { USE_REDIS, USE_SOCKET } = require('./config');

const port = 8080;
const app = express();
const server = http.createServer(app);
let io = null;

if (USE_SOCKET) {
  io = setupSocketIO(server);
}

app.use(bodyParser.json());
app.use(cors());
app.use('/api', apiRoutes);

// Hàm xử lý cache-aside
async function viewWithCache(key) {
  const cacheKey = `data:${key}`;
  try {
    const cachedValue = await redisClient.get(cacheKey);

    if (cachedValue !== null) {
      console.log(`[CACHE] Cache hit for key: ${key}`);
      return cachedValue;
    }

    console.log(`[CACHE] Cache miss for key: ${key}`);
    const dbValue = await Persistent.view(key);
    if (dbValue !== null) {
      await redisClient.set(cacheKey, dbValue);
    }

    return dbValue;
  } catch (err) {
    console.error('[CACHE] Redis error:', err);
    return await Persistent.view(key);
  }
}


// Serve static pages
app.use(express.static(path.join(__dirname, 'public')));
app.get('/viewer/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/viewer.html')));
app.get('/add', (req, res) => res.sendFile(path.join(__dirname, 'public/add.html')));
app.get('/all', (req, res) => res.sendFile(path.join(__dirname, 'public/all.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

(async () => {
  if (USE_REDIS) {
    await setupRedis();
    await initSubscriber(io); // io có thể null nếu không dùng socket
  }
  server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
})();
