# DriveEasy

Car rental web app for the UAE: search by branch and dates, extras, checkout with a security-deposit
hold, digital pick-up voucher, my rentals, and admin screens for branches, fleet, pricing, reservations,
check-out/check-in and damage reports.

Next.js 16 (App Router) · TypeScript · Tailwind CSS · PostgreSQL + Drizzle ORM · Better Auth · Vitest ·
Playwright. Money is AED stored as integer fils; timestamps are UTC and shown in each branch's time zone.

> Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/` before changing app code.

## Local setup

Requirements: Node 22+, pnpm, PostgreSQL 18 (DriveEasy uses its own instance on port 5433).

```bash
pnpm install
cp .env.example .env.local        # fill in passwords and secrets (see below)
pnpm db:start                     # start the local PostgreSQL instance (after every reboot)
pnpm db:check                     # both databases reachable, btree_gist installed
pnpm db:migrate:deploy            # apply migrations to DATABASE_URL (driveeasy_dev)
pnpm db:seed                      # branches, categories, vehicles, extras, pricing rules, users
pnpm dev                          # http://localhost:3000
```

The seed prints two logins (local only):
`admin@driveeasy.local / DriveEasyAdmin!2026` and `customer@driveeasy.local / DriveEasyDemo!2026`.
Override with `SEED_ADMIN_PASSWORD` / `SEED_CUSTOMER_PASSWORD`. `pnpm admin:create <email>` promotes an
existing user to admin.

Everything runs locally with stand-ins chosen by settings: fake payments, private local uploads and a
local job runner. The cloud implementations are wired up behind the same interfaces (see below).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | App database. Locally `driveeasy_dev`; on Vercel the **pooled** Neon URL. |
| `TEST_DATABASE_URL` | Local test database (`driveeasy_test`). |
| `DATABASE_DRIVER` | `pg` (node-postgres) or `neon` (@neondatabase/serverless over WebSockets). |
| `DATABASE_POOL_MAX` | Connections per process (keep small on serverless). |
| `MIGRATION_DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Direct connection used only by migrations. |
| `SKIP_MIGRATIONS` | `1` skips the migration step of a build. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Authentication. |
| `QR_SIGNING_SECRET` | Signs voucher QR payloads. |
| `PAYMENTS_PROVIDER` | `fake` (local) or `stripe` (test-mode keys only). |
| `PAYMENTS_WEBHOOK_SECRET` | Verifies payment webhooks (Stripe: the endpoint's `whsec_...`). |
| `FAKE_PAYMENTS_WEBHOOK_URL`, `FAKE_PAYMENTS_DUPLICATE_WEBHOOKS` | Fake provider webhook target / send every event twice. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe test mode. |
| `STORAGE_PROVIDER` | `local` (private folder `UPLOADS_DIR`) or `vercel-blob` (private blobs). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob. |
| `SCHEDULER_PROVIDER` | `local` (`pnpm jobs:*`) or `cloud-cron` (Vercel Cron calls `/api/cron/<job>`). |
| `CRON_SECRET` | Bearer token required by `/api/cron/*`. |
| `RESERVATION_HOLD_MINUTES` | How long an unpaid reservation holds a vehicle (default 15). |

Database and payment secrets are read only on the server (`src/server/config.ts`); nothing secret uses a
`NEXT_PUBLIC_` prefix.

## Database

- Schema: `src/server/db/schema.ts` (Drizzle). Migrations: `drizzle/`.
  `0000` installs `btree_gist`; `0002` adds the double-booking guard and triggers that Drizzle cannot express.
- Change the schema, then `pnpm db:generate` and review the SQL. Apply with `pnpm db:migrate:deploy`
  (advisory-locked, safe to re-run) or `pnpm db:migrate` (drizzle-kit).
- Double booking is impossible at the database level: every active reservation (`PENDING`, `CONFIRMED`,
  `PICKED_UP`) and every maintenance block has a row in `vehicle_occupancy`, whose exclusion constraint
  `vehicle_occupancy_no_overlap` forbids overlapping `[start, end)` periods per vehicle.
- Pricing, holds, payment/deposit rules and the cancellation policy: [docs/pricing-and-cancellation.md](docs/pricing-and-cancellation.md).

### Server API (for pages and route handlers)

| Module | What |
| --- | --- |
| `@/server/data/catalog` | Branches, categories, extras, features, vehicles, pricing rules (reads). |
| `@/server/data/drivers` | Driver profile get/upsert. |
| `@/server/data/admin` | Admin create/update for branches, categories, vehicles, pricing rules, extras, maintenance. |
| `@/server/reservations` | Search, availability calendar, quote, hold, pay, modify, cancel, check-out/in, damage reports, reservation reads. Errors are `ReservationError` with a stable `code`. |
| `@/server/jobs` | `release-expired-holds`. |

Payment webhooks: `POST /api/webhooks/payments` (signature-verified; each event id processed once).

## Scheduled jobs

`release-expired-holds` expires lapsed holds and refunds / releases money for reservations that will not
go ahead. It is idempotent and safe to run concurrently.

- Locally: `pnpm jobs:release-expired-holds` (add `--every 60` to repeat).
- On Vercel: `vercel.json` schedules `GET /api/cron/release-expired-holds` every 5 minutes; Vercel sends
  `Authorization: Bearer $CRON_SECRET`. (Sub-daily schedules need a Pro plan. Lapsed holds stop blocking
  vehicles immediately even if the job runs late.)

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test                         # all Vitest projects
pnpm exec vitest run --project unit   # pure unit tests
pnpm exec vitest run --project db     # engine integration tests (recreates driveeasy_engine_test)
pnpm exec vitest run --project qa     # QA integration tests (resets driveeasy_test)
pnpm test:e2e                     # Playwright
```

The `db` and `qa` projects refuse to run against anything but local `*_test` databases.

## Deploying to Vercel (prepared, not yet done)

1. Import the repository in Vercel. `vercel.json` sets the install/build commands and the cron.
2. Add **Neon** from the Vercel Marketplace. It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
   (direct). Set `DATABASE_DRIVER=neon`, `DATABASE_POOL_MAX=5`. Enable Neon preview branches so each
   preview deployment gets its own database branch (otherwise set `SKIP_MIGRATIONS=1` for Preview).
3. Add **Vercel Blob** (private store). It sets `BLOB_READ_WRITE_TOKEN`. Set `STORAGE_PROVIDER=vercel-blob`.
4. Payments (test mode): set `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, create a webhook endpoint for
   `https://<domain>/api/webhooks/payments` with events `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.amount_capturable_updated`,
   and put its signing secret in `PAYMENTS_WEBHOOK_SECRET`.
5. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `QR_SIGNING_SECRET`, `CRON_SECRET`
   (`SCHEDULER_PROVIDER=cloud-cron`) separately for Preview and Production.
6. Deploy. The build runs `pnpm db:migrate:deploy` (direct connection, advisory lock) before `next build`.
   Seed reference data once with `DATABASE_URL=<direct url> pnpm db:seed` (refuses production unless
   `ALLOW_PRODUCTION_SEED=1`), then change the seeded admin password or use `pnpm admin:create`.

Locally you can check both build modes with `next build` using preview-like and production-like env files.
