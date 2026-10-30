# DriveEasy team brief

Team name: **DriveEasy**, three agents: App Agent, Database Engine Agent, QA Agent.

Goal: build a production-ready car rental web app and prepare it for deployment on Vercel.

## Decisions (agreed with the owner, 30 Oct 2026)

- **Local first.** Build and test everything locally. Do not create, log in to, or deploy to any
  cloud account (Vercel, Neon, Blob, payment provider). The owner will supply cloud links later.
- Use the local stand-ins already in `src/server/services` and `src/server/jobs`
  (fake payments, private local uploads, local job runner). Add the cloud implementations
  (Neon, Vercel Blob, real payment provider in test mode, Vercel Cron) behind the same
  interfaces so switching is a settings change. Wire them up, but do not run them against real services.
- Prepare deployment (`vercel.json`, cron config, migration-on-deploy step, README) but stop
  before the actual deploy, Neon provisioning and webhook-secret configuration.
- Local database: dedicated PostgreSQL 18.6 instance on port 5433 (`pnpm db:start`),
  databases `driveeasy_dev` and `driveeasy_test`, btree_gist installed in both.
- `RESERVERESERVED` in the original brief is a typo for `RESERVED`.
- Currency is AED, stored as integer fils.
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before writing code (see AGENTS.md).

## Technology

- Next.js with TypeScript and App Router
- Tailwind CSS
- Neon serverless PostgreSQL from Vercel Marketplace
- Drizzle ORM with migrations
- Secure authentication
- Vercel Functions for backend operations
- Vercel Blob for vehicle photos, driving-licence uploads and damage-report images
- Payment provider in test mode, supporting both charges and refundable security-deposit holds
- Never expose database or payment secrets in browser code

## Agent 1 – App Agent

- Build a polished responsive car-rental interface
- Create home, search results, vehicle details, branch, date selection, extras, checkout, pick-up
  voucher, my rentals, profile, login, and admin pages
- Let users search and filter vehicles by pick-up branch, return branch, dates and times, category,
  transmission, seats, fuel type, and price
- Show accurate vehicle availability for the chosen date range, with an availability calendar per vehicle
- Let users add extras such as child seat, GPS, additional driver, and full insurance cover
- Display daily rate, number of days, extras, one-way fee, taxes, security deposit, and final total
  before payment
- Collect driver details and driving-licence upload before confirming the rental
- Generate a digital pick-up voucher with reservation reference and QR code
- Allow users to view, modify dates, and cancel eligible reservations according to the cancellation policy
- Give admins screens to manage branches, fleet, pricing, reservations, check-out, check-in, and
  damage reports
- Connect every screen to the real database
- Do not use permanent mock data or placeholder buttons
- Optimize the application for desktop and mobile

## Agent 2 – Database Engine Agent

Use Neon PostgreSQL and create migrations for:
users, driver_profiles, branches, vehicle_categories, vehicles, vehicle_features,
vehicle_feature_map, pricing_rules, extras, reservations, reservation_extras, payments, deposits,
rental_agreements, damage_reports, maintenance_blocks, audit_logs.

### Database rules

- Use UUID primary keys
- Store all timestamps in UTC; display them in the branch's local time zone
- Store money as integer minor units (fils for AED), never floating-point values
- Add foreign keys, validation constraints, indexes, and appropriate cascade rules
- Create unique constraints for vehicle plate numbers, VINs, and branch codes
- Store each rental period as a time range and use a PostgreSQL exclusion constraint so the same
  vehicle can never have two overlapping active reservations or maintenance blocks
- Store vehicle status as AVAILABLE, RESERVED, ON_RENT, MAINTENANCE, or RETIRED
- Store reservation status as PENDING, CONFIRMED, PICKED_UP, RETURNED, CANCELLED, EXPIRED, or REFUNDED
- Store payment status and deposit status separately from reservation status
- Record mileage and fuel level at pick-up and return in the rental agreement

### Reservation transaction

1. Begin a database transaction
2. Lock the requested vehicle record
3. Confirm the vehicle has no overlapping reservation or maintenance block for the requested period
4. Create a temporary hold with an expiration time
5. Calculate the rental price, extras, fees, taxes, and deposit on the server
6. Create the pending reservation
7. Commit the transaction
8. Confirm the reservation only after verified payment and deposit authorisation
9. Use payment idempotency keys so retries cannot create duplicate reservations
10. Reject the reservation if the vehicle is no longer available for the selected period

Create a secure server-side endpoint for releasing expired holds. Make the operation idempotent so
repeated runs are safe. If using Vercel Cron, protect the route with CRON_SECRET.

## Agent 3 – QA Agent

- Test registration, login, logout, and authorization
- Test vehicle search, branch selection, date ranges, filters, and availability calendars
- Test complete rentals from search through payment, pick-up voucher, check-out, and return
- Attempt to reserve the same vehicle for overlapping dates from two sessions at the same time;
  confirm only one reservation succeeds
- Test back-to-back rentals where one ends exactly when the next begins
- Test expired holds and automatic release
- Verify daily rates, extras, one-way fees, taxes, late-return charges, and deposit amounts
- Test payment success, failure, cancellation, retry, refund, deposit release, and duplicate webhook delivery
- Confirm users cannot access another user's reservations, vouchers, or licence uploads
- Test admin permissions for fleet, pricing, check-in, and damage reports
- Test database migrations on a clean database
- Test Vercel preview and production builds (locally: `next build` with preview and production settings)
- Test desktop and mobile layouts
- Report every bug to the responsible agent and retest each fix

## Deployment requirements (prepare now, execute when cloud links arrive)

- Deploy the Next.js application to Vercel
- Provision Neon PostgreSQL through Vercel Marketplace
- Use pooled DATABASE_URL for application requests
- Keep migration credentials and production secrets server-side
- Configure separate preview and production environments
- Run migrations safely during deployment
- Configure payment webhook secrets
- Protect scheduled cleanup endpoints
- Keep licence uploads private and serve them only to the owner and admins
- Add error handling, loading states, empty states, and structured server logs
- Create a README containing local setup, environment variables, migrations, testing, and Vercel
  deployment instructions
