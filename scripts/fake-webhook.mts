// Sends a signed fake payments webhook to the local app, e.g.
//   pnpm fake:webhook charge.succeeded
//   pnpm fake:webhook deposit.released --duplicate   (sends the same event id twice)
import { FAKE_SIGNATURE_HEADER, makeFakeEvent, signFakeWebhook } from "@/server/services/payments/fake";
import type { PaymentEventType } from "@/server/services/payments/types";

const types: PaymentEventType[] = [
  "charge.succeeded",
  "charge.failed",
  "charge.canceled",
  "charge.refunded",
  "deposit.held",
  "deposit.released",
  "deposit.captured",
];

const [type, ...flags] = process.argv.slice(2) as [PaymentEventType, ...string[]];
const url = process.env.FAKE_PAYMENTS_WEBHOOK_URL;
const secret = process.env.PAYMENTS_WEBHOOK_SECRET;

if (!types.includes(type) || !url || !secret) {
  console.error(`Usage: pnpm fake:webhook <type> [--duplicate]\nTypes: ${types.join(", ")}`);
  console.error("Needs FAKE_PAYMENTS_WEBHOOK_URL and PAYMENTS_WEBHOOK_SECRET in .env.local");
  process.exit(1);
}

const isDeposit = type.startsWith("deposit.");
const event = makeFakeEvent(type, {
  id: `${isDeposit ? "dh" : "ch"}_fake_cli`,
  amountCents: 5000,
  currency: "aed",
  status: type.split(".")[1] as never,
  ...(isDeposit ? { capturedCents: 0 } : { refundedCents: 0 }),
  metadata: { source: "cli" },
} as never);

const body = JSON.stringify(event);
for (let i = 0; i < (flags.includes("--duplicate") ? 2 : 1); i++) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body, secret) },
    body,
  });
  console.log(`Sent ${event.id} (${type}) → ${res.status}`);
}
