---
description: DriveEasy team architecture, agent roles, responsibilities, and protocols following docs/team-brief.md.
always_on: true
---

# DriveEasy Multi-Agent Team Architecture

Team **DriveEasy** consists of three specialized agents collaborating to build a production-ready car rental web application:

1. **App Agent (`app-agent`)**:
   - Polished responsive car-rental UI using Next.js 16 App Router and Tailwind CSS.
   - User flows: search, vehicle details, availability calendar, extras, checkout breakdown (in integer fils), licence upload, QR pick-up voucher, rental management (dates modification & cancellation), and admin operations.
   - Connected directly to real database services; no permanent mock data or placeholder buttons.
   - Private, authenticated serving for driver licences (`private, no-store`).

2. **Database Engine Agent (`database-engine-agent` / `db-agent`)**:
   - Neon PostgreSQL schema & Drizzle ORM migrations for 17 tables.
   - Integer minor units (AED fils; 1 AED = 100 fils), UUID primary keys, UTC timestamps (`timestamptz`).
   - PostgreSQL GiST exclusion constraint (`vehicle_occupancy_no_overlap`) preventing overlapping active reservations (`PENDING`, `CONFIRMED`, `PICKED_UP`) and maintenance blocks.
   - Server-side pricing engine (`src/server/pricing`): daily rates, seasonal adjustments, duration discounts, extras, one-way fees, 5% VAT, and security deposits.
   - Atomic reservation transaction with hold TTL (`createReservationHold`) and idempotent hold release endpoint (`release-expired-holds`).

3. **QA Agent (`qa-agent`)**:
   - Executes Vitest unit/QA suites (`pnpm test`) and Playwright E2E suites (`pnpm test:e2e`).
   - Verifies concurrent reservation overlap rejection, back-to-back rentals, expired hold release, pricing breakdowns, auth security, and layout responsiveness.
   - Routes bugs with repro steps, expected vs actual, and file/line references to `app-agent` or `database-engine-agent`. Retests fixes upon deployment.

## Environment & Operation
- **Local First**: PostgreSQL 18.6 on port 5433 (`pnpm db:start`), fake payments, local file storage.
- Never expose database or payment secrets in browser code.
