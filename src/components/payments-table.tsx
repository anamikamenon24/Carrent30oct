import { formatAED, formatDateTime, titleCase } from "@/lib/format";

interface PaymentLike {
  id: string;
  kind: string;
  status: string;
  amountFils: number;
  refundedFils: number;
  createdAt: Date;
  failureReason: string | null;
}
interface DepositLike {
  id: string;
  status: string;
  amountFils: number;
  capturedFils: number;
  createdAt: Date;
}

/** Payments and deposit holds for a reservation. */
export function PaymentsTable({ payments, deposits, timeZone }: { payments: PaymentLike[]; deposits: DepositLike[]; timeZone: string }) {
  if (payments.length === 0 && deposits.length === 0) return <p className="text-sm text-muted">No payments yet.</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Status</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} data-testid="payment-row" data-status={p.status} data-fils={p.amountFils}>
              <td className="whitespace-nowrap">{formatDateTime(p.createdAt, timeZone)}</td>
              <td>{p.kind === "RENTAL" ? "Rental payment" : p.kind === "MODIFICATION" ? "Date change" : "Return charges"}</td>
              <td>
                {titleCase(p.status)}
                {p.failureReason && <span className="block text-xs text-red-700">{p.failureReason}</span>}
                {p.refundedFils > 0 && <span className="block text-xs text-muted">Refunded {formatAED(p.refundedFils)}</span>}
              </td>
              <td className="text-right tabular-nums">{formatAED(p.amountFils)}</td>
            </tr>
          ))}
          {deposits.map((d) => (
            <tr key={d.id} data-testid="deposit-row" data-status={d.status}>
              <td className="whitespace-nowrap">{formatDateTime(d.createdAt, timeZone)}</td>
              <td>Security deposit (hold)</td>
              <td>
                {titleCase(d.status)}
                {d.capturedFils > 0 && <span className="block text-xs text-muted">Kept {formatAED(d.capturedFils)}</span>}
              </td>
              <td className="text-right tabular-nums">{formatAED(d.amountFils)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
