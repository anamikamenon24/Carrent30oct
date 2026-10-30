import { getEnv } from "@/server/config";
import { FakePaymentProvider } from "./payments/fake";
import { StripePaymentProvider } from "./payments/stripe";
import type { PaymentProvider } from "./payments/types";
import { LocalFileStorage } from "./storage/local";
import { VercelBlobStorage } from "./storage/vercel-blob";
import type { FileStorage } from "./storage/types";

export type { PaymentProvider } from "./payments/types";
export type { FileStorage } from "./storage/types";

// Kept on globalThis so in-memory state survives Next.js hot reloads in development.
const store = globalThis as unknown as { __payments?: PaymentProvider; __storage?: FileStorage };

/** Returns the payment provider picked by PAYMENTS_PROVIDER. */
export function getPayments(): PaymentProvider {
  if (store.__payments) return store.__payments;
  const env = getEnv();
  switch (env.PAYMENTS_PROVIDER) {
    case "fake":
      store.__payments = new FakePaymentProvider({
        webhookSecret: env.PAYMENTS_WEBHOOK_SECRET,
        webhookUrl: env.FAKE_PAYMENTS_WEBHOOK_URL,
        duplicateWebhooks: env.FAKE_PAYMENTS_DUPLICATE_WEBHOOKS,
      });
      break;
    case "stripe":
      if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY (sk_test_...) is required for PAYMENTS_PROVIDER=stripe");
      store.__payments = new StripePaymentProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.PAYMENTS_WEBHOOK_SECRET,
      });
      break;
  }
  return store.__payments;
}

/** Returns the file storage picked by STORAGE_PROVIDER. */
export function getStorage(): FileStorage {
  if (store.__storage) return store.__storage;
  const env = getEnv();
  switch (env.STORAGE_PROVIDER) {
    case "local":
      store.__storage = new LocalFileStorage(env.UPLOADS_DIR);
      break;
    case "vercel-blob":
      store.__storage = new VercelBlobStorage(env.BLOB_READ_WRITE_TOKEN ?? "");
      break;
  }
  return store.__storage;
}
