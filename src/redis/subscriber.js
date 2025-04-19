const redis = require('redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisChannel = 'dataUpdates';

const subscriberClient = redis.createClient({ url: redisUrl });

async function initSubscriber(io) {
    try {
        await subscriberClient.connect();
        await subscriberClient.subscribe(redisChannel, (message) => {
            const data = JSON.parse(message);
            io.emit('updateValue', data);
            console.log(`[Redis] Broadcasted: ${message}`);
        });
        console.log(`[Redis] Subscribed to ${redisChannel}`);
    } catch (err) {
        console.error('[Redis Subscriber] Error:', err);
        process.exit(1);
    }
}

module.exports = { initSubscriber };
