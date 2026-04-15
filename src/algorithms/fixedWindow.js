const redis = require("../db/redis");

async function fixedWindow({ key, limit, window: windowSeconds }) {
  const now = Math.floor(Date.now() / 1000);

  const windowStart =
    Math.floor(now / windowSeconds) * windowSeconds;

  const redisKey = `ratelimit:fixed:${key}:${windowStart}`;

  // Initialize key safely (avoids race condition)
  await redis.set(redisKey, 0, "NX", "EX", windowSeconds);

  const count = await redis.incr(redisKey);

  const resetAt = windowStart + windowSeconds;
  const remaining = Math.max(0, limit - count);

  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: resetAt - now,
    };
  }

  return {
    allowed: true,
    remaining,
    resetAt,
  };
}

module.exports = fixedWindow;