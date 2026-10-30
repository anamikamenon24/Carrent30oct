// Local scheduler: `pnpm job <name>` runs a job once; add `--every <seconds>` to repeat it.
import { isJobName, jobs, runJob, type JobName } from "@/server/jobs";

const [name, flag, seconds] = process.argv.slice(2);

if (!name || !isJobName(name)) {
  console.error(`Usage: pnpm job <name> [--every <seconds>]\nJobs: ${Object.keys(jobs).join(", ")}`);
  process.exit(1);
}
const job: JobName = name;

async function once() {
  console.log(`[${new Date().toISOString()}] ${job}:`, JSON.stringify(await runJob(job)));
}

await once();
if (flag === "--every") {
  const ms = Number(seconds) * 1000;
  if (!(ms > 0)) throw new Error("--every needs a number of seconds");
  setInterval(() => once().catch((err) => console.error(err)), ms);
}
