"use client";

import Form from "next/form";
import { useRef } from "react";
import { formatAED } from "@/lib/format";

export interface ExtraOption {
  code: string;
  name: string;
  description: string | null;
  pricing: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxQuantity: number;
}

/**
 * Extras selection. A GET form that re-submits on every change so the server recomputes the
 * quote shown next to it (prices are never calculated in the browser).
 * Fields: extra=<code> (repeated) and qty_<code>=<n>.
 */
export function ExtrasPicker({
  action,
  hidden,
  extras,
  selected,
}: {
  action: string;
  hidden: Record<string, string>;
  extras: ExtraOption[];
  selected: Record<string, number>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => ref.current?.requestSubmit();

  return (
    <Form ref={ref} action={action} scroll={false} replace className="space-y-3" data-testid="extras-form">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {extras.map((x) => {
        const qty = selected[x.code] ?? 0;
        const on = qty > 0;
        return (
          <div
            key={x.code}
            className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${on ? "border-brand-500 bg-brand-50/60" : "border-line bg-white"}`}
          >
            <input
              id={`extra-${x.code}`}
              type="checkbox"
              name="extra"
              value={x.code}
              defaultChecked={on}
              onChange={submit}
              className="mt-1 size-4 accent-brand-600"
              data-testid={`extra-${x.code}`}
            />
            <label htmlFor={`extra-${x.code}`} className="flex-1 cursor-pointer">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{x.name}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatAED(x.priceFils)}
                  <span className="font-normal text-muted"> {x.pricing === "PER_DAY" ? "/ day" : "/ rental"}</span>
                </span>
              </span>
              {x.description && <span className="mt-0.5 block text-sm text-muted">{x.description}</span>}
            </label>
            {x.maxQuantity > 1 && (
              <div>
                <label htmlFor={`qty-${x.code}`} className="sr-only">
                  {x.name} quantity
                </label>
                <select
                  id={`qty-${x.code}`}
                  name={`qty_${x.code}`}
                  defaultValue={String(Math.max(qty, 1))}
                  onChange={submit}
                  disabled={!on}
                  className="input w-16 py-1"
                  data-testid={`extra-qty-${x.code}`}
                >
                  {Array.from({ length: x.maxQuantity }, (_, i) => (
                    <option key={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
      <noscript>
        <button type="submit" className="btn-secondary">
          Update price
        </button>
      </noscript>
    </Form>
  );
}
