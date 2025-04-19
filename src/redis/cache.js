const redisClient = require('../redis/cacheClient');
const Persistent = require('../lib/db');

async function viewWithCache(key) {
    const cacheKey = `data:${key}`;
    try {
        const cachedValue = await redisClient.get(cacheKey);
        if (cachedValue !== null) {
            console.log(`[CACHE] HIT for key: ${key}`);
            return cachedValue;
        }

        console.log(`[CACHE] MISS for key: ${key}`);
        const dbValue = await Persistent.view(key);
        if (dbValue !== null) {
            await redisClient.set(cacheKey, dbValue);
        }
        return dbValue;
    } catch (err) {
        console.error('[CACHE] Redis error:', err);
        return await Persistent.view(key); // fallback nếu Redis lỗi
    }
}

module.exports = { viewWithCache };
