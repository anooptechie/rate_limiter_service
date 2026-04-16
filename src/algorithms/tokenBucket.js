const redis = require("../db/redis");

/**
 * Lua script for atomic Token Bucket logic
 */
const TOKEN_BUCKET_LUA = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])
local cost       = tonumber(ARGV[4])

-- Fetch existing data
local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1]) or capacity
local lastRefill = tonumber(data[2]) or now

-- Calculate refill
local elapsed = math.max(0, now - lastRefill)
local refilled = math.min(capacity, tokens + elapsed * refillRate)

if refilled >= cost then
  -- Allow request
  redis.call('HMSET', key, 'tokens', refilled - cost, 'lastRefill', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 1)
  return {1, math.floor(refilled - cost), 0}
else
  -- Reject request
  local waitTime = math.ceil((cost - refilled) / refillRate)
  redis.call('HMSET', key, 'tokens', refilled, 'lastRefill', now)
  return {0, 0, waitTime}
end
`;

async function tokenBucket({ key, limit: capacity, window, cost = 1 }) {
  // tokens added per second
  const refillRate = capacity / window;

  const now = Math.floor(Date.now() / 1000); // seconds
  const redisKey = `ratelimit:token:${key}`;

  const result = await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    redisKey,
    capacity,
    refillRate,
    now,
    cost
  );

  const allowed = result[0] === 1;
  const remaining = Number(result[1]);
  const retryAfter = Number(result[2]);

  const resetAt = now + Math.ceil((capacity - remaining) / refillRate);

  if (!allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  return {
    allowed: true,
    remaining,
    resetAt,
  };
}

module.exports = tokenBucket;