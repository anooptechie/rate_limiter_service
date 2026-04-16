const Redis = require("ioredis");

let redis;

// 🔥 Prevent Redis connection during tests
if (process.env.NODE_ENV === "test") {
  // return a dummy object (won't be used anyway because of jest.mock)
  redis = {
    get: async () => {},
    set: async () => {},
    incr: async () => {},
    expire: async () => {},
    ping: async () => "PONG",
    hgetall: async () => ({}),
    hmset: async () => {},
    eval: async () => {},
    quit: async () => {},
  };
} else {
  redis = new Redis(process.env.REDIS_URL);

  redis.on("connect", () => {
    console.log("✅ Redis connected");
  });

  redis.on("error", (err) => {
    console.error("Redis error:", err);
  });
}

module.exports = redis;
