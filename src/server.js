const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { setupRedis, publisherClient } = require('./redis/publisher');
const { initSubscriber } = require('./redis/subscriber');
const setupSocketIO = require('./sockets/io');
const apiRoutes = require('./routes/api');

const port = 8080;
const app = express();
const server = http.createServer(app);
const io = setupSocketIO(server);

app.use(bodyParser.json());
app.use(cors());
app.use('/api', apiRoutes);

// Serve static pages
app.use(express.static(path.join(__dirname, 'public')));
app.get('/viewer/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/viewer.html')));
app.get('/add', (req, res) => res.sendFile(path.join(__dirname, 'public/add.html')));
app.get('/all', (req, res) => res.sendFile(path.join(__dirname, 'public/all.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

(async () => {
    await setupRedis();
    await initSubscriber(io); // Pass socket.io instance
    server.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
})();
