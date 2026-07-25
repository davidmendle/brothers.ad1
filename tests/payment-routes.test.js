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
const {
  createApp,
  createPayPalOrder,
  createStripeCheckout,
  manualPaymentInstructions,
  normalizePaymentPayload
} = require("../createApp");

describe("payment and integration routes", () => {
  let app;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.ZELLE_BUSINESS_RECIPIENT;
    delete process.env.WIRE_PAYMENT_INSTRUCTIONS;
    app = createApp();
  });

  it("protects every payment and accounting integration route with OS authorization", async () => {
    await request(app).post("/api/payments/stripe/intent").send({ amount: 1250, customer: "North Ridge" }).expect(401);
    await request(app).post("/api/payments/paypal/order").send({ amount: 860, customer: "Oak Avenue" }).expect(401);
    await request(app).post("/api/payments/zelle/instructions").send({ amount: 100, customer: "Customer" }).expect(401);
    await request(app).post("/api/payments/wire/instructions").send({ amount: 100, customer: "Customer" }).expect(401);
    await request(app).get("/api/integrations/quickbooks/oauth/start").expect(401);
  });

  it("validates payment payloads before a provider request", () => {
    expect(normalizePaymentPayload({ amount: 0, customer: "Customer" })).toMatchObject({ ok: false, statusCode: 400 });
    expect(normalizePaymentPayload({ amount: 1250.459, customer: " North Ridge ", job: "J-1" })).toMatchObject({
      ok: true,
      payment: {
        amount: 1250.46,
        amountCents: 125046,
        customer: "North Ridge",
        job: "J-1"
      }
    });
  });

  it("reports configuration requirements without pretending a payment was created", async () => {
    const payment = normalizePaymentPayload({ amount: 1250, customer: "North Ridge", requestId: "PAY-1" }).payment;
    await expect(createStripeCheckout(payment, {})).resolves.toMatchObject({
      statusCode: 202,
      body: { rail: "Card", status: "configuration_required" }
    });
    await expect(createPayPalOrder(payment, {})).resolves.toMatchObject({
      statusCode: 202,
      body: { rail: "PayPal", status: "configuration_required" }
    });
    expect(manualPaymentInstructions("Zelle", payment)).toMatchObject({
      statusCode: 202,
      body: { rail: "Zelle", status: "configuration_required" }
    });
    process.env.ZELLE_BUSINESS_RECIPIENT = "payments@example.com";
    expect(manualPaymentInstructions("Zelle", payment)).toMatchObject({
      statusCode: 200,
      body: { rail: "Zelle", status: "instructions_ready", instructions: "payments@example.com" }
    });
  });
});
