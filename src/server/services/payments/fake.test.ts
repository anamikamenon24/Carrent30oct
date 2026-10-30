import { describe, expect, it, vi } from "vitest";
import { FAKE_PAYMENT_METHODS, FAKE_SIGNATURE_HEADER, FakePaymentProvider, signFakeWebhook } from "./fake";
import type { PaymentInput } from "./types";

const secret = "test-webhook-secret-123";
let key = 0;
const input = (paymentMethod: string): PaymentInput => ({
  amountCents: 10_000,
  currency: "GBP",
  paymentMethod,
  idempotencyKey: `key-${key++}`,
});

describe("FakePaymentProvider", () => {
  it("succeeds, fails and cancels based on the payment method", async () => {
    const p = new FakePaymentProvider({ webhookSecret: secret });
    expect((await p.createCharge(input(FAKE_PAYMENT_METHODS.success))).status).toBe("succeeded");
    expect((await p.createCharge(input(FAKE_PAYMENT_METHODS.fail))).status).toBe("failed");
    expect((await p.createCharge(input(FAKE_PAYMENT_METHODS.cancel))).status).toBe("canceled");
    const pending = await p.createCharge(input(FAKE_PAYMENT_METHODS.pending));
    expect((await p.cancelCharge(pending.id)).status).toBe("canceled");
    expect(p.sentEvents.map((e) => e.type)).toEqual(["charge.succeeded", "charge.failed", "charge.canceled", "charge.canceled"]);
  });

  it("returns the same charge for a repeated idempotency key", async () => {
    const p = new FakePaymentProvider({ webhookSecret: secret });
    const req = input(FAKE_PAYMENT_METHODS.success);
    expect((await p.createCharge(req)).id).toBe((await p.createCharge(req)).id);
    expect(p.sentEvents).toHaveLength(1);
  });

  it("refunds partially and then fully", async () => {
    const p = new FakePaymentProvider({ webhookSecret: secret });
    const charge = await p.createCharge(input(FAKE_PAYMENT_METHODS.success));
    expect((await p.refundCharge(charge.id, 4_000)).status).toBe("partially_refunded");
    const done = await p.refundCharge(charge.id);
    expect(done).toMatchObject({ status: "refunded", refundedCents: 10_000 });
    await expect(p.refundCharge(charge.id, 1)).rejects.toThrow();
  });

  it("holds, releases and captures deposits", async () => {
    const p = new FakePaymentProvider({ webhookSecret: secret });
    const a = await p.holdDeposit(input(FAKE_PAYMENT_METHODS.success));
    expect(a.status).toBe("held");
    expect((await p.releaseDeposit(a.id)).status).toBe("released");
    await expect(p.releaseDeposit(a.id)).rejects.toThrow(/already released/);

    const b = await p.holdDeposit(input(FAKE_PAYMENT_METHODS.success));
    expect(await p.captureDeposit(b.id, 2_500)).toMatchObject({ status: "captured", capturedCents: 2_500 });
    await expect(p.holdDeposit(input(FAKE_PAYMENT_METHODS.fail))).rejects.toThrow(/declined/);
  });

  it("sends signed webhooks, twice with the same id when duplicates are on", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null));
    const p = new FakePaymentProvider({
      webhookSecret: secret,
      webhookUrl: "http://localhost:3000/api/webhooks/payments",
      duplicateWebhooks: true,
      fetch: fetchMock,
    });
    await p.createCharge(input(FAKE_PAYMENT_METHODS.success));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => init!.body as string);
    expect(bodies[0]).toBe(bodies[1]);

    const headers = new Headers(fetchMock.mock.calls[0][1]!.headers);
    const event = await p.parseWebhook(bodies[0], headers);
    expect(event.type).toBe("charge.succeeded");

    await p.resendEvent(event.id);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects webhooks with a bad or stale signature", async () => {
    const p = new FakePaymentProvider({ webhookSecret: secret });
    const body = JSON.stringify({ id: "evt_x" });
    const bad = new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body, "wrong-secret-value") });
    const stale = new Headers({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body, secret, 1_000) });
    await expect(p.parseWebhook(body, bad)).rejects.toThrow(/signature/);
    await expect(p.parseWebhook(body, stale)).rejects.toThrow(/signature/);
  });
});
