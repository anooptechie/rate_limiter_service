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

🚀 Milestone 4 — Token Bucket Rate Limiting (with Weighted Cost)
🎯 Goal

Implement a flexible and production-grade rate limiting algorithm that allows burst traffic while maintaining a controlled long-term request rate.

🧱 What was implemented
Token Bucket algorithm using:
Redis Hash to store:
tokens → current available tokens
lastRefill → last refill timestamp
Lua script for atomic execution:
Prevents race conditions under concurrent requests
Continuous refill logic:
refillRate = capacity / window
Tokens added based on elapsed time
Burst handling:
Allows immediate requests up to bucket capacity
Weighted cost support:
Each request consumes configurable tokens (cost)

⚙️ Algorithm Flow
Fetch current bucket state (tokens, lastRefill)
Calculate elapsed time and refill tokens
Cap tokens at maximum capacity
Check if enough tokens are available:
If yes → consume tokens and allow
If no → reject and calculate retryAfter
Persist updated state in Redis

🧪 Verification
Burst Test (limit = 10):
First 10 requests → allowed
11th request → rejected
Refill Test:
After waiting a few seconds → requests allowed again
Weighted Cost Test (cost = 5):
Only 2 requests allowed
3rd request rejected
Redis Inspection:
HGETALL ratelimit:token:{key} shows:
tokens decreasing and refilling
lastRefill updating correctly

⚠️ Important Implementation Details
Used seconds (not milliseconds) for refill calculations
Handled cold start:
New key initializes bucket at full capacity
Used math.min to prevent token overflow
Returned integer remaining while maintaining fractional tokens internally
Applied TTL using:
EXPIRE = capacity / refillRate

🧠 Key Learnings
Token Bucket supports:
Burst traffic
Smooth rate limiting
Continuous refill enables:
More natural traffic flow compared to fixed/sliding windows
Weighted cost allows:
Fair usage of expensive endpoints
Atomic Lua execution is critical for correctness

🔍 Comparison with Other Algorithms
Feature	Fixed Window	Sliding Window	Token Bucket
Burst support	❌	❌	✅
Accuracy	❌	✅	✅
Memory usage	✅ Low	❌ High	✅ Low
Real-world usage	⚠️	⚠️	✅
💡 Real-World Relevance

Token Bucket is widely used in:

API gateways
Cloud platforms (AWS, GCP)
Rate-limited SaaS services

🚀 Milestone 5 — Input Validation & Algorithm Routing
🎯 Goal

Refactor the API layer to follow clean architecture principles by introducing request validation and a scalable routing mechanism for different rate limiting algorithms.

🧱 What was implemented
Input validation using Zod:
Enforced strict schema for incoming requests
Validated fields:
key, algorithm, limit, window, cost
Rejected invalid requests with HTTP 400 and detailed error messages
Validation middleware (validateRequest):
Centralized validation logic
Attached sanitized input to req.validated
Prevented usage of untrusted req.body
Algorithm Router (algorithmRouter):
Mapped algorithm names to implementations:
fixed-window
sliding-window
token-bucket
Dynamically invoked correct algorithm based on request
Route refactoring:
Replaced conditional logic (if-else) with modular routing
Introduced clean middleware chain:
Validation → Routing → Response

⚙️ Request Flow
Client Request
      ↓
Validation Middleware (Zod)
      ↓
Algorithm Router
      ↓
Rate Limiting Algorithm
      ↓
Response (200 / 429 / 400)

🧪 Verification
Valid request:
Routed correctly to respective algorithm
Returned expected rate limiting response
Invalid request:
Missing or incorrect fields → HTTP 400
Response includes field-level validation errors
Edge cases tested:
Missing key
Invalid algorithm
Negative or zero limit
Missing request body

⚠️ Important Implementation Details
Used req.validated instead of req.body to ensure safe input handling
Updated Zod error handling to use error.issues (latest API)
Removed legacy stub route to avoid incorrect fallback behavior
Ensured all algorithms are invoked through a single routing layer