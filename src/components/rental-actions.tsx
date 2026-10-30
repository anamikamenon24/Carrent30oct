"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export interface RentalActionState {
  error?: string;
  message?: string;
}

/** Cancel button with an inline confirmation that states the fee and refund before anything happens. */
export function CancelReservation({
  action,
  reservationId,
  summary,
}: {
  action: (s: RentalActionState, f: FormData) => Promise<RentalActionState>;
  reservationId: string;
  summary: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  if (!open) {
    return (
      <button type="button" className="btn-secondary text-red-700" onClick={() => setOpen(true)} data-testid="cancel-reservation-button">
        Cancel reservation
      </button>
    );
  }
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4" data-testid="cancel-confirm-panel">
      <input type="hidden" name="reservationId" value={reservationId} />
      <p className="font-semibold text-red-900">Cancel this reservation?</p>
      <div className="text-sm text-red-900">{summary}</div>
      <label className="block text-sm">
        <span className="label">Reason (optional)</span>
        <input name="reason" maxLength={200} className="input" placeholder="e.g. Plans changed" />
      </label>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn-danger" pendingText="Cancelling…" testId="confirm-cancel">
          Yes, cancel reservation
        </SubmitButton>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Keep reservation
        </button>
      </div>
    </form>
  );
}

/** Shows server-side action results (used by forms that redirect on success but return errors). */
export function ActionForm({
  action,
  children,
  className,
  testId,
}: {
  action: (s: RentalActionState, f: FormData) => Promise<RentalActionState>;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {state.error && (
        <Alert tone="error" className="mb-3">
          {state.error}
        </Alert>
      )}
      {state.message && (
        <Alert tone="success" className="mb-3">
          {state.message}
        </Alert>
      )}
      {children}
    </form>
  );
}
