export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13" strokeLinejoin="round" />
          <rect x="3" y="13" width="18" height="5" rx="1.5" />
          <circle cx="7.5" cy="18" r="1.5" fill="currentColor" />
          <circle cx="16.5" cy="18" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-ink">
        Drive<span className="text-brand-600">Easy</span>
      </span>
    </span>
  );
}
