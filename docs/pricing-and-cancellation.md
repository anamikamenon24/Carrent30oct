# Pricing, holds and cancellation policy

All amounts are AED in integer fils (1 AED = 100 fils). All prices are calculated on the server
(`src/server/pricing`, `src/server/reservations`); the browser never sends a price.

## Price of a rental

| Line | Rule |
| --- | --- |
| Rental days | `ceil((return - pick-up - 59 min) / 24 h)`, minimum 1. 24 h 59 min = 1 day, 25 h = 2 days. |
| Daily rate | The vehicle's own rate if set, otherwise its category's rate. |
| Seasonal rules | Rental day *i* starts at pick-up + *i* × 24 h. If its local date (pick-up branch time zone) falls in a `SEASONAL` rule's date range, the rate is adjusted by the rule's basis points (+2000 = +20 %). Highest priority wins. |
| Duration discount | The `DURATION_DISCOUNT` rule with the largest `min_days` ≤ days takes its percentage off the rental (not off extras or fees). |
| Extras | `PER_DAY`: price × quantity × days. `PER_RENTAL`: price × quantity. Quantity 1 to the extra's `max_quantity`. |
| One-way fee | Only when the return branch differs. The most specific `ONE_WAY_FEE` rule wins (both branches set > one set > catch-all; a category match breaks ties). No matching rule = no fee. |
| VAT | 5 % of (rental − discount + extras + one-way fee). |
| Total | rental − discount + extras + one-way fee + VAT. Charged when paying. |
| Security deposit | The category's `deposit_fils`. Authorised (held) on the card, not charged, not taxed. |

Rounding is half away from zero to whole fils, per line.

## Holds and confirmation

1. `createReservationHold` locks the vehicle row, rejects overlaps with active reservations
   (`PENDING`, `CONFIRMED`, `PICKED_UP`) and maintenance blocks, prices the rental and inserts a
   `PENDING` reservation that holds the vehicle for `RESERVATION_HOLD_MINUTES` (default 15).
2. `payReservation` charges the total and places the deposit hold (each with its own idempotency key),
   then confirms. Retries with the same key never charge twice. A reservation is `CONFIRMED` only when a
   rental payment for the full total has `SUCCEEDED` and the deposit is `HELD`.
3. Webhooks (`POST /api/webhooks/payments`) apply the same rule; each provider event id is processed once.
4. Lapsed holds stop blocking the vehicle immediately (searches and new bookings ignore them) and are
   marked `EXPIRED` by the `release-expired-holds` job, which also refunds any money and releases any
   deposit for reservations that will not go ahead.

The database is the final guard: `vehicle_occupancy_no_overlap` (an exclusion constraint) makes it
impossible to store two overlapping active reservations or maintenance blocks for one vehicle.
Periods are `[pick-up, return)`, so back-to-back rentals are allowed.

## Cancellation policy

| When | Fee kept | Refund |
| --- | --- | --- |
| Unpaid hold (`PENDING`) | none | nothing was charged |
| 48 h or more before pick-up | none | 100 % |
| 24 h to 48 h before pick-up | one day's rental at the base daily rate, plus VAT (capped at the total) | the rest |
| Less than 24 h before pick-up | 50 % of the total | 50 % |
| After the pick-up time, or once picked up | cannot be cancelled online | — |

The deposit hold is always released in full on cancellation. A cancelled reservation becomes
`REFUNDED` once a refund has been issued, otherwise it stays `CANCELLED`. Admins can cancel with the fee
waived (also after the pick-up time, e.g. for no-shows they choose to waive).

## Changing dates

- `PENDING` (unpaid): any time before pick-up; just re-priced.
- `CONFIRMED`: up to 24 h before the current pick-up, same vehicle and branches, subject to availability.
  A higher price is charged first (payment method required); a lower price is refunded after the change.
  The deposit agreed at payment does not change.

## Pick-up and return

- Check-out opens 2 h before the booked pick-up time. Staff record odometer (km) and fuel (eighths, 0–8).
- At return: late fee if more than 59 minutes late — each started hour costs 25 % of the daily rate,
  capped at one daily rate per started 24 h; refuelling at AED 50 per missing eighth of a tank; plus any
  damage charges recorded on damage reports. VAT 5 % is added. The total is captured from the deposit hold
  (the rest is released); anything above the deposit is recorded as outstanding on the rental agreement.
