const express = require("express");
const fixedWindow = require("./algorithms/fixedWindow");
const slidingWindow = require("./algorithms/slidingWindow");

const app = express();

app.use(express.json());

app.post("/check", async (req, res) => {
  const { key, limit, window, algorithm } = req.body;

  if (algorithm === "fixed-window") {
    const result = await fixedWindow({ key, limit, window });
    return res.status(result.allowed ? 200 : 429).json(result);
  }

  if (algorithm === "sliding-window") {
    const result = await slidingWindow({ key, limit, window });
    return res.status(result.allowed ? 200 : 429).json(result);
  }

  // fallback stub
  res.json({
    allowed: true,
    remaining: 99,
    resetAt: Date.now() + 60000,
    algorithm: "stub",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

module.exports = app;
