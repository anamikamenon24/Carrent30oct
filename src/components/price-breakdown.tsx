import { formatAED } from "@/lib/format";

export interface PriceLines {
  rentalDays: number;
  dailyRateFils: number;
  rentalFils: number;
  discountFils: number;
  extras: { code: string; name: string; quantity: number; totalFils: number }[];
  extrasFils: number;
  oneWayFeeFils: number;
  vatBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
}

function Row({
  label,
  fils,
  testId,
  sub,
  negative,
  value,
}: {
  label: React.ReactNode;
  fils: number;
  testId: string;
  sub?: React.ReactNode;
  negative?: boolean;
  value?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5" data-testid={testId} data-fils={fils}>
      <dt className="text-muted">
        {label}
        {sub && <span className="block text-xs">{sub}</span>}
      </dt>
      <dd className={`text-right font-medium tabular-nums ${negative ? "text-emerald-700" : ""}`}>
        {value ?? (negative ? `− ${formatAED(fils)}` : formatAED(fils))}
      </dd>
    </div>
  );
}

/** Full price breakdown. Every line has a data-testid and data-fils (integer) for testing. */
export function PriceBreakdown({ price, title = "Price breakdown" }: { price: PriceLines; title?: string }) {
  const vatPct = (price.vatBps / 100).toLocaleString("en", { maximumFractionDigits: 2 });
  return (
    <section aria-labelledby="price-title" className="text-sm" data-testid="price-breakdown">
      <h2 id="price-title" className="mb-2 text-base font-semibold">
        {title}
      </h2>
      <dl className="divide-y divide-line/60">
        <Row label="Daily rate" fils={price.dailyRateFils} testId="price-daily-rate" />
        <div className="flex justify-between py-1.5" data-testid="price-days" data-value={price.rentalDays}>
          <dt className="text-muted">Rental days</dt>
          <dd className="font-medium tabular-nums">{price.rentalDays}</dd>
        </div>
        <Row label="Rental" sub={`${price.rentalDays} × daily rate (incl. seasonal rates)`} fils={price.rentalFils} testId="price-rental" />
        {price.discountFils > 0 && <Row label="Long-rental discount" fils={price.discountFils} testId="price-discount" negative />}
        {price.extras.map((e) => (
          <Row
            key={e.code}
            label={e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name}
            fils={e.totalFils}
            testId={`price-extra-${e.code}`}
          />
        ))}
        <Row label="Extras total" fils={price.extrasFils} testId="price-extras-total" />
        <Row label="One-way fee" fils={price.oneWayFeeFils} testId="price-one-way-fee" />
        <Row label={`VAT (${vatPct}%)`} fils={price.vatFils} testId="price-vat" />
      </dl>
      <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink/10 pt-3" data-testid="price-total" data-fils={price.totalFils}>
        <span className="text-base font-semibold">Total to pay</span>
        <span className="text-xl font-bold tabular-nums">{formatAED(price.totalFils)}</span>
      </div>
      <div
        className="mt-3 flex items-start justify-between gap-4 rounded-lg bg-sand-50 px-3 py-2"
        data-testid="price-deposit"
        data-fils={price.depositFils}
      >
        <span>
          <span className="font-medium">Refundable security deposit</span>
          <span className="block text-xs text-muted">Held on your card, not charged. Released after return.</span>
        </span>
        <span className="font-semibold tabular-nums">{formatAED(price.depositFils)}</span>
      </div>
    </section>
  );
}
