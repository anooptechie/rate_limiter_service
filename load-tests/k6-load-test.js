import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const reqAllowed = new Counter("requests_allowed");
const reqRejected = new Counter("requests_rejected");

// 🔥 Change this per run
const ALGORITHM = "token-bucket";

export const options = {
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate: 50, // start with 50 req/sec
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 20,
    },
  },
};

export default function () {
  const payload = JSON.stringify({
    key: `user:${__VU}`,
    algorithm: ALGORITHM,
    limit: 10,
    window: 60,
  });

  const res = http.post("http://localhost:3000/check", payload, {
    headers: { "Content-Type": "application/json" },
  });

  if (res.status === 200) reqAllowed.add(1);
  if (res.status === 429) reqRejected.add(1);

  check(res, {
    "status is 200 or 429": (r) => r.status === 200 || r.status === 429,
  });
}
