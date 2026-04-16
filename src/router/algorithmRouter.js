const fixedWindow = require("../algorithms/fixedWindow");
const slidingWindow = require("../algorithms/slidingWindow");
const tokenBucket = require("../algorithms/tokenBucket");

const ALGORITHMS = {
  "fixed-window": fixedWindow,
  "sliding-window": slidingWindow,
  "token-bucket": tokenBucket,
};

async function route(params) {
  const fn = ALGORITHMS[params.algorithm];

  if (!fn) {
    throw new Error(`Unknown algorithm: ${params.algorithm}`);
  }

  return fn(params);
}

module.exports = { route };
