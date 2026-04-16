const slidingWindow = require("../src/algorithms/slidingWindow");

describe.skip("Sliding Window", () => {

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("allows requests within limit", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    const key = "sw:test";

    for (let i = 0; i < 5; i++) {
      const res = await slidingWindow({
        key,
        limit: 5,
        window: 60,
      });

      expect(res.allowed).toBe(true);
    }
  });

  it("rejects when limit exceeded", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    const key = "sw:limit";

    for (let i = 0; i < 5; i++) {
      await slidingWindow({ key, limit: 5, window: 60 });
    }

    const res = await slidingWindow({
      key,
      limit: 5,
      window: 60,
    });

    expect(res.allowed).toBe(false);
  });

  it("allows request after window slides", async () => {
    const key = "sw:slide";

    // initial time
    jest.spyOn(Date, "now").mockReturnValue(1000000);

    for (let i = 0; i < 5; i++) {
      await slidingWindow({ key, limit: 5, window: 60 });
    }

    // move time forward (simulate window shift)
    jest.spyOn(Date, "now").mockReturnValue(1000000 + 61000);

    const res = await slidingWindow({
      key,
      limit: 5,
      window: 60,
    });

    expect(res.allowed).toBe(true);
  });

});