const { z } = require("zod");

const schema = z.object({
  key: z.string().min(1).max(200),
  algorithm: z.enum(["fixed-window", "sliding-window", "token-bucket"]),
  limit: z.number().int().positive().max(100000),
  window: z.number().int().positive().max(86400),
  cost: z.number().int().positive().max(1000).optional().default(1),
});

const validateRequest = (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: result.error.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  req.validated = result.data;
  next();
};

module.exports = validateRequest;
