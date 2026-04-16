const { randomUUID } = require("crypto");
const redis = require("../db/redis");

/**
 * Lua Script (runs INSIDE Redis)
 * This ensures atomicity (no race conditions)
 */
const SLIDING_WINDOW_LUA = `
local key       = KEYS[1]
local now       = tonumber(ARGV[1])   -- current timestamp (ms)
local window    = tonumber(ARGV[2])   -- window size (ms)
local limit     = tonumber(ARGV[3])
local requestId = ARGV[4]

-- Step 1: Remove old requests (outside window)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

-- Step 2: Count current requests
local count = redis.call('ZCARD', key)

-- Step 3: Decision
if count < limit then
  -- Allow request
  redis.call('ZADD', key, now, requestId)
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
  return {1, limit - count - 1}   -- allowed, remaining
else
  -- Reject request
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, oldest[2]}           -- rejected, timestamp of oldest request
end
`;

async function slidingWindow({ key, limit, window: windowSeconds }) {
  const now = Date.now(); // milliseconds
  const windowMs = windowSeconds * 1000;

  // Unique ID so ZSET entries don’t collide
  const requestId = randomUUID();

  const redisKey = `ratelimit:sliding:${key}`;

  const result = await redis.eval(
    SLIDING_WINDOW_LUA,
    1,                // number of keys
    redisKey,
    now,
    windowMs,
    limit,
    requestId
  );

  const allowed = result[0] === 1;
  const value = Number(result[1]);

  if (!allowed) {
    const retryAfter = Math.max(
      0,
      Math.ceil((value + windowMs - now) / 1000)
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.ceil(value / 1000),
      retryAfter,
    };
  }

  return {
    allowed: true,
    remaining: value,
    resetAt: Math.ceil((now + windowMs) / 1000),
  };
}

module.exports = slidingWindow;