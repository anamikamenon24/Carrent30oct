# DriveEasy Multi-Agent Engineering Guidelines

## Team: DriveEasy
DriveEasy is an automated, production-ready car rental web application prepared for deployment on Vercel.
The engineering team operates as three specialized agents following [docs/team-brief.md](docs/team-brief.md):

1. **App Agent (`app-agent`)**: Frontend UI, Next.js 16 App Router pages, responsive design, checkout breakdown, driver licence uploads, QR pick-up vouchers, rentals management, and admin screens.
2. **Database Engine Agent (`database-engine-agent` / `db-agent`)**: Neon PostgreSQL schema (17 tables), Drizzle ORM migrations, GiST exclusion constraints (`vehicle_occupancy_no_overlap`), server-side pricing engine (`src/server/pricing`), atomic reservation holds, and cron hold cleanup.
3. **QA Agent (`qa-agent`)**: Automated test suites in Vitest and Playwright, concurrency verification (overlapping reservation collision tests), pricing math verification, security isolation, multi-device layout checks, and bug reporting.

---

## Local Development & Safety

- **Database**: Dedicated PostgreSQL 18.6 instance on port 5433 (`pnpm db:start`, `pnpm db:status`, `pnpm db:stop`).
- **Databases**:
  - `driveeasy_dev`: Development database (never reset by automated tests).
  - `driveeasy_test`: Automated test database (reset and seeded by test runners).
  - `driveeasy_qa_*`: Ephemeral throwaway databases for clean migration testing.
- **Local Stand-ins**: Fake payments (`src/server/services/payments`), private local file uploads (`src/server/services/storage`), local job runner. No cloud accounts are used during local development.
- **Currency**: UAE Dirham (AED) stored exclusively as integer minor units (fils: 1 AED = 100 fils). Never use floating point for currency.

---

## Key Commands

- `pnpm dev`: Start Next.js development server on port 3000.
- `pnpm db:start`: Start local PostgreSQL 18.6 service.
- `pnpm db:migrate`: Run Drizzle migrations.
- `pnpm db:seed`: Seed local database with demo fleet, branches, and pricing rules.
- `pnpm test`: Run Vitest unit and QA tests (occupancy, engine, pricing, migrations, webhooks, cron).
- `pnpm test:e2e`: Run Playwright end-to-end tests across Chromium, Firefox, WebKit, and mobile viewports.
- `pnpm build`: Verify production Next.js build.

---

## Agent Communication & Handoff Protocols

- **Task Board**: Maintained under `.claude/tasks/DriveEasy/`.
- **Peer-to-Peer Messaging**: Teammates communicate via `.claude/teams/DriveEasy/inboxes/`.
- **Bug Reporting**: Bugs found by `qa-agent` are reported with exact reproduction steps, expected vs actual behavior, and file/line references:
  - UI, auth, and pages $\rightarrow$ `app-agent`
  - Schema, migrations, pricing, transactions, holds, cron, webhooks $\rightarrow$ `database-engine-agent`
- Retest fixes with the relevant suite (`pnpm test` or `pnpm test:e2e`) before closing issues.
