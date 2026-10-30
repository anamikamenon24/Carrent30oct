import Link from "next/link";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatDateTime, titleCase } from "@/lib/format";
import type { BookingContext } from "./booking-context";

/** Car + trip summary card shown beside the booking steps. */
export function TripSummary({ ctx, editHref }: { ctx: BookingContext; editHref?: string }) {
  const { vehicle, pickupBranch, returnBranch, start, end } = ctx;
  return (
    <div className="card overflow-hidden" data-testid="trip-summary">
      <div className="aspect-[16/7]">
        <VehicleVisual photos={vehicle.photos} color={vehicle.color} alt={`${vehicle.make} ${vehicle.model}`} />
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div>
          <p className="text-base font-semibold">
            {vehicle.make} {vehicle.model} <span className="font-normal text-muted">{vehicle.year}</span>
          </p>
          <p className="text-muted">
            {vehicle.category.name} · {vehicle.seats} seats · {titleCase(vehicle.transmission)} · {titleCase(vehicle.fuelType)}
          </p>
        </div>
        <dl className="grid gap-2">
          <div>
            <dt className="text-xs font-semibold text-muted uppercase">Pick-up</dt>
            <dd>
              {pickupBranch.name}
              <span className="block text-muted">{formatDateTime(start, pickupBranch.timeZone)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted uppercase">Return</dt>
            <dd>
              {returnBranch.name}
              <span className="block text-muted">{formatDateTime(end, returnBranch.timeZone)}</span>
            </dd>
          </div>
        </dl>
        {editHref && (
          <Link href={editHref} className="text-sm font-medium text-brand-700 hover:underline">
            Change dates or branches
          </Link>
        )}
      </div>
    </div>
  );
}
