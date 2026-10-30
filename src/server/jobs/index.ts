import { releaseExpiredHolds } from "./release-expired-holds";

/**
 * Scheduled jobs. The same job runs either way:
 * - SCHEDULER_PROVIDER=local: `pnpm jobs:release-expired-holds` (add `--every 60` to repeat).
 * - SCHEDULER_PROVIDER=cloud-cron: a cloud scheduler calls GET /api/cron/<job>
 *   with `Authorization: Bearer $CRON_SECRET`.
 */
export const jobs = {
  "release-expired-holds": () => releaseExpiredHolds(),
} satisfies Record<string, () => Promise<unknown>>;

export type JobName = keyof typeof jobs;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(jobs, name);
}

export function runJob(name: JobName) {
  return jobs[name]();
}
