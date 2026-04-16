const request = require("supertest");
const app = require("../src/app");

describe("/check endpoint", () => {
  it("returns 400 for missing fields", async () => {
    const res = await request(app).post("/check").send({});
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid algorithm", async () => {
    const res = await request(app).post("/check").send({
      key: "test",
      algorithm: "invalid",
      limit: 5,
      window: 60,
    });

    expect(res.statusCode).toBe(400);
  });

  it("routes fixed-window correctly", async () => {
    const res = await request(app).post("/check").send({
      key: "fw:test",
      algorithm: "fixed-window",
      limit: 5,
      window: 60,
    });

    expect(res.statusCode).toBe(200);
  });
});
