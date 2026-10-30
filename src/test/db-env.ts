import { engineTestUrl } from "./db-target";

// Point the app at the engine test database before any server module is imported.
process.env.DATABASE_URL = engineTestUrl().url;
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.PAYMENTS_PROVIDER = "fake";
// Never deliver fake webhooks to a running dev server; tests feed events to processPaymentEvent directly.
delete process.env.FAKE_PAYMENTS_WEBHOOK_URL;
process.env.FAKE_PAYMENTS_DUPLICATE_WEBHOOKS = "false";
