import Link from "next/link";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatAED, titleCase } from "@/lib/format";

export interface VehicleCardData {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  transmission: string;
  fuelType: string;
  seats: number;
  doors: number;
  luggage: number;
  photos: string[];
  categoryName: string;
  dailyRateFils: number;
  /** Estimated rental cost for the searched dates (before extras and VAT), if dates were given. */
  rentalFils?: number;
  rentalDays?: number;
}

export function VehicleCard({ v, href }: { v: VehicleCardData; href: string }) {
  const name = `${v.make} ${v.model}`;
  return (
    <article className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md" data-testid="vehicle-card" data-vehicle-id={v.id} data-daily-fils={v.dailyRateFils}>
      <div className="relative aspect-[16/9] overflow-hidden">
        <VehicleVisual photos={v.photos} color={v.color} alt={`${name} ${v.year}`} className="transition-transform group-hover:scale-[1.02]" />
        <span className="badge absolute top-3 left-3 bg-white/90 text-ink shadow-sm">{v.categoryName}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-lg font-semibold">
          <Link href={href} className="hover:text-brand-700">
            {name}
          </Link>{" "}
          <span className="text-sm font-normal text-muted">{v.year}</span>
        </h3>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          <li>{v.seats} seats</li>
          <li>{titleCase(v.transmission)}</li>
          <li>{titleCase(v.fuelType)}</li>
          <li>{v.luggage} bags</li>
        </ul>
        <div className="mt-auto flex items-end justify-between pt-4">
          <div>
            <p className="text-xl font-bold tabular-nums">
              {formatAED(v.dailyRateFils)}
              <span className="text-sm font-normal text-muted"> / day</span>
            </p>
            {v.rentalFils !== undefined && v.rentalDays !== undefined && (
              <p className="text-xs text-muted">
                {formatAED(v.rentalFils)} for {v.rentalDays} {v.rentalDays === 1 ? "day" : "days"} + VAT
              </p>
            )}
          </div>
          <Link href={href} className="btn-primary" data-testid="vehicle-card-view">
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
