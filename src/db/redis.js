const Redis = require("ioredis");
const config = require("../config/env");

const redis = new Redis({
  host: config.redisHost,
  port: config.redisPort,
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

module.exports = redis;