const redis = require('redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const publisherClient = redis.createClient({ url: redisUrl });

async function setupRedis() {
    try {
        await publisherClient.connect();
        console.log('[Redis Publisher] Connected successfully.');
    } catch (err) {
        console.error('[Redis Publisher] Error:', err);
        process.exit(1);
    }
}

module.exports = {
    setupRedis,
    publisherClient
};
