# Rate Limiter Service

A standalone, production-grade rate limiting infrastructure service that enforces request limits across an entire backend ecosystem. Any service calls `POST /check` — the Rate Limiter handles the rest.

Built with **Node.js**, **Express**, **Redis**, and **Lua scripts** for distributed atomicity.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Algorithms](#algorithms)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [How to Run](#how-to-run)
- [Build Journey — Milestone by Milestone](#build-journey--milestone-by-milestone)
  - [Milestone 1 — Infrastructure](#milestone-1--infrastructure)
  - [Milestone 2 — Fixed Window Counter](#milestone-2--fixed-window-counter)
  - [Milestone 3 — Sliding Window Log](#milestone-3--sliding-window-log)
  - [Milestone 4 — Token Bucket (with Weighted Cost)](#milestone-4--token-bucket-with-weighted-cost)
  - [Milestone 5 — Input Validation & Algorithm Routing](#milestone-5--input-validation--algorithm-routing)
  - [Milestone 6 — Observability](#milestone-6--observability)
  - [Milestone 7 — Docker + Tests + CI](#milestone-7--docker--tests--ci)
  - [Milestone 8 — Load Testing](#milestone-8--load-testing)
  - [Milestone 9 — Consumer Integration (Auth Service)](#milestone-9--consumer-integration-auth-service)
  - [Milestone 10 — Trace Propagation](#milestone-10--trace-propagation)
- [Testing Strategy](#testing-strategy)
- [Load Test Results](#load-test-results)
- [Consumer Integration Guide](#consumer-integration-guide)
- [Why Not Nginx or API Gateway?](#why-not-nginx-or-api-gateway)
- [Trade-offs & Upgrade Paths](#trade-offs--upgrade-paths)
- [Portfolio Context](#portfolio-context)

---

## Overview

Most backend services implement rate limiting as local middleware — each service has its own counter, its own Redis connection, its own algorithm. When you run multiple instances, the counters are out of sync. When you add a new service, you reimplement the same logic.

This project solves that properly.

The Rate Limiter Service is a **standalone infrastructure service**. It owns all rate limiting logic, all Redis state, and all algorithm implementations. Any downstream service — Auth, Inventory, Notification, or anything future — integrates with one HTTP call and one thin wrapper file.

**What this demonstrates:**

- Three rate limiting algorithms implemented from scratch, each with distinct behavior and trade-offs
- Distributed correctness using Redis Lua scripts for atomic operations under concurrent load
- Weighted request cost — expensive endpoints consume more tokens than cheap ones
- Load-tested behavior — algorithm differences proven with k6, not just described
- End-to-end trace propagation across service boundaries
- Fail-open consumer integration — Rate Limiter outage never blocks legitimate users

---

## System Architecture

```
                    ┌──────────────────────────────┐
                    │         API Gateway           │
                    │    (Nginx / reverse proxy)    │
                    └─────────────┬────────────────┘
                                  │
          ┌───────────────┬───────┴───────┬───────────────┐
          │               │               │               │
    ┌─────▼─────┐  ┌──────▼─────┐  ┌─────▼──────┐  ┌────▼──────┐
    │   Auth    │  │ Inventory  │  │Notification│  │  Future   │
    │  Service  │  │  Service   │  │  Service   │  │  Service  │
    │   :4000   │  │   :5000    │  │   :6000    │  │   :XXXX   │
    └─────┬─────┘  └──────┬─────┘  └─────┬──────┘  └────┬──────┘
          │               │               │               │
          └───────────────┴───────┬───────┴───────────────┘
                                  │  POST /check
                    ┌─────────────▼──────────────┐
                    │    Rate Limiter Service     │
                    │          :3000              │
                    │                             │
                    │   ┌─────────────────────┐   │
                    │   │   Algorithm Router  │   │
                    │   └──┬──────┬───────┬───┘   │
                    │      │      │       │        │
                    │   Fixed  Sliding  Token      │
                    │   Window  Window  Bucket     │
                    └──────┬──────┬───────┬────────┘
                           │      │       │
                           └──────▼───────┘
                               Redis :6379
```

**Key design principle:** Every future service in the ecosystem gets rate limiting for free. Add `rateLimitClient.js` (20 lines), set `RATE_LIMITER_URL` in `.env`, and the integration is complete.

---

## Algorithms

Three algorithms are implemented. Each has distinct behavior, trade-offs, and production use cases. Understanding all three — not just using one — is the core engineering goal of this project.

### Fixed Window Counter

Divides time into fixed windows (e.g. 0–60s, 60–120s). Counts requests per window. Rejects when count exceeds limit.

**Redis storage:** One integer counter per client per window. TTL = window duration.  
**Memory:** `O(1)` per client.  
**Known issue:** Boundary spike — a client can send double the intended limit by bursting at the end of one window and the start of the next.

```
Window: 0–60s  →  counter = 0, limit = 5
t=58: request 5 → allowed  (counter = 5)
t=59: request 6 → REJECTED (429)
t=60: window resets → counter = 0
```

### Sliding Window Log

Stores a timestamp for every request in a Redis sorted set. Counts only timestamps within the last N seconds from *now*. No fixed boundaries — the window always rolls from the current moment.

**Redis storage:** Sorted set per client. Score = request timestamp in ms. One entry per request.  
**Memory:** `O(requests per window)` — grows with traffic volume.  
**Advantage:** Perfectly precise. No boundary spike. Every client gets exactly their limit per rolling window.

### Token Bucket

A bucket holds up to N tokens. Each request consumes tokens (configurable cost). Tokens refill at a fixed rate. If the bucket has fewer tokens than the request cost, the request is rejected.

**Redis storage:** Hash per client. Fields: `tokens` (float), `lastRefill` (Unix seconds).  
**Memory:** `O(1)` per client.  
**Advantage:** Native burst handling. Idle clients accumulate tokens and can send a burst. Models real-world traffic patterns. Used by Stripe, AWS, and Cloudflare.  
**v2.0 addition:** Weighted cost — expensive endpoints (bulk export, heavy computation) can consume more tokens per request than simple GETs.

### Algorithm Comparison

| Property | Fixed Window | Sliding Window | Token Bucket |
|---|---|---|---|
| Implementation | Simplest | Moderate | Most complex |
| Memory per client | O(1) | O(requests) | O(1) |
| Boundary edge case | ⚠️ Yes | ✅ None | ✅ None |
| Burst handling | ❌ None | ❌ None | ✅ Native |
| Weighted cost support | ❌ No | ❌ No | ✅ Yes |
| Precision | Low | Highest | High |
| Redis atomicity | SET NX + INCR | Lua script | Lua script |
| Used by | Internal tools | Financial APIs | Stripe, AWS, Cloudflare |

---

## API Reference

### `POST /check`

The core endpoint. The only endpoint any consumer service ever calls.

**Request:**
```json
{
  "key":       "login:user@example.com:192.168.1.1",
  "algorithm": "token-bucket",
  "limit":     10,
  "window":    900,
  "cost":      1
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | ✅ | What to rate limit. Typically `action:identifier`. |
| `algorithm` | string | ✅ | `fixed-window`, `sliding-window`, or `token-bucket` |
| `limit` | integer | ✅ | Max requests allowed (or token bucket capacity) |
| `window` | integer | ✅ | Time window in seconds (or token refill interval) |
| `cost` | integer | ❌ | Tokens consumed per request. Default: `1`. Token Bucket only. |

**Response — Allowed (200 OK):**
```json
{
  "allowed":   true,
  "remaining": 9,
  "resetAt":   1713200900,
  "algorithm": "token-bucket",
  "traceId":   "7fe9215e-daf2-4e36-8e5d-7f5bcf0b7718"
}
```

**Response — Rejected (429 Too Many Requests):**
```json
{
  "allowed":    false,
  "remaining":  0,
  "resetAt":    1713200900,
  "retryAfter": 120,
  "algorithm":  "token-bucket",
  "traceId":    "7fe9215e-daf2-4e36-8e5d-7f5bcf0b7718"
}
```

**Response — Validation Error (400 Bad Request):**
```json
{
  "error": "Validation failed",
  "details": [
    { "field": "algorithm", "message": "Invalid enum value" }
  ]
}
```

### `GET /health`

```json
{
  "status": "ok",
  "redis":  "connected",
  "uptime": 3421
}
```

Returns `status: "degraded"` if Redis is unreachable. Still returns HTTP 200 — the service is running, just impaired. Load balancers read the `status` field.

### `GET /metrics`

Exposes Prometheus-compatible metrics on port `3001`.

---

## Project Structure

```
rate-limiter-service/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   └── rateLimit.routes.js      # POST /check — validation → router → response
│   │   └── middlewares/
│   │       └── validateRequest.js       # Zod schema validation
│   ├── algorithms/
│   │   ├── fixedWindow.js               # Fixed Window Counter (SET NX + INCR)
│   │   ├── slidingWindow.js             # Sliding Window Log (sorted set + Lua)
│   │   └── tokenBucket.js              # Token Bucket with weighted cost (hash + Lua)
│   ├── router/
│   │   └── algorithmRouter.js           # Maps algorithm name → implementation
│   ├── db/
│   │   └── redis.js                     # ioredis singleton client
│   ├── config/
│   │   └── env.js                       # Env var validation. Fails fast on startup.
│   ├── utils/
│   │   ├── logger.js                    # Pino structured logger
│   │   └── traceId.js                   # traceId middleware (accept or generate)
│   └── app.js                           # Express app setup
├── tests/
│   ├── __mocks__/
│   │   └── redis.js                     # In-memory Redis mock for CI
│   ├── setup.js                         # Global test setup
│   ├── check.endpoint.test.js           # Integration tests for POST /check
│   ├── fixedWindow.test.js              # Fixed Window algorithm tests
│   ├── slidingWindow.test.js            # Sliding Window tests (skipped — see Testing Strategy)
│   └── tokenBucket.test.js             # Token Bucket tests (skipped — see Testing Strategy)
├── load-tests/
│   └── k6-load-test.js                  # k6 load test script — all three algorithms
├── server.js                            # Entry point. Main server + metrics server.
├── docker-compose.yml                   # Rate Limiter + Redis
├── .env.example
└── package.json
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js | Non-blocking I/O suits high-frequency, short-duration rate check calls |
| Framework | Express.js | Minimal. Rate check logic stays explicit and visible. |
| State Store | Redis (ioredis) | O(1) ops. Native TTL. Sorted sets for Sliding Window. Lua for atomicity. |
| Validation | Zod | Schema-first. Field-level error messages. Uses `error.issues` (current API). |
| Logging | Pino | Structured JSON logs. Consistent with portfolio ecosystem. |
| Metrics | prom-client | Prometheus-compatible. Per-algorithm labels. |
| Load Testing | k6 | Industry-standard. Proves algorithm behavior under real concurrency. |
| Containerisation | Docker + Compose | One-command startup. Consistent across environments. |
| Testing | Jest + Supertest | Integration tests with mocked Redis. CI-safe. |
| CI | GitHub Actions | Automated test runs on every push and pull request. |

---

## How to Run

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Start with Docker (recommended)

```bash
docker compose up --build
```

This starts Redis and the Rate Limiter Service together. The service is available at `http://localhost:3000`.

### Start locally

```bash
# 1. Start Redis
docker compose up redis -d

# 2. Install dependencies
npm install

# 3. Copy env file and configure
cp .env.example .env

# 4. Start the server
node server.js
```

### Environment variables

```env
PORT=3000
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
METRICS_PORT=3001
```

### Test the API

```bash
# Allowed request
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"key":"test:user","algorithm":"token-bucket","limit":5,"window":60}'

# Rejected request (send 6 times with limit=5)
for i in 1 2 3 4 5 6; do
  curl -s -X POST http://localhost:3000/check \
    -H "Content-Type: application/json" \
    -d '{"key":"test:user","algorithm":"fixed-window","limit":5,"window":60}' | jq .allowed
done

# Health check
curl http://localhost:3000/health

# Metrics
curl http://localhost:3001/metrics
```

### Run tests

```bash
npm test
```

---

## Build Journey — Milestone by Milestone

---

### Milestone 1 — Infrastructure

**Goal:** Redis running. Express server starts. `POST /check` returns a stub response. Foundation only.

**What was built:**

- Node.js project with all dependencies installed
- Environment configuration via `.env` with validation in `env.js` — throws immediately on startup if any required variable is missing
- ioredis client as a singleton — one shared client across all algorithm files. Adding an `error` event listener prevents unhandled exceptions from crashing the process on Redis connection failure.
- Express server with stub `POST /check` and `GET /health`
- Pino structured logger integrated from day one

**Verification:**

```bash
redis-cli ping          # → PONG
node server.js          # → Server running on port 3000
curl -X POST http://localhost:3000/check -H "Content-Type: application/json" -d '{}'
# → { "allowed": true }  (stub response)
```

**Key insight:** The singleton Redis client pattern is critical. Creating multiple `ioredis` instances in different files would exhaust connection limits. All algorithm files import from `src/db/redis.js` — nowhere else creates a Redis connection.

---

### Milestone 2 — Fixed Window Counter

**Goal:** `POST /check` with `algorithm: "fixed-window"` correctly limits requests. Verified against real Redis.

**What was built:**

Fixed Window implementation using two Redis operations in sequence:

```
SET ratelimit:fixed:{key}:{windowStart} 0 NX EX windowSeconds
INCR ratelimit:fixed:{key}:{windowStart}
```

Window start calculated as:

```js
windowStart = Math.floor(now / windowSeconds) * windowSeconds
```

This snaps the timestamp to the nearest window boundary, ensuring all requests within the same window share the same Redis key.

**Critical implementation detail — the immortal key problem:**

A naive implementation uses `INCR` first, then `EXPIRE`. If the server crashes between these two commands, the key exists with no TTL and never expires. The fix is `SET NX EX` before `INCR`. This atomically creates the key with a TTL if it does not exist. `INCR` then increments it. One crash cannot produce an immortal key.

**Response fields:**

| Field | Description |
|---|---|
| `allowed` | `true` if request is within limit |
| `remaining` | `Math.max(0, limit - count)` — never negative |
| `resetAt` | Unix timestamp of next window start |
| `retryAfter` | Seconds until counter resets (on rejection only) |

**Verification:**

```bash
# Send 6 requests with limit = 5
for i in 1 2 3 4 5 6; do
  curl -s -X POST http://localhost:3000/check \
    -H "Content-Type: application/json" \
    -d '{"key":"test:ip","algorithm":"fixed-window","limit":5,"window":60}' | jq .allowed
done
# → true true true true true false

# Verify Redis directly
redis-cli GET "ratelimit:fixed:test:ip:$(date +%s | awk '{print int($1/60)*60}')"
# → "6"

redis-cli TTL "ratelimit:fixed:test:ip:$(date +%s | awk '{print int($1/60)*60}')"
# → remaining seconds in window
```

**Key learnings:**

- `SET NX EX` before `INCR` is the correct atomic pattern — not `INCR` then `EXPIRE`
- Fixed Window suffers from the boundary spike problem — a client can burst at window boundaries and receive double the intended limit
- Redis TTL is the cleanup mechanism — no manual expiration code needed

---

### Milestone 3 — Sliding Window Log

**Goal:** Eliminate the boundary spike by tracking individual request timestamps in a rolling window.

**What was built:**

Sliding Window implementation using a Redis sorted set and a Lua script. The Lua script ensures that all three operations — remove expired entries, count, conditionally add — execute as a single atomic unit.

```lua
-- sliding_window.lua
local key       = KEYS[1]
local now       = tonumber(ARGV[1])    -- current Unix ms timestamp
local window    = tonumber(ARGV[2])    -- window in ms
local limit     = tonumber(ARGV[3])
local requestId = ARGV[4]              -- unique ID prevents ZADD score collisions

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, requestId)
  redis.call('EXPIRE', key, math.ceil(window / 1000))
  return {1, limit - count - 1}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, oldest[2]}
end
```

**Why a Lua script is required:**

Without atomicity, two concurrent requests can both execute `ZCARD`, both see `count < limit`, and both get through — even if only one should be allowed. Lua scripts execute atomically in Redis. No other command runs between lines of the script.

**The boundary spike difference — demonstrated:**

```
Fixed Window (limit=5, window=60s):
  t=59: requests 1-5 → all allowed  (window 1)
  t=61: requests 6-10 → all allowed (window 2 resets)
  Result: 10 requests in 2 seconds. Double the limit. ❌

Sliding Window (limit=5, window=60s):
  t=59: requests 1-5 → all allowed
  t=61: requests 6-10 → all rejected (window looks back to t=1, still sees 5 entries)
  Result: exactly 5 per rolling 60 seconds. ✅
```

**Verification:**

```bash
# Send 6 requests with limit = 5
# First 5 → allowed. 6th → 429 with retryAfter

# Inspect sorted set directly
redis-cli ZRANGE ratelimit:sliding:test:ip 0 -1 WITHSCORES
# Shows 5 entries with millisecond timestamps as scores
```

**Fixed Window vs Sliding Window:**

| Feature | Fixed Window | Sliding Window |
|---|---|---|
| Accuracy | ❌ Low | ✅ High |
| Boundary spike | ❌ Yes | ✅ None |
| Complexity | ✅ Simple | ⚠️ Moderate |
| Memory per client | ✅ O(1) | ⚠️ O(requests) |
| Data stored in Redis | Integer counter | Individual timestamps |

**Key learnings:**

- Milliseconds precision is critical for Sliding Window — using seconds causes collisions in the sorted set
- `EXPIRE` on the sorted set is mandatory — without it, old keys accumulate indefinitely in Redis
- `requestId` as the ZADD member prevents two requests in the same millisecond from overwriting each other

---

### Milestone 4 — Token Bucket (with Weighted Cost)

**Goal:** Implement burst-aware rate limiting with configurable request cost. The most complex and most production-relevant algorithm.

**What was built:**

Token Bucket implementation using a Redis hash and a Lua script. The hash stores two fields per client: current token count and last refill timestamp. The Lua script atomically computes how many tokens to add based on elapsed time, checks if enough tokens are available, and either consumes them or rejects the request.

```lua
-- token_bucket.lua
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])   -- tokens per second (= capacity / window)
local now        = tonumber(ARGV[3])   -- current Unix seconds
local cost       = tonumber(ARGV[4])   -- tokens this request consumes

local data       = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens     = tonumber(data[1]) or capacity   -- cold start: full bucket
local lastRefill = tonumber(data[2]) or now

local elapsed  = math.max(0, now - lastRefill)
local refilled = math.min(capacity, tokens + elapsed * refillRate)

if refilled >= cost then
  redis.call('HMSET', key, 'tokens', refilled - cost, 'lastRefill', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 1)
  return {1, math.floor(refilled - cost), 0}
else
  local waitTime = math.ceil((cost - refilled) / refillRate)
  redis.call('HMSET', key, 'tokens', refilled, 'lastRefill', now)
  return {0, 0, waitTime}
end
```

**Algorithm flow:**

```
1. Read tokens and lastRefill from Redis hash
2. Calculate elapsed = now - lastRefill
3. refilled = min(capacity, tokens + elapsed × refillRate)
4. If refilled >= cost → consume, save, allow
5. If refilled < cost → save updated state, return waitTime, reject
```

**Weighted cost — how it works:**

```json
{ "algorithm": "token-bucket", "limit": 10, "window": 60, "cost": 1 }
→ Normal request. Consumes 1 token. 10 requests before rejection.

{ "algorithm": "token-bucket", "limit": 10, "window": 60, "cost": 5 }
→ Heavy request. Consumes 5 tokens. Only 2 requests before rejection.
```

Same bucket. Same capacity. Heavy endpoints are rate-limited more aggressively. This is how real-world API gateways implement fair usage across endpoints with different resource costs.

**Verification:**

```bash
# Burst test (limit=10, cost=1)
# Requests 1-10 → allowed. 11th → 429.

# Weighted cost test (limit=10, cost=5)
# Requests 1-2 → allowed. 3rd → 429.

# Refill test
# After waiting a few seconds → new tokens available, requests allowed again.

# Redis inspection
redis-cli HGETALL ratelimit:token:test:user
# → tokens 7.5 lastRefill 1713200060
```

**Implementation details:**

| Detail | Why it matters |
|---|---|
| Cold start defaults to full capacity | New client gets a fair start, not an empty bucket |
| Fractional tokens stored internally | Smooth refill between seconds. `math.floor` for client response. |
| `math.min(capacity, ...)` on refill | Prevents token overflow above bucket capacity |
| TTL = `capacity / refillRate + 1` | Key auto-expires after enough idle time. No manual cleanup. |

**Full algorithm comparison:**

| Feature | Fixed Window | Sliding Window | Token Bucket |
|---|---|---|---|
| Burst support | ❌ | ❌ | ✅ |
| Accuracy | ❌ | ✅ | ✅ |
| Memory usage | ✅ Low | ❌ High | ✅ Low |
| Weighted cost | ❌ | ❌ | ✅ |
| Real-world usage | ⚠️ Internal | ⚠️ Financial | ✅ Stripe, AWS |

**Key learnings:**

- Token Bucket is the most production-relevant algorithm because real traffic is bursty, not perfectly uniform
- Weighted cost makes the same infrastructure serve fundamentally different endpoint profiles
- The cold start case (`data[1] or capacity`) is easy to miss and causes incorrect rejection of first-time clients

---

### Milestone 5 — Input Validation & Algorithm Routing

**Goal:** Clean request validation and a scalable routing layer. No conditional if-else chains in route handlers.

**What was built:**

**Zod validation schema** (`validateRequest.js`):

```js
const checkSchema = z.object({
  key:       z.string().min(1).max(200),
  algorithm: z.enum(['fixed-window', 'sliding-window', 'token-bucket']),
  limit:     z.number().int().positive().max(100000),
  window:    z.number().int().positive().max(86400),
  cost:      z.number().int().positive().max(1000).optional().default(1),
});
```

Validation errors return field-level detail:

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "algorithm", "message": "Invalid enum value" }
  ]
}
```

**Algorithm router** (`algorithmRouter.js`):

```js
const ALGORITHMS = {
  'fixed-window':   fixedWindow,
  'sliding-window': slidingWindow,
  'token-bucket':   tokenBucket,
};

async function route(params) {
  return ALGORITHMS[params.algorithm](params);
}
```

**Request flow after this milestone:**

```
POST /check
     ↓
validateRequest middleware (Zod)
     ↓ req.validated (typed, safe)
algorithmRouter.route()
     ↓
fixedWindow / slidingWindow / tokenBucket
     ↓
200 or 429 response
```

**Implementation details:**

- `req.validated` used everywhere downstream — `req.body` is untrusted input and never accessed after validation
- Zod `error.issues` used instead of deprecated `error.errors`
- Adding a new algorithm requires one line in the router map — no other changes needed

---

### Milestone 6 — Observability

**Goal:** Structured logs, Prometheus metrics, and a real health check endpoint. Make the system visible.

**Structured logging (Pino):**

Every request emits a structured JSON log line containing:

```json
{
  "level": "info",
  "traceId": "7fe9215e-daf2-4e36-8e5d-7f5bcf0b7718",
  "algorithm": "token-bucket",
  "key": "login:user@example.com:192.168.1.1",
  "cost": 1,
  "allowed": true,
  "remaining": 9,
  "duration": 2.4
}
```

**Prometheus metrics (port 3001):**

| Metric | Type | Labels | Description |
|---|---|---|---|
| `rate_limiter_requests_total` | Counter | `algorithm` | Total checks performed |
| `rate_limiter_allowed_total` | Counter | `algorithm` | Requests that were allowed |
| `rate_limiter_rejected_total` | Counter | `algorithm` | Requests that were rejected |
| `rate_limiter_request_duration_seconds` | Histogram | `algorithm` | End-to-end latency per check |

All metrics include the `algorithm` label so you can compare Fixed Window vs Token Bucket behavior in Grafana without filtering manually.

**Health check:**

```json
GET /health

{
  "status": "ok",
  "redis":  "connected",
  "uptime": 3421
}
```

If Redis is unreachable: `status: "degraded"`. The service still returns HTTP 200 — load balancers read the `status` field and mark the instance as degraded without taking it offline entirely.

**Verification:**

```bash
# Structured logs with traceId visible in terminal on every request
curl -X POST http://localhost:3000/check ...

# Prometheus metrics
curl http://localhost:3001/metrics
# → rate_limiter_requests_total{algorithm="token-bucket"} 42

# Health with Redis running
curl http://localhost:3000/health
# → { "status": "ok", "redis": "connected", "uptime": 183 }

# Health with Redis stopped
docker compose stop redis
curl http://localhost:3000/health
# → { "status": "degraded", "redis": "error", "uptime": 191 }
```

---

### Milestone 7 — Docker + Tests + CI

**Goal:** Full containerised deployment. Automated tests. CI pipeline that prevents regressions.

**Docker Compose — final configuration:**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis_data:/data]

  rate-limiter:
    build: .
    ports: ["3000:3000", "3001:3001"]
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PORT=3000
      - METRICS_PORT=3001
    depends_on:
      - redis

volumes:
  redis_data:
```

**CI pipeline (GitHub Actions):**

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm test
        env: { NODE_ENV: test }
```

---

### Milestone 8 — Load Testing

**Goal:** Prove algorithm behavior under real concurrent load. Not describe it — prove it.

> Without load testing, you can describe algorithm behavior.  
> With load testing, you can prove it.

See the [Load Test Results](#load-test-results) section for full numbers and observations.

**Running the tests:**

```bash
# Install k6
brew install k6

# Run with the Rate Limiter running
docker compose up -d
k6 run load-tests/k6-load-test.js
```

Change the `ALGORITHM` constant in the script to test each algorithm and compare results.

---

### Milestone 9 — Consumer Integration (Auth Service)

**Goal:** Integrate Rate Limiter into the Auth Service `/login` endpoint. Demonstrate real service-to-service rate limiting with production-grade design decisions.

**Architecture:**

```
Client
   ↓
Auth Service (/login)
   ↓
Input validation (email + password format)
   ↓
Rate Limiter Service (/check)   ← POST /check with combined key
   ↓
Decision: allowed / blocked (429)
   ↓
Authentication logic (DB lookup, bcrypt, JWT, audit log)
```

**Rate limit key design:**

```js
key: `login:${normalizedEmail}:${req.ip}`
```

Why a combined key instead of IP-only:

| Approach | Problem |
|---|---|
| `login:${req.ip}` only | University or office networks share one IP. 20 students all get blocked when one exceeds the limit. |
| `login:${email}` only | Attacker from different IPs targeting the same account bypasses IP-based limits. |
| `login:${email}:${ip}` | Independent limit per (user, IP) pair. Each user is isolated. Each IP is isolated per user. |

**Email normalization:**

```js
const normalizedEmail = email.toLowerCase().trim();
```

Without this, `Test@Email.com` and `test@email.com` create separate rate limit keys. An attacker can trivially bypass a 10-attempt limit by varying case — 26 case variations × 10 attempts = 260 login attempts before any limit is hit.

**Execution order:**

```
1. Validate input format (email, password presence)
2. Apply rate limiting
3. Execute authentication logic (DB lookup, bcrypt)
```

Rate limiting before DB lookup means invalid requests consume no database resources and no authentication tokens before being rejected.

**Fail-open strategy:**

```js
} catch (err) {
  // Rate Limiter unavailable — fail open
  logger.warn({ err: err.message }, 'Rate Limiter unavailable. Failing open.');
  return { allowed: true, remaining: -1, resetAt: 0 };
}
```

If the Rate Limiter Service is down, requests are allowed through. This is the correct production default — the Rate Limiter is an infrastructure component, not the authentication system itself. A Rate Limiter outage should never cause a login outage.

| Strategy | Outcome |
|---|---|
| Fail-closed | Secure during outage, but all login attempts fail. User-facing outage. |
| Fail-open ✅ | Slight window of unprotected access during outage, but users can still log in. |

**Verification:**

- Different users with same IP → each has independent rate limit ✅
- Same user from different IPs → each (user, IP) pair is independent ✅
- Rate limit enforced after 10 attempts → 429 with `retryAfter` ✅
- Rate Limiter stopped → login still works ✅
- Token Bucket burst behavior → first 10 requests fast, then gradual rejection ✅

---

### Milestone 10 — Trace Propagation

**Goal:** Maintain end-to-end traceability across service boundaries. When Auth Service calls Rate Limiter, both services should log the same traceId.

**How it works:**

```js
// traceId.js middleware — first middleware in the chain
const traceIdMiddleware = (req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || randomUUID();
  res.setHeader('x-trace-id', req.traceId);
  next();
};
```

When Auth Service calls Rate Limiter, it passes its own `x-trace-id` header. The Rate Limiter accepts it rather than generating a new one. Both services log the same ID.

**Request flow:**

```
Auth Service (traceId: abc-123)
   ↓  x-trace-id: abc-123
Rate Limiter Service
   ↓  accepts incoming traceId
Logs: { traceId: "abc-123", algorithm: "token-bucket", allowed: true }
   ↓
Response includes: { traceId: "abc-123" }
```

**Design principle:** Downstream services must never generate new trace IDs if one is already present. A new ID at the Rate Limiter would break the correlation chain — you could no longer connect a Rate Limiter log to the Auth Service log that triggered it.

**Validation:**

```bash
# Send request with explicit traceId
curl -X POST http://localhost:3000/check \
  -H "x-trace-id: abc-123-test" \
  -H "Content-Type: application/json" \
  -d '{"key":"test","algorithm":"token-bucket","limit":10,"window":60}'

# Response contains same traceId
# Terminal logs show traceId: "abc-123-test"
# No new UUID was generated
```

---

## Testing Strategy

The test suite validates correctness, safety, and reliability of the rate limiting API and the Fixed Window algorithm in a CI-safe environment.

**Hybrid testing approach:**

| Layer | Type | Redis | Purpose |
|---|---|---|---|
| API endpoints | Integration tests | Mocked (in-memory Map) | Validate request contract, validation errors, routing |
| Fixed Window | Behavioural tests | Mocked | Validate counter logic and key isolation |
| Sliding Window | Manual validation | Real Redis | Lua script + sorted sets cannot be accurately mocked |
| Token Bucket | Manual validation | Real Redis | Lua script + atomic hash updates cannot be accurately mocked |
| All algorithms | k6 load tests | Real Redis | Concurrent behavior proven under sustained load |

**Why Sliding Window and Token Bucket tests are skipped in CI:**

The in-memory Redis mock cannot simulate:
- Lua script execution (`EVAL`)
- Sorted sets (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`)
- TTL / key expiration

Forcing mocks that cannot reproduce these behaviours would produce tests that pass in CI but verify nothing about the actual algorithm. That is worse than no test — it gives false confidence.

**How correctness is validated for these algorithms:**

1. **Manual testing against real Redis** — verified with `curl` and `redis-cli` at each milestone (see verification sections above)
2. **k6 load tests** — all three algorithms are tested under 50 req/sec with 20 concurrent users for 20 seconds. The load test results prove the algorithms behave correctly under concurrent load. See [Load Test Results](#load-test-results).

**Running tests:**

```bash
npm test
```

**Expected output:**

```
PASS  tests/check.endpoint.test.js
PASS  tests/fixedWindow.test.js
SKIPPED  tests/slidingWindow.test.js
SKIPPED  tests/tokenBucket.test.js
```

---

## Load Test Results

**Tool:** k6  
**Configuration:** 50 requests/sec · 20 virtual users · 20 seconds · isolated key per user  
**Limit:** 10 requests per user · 60-second window  

### Final Results — All Three Algorithms

| Algorithm | Allowed | Rejected | Avg Latency | p95 Latency |
|---|---|---|---|---|
| Fixed Window | 200 | 801 | 5.57 ms | 22.58 ms |
| Sliding Window | 200 | 801 | 4.63 ms | 12.58 ms |
| Token Bucket | 260 | 740 | 5.10 ms | 20.20 ms |

**Error rate:** 0% across all runs. Every response was 200 or 429 — no 500s, no timeouts.

### Key Observations

**Fixed Window:**
- Enforces strict limits. 20 users × 10 requests = 200 allowed — exactly as configured.
- Higher p95 latency (22.58ms) reflects the window boundary reset behavior under load.
- The boundary spike is present but not visible in these results because the 20-second test duration did not capture a full window reset cycle. The spike would be visible in a longer test (60+ seconds) as an allowed-count jump when the counter resets.

**Sliding Window:**
- Same allowed count as Fixed Window (200) — correct. No boundary spike means the rolling window enforced the limit consistently throughout.
- Best p95 latency (12.58ms) — the sorted set operations are efficient and the window slide is predictable.

**Token Bucket:**
- Allowed 260 requests instead of 200. This is correct and expected behavior, not a bug.
- Token Bucket allows time-based refill during the test window:
  ```
  refillRate       = limit / window = 10 / 60 = 0.167 tokens/sec
  tokens_refilled  = refillRate × duration = 0.167 × 20 = 3.33 tokens/user
  total_allowed    ≈ 20 users × (10 initial + 3.33 refilled) = ~266 requests
  ```
- This is the burst-and-refill behavior that makes Token Bucket suitable for user-facing APIs. Users who pace their requests benefit from refilled capacity.

### Why high rejection rate is expected

~80% rejection is correct behavior, not a system problem. The test deliberately saturates the rate limiter — 50 req/sec against 20 users with a 10-request limit. The rejection rate proves the limits are being enforced accurately.

---

## Consumer Integration Guide

Any service in the ecosystem integrates with two additions:

**1. Add to `.env`:**

```env
RATE_LIMITER_URL=http://localhost:3000
```

**2. Create `src/utils/rateLimitClient.js`:**

```js
const axios  = require('axios');
const logger = require('./logger');

async function checkRateLimit({ key, algorithm = 'token-bucket', limit, window, cost = 1 }) {
  try {
    const response = await axios.post(
      `${process.env.RATE_LIMITER_URL}/check`,
      { key, algorithm, limit, window, cost },
      { timeout: 200 }   // never block the user for more than 200ms
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 429) return err.response.data;
    logger.warn({ err: err.message }, 'Rate Limiter unavailable. Failing open.');
    return { allowed: true, remaining: -1, resetAt: 0 };
  }
}

module.exports = checkRateLimit;
```

**3. Use in a route:**

```js
const checkRateLimit = require('../../utils/rateLimitClient');

router.post('/login', async (req, res) => {
  const result = await checkRateLimit({
    key:       `login:${normalizedEmail}:${req.ip}`,
    algorithm: 'token-bucket',
    limit:     10,
    window:    900,
  });

  if (!result.allowed) {
    return res.status(429).json({
      error:      'Too many login attempts',
      retryAfter: result.retryAfter,
    });
  }

  // ... business logic
});
```

**The 200ms timeout is critical.** A hung Rate Limiter should never hold up a login request for seconds. If the timeout is hit, the catch block fails open and the request proceeds.

---

## Why Not Nginx or API Gateway?

This question comes up in every system design conversation about rate limiting. Here is the honest comparison.

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Nginx** | Fast, built-in, zero extra service | Per-process only — not distributed. Fixed Window only. No weighted cost. No custom logic. | Single-server setups, simple traffic shaping. |
| **AWS API Gateway** | Managed, globally distributed, zero ops | Expensive at scale. Vendor lock-in. Limited algorithm choice. No custom business logic. | Cloud-native apps where managed infra cost is acceptable. |
| **Cloudflare** | Edge-level, globally distributed, DDoS protection | External service. Limited per-request logic. Ongoing cost per rule. | Public-facing APIs needing global edge protection. |
| **This service** | Distributed-correct (shared Redis), three algorithms, weighted cost, full observability, ecosystem-native | Extra service to run. ~1ms network hop per request. | Internal microservices where you control all services. |

**The key difference with Nginx:**

Nginx rate limiting is per-process. If you run three server instances, each has its own counter. A client can hit all three instances and receive three times the intended limit. This service uses Redis as shared state — the limit is enforced correctly regardless of how many service instances are running.

**The key difference with AWS API Gateway:**

API Gateway offers Fixed Window only at the application layer. There is no Token Bucket with burst support, no weighted cost, and no ability to key on application-specific fields like `email:ip` combinations. For internal service-to-service rate limiting with custom business logic, a service-owned rate limiter is the right architecture.

---

## Trade-offs & Upgrade Paths

| What is not built | Why | Upgrade path |
|---|---|---|
| Config store (limits in DB) | Limits passed in request body keeps the service stateless and flexible. Each consumer owns its own limits. | Store tier configs in Redis hash keyed by `tierId`. Consumer passes tier, Rate Limiter looks up the rules. |
| Auth on `/check` | Consumer services on the same internal network. Auth adds latency to every single check. | API key header validated per consumer service. |
| Redis Cluster / sharding | Single Redis instance is correct for this ecosystem scale. | Redis Cluster shards keys across nodes. Hot key problem mitigated by appending a shard suffix to the key and summing counts. |
| Multi-region distribution | All consumers share one Redis instance. Multi-region requires Cluster or CRDT coordination. | Redis Cluster per region. Accept that limits are per-region, not globally enforced. |
| Real-time dashboard | No job queue — Bull Board does not apply. | Prometheus + Grafana for metric visualisation. |

---

## Portfolio Context

This service is part of a backend ecosystem built to demonstrate progression from API-centric development to system-oriented backend engineering.

```
Auth Service          →  Issues JWTs. Manages users and sessions.
                               ↓ calls Rate Limiter on /login, /register, /refresh
Rate Limiter Service  →  Standalone. Consumed by the entire ecosystem.
                               ↑
Inventory Service     →  Calls Rate Limiter on /stock and /orders endpoints.
                               ↑
Notification Service  →  Calls Rate Limiter on /events to prevent flooding.
                               ↑
Background Job System →  Powers async processing throughout the ecosystem.
```

**What this project adds to the portfolio:**

| Capability | Evidence |
|---|---|
| Infrastructure service design | Standalone service consumed via HTTP — zero tight coupling to any consumer |
| Algorithm knowledge with trade-offs | Three algorithms implemented, compared, and load-tested |
| Distributed systems correctness | Lua scripts prove atomic behavior under concurrent load |
| Weighted cost design | Token Bucket accepts `cost` — heavy endpoints drain capacity faster |
| Load-tested behavior | k6 results prove algorithm differences with real numbers |
| End-to-end observability | Pino + traceId propagation + Prometheus metrics + health check |
| Engineering judgement | Why-not-Nginx analysis, fail-open consumer pattern, documented upgrade paths |