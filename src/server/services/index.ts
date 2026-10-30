import { getEnv } from "@/server/config";
import { FakePaymentProvider } from "./payments/fake";
import type { PaymentProvider } from "./payments/types";
import { LocalFileStorage } from "./storage/local";
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
      throw new Error("Stripe payments are not set up yet. Use PAYMENTS_PROVIDER=fake.");
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
    case "s3":
      throw new Error("S3 storage is not set up yet. Use STORAGE_PROVIDER=local.");
  }
  return store.__storage;
}
