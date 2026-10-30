"use client";

import { useEffect, useState } from "react";

/** Live "time left to pay" for a reservation hold. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (now === null) return <span className="tabular-nums">…</span>;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  if (left === 0) {
    return (
      <span role="alert" className="font-semibold text-red-700" data-testid="hold-expired">
        Your hold has expired. Reload the page or start a new search.
      </span>
    );
  }
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <span className={`font-semibold tabular-nums ${left < 120 ? "text-red-700" : ""}`} data-testid="hold-countdown">
      {m}:{s}
    </span>
  );
}
