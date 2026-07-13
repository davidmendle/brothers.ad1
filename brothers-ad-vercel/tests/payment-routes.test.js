import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.INSURANCE_API_KEY = "test-secret";
process.env.ADMIN_EMAILS = "owner@brothersos.test";
process.env.ADMIN_PASSWORD = "correct horse battery staple";
process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret-with-enough-length";
process.env.ADMIN_COOKIE_SECURE = "false";
process.env.DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brothers-payment-test-")), "test.db")}`;

const require = createRequire(import.meta.url);
const { createApp } = require("../createApp");

describe("payment and integration routes", () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it("keeps card and PayPal payment routes online with setup-required responses", async () => {
    const card = await request(app)
      .post("/payments/stripe/intent")
      .send({ amount: 1250, customer: "North Ridge Apartments" })
      .expect(202);
    expect(card.body).toMatchObject({
      success: true,
      rail: "Card",
      status: "configuration_required",
      requestedAmount: 1250,
      customer: "North Ridge Apartments"
    });

    const paypal = await request(app)
      .post("/payments/paypal/order")
      .send({ amount: 860, customer: "Oak Avenue" })
      .expect(202);
    expect(paypal.body).toMatchObject({
      success: true,
      rail: "PayPal",
      status: "configuration_required",
      requestedAmount: 860,
      customer: "Oak Avenue"
    });
  });

  it("keeps manual rail and QuickBooks routes from falling through to static pages", async () => {
    const zelle = await request(app).get("/payments/zelle/instructions").expect(202);
    expect(zelle.body).toMatchObject({ success: true, rail: "Zelle", status: "configuration_required" });

    const wire = await request(app).get("/payments/wire/instructions").expect(202);
    expect(wire.body).toMatchObject({ success: true, rail: "Wire", status: "configuration_required" });

    const quickBooks = await request(app).get("/integrations/quickbooks/oauth/start").expect(202);
    expect(quickBooks.body).toMatchObject({ success: true, integration: "QuickBooks", status: "configuration_required" });
  });
});
