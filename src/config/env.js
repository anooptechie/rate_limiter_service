require("dotenv").config();

const requiredEnv = ["PORT", "REDIS_HOST", "REDIS_PORT"];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required env variable: ${key}`);
  }
});

const config = Object.freeze({
  port: process.env.PORT,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  nodeEnv: process.env.NODE_ENV || "development",
});

module.exports = config;