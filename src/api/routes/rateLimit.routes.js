const express = require("express");
const validateRequest = require("../middlewares/validateRequest");
const algorithmRouter = require("../../router/algorithmRouter");

const {
  requestsTotal,
  allowedTotal,
  rejectedTotal,
  requestDuration,
} = require("../../observability/metrics");

const router = express.Router();

router.post("/check", validateRequest, async (req, res) => {
  const start = Date.now();
  const { algorithm } = req.validated;

  // 📊 total requests
  requestsTotal.inc({ algorithm });

  try {
    const result = await algorithmRouter.route(req.validated);

    // 📊 allowed / rejected
    if (result.allowed) {
      allowedTotal.inc({ algorithm });
    } else {
      rejectedTotal.inc({ algorithm });
    }

    // 📊 latency
    const duration = (Date.now() - start) / 1000;
    requestDuration.observe({ algorithm }, duration);

    // 🧾 structured log
    req.log.info({
      traceId: req.id,
      algorithm,
      allowed: result.allowed,
    });

    res.status(result.allowed ? 200 : 429).json({
      ...result,
      algorithm,
      traceId: req.id,
    });
  } catch (err) {
    req.log.error({
      err,
      traceId: req.id,
    });

    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
