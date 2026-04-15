🚀 Milestone 1 — Infrastructure Setup
🎯 Goal
Set up the foundational infrastructure for the Rate Limiter Service:

Redis connection
Express server
Basic API endpoints

🧱 What was implemented
Node.js project initialization with required dependencies
Environment configuration using .env and validation via env.js
Redis client setup using ioredis (singleton pattern)
Express server with:
POST /check → stub response
GET /health → service health check
Structured logging using Pino

🧪 Verification
Redis running locally (redis-cli ping → PONG)
Server starts successfully (node server.js)
/check returns stub response
/health returns service status

🧠 Key Learnings
Importance of singleton Redis client
Early environment validation prevents runtime failures
Stub-first approach simplifies incremental development

🚀 Milestone 2 — Fixed Window Rate Limiting
🎯 Goal
Implement Fixed Window Counter algorithm using Redis to enforce request limits per key within a time window.

🧱 What was implemented

Fixed Window algorithm using:
Redis SET NX EX for safe initialization
Redis INCR for atomic counter increment

Time window segmentation using:
windowStart = floor(now / window) * window

Rate limit enforcement:
Allow requests within limit
Reject requests beyond limit with HTTP 429

Response structure includes:
allowed, remaining, resetAt, retryAfter

Integrated algorithm into /check endpoint

🧪 Verification
Sent 6 requests with limit = 5:
First 5 → allowed
6th → rejected (429)

Verified Redis:
Keys created per window
Counter increments correctly
TTL decreases as expected

⚠️ Important Implementation Details
Used SET NX EX before INCR to avoid immortal key issue
Ensured remaining never goes negative using Math.max
Included windowStart in Redis key to isolate time windows

🧠 Key Learnings
Fixed Window suffers from boundary spike problem
Atomic operations are critical in distributed systems
Redis TTL plays a key role in automatic window reset

🚀 Milestone 3 — Sliding Window Rate Limiting
🎯 Goal

Implement a more accurate rate limiting algorithm that eliminates the boundary spike issue of the Fixed Window approach by tracking requests over a rolling time window.

🧱 What was implemented
Sliding Window algorithm using:
Redis Sorted Sets (ZSET) to store request timestamps
Lua script for atomic execution of all operations
Request flow handled atomically:
Remove expired requests (ZREMRANGEBYSCORE)
Count active requests (ZCARD)
Allow or reject request based on limit
Add new request (ZADD) if allowed
Each request stored with:
Timestamp as score
Unique requestId to avoid collisions
TTL applied to prevent memory leaks

🧪 Verification
Sent 5 requests (limit = 5):
All allowed
Sent 6th request:
Rejected with HTTP 429 and retryAfter
Verified Redis state:
ZRANGE ... WITHSCORES shows exactly 5 timestamps
Old entries removed automatically as window slides

⚠️ Important Implementation Details
Used Lua script to ensure:
No race conditions under concurrent requests
Used milliseconds precision for accurate time tracking
Calculated retryAfter using:
Oldest request timestamp + window duration
Applied EXPIRE on sorted set to avoid unbounded growth

🧠 Key Learnings
Fixed Window suffers from boundary spike problem
Sliding Window provides:
More accurate and fair rate limiting
Atomic operations are essential in distributed systems
Redis Sorted Sets are ideal for time-based queries

🔍 Comparison with Fixed Window
Feature	Fixed Window	Sliding Window
Accuracy	❌ Low	    ✅ High
Boundary spike	❌ Yes	✅ No
Complexity	✅ Simple	⚠️ Moderate
Data stored	Counter	Individual requests