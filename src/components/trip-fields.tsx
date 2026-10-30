"use client";

import { useId, useState } from "react";

export interface BranchOption {
  code: string;
  name: string;
  city: string;
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/**
 * Pick-up/return branch and date/time inputs. Field names: pickup, dropoff, startDate, startTime, endDate, endTime
 * (the search and booking pages accept these as well as combined `start`/`end`).
 */
export function TripFields({
  branches,
  pickup,
  dropoff,
  start,
  end,
  minDate,
  layout = "grid",
  showBranches = true,
}: {
  branches: BranchOption[];
  pickup?: string;
  dropoff?: string;
  start: string;
  end: string;
  minDate: string;
  layout?: "grid" | "stack";
  showBranches?: boolean;
}) {
  const id = useId();
  const [startDate, setStartDate] = useState(start.slice(0, 10));
  const [startTime, setStartTime] = useState(start.slice(11, 16));
  const [endDate, setEndDate] = useState(end.slice(0, 10));
  const [endTime, setEndTime] = useState(end.slice(11, 16));
  const [sameReturn, setSameReturn] = useState(!dropoff || dropoff === pickup);

  const invalid = `${endDate}T${endTime}` <= `${startDate}T${startTime}`;
  const grid = layout === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-3";

  return (
    <div className="space-y-3">
      {showBranches && (
        <div className={layout === "grid" ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
          <div>
            <label htmlFor={`${id}-pickup`} className="label">
              Pick-up branch
            </label>
            <select id={`${id}-pickup`} name="pickup" defaultValue={pickup ?? ""} required className="input" data-testid="field-pickup">
              <option value="" disabled>
                Choose a branch
              </option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.city})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-dropoff`} className="label">
              Return branch
            </label>
            <select
              id={`${id}-dropoff`}
              name="dropoff"
              defaultValue={sameReturn ? "" : dropoff}
              className="input"
              onChange={(e) => setSameReturn(e.target.value === "")}
              data-testid="field-dropoff"
            >
              <option value="">Same as pick-up</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.city})
                </option>
              ))}
            </select>
            {!sameReturn && <p className="mt-1 text-xs text-amber-700">A one-way fee may apply.</p>}
          </div>
        </div>
      )}
      <div className={grid}>
        <div>
          <label htmlFor={`${id}-sd`} className="label">
            Pick-up date
          </label>
          <input
            id={`${id}-sd`}
            type="date"
            name="startDate"
            required
            min={minDate}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value && e.target.value > endDate) setEndDate(e.target.value);
            }}
            className="input"
            data-testid="field-start-date"
          />
        </div>
        <div>
          <label htmlFor={`${id}-st`} className="label">
            Pick-up time
          </label>
          <select id={`${id}-st`} name="startTime" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" data-testid="field-start-time">
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-ed`} className="label">
            Return date
          </label>
          <input
            id={`${id}-ed`}
            type="date"
            name="endDate"
            required
            min={startDate || minDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
            aria-invalid={invalid || undefined}
            data-testid="field-end-date"
          />
        </div>
        <div>
          <label htmlFor={`${id}-et`} className="label">
            Return time
          </label>
          <select id={`${id}-et`} name="endTime" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input" data-testid="field-end-time">
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      {invalid && (
        <p role="alert" className="text-sm font-medium text-red-700">
          Return must be after pick-up.
        </p>
      )}
    </div>
  );
}
