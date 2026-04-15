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