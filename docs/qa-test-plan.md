# DriveEasy QA test plan

Owner: QA Agent. Everything runs locally: PostgreSQL 18.6 on port 5433, fake payments, local uploads.
No cloud accounts are used.

## How to run

| Command | What it runs | Database |
|---|---|---|
| `pnpm db:start` | Starts the local PostgreSQL instance (needed after a reboot) | |
| `pnpm test` | vitest projects `unit` (`src/**/*.test.ts`) and `qa` (`tests/qa/**/*.qa.test.ts`) | `qa` resets `driveeasy_test` once per run (drop + recreate `public`, then migrate). Clean-migration tests use throwaway `driveeasy_qa_*` databases and drop them afterwards. |
| `pnpm test:e2e` | Playwright: `next build` + `next start -p 3100`, then `e2e/*.spec.ts` | `driveeasy_test`, reset, migrated and seeded (`pnpm db:seed`) in `e2e/global-setup.ts` |
| `E2E_SKIP_BUILD=1 pnpm test:e2e` | Same, reusing the last build | |

Safety: `tests/qa/setup/load-env.ts` refuses any database URL that is not on localhost or whose
name does not end in `_test` or start with `driveeasy_qa_`. `driveeasy_dev` can never be reset by tests.
Don't run `pnpm test` and `pnpm test:e2e` at the same time: both reset `driveeasy_test`.

Playwright projects: `chromium` (desktop, full functional suite), plus `firefox`, `webkit`,
`mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 14), which run the tests tagged
`@smoke`, `@layout` and `@mobile`.

## Coverage of the brief

| Brief item | Tests |
|---|---|
| Migrations on a clean database | `tests/qa/migrations.qa.test.ts`: new empty DB without btree_gist; all 17 tables; UUID PKs; timestamptz only; no float/numeric money; unique plate/VIN/branch code; GiST exclusion constraints; tstzrange periods; status enums; payment/deposit status separate; mileage + fuel at pick-up/return; FK indexes; re-running is a no-op |
| Two sessions reserve overlapping dates at once → only one succeeds | `tests/qa/occupancy.qa.test.ts` (two open transactions; 20 parallel inserts); `tests/qa/engine.qa.test.ts` (service-level, 20 parallel `createReservation` calls → 1 ok, 19 `VEHICLE_UNAVAILABLE`) |
| Back-to-back rentals | `occupancy.qa.test.ts` (10:00 end / 10:00 start allowed; 1-minute overlap at either end rejected; same instant in a different UTC offset); `engine.qa.test.ts` |
| Maintenance blocks | `occupancy.qa.test.ts`: block vs reservation in both directions, delete frees the period, extend into a booking is rejected |
| Expired holds + automatic release, idempotent | `engine.qa.test.ts` (release after TTL, not before; second run releases 0; released slot is bookable; confirmed reservations untouched); `tests/qa/cron-route.qa.test.ts` (CRON_SECRET: missing/wrong/no-Bearer → 401, unknown job → 404, repeat run → `released: 0`) |
| Daily rate, extras, one-way fee, VAT, late return, deposit | `tests/qa/pricing.qa.test.ts` (table of cases against an independent reference model, integer fils only); `e2e/rental-flow.spec.ts` checks the checkout breakdown adds up (`data-fils` on every line) |
| Payment success / failure / cancel / retry / refund / deposit release / duplicate webhook | `engine.qa.test.ts` + `tests/qa/webhooks.qa.test.ts` (signed fake webhooks, bad signature → 400, same event id twice → applied once); `e2e/rental-flow.spec.ts` (declined → retry succeeds with one booking; abandoned → no voucher; double-click pay → one payment; cancel → refund) |
| Registration, login, logout, authorization | `e2e/auth.spec.ts`: register/logout/login, identical error for wrong password vs unknown email, duplicate email, httpOnly session cookie, login throttling, role escalation through the raw `/api/auth/*` API, anonymous redirects |
| Users can't access other users' reservations, vouchers, licence uploads | `e2e/authorization.spec.ts`: other user and anonymous get 404 for `/rentals/<id>`, `/rentals/<id>/voucher`, `/api/files/licence/<id>`; uploads not served as static files; licence response is `private`/`no-store` |
| Admin permissions (fleet, pricing, check-in, damage) | `e2e/authorization.spec.ts` (customer gets 404 on every `/admin/*` page and on damage images); `e2e/rental-flow.spec.ts` (admin check-out/check-in, mileage cannot go backwards, damage form) |
| Search, branches, date ranges, filters, calendars | `e2e/search.spec.ts`: form → URL params, invalid ranges, past dates, unknown branch, each filter narrows and every card matches, sort, calendar day statuses, branch pages + 404 |
| Full rental: search → payment → voucher → check-out → return | `e2e/rental-flow.spec.ts` (serial) |
| Preview and production builds | `next build` with `VERCEL_ENV=preview` and `VERCEL_ENV=production`, then `next start` + smoke (see the QA report) |
| Desktop and mobile layouts | `e2e/layout.spec.ts` on all 5 projects: no horizontal scroll, tap targets ≥ 24px inside the viewport, no console errors, nav and search usable on phones |

## Bug reporting

Bugs go to the owning agent with repro steps, expected vs actual, and file/line:
UI, auth and pages → app-agent; schema, migrations, reservations, pricing, payments, holds, cron
and webhooks → db-agent. Each fix is retested with the test named in the report.
