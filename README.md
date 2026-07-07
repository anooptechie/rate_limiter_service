# Rate Limiter Service

A standalone, production-grade rate limiting infrastructure service built with **Node.js**, **Express**, **Redis**, and **Lua scripts**.

Any service in the ecosystem calls `POST /check` — the Rate Limiter handles algorithm selection, Redis state, and the allow/reject decision.

---

## The Problem It Solves

Most teams implement rate limiting as local middleware — each service has its own counter and its own Redis connection. When you run multiple instances, counters go out of sync. When you add a new service, you reimplement the same logic.

This service centralizes all rate limiting. Every downstream service — Auth, Inventory, Notification — integrates with one HTTP call and a 20-line wrapper file.

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
                    │   ┌─────────────────────┐   │
                    │   │   Algorithm Router  │   │
                    │   └──┬──────┬───────┬───┘   │
                    │   Fixed  Sliding  Token      │
                    │   Window  Window  Bucket     │
                    └──────┬──────┬───────┬────────┘
                           └──────▼───────┘
                               Redis :6379
```

---

## Algorithms

Three algorithms implemented from scratch — each with distinct trade-offs and production use cases.

| Property | Fixed Window | Sliding Window | Token Bucket |
|---|---|---|---|
| Memory per client | O(1) | O(requests) | O(1) |
| Boundary spike | ⚠️ Yes | ✅ None | ✅ None |
| Burst handling | ❌ | ❌ | ✅ Native |
| Weighted cost | ❌ | ❌ | ✅ Yes |
| Redis atomicity | SET NX + INCR | Lua script | Lua script |
| Used by | Internal tools | Financial APIs | Stripe, AWS, Cloudflare |

**Token Bucket** is the production default — it models real-world bursty traffic and supports weighted cost, where expensive endpoints consume more tokens per request than simple GETs.

---

## API Reference

### `POST /check`

```json
{
  "key":       "login:user@example.com:192.168.1.1",
  "algorithm": "token-bucket",
  "limit":     10,
  "window":    900,
  "cost":      1
}
```

**Allowed (200):**
```json
{ "allowed": true, "remaining": 9, "resetAt": 1713200900, "algorithm": "token-bucket", "traceId": "..." }
```

**Rejected (429):**
```json
{ "allowed": false, "remaining": 0, "retryAfter": 120, "algorithm": "token-bucket", "traceId": "..." }
```

### `GET /health` — Redis connectivity check
### `GET /metrics` — Prometheus metrics on port `3001`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + Express |
| State Store | Redis (ioredis) — Lua scripts for atomicity |
| Validation | Zod |
| Logging | Pino + pino-http (structured JSON) |
| Metrics | prom-client (Prometheus-compatible) |
| Load Testing | k6 |
| Containerisation | Docker + Compose |
| Testing | Jest + Supertest |
| CI | GitHub Actions |

---

## How to Run

### Prerequisites
- Node.js 18+
- Docker and Docker Compose

### Start (recommended)
```bash
docker compose up --build
```

### Start locally
```bash
# Start Redis
docker compose up redis -d

# Install dependencies and copy env
npm install
cp .env.example .env

# Start the server
npm run dev         # pretty logs (development)
node server.js      # raw JSON logs (production)
```

### Run tests
```bash
npm test
```

### Quick verification
```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"key":"test:user","algorithm":"token-bucket","limit":5,"window":60}'
```

---

## Load Test Results

**Config:** k6 · 50 req/sec · 20 VUs · 20 seconds · limit 10 · window 60s

| Algorithm | Allowed | Rejected | Avg Latency | p95 Latency | Error Rate |
|---|---|---|---|---|---|
| Fixed Window | 200 | 801 | 1.99ms | 5.65ms | 0% |
| Sliding Window | 200 | 801 | 1.84ms | 5.01ms | 0% |
| Token Bucket | 260 | 741 | 1.70ms | 4.68ms | 0% |

Token Bucket allowed 260 instead of 200 — correct behavior. Tokens refill during the 20s run (`0.167 tokens/sec × 20s × 20 users ≈ 266`). Zero 500s or timeouts across all three runs.

---

## Key Engineering Decisions

**Lua scripts for atomicity** — Sliding Window and Token Bucket use Redis Lua scripts so that read-check-write is a single atomic operation. Without this, two concurrent requests can both pass a limit check that should only allow one.

**Fail-open consumer pattern** — If the Rate Limiter is unreachable (200ms timeout), requests are allowed through. A Rate Limiter outage should never cause a login outage.

**Composite rate limit key** — `login:${email}:${ip}` instead of IP-only (shared IPs in offices) or email-only (multi-IP attackers).

**Separate metrics server** — Prometheus metrics on port `3001`, main API on port `3000`. Clean separation.

**Why not Nginx?** — Nginx rate limiting is per-process. Three instances = three independent counters = 3× the intended limit. This service uses Redis as shared state — limits are enforced correctly regardless of instance count.

---

## Project Structure

```
rate-limiter-service/
├── src/
│   ├── algorithms/
│   │   ├── fixedWindow.js        # SET NX + INCR
│   │   ├── slidingWindow.js      # Sorted set + Lua
│   │   └── tokenBucket.js        # Hash + Lua + weighted cost
│   ├── api/
│   │   ├── routes/
│   │   │   └── rateLimit.routes.js
│   │   └── middlewares/
│   │       └── validateRequest.js  # Zod schema
│   ├── router/
│   │   └── algorithmRouter.js    # Algorithm name → implementation map
│   ├── observability/
│   │   └── metrics.js            # prom-client counters + histogram
│   ├── db/redis.js               # ioredis singleton
│   ├── config/env.js             # Fail-fast env validation
│   └── app.js
├── tests/
│   ├── __mocks__/redis.js        # In-memory mock for CI
│   ├── check.endpoint.test.js    # Integration tests
│   └── fixedWindow.test.js
├── load-tests/k6-load-test.js
├── docker-compose.yml
├── Dockerfile
└── server.js
```

---

## Consumer Integration

Any service integrates with two steps:

```js
// src/utils/rateLimitClient.js
async function checkRateLimit({ key, algorithm = 'token-bucket', limit, window, cost = 1 }) {
  try {
    const response = await axios.post(`${process.env.RATE_LIMITER_URL}/check`,
      { key, algorithm, limit, window, cost },
      { timeout: 200 }  // never block the user more than 200ms
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 429) return err.response.data;
    return { allowed: true, remaining: -1, resetAt: 0 }; // fail open
  }
}
```

```js
// In any route
const result = await checkRateLimit({
  key: `login:${normalizedEmail}:${req.ip}`,
  algorithm: 'token-bucket',
  limit: 10,
  window: 900,
});
if (!result.allowed) return res.status(429).json({ error: 'Too many attempts', retryAfter: result.retryAfter });
```