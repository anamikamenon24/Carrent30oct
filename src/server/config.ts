import { z } from "zod";

/**
 * Typed server settings. Each cloud stand-in is chosen by a *_PROVIDER setting,
 * so swapping a local stand-in for a real cloud service is a settings change.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  /**
   * "pg": node-postgres over TCP (local Postgres, or Neon's pooled URL).
   * "neon": @neondatabase/serverless over WebSockets (Vercel Functions + Neon). Same queries either way.
   */
  DATABASE_DRIVER: z.enum(["pg", "neon"]).default("pg"),
  /** Max connections per process. Keep small on serverless. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  QR_SIGNING_SECRET: z.string().min(32),

  PAYMENTS_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16),
  FAKE_PAYMENTS_WEBHOOK_URL: z.url().optional(),
  FAKE_PAYMENTS_DUPLICATE_WEBHOOKS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Test mode only: the Stripe adapter refuses anything but sk_test_ keys. */
  STRIPE_SECRET_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().startsWith("sk_test_").optional()),

  STORAGE_PROVIDER: z.enum(["local", "vercel-blob"]).default("local"),
  UPLOADS_DIR: z.string().default("./storage/uploads"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  /** How long an unpaid PENDING reservation holds the vehicle. */
  RESERVATION_HOLD_MINUTES: z.coerce.number().int().min(1).max(120).default(15),

  SCHEDULER_PROVIDER: z.enum(["local", "cloud-cron"]).default("local"),
  CRON_SECRET: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
