const tokenBucket = require("../src/algorithms/tokenBucket");

describe.skip("Token Bucket", () => {

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("allows burst up to capacity", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    const key = "tb:burst";

    for (let i = 0; i < 5; i++) {
      const res = await tokenBucket({
        key,
        limit: 5,
        window: 60,
      });

      expect(res.allowed).toBe(true);
    }
  });

  it("rejects when bucket is empty", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    const key = "tb:empty";

    for (let i = 0; i < 5; i++) {
      await tokenBucket({ key, limit: 5, window: 60 });
    }

    const res = await tokenBucket({
      key,
      limit: 5,
      window: 60,
    });

    expect(res.allowed).toBe(false);
    expect(res.retryAfter).toBeGreaterThan(0);
  });

  it("refills over time and allows request again", async () => {
    const key = "tb:refill";

    // drain bucket
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    for (let i = 0; i < 5; i++) {
      await tokenBucket({ key, limit: 5, window: 60 });
    }

    // move time forward (simulate refill)
    jest.spyOn(Date, "now").mockReturnValue(1000000 + 30000); // 30 sec

    const res = await tokenBucket({
      key,
      limit: 5,
      window: 60,
    });

    expect(res.allowed).toBe(true);
  });

  it("supports weighted cost", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    const key = "tb:cost";

    // cost = 5, capacity = 10 → only 2 requests allowed
    const res1 = await tokenBucket({
      key,
      limit: 10,
      window: 60,
      cost: 5,
    });

    const res2 = await tokenBucket({
      key,
      limit: 10,
      window: 60,
      cost: 5,
    });

    const res3 = await tokenBucket({
      key,
      limit: 10,
      window: 60,
      cost: 5,
    });

    expect(res1.allowed).toBe(true);
    expect(res2.allowed).toBe(true);
    expect(res3.allowed).toBe(false);
  });

});