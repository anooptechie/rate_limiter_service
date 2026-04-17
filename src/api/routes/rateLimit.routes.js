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

  // 🔥 STEP 3: Read incoming traceId from Auth Service
  const traceId = req.headers["x-trace-id"] || req.id;
  // fallback to req.id if not provided (important for safety)

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

    // 🧾 structured log (🔥 now uses propagated traceId)
    req.log.info(
      {
        traceId,
        algorithm,
        allowed: result.allowed,
      },
      "rate limit decision",
    );

    res.status(result.allowed ? 200 : 429).json({
      ...result,
      algorithm,
      traceId, // 🔥 return SAME traceId
    });
  } catch (err) {
    req.log.error(
      {
        err,
        traceId, // 🔥 consistent traceId even on error
      },
      "rate limiter error",
    );

    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
