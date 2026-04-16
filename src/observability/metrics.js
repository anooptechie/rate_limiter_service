const client = require("prom-client");

const register = new client.Registry();

client.collectDefaultMetrics({ register });

// Counters
const requestsTotal = new client.Counter({
  name: "rate_limiter_requests_total",
  help: "Total requests",
  labelNames: ["algorithm"],
});

const allowedTotal = new client.Counter({
  name: "rate_limiter_allowed_total",
  help: "Allowed requests",
  labelNames: ["algorithm"],
});

const rejectedTotal = new client.Counter({
  name: "rate_limiter_rejected_total",
  help: "Rejected requests",
  labelNames: ["algorithm"],
});

// Histogram (latency)
const requestDuration = new client.Histogram({
  name: "rate_limiter_request_duration_seconds",
  help: "Request latency",
  labelNames: ["algorithm"],
});

register.registerMetric(requestsTotal);
register.registerMetric(allowedTotal);
register.registerMetric(rejectedTotal);
register.registerMetric(requestDuration);

module.exports = {
  register,
  requestsTotal,
  allowedTotal,
  rejectedTotal,
  requestDuration,
};
