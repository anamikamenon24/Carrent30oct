export type ReservationErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  /** The vehicle is booked or in maintenance for (part of) the period, or not at the pick-up branch then. */
  | "VEHICLE_UNAVAILABLE"
  /** The vehicle is retired or in the workshop. */
  | "VEHICLE_NOT_RENTABLE"
  | "BRANCH_CLOSED"
  | "IDEMPOTENCY_CONFLICT"
  | "HOLD_EXPIRED"
  | "INVALID_STATE"
  | "POLICY_VIOLATION"
  | "DRIVER_PROFILE_REQUIRED"
  | "DRIVER_NOT_ELIGIBLE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "PROVIDER_ERROR";

/** A domain error with a stable `code`; `message` is safe to show to the user. */
export class ReservationError extends Error {
  constructor(
    readonly code: ReservationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

export function isReservationError(err: unknown, code?: ReservationErrorCode): err is ReservationError {
  return err instanceof ReservationError && (code === undefined || err.code === code);
}

/** Suggested HTTP status for a code (for route handlers / server actions). */
export function httpStatusFor(code: ReservationErrorCode): number {
  switch (code) {
    case "VALIDATION":
    case "BRANCH_CLOSED":
    case "DRIVER_NOT_ELIGIBLE":
    case "POLICY_VIOLATION":
      return 422;
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "PAYMENT_REQUIRED":
    case "PAYMENT_FAILED":
      return 402;
    case "PROVIDER_ERROR":
      return 502;
    default:
      return 409;
  }
}

/** Postgres error codes we translate. */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  // Drizzle wraps driver errors in `cause`.
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";
