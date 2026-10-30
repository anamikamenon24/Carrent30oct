const STEPS = ["Dates", "Extras", "Driver & payment", "Voucher"];

export function BookingSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-sm" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
              i < current ? "bg-brand-600 text-white" : i === current ? "bg-brand-100 text-brand-800 ring-2 ring-brand-600" : "bg-line text-muted"
            }`}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span className={i === current ? "font-semibold" : "text-muted"}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
