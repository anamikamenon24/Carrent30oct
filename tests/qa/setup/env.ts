import { loadTestEnv } from "./load-env";

loadTestEnv();
// The fake payment provider must not POST webhooks to a running dev server (which uses
// driveeasy_dev). In-process tests read events from getPayments().sentEvents instead.
delete process.env.FAKE_PAYMENTS_WEBHOOK_URL;
process.env.PAYMENTS_PROVIDER = "fake";
process.env.STORAGE_PROVIDER = "local";
process.env.UPLOADS_DIR = "./storage/qa-uploads";
