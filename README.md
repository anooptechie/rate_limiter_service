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

🚀 Milestone 6 — Observability (Logging, Metrics, Health Checks)
🎯 Goal

Enhance the service with observability features to make it production-ready by enabling monitoring, debugging, and performance analysis.

🧱 What was implemented
🧾 Structured Logging
Integrated Pino HTTP logger
Generated unique traceId for each request
Logged:
Algorithm used
Request outcome (allowed/rejected)
Errors with context

📊 Metrics (Prometheus)
Implemented metrics using prom-client
Exposed /metrics endpoint for scraping

Tracked metrics:

rate_limiter_requests_total → Total requests
rate_limiter_allowed_total → Allowed requests
rate_limiter_rejected_total → Rejected requests
rate_limiter_request_duration_seconds → Request latency

All metrics include:

algorithm label for granular analysis

❤️ Health Check
Enhanced /health endpoint:
Verifies Redis connectivity
Response format:
{
  "status": "ok",
  "redis": "connected"
}

⚙️ Request Flow with Observability
Incoming Request
      ↓
Assign traceId (logging middleware)
      ↓
Validation → Algorithm Router → Algorithm
      ↓
Metrics recorded (request, allowed/rejected, latency)
      ↓
Structured logs emitted
      ↓
Response returned with traceId

🧪 Verification
Logs
Verified structured logs with traceId in terminal
Metrics
/metrics exposes Prometheus-compatible format
Confirmed:
request count increments
allowed/rejected counters update correctly
latency histogram records values
Health Check
/health returns Redis connection status

⚠️ Important Implementation Details
Used pino-http for automatic request logging
Generated trace IDs using crypto.randomUUID()
Ensured metrics include labels for better observability
Used histogram buckets for latency tracking
Handled errors with structured logging

🧪 Testing Strategy
🎯 Goal

Ensure correctness of the rate limiter while keeping tests:

Fast ⚡
Deterministic 🎯
CI-friendly 🤖
🧱 Approach

We follow a hybrid testing strategy:

Layer	Type	Redis
API (endpoints)	Integration tests	Mocked
Algorithms (basic)	Behavioral tests	Mocked
Algorithms (advanced)	Manual validation	Real Redis

🔁 Redis Mocking
Redis is mocked using an in-memory Map
Implemented in:

📁 tests/__mocks__/redis.js

Applied globally via:

📁 tests/setup.js

✅ Why mock Redis?
CI environments (e.g., GitHub Actions) do not provide Redis by default
Avoids flaky tests due to network or connection issues
Keeps tests fast and deterministic
Focuses on application logic, not Redis internals

🧪 Test Coverage
✅ 1. API Tests (Integration)

📁 tests/check.endpoint.test.js

Covers:

Missing fields → returns 400
Invalid algorithm → returns 400
Valid requests → routed correctly
Response structure includes:
allowed
remaining
retryAfter (when applicable)
traceId

✅ 2. Fixed Window Tests

📁 tests/fixedWindow.test.js

Covers:

Requests within limit → allowed
Different keys are isolated
⚠️ 3. Sliding Window Tests

📁 tests/slidingWindow.test.js

Marked as skipped using describe.skip()
⚠️ 4. Token Bucket Tests

📁 tests/tokenBucket.test.js

Marked as skipped using describe.skip()
⚠️ Limitations of Mock-Based Testing

Some algorithms rely on Redis-specific features:

Algorithm	Dependency
Sliding Window	Sorted Sets (ZSET) + Lua
Token Bucket	Lua scripts + atomic updates
Fixed Window (advanced)	TTL / expiration

🚫 Why these tests are skipped

The in-memory mock does NOT support:

TTL (key expiration)
Sorted Sets (ZSET)
Lua scripts (EVAL)

👉 Therefore:

Behavior cannot be accurately simulated
Tests would be misleading or incorrect

✅ How correctness was validated
All algorithms were tested manually against real Redis
Verified using:
curl requests
Redis CLI (ZRANGE, HGETALL, etc.)

🧠 Key Engineering Insight

Not all distributed system behavior can be reliably unit tested.

This project demonstrates:

Proper use of mocks for CI-safe testing
Awareness of system limitations
Validation of critical logic against real infrastructure

⚙️ Running Tests
npm test

📊 Expected Output
PASS  tests/check.endpoint.test.js
PASS  tests/fixedWindow.test.js
PASS  tests/rateLimit.test.js
SKIPPED tests/slidingWindow.test.js
SKIPPED tests/tokenBucket.test.js

💡 Design Decision

Instead of forcing unrealistic mocks:

We test what can be reliably validated
We document what cannot
We verify critical paths manually

👉 This reflects real-world backend engineering practices

Milestone 8 Load Testing (K6)

🚀 Load Testing (k6)
Test Configuration
Load: 50 requests/sec
Duration: 20 seconds
Virtual Users: 20
Algorithm: Fixed Window
Limit: 10 requests per user per minute
Results
Metric	Value
Total Requests	1001
Allowed	200
Rejected	801
Avg Latency	5.57 ms
p95 Latency	22.58 ms
Key Observations
System enforced rate limits accurately

Maximum allowed requests matched theoretical limit:

20 users × 10 requests = 200
Excess traffic was correctly rejected with 429
Latency remained low under sustained load
Important Note
High rejection rate (~80%) is expected behavior
Indicates strict enforcement of rate limits, not system failure

🔁 Sliding Window vs Fixed Window
Observations
Metric	Fixed Window	Sliding Window
Allowed Requests	200	200
Rejected Requests	801	801
Avg Latency	5.57 ms	4.63 ms
p95 Latency	22.58 ms	12.58 ms
Key Insight
Both algorithms enforce limits correctly
Sliding Window shows better latency distribution
Reduces burst effects at window boundaries
Design Trade-off
Algorithm	Trade-off
Fixed Window	Simple but allows burst
Sliding Window	More accurate but slightly complex

🚀 FINAL Load Testing (k6)
Configuration
Load: 50 requests/sec
Duration: 20 seconds
Users: 20 (isolated keys)
Limit: 10 requests/user
Window: 60 seconds
📊 Results
Algorithm	Allowed	Rejected	Avg Latency	p95 Latency
Fixed Window	200	801	5.57 ms	22.58 ms
Sliding Window	200	801	4.63 ms	12.58 ms
Token Bucket	260	740	5.10 ms	20.20 ms
🧠 Key Observations
Fixed Window
Enforces strict limits
Allows burst at window boundaries
Sliding Window
Smoother request distribution
Lower tail latency (better p95)
Token Bucket
Allows burst + gradual refill
Enables more requests over time
Best suited for user-facing APIs
🔥 Key Insight

Token Bucket allowed more requests due to time-based refill:

refill_rate = limit / window
total_tokens = initial + (refill_rate × duration)

This resulted in ~260 allowed requests instead of 200.

