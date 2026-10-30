import { z } from "zod";

/**
 * Typed server settings. Each cloud stand-in is chosen by a *_PROVIDER setting,
 * so swapping a local stand-in for a real cloud service is a settings change.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),

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
  STRIPE_SECRET_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  UPLOADS_DIR: z.string().default("./storage/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),

  SCHEDULER_PROVIDER: z.enum(["local", "cloud-cron"]).default("local"),
  CRON_SECRET: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
