const express = require("express");
const validateRequest = require("../middlewares/validateRequest");
const algorithmRouter = require("../../router/algorithmRouter");

const router = express.Router();

router.post("/check", validateRequest, async (req, res) => {
  try {
    const result = await algorithmRouter.route(req.validated);

    const status = result.allowed ? 200 : 429;

    res.status(status).json({
      ...result,
      algorithm: req.validated.algorithm,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;