const express = require("express");
const rateLimitRoutes = require("./api/routes/rateLimit.routes");

const app = express();

app.use(express.json());

// ✅ Only this
app.use("/", rateLimitRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

module.exports = app;
