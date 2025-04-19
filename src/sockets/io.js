const socketIo = require('socket.io');

function setupSocketIO(server) {
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket.IO] Connected: ${socket.id}`);
        socket.on('disconnect', () => {
            console.log(`[Socket.IO] Disconnected: ${socket.id}`);
        });
    });

    return io;
}

module.exports = setupSocketIO;
