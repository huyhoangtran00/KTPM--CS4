const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Persistent = require('./lib/db');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io'); // Thêm socket.io

const app = express();
const server = http.createServer(app); // Tạo server HTTP
const io = socketIo(server); // Tạo socket.io từ server HTTP

const port = 8080;

app.use(bodyParser.json());
app.use(cors());

// Khi có bất kỳ thay đổi nào, phát sự kiện cho tất cả các client
app.post('/add', async (req, res) => {
    try {
        const { key, value } = req.body;
        console.log(req.body);
        console.log(`key: ${key}, value: ${value}`);
        const result = await Persistent.write(key, value);
        console.log(result);  // Log xem là create hay update
        res.send("Insert a new record successfully!");

        // Phát sự kiện tới tất cả các client để cập nhật giá trị mới
        io.emit('updateValue', { key, value });
    } catch (err) {
        res.send(err.toString());
    }
});

// Lấy giá trị từ database dựa trên key
app.get('/get/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const value = await Persistent.view(id);
        res.status(200).send(value);
    } catch (err) {
        res.send(err)
    }
});

// Trang web để theo dõi giá trị của key
app.get('/viewer/:id', (req, res) => {
    const id = req.params.id;
    res.sendFile(path.join(__dirname, "viewer.html"));
});

// Trang add.html để thêm key-value
app.get('/add', (req, res) => {
    res.sendFile(path.join(__dirname, 'add.html'));
});

// Khởi động server HTTP và lắng nghe kết nối
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
