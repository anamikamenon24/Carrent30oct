"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { createHoldAction, type HoldState } from "./actions";

/** "Continue to checkout": creates the reservation hold with the chosen trip and extras. */
export function HoldForm({
  fields,
  signedIn,
  disabled,
}: {
  fields: Record<string, string>;
  signedIn: boolean;
  disabled?: boolean;
}) {
  const [state, action] = useActionState<HoldState, FormData>(createHoldAction, {});
  return (
    <form action={action} className="space-y-3" data-testid="hold-form">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.error && (
        <Alert tone="error" testId="hold-error">
          {state.error}
        </Alert>
      )}
      <SubmitButton className="btn-primary w-full py-3" pendingText="Reserving your car…" testId="continue-to-checkout" disabled={disabled}>
        {signedIn ? "Continue to checkout" : "Sign in to continue"}
      </SubmitButton>
      <p className="text-center text-xs text-muted">We hold the car for you while you complete checkout.</p>
    </form>
  );
}
