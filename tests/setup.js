/**
 * Global test setup
 */

// 🔹 Mock Redis with in-memory implementation
jest.mock("../src/db/redis",() => require("./__mocks__/redis"));

/**
 * 🔹 Clear mock store before each test
 */
beforeEach(() => {
  const redis = require("./__mocks__/redis");

  if (redis.__store && typeof redis.__store.clear === "function") {
    redis.__store.clear();
  }
});

/**
 * 🔹 Cleanup after all tests
 * (Prevents Jest hanging due to open handles)
 */
afterAll(async () => {
  try {
    const redis = require("../src/db/redis");

    if (redis && typeof redis.quit === "function") {
      await redis.quit();
    }
  } catch (err) {
    // Ignore cleanup errors (mock may not have quit)
  }
});