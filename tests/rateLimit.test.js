const request = require("supertest");
const app = require("../src/app");

describe("Rate Limiter API", () => {

  it("should allow requests within limit (fixed window)", async () => {
    const res = await request(app)
      .post("/check")
      .send({
        key: "test:fw",
        algorithm: "fixed-window",
        limit: 5,
        window: 60,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.allowed).toBe(true);
  });

  it("should reject invalid request", async () => {
    const res = await request(app)
      .post("/check")
      .send({});

    expect(res.statusCode).toBe(400);
  });

  it.skip("should reject when limit exceeded (fixed window)", async () => {
    const key = "test:fw:limit";

    for (let i = 0; i < 5; i++) {
      await request(app).post("/check").send({
        key,
        algorithm: "fixed-window",
        limit: 5,
        window: 60,
      });
    }

    const res = await request(app).post("/check").send({
      key,
      algorithm: "fixed-window",
      limit: 5,
      window: 60,
    });

    expect(res.statusCode).toBe(429);
    expect(res.body.allowed).toBe(false);
  });

});