import Link from "next/link";

export function EmptyState({
  title,
  description,
  action,
  testId = "empty-state",
}: {
  title: string;
  description?: React.ReactNode;
  action?: { href: string; label: string };
  testId?: string;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center" data-testid={testId}>
      <div className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {description && <div className="mt-1 max-w-md text-sm text-muted">{description}</div>}
      {action && (
        <Link href={action.href} className="btn-primary mt-6">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-line/70 ${className}`} aria-hidden />;
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-sm font-medium text-brand-700">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-emerald-100 text-emerald-900",
  PICKED_UP: "bg-sky-100 text-sky-900",
  RETURNED: "bg-slate-100 text-slate-800",
  CANCELLED: "bg-red-100 text-red-800",
  EXPIRED: "bg-zinc-100 text-zinc-700",
  REFUNDED: "bg-violet-100 text-violet-900",
  AVAILABLE: "bg-emerald-100 text-emerald-900",
  RESERVED: "bg-amber-100 text-amber-900",
  ON_RENT: "bg-sky-100 text-sky-900",
  MAINTENANCE: "bg-orange-100 text-orange-900",
  RETIRED: "bg-zinc-100 text-zinc-700",
};

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  const label = status
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return (
    <span className={`badge ${STATUS_TONES[status] ?? "bg-zinc-100 text-zinc-700"}`} data-testid={testId} data-status={status}>
      {label}
    </span>
  );
}
