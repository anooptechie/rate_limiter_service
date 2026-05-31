const app = require("./src/app");
const express = require("express");
const config = require("./src/config/env");
const { register } = require("./src/observability/metrics");
require("./src/db/redis");

// 🚀 Main app server
app.listen(config.port, () => {
  console.log(`🚀 Server running on port ${config.port}`);
});

// 📊 Separate metrics server
const metricsApp = express();

metricsApp.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

metricsApp.listen(config.metricsPort, () => {
  console.log(`📊 Metrics running on port ${config.metricsPort}`);
});