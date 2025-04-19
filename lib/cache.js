const redis = require('redis');

const client = redis.createClient();

client.on('error', (err) => {
  console.error('[REDIS] Error:', err);
});

client.connect()
  .then(() => console.log('[REDIS] Connected to Redis'))
  .catch(console.error);

module.exports = client;
