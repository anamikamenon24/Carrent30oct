import { VehicleVisual } from "@/components/vehicle-visual";
import { formatDateTime, titleCase } from "@/lib/format";

export interface ReservationSummaryData {
  vehicle: { make: string; model: string; year: number; photos: string[]; color: string | null; seats: number; transmission: string; fuelType: string; category: { name: string } };
  pickupBranch: { name: string; addressLine: string; city: string; timeZone: string };
  returnBranch: { name: string; addressLine: string; city: string; timeZone: string };
  reservation: { pickupAt: Date; returnAt: Date; reference: string };
}

export function ReservationSummary({ d, showImage = true }: { d: ReservationSummaryData; showImage?: boolean }) {
  const { vehicle: v, pickupBranch: pb, returnBranch: rb, reservation: r } = d;
  return (
    <div className="card overflow-hidden" data-testid="reservation-summary">
      {showImage && (
        <div className="aspect-[16/7]">
          <VehicleVisual photos={v.photos} color={v.color} alt={`${v.make} ${v.model}`} />
        </div>
      )}
      <div className="space-y-3 p-4 text-sm">
        <div>
          <p className="text-base font-semibold">
            {v.make} {v.model} <span className="font-normal text-muted">{v.year}</span>
          </p>
          <p className="text-muted">
            {v.category.name} · {v.seats} seats · {titleCase(v.transmission)} · {titleCase(v.fuelType)}
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-muted uppercase">Pick-up</dt>
            <dd data-testid="summary-pickup">
              <span className="font-medium">{formatDateTime(r.pickupAt, pb.timeZone)}</span>
              <span className="block">{pb.name}</span>
              <span className="block text-muted">
                {pb.addressLine}, {pb.city}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted uppercase">Return</dt>
            <dd data-testid="summary-return">
              <span className="font-medium">{formatDateTime(r.returnAt, rb.timeZone)}</span>
              <span className="block">{rb.name}</span>
              <span className="block text-muted">
                {rb.addressLine}, {rb.city}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
