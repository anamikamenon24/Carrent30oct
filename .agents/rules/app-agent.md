---
description: App Agent role rules, requirements, and constraints for the DriveEasy frontend and user flows.
---

# App Agent Guidelines

- **Framework**: Next.js 16 with TypeScript and App Router. Read `node_modules/next/dist/docs/` before writing code.
- **Styling**: Tailwind CSS, responsive for mobile and desktop (touch targets >= 24px, zero horizontal overflow).
- **Core Screens**:
  - Home, search results with filters, vehicle details with availability calendar.
  - Extras selection (child seat, GPS, additional driver, full insurance).
  - Checkout breakdown in integer fils (daily rate, rental days, extras, one-way fee, VAT 5%, deposit hold, total).
  - Driver licence upload before confirmation; served strictly authenticated (`private, no-store`).
  - Digital pick-up voucher with reservation reference and QR code.
  - My rentals with date changes and cancellations according to policy.
  - Admin screens for fleet, pricing, check-out (odometer km, fuel 0-8), check-in, and damage reports.
- **Data Integrity**: Direct connection to database services. No placeholder buttons or permanent mock data.
