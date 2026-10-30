---
description: Database Engine Agent rules, constraints, schema standards, and transactional flows.
---

# Database Engine Agent Guidelines

- **Database**: Neon PostgreSQL via Drizzle ORM.
- **17 Tables**: `users`, `driver_profiles`, `branches`, `vehicle_categories`, `vehicles`, `vehicle_features`, `vehicle_feature_map`, `pricing_rules`, `extras`, `reservations`, `reservation_extras`, `payments`, `deposits`, `rental_agreements`, `damage_reports`, `maintenance_blocks`, `audit_logs`.
- **Database Rules**:
  - UUID primary keys for all entities.
  - UTC timestamps (`timestamptz`); display in local branch time zone.
  - Minor integer units for money (AED in fils: 1 AED = 100 fils). No floating-point.
  - Exclusion constraint (`vehicle_occupancy_no_overlap`) preventing overlapping active reservations (`PENDING`, `CONFIRMED`, `PICKED_UP`) and maintenance blocks on the same vehicle.
  - Status enums for vehicles (`AVAILABLE`, `RESERVED`, `ON_RENT`, `MAINTENANCE`, `RETIRED`) and reservations (`PENDING`, `CONFIRMED`, `PICKED_UP`, `RETURNED`, `CANCELLED`, `EXPIRED`, `REFUNDED`).
  - Separate payment and deposit statuses.
- **Transactions & Pricing**:
  - Atomic reservation holds with TTL (`createReservationHold`).
  - Server-side calculation only (`src/server/pricing`).
  - Idempotent expired-hold release (`release-expired-holds`).
  - Webhook replay protection using provider event IDs.
