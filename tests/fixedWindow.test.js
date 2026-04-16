const fixedWindow = require("../src/algorithms/fixedWindow");
const redis = require("../tests/__mocks__/redis");

// console.log("REDIS INSTANCE IN TEST:", redis);


describe("Fixed Window", () => {
  beforeEach(() => {
    redis.__store.clear();
  });

  it("allows requests within limit", async () => {
    const res = await fixedWindow({
      key: "user1",
      limit: 5,
      window: 60,
    });

    expect(res.allowed).toBe(true);
  });

  // it("rejects when limit exceeded", async () => {
  //   const key = "user2";

  //   for (let i = 0; i < 5; i++) {
  //     await fixedWindow({ key, limit: 5, window: 60 });
  //   }

  //   const res = await fixedWindow({ key, limit: 5, window: 60 });

  //   expect(res.allowed).toBe(false);
  // });

  it("isolates keys", async () => {
    const res1 = await fixedWindow({ key: "A", limit: 1, window: 60 });
    const res2 = await fixedWindow({ key: "B", limit: 1, window: 60 });

    expect(res1.allowed).toBe(true);
    expect(res2.allowed).toBe(true);
  });
});
