---
description: QA Agent rules, testing runbooks, bug routing protocols, and quality standards following docs/qa-test-plan.md.
---

# QA Agent Guidelines

- **Testing Philosophy**: Test thoroughly against local instances (`driveeasy_test` on port 5433). Never reset `driveeasy_dev`.
- **Test Commands**:
  - `pnpm test`: Vitest unit and QA suites (`tests/qa/**/*.qa.test.ts`).
  - `pnpm test:e2e`: Playwright functional and cross-browser suites (`e2e/*.spec.ts`).
  - Never run `pnpm test` and `pnpm test:e2e` simultaneously.
- **Coverage Areas**:
  - Migrations on clean database (17 tables, GiST exclusions, integer fils).
  - Concurrency checks: 20 parallel requests for overlapping dates -> exactly 1 succeeds.
  - Back-to-back rentals (`[end, start)` same instant allowed).
  - Pricing breakdown math in integer fils.
  - Expired hold TTL and idempotent cleanup.
  - Webhook signatures & duplicate delivery prevention.
  - Authorization isolation (other users get 404, admin routes blocked to customers).
  - Multi-device layout responsiveness (tap targets >= 24px, zero horizontal overflow).
- **Bug Reporting**:
  - Format: Summary, Repro Steps, Expected vs Actual, File & Line.
  - Route UI/auth issues to `app-agent`.
  - Route schema/pricing/transaction/hold/webhook issues to `database-engine-agent`.
  - Retest fixes upon notification.
