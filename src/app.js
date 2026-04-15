const express = require("express");

const app = express();

app.use(express.json());

// Stub route (VERY IMPORTANT — do not change yet)
app.post("/check", (req, res) => {
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