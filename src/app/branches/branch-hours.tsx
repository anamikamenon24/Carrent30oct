import { timeZoneLabel } from "@/lib/format";
import type { Branch } from "@/server/data/catalog";

export function branchHours(b: Pick<Branch, "is24Hours" | "opensAt" | "closesAt">): string {
  return b.is24Hours ? "Open 24 hours" : `${b.opensAt.slice(0, 5)}–${b.closesAt.slice(0, 5)} daily`;
}

export function BranchHours({ branch }: { branch: Branch }) {
  return (
    <span>
      {branchHours(branch)} <span className="text-muted">({timeZoneLabel(branch.timeZone)})</span>
    </span>
  );
}
