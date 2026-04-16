const express = require("express");
const pinoHttp = require("pino-http");
const { randomUUID } = require("crypto");

const rateLimitRoutes = require("./api/routes/rateLimit.routes");
const { register } = require("./observability/metrics");
const redis = require("./db/redis");

const app = express();

// 🔥 Structured logging with traceId
app.use(
  pinoHttp({
    genReqId: () => randomUUID(),
  }),
);

app.use(express.json());

// Routes
app.use("/", rateLimitRoutes);

// 🔥 Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// 🔥 Health check (with Redis)
app.get("/health", async (req, res) => {
  try {
    await redis.ping();

    res.json({
      status: "ok",
      redis: "connected",
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      redis: "disconnected",
    });
  }
});

module.exports = app;
