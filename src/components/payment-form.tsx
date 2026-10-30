"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED } from "@/lib/format";

export interface PayState {
  error?: string;
  /** Fresh idempotency key for the next attempt after a failed one. */
  nextKey?: string;
}

const METHODS = [
  { value: "pm_fake_success", label: "Test card – succeeds", last4: "4242" },
  { value: "pm_fake_fail", label: "Test card – declined", last4: "0002" },
  { value: "pm_fake_cancel", label: "Test card – abandoned", last4: "9995" },
];

/**
 * Pay for a held reservation. Locally this uses the fake payment provider's test cards; the
 * idempotency key is generated once per page view so double-clicks and retries cannot double-charge.
 */
export function PaymentForm({
  action,
  reservationId,
  totalFils,
  depositFils,
  idempotencyKey,
  disabled,
  disabledReason,
}: {
  action: (state: PayState, formData: FormData) => Promise<PayState>;
  reservationId: string;
  totalFils: number;
  depositFils: number;
  idempotencyKey: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4" data-testid="payment-form">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="idempotencyKey" value={state.nextKey ?? idempotencyKey} />
      {state.error && (
        <Alert tone="error" title="Payment not completed" testId="payment-error">
          {state.error}
        </Alert>
      )}
      <div>
        <label htmlFor="payment-method" className="label">
          Card
        </label>
        <select id="payment-method" name="paymentMethod" className="input" defaultValue={METHODS[0].value} data-testid="payment-method">
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label} (•••• {m.last4})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Local test mode: no real card is charged.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="terms"
          required
          className="mt-0.5 size-4 accent-brand-600"
          data-testid="accept-terms"
        />
        <span>
          I agree to the rental terms and the cancellation policy, and authorise a refundable deposit hold of{" "}
          <strong>{formatAED(depositFils)}</strong>.
        </span>
      </label>
      {disabled && disabledReason && <Alert tone="warning">{disabledReason}</Alert>}
      <SubmitButton className="btn-primary w-full py-3 text-base" pendingText="Processing payment…" testId="pay-button" disabled={disabled}>
        Pay {formatAED(totalFils)}
      </SubmitButton>
    </form>
  );
}
