// Starts, stops or reports on the local DriveEasy PostgreSQL instance (port 5433).
//   pnpm db:start | pnpm db:stop | pnpm db:status
// Override locations with PG_BIN and PG_DATA if your install differs.
import { spawnSync } from "node:child_process";
import path from "node:path";

const action = process.argv[2];
const pgBin = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";
const pgData = process.env.PG_DATA ?? path.join(process.env.LOCALAPPDATA ?? "", "DriveEasy", "pgdata");
const pgCtl = path.join(pgBin, "pg_ctl.exe");

function pgctl(args: string[], quiet = false) {
  // stdio "ignore" for start: the server must not hold this process's output open.
  return spawnSync(pgCtl, ["-D", pgData, ...args], { stdio: quiet ? "ignore" : "inherit" }).status ?? 1;
}

const running = pgctl(["status"], true) === 0;

switch (action) {
  case "start":
    if (running) {
      console.log("DriveEasy PostgreSQL is already running.");
    } else {
      const logFile = path.join(path.dirname(pgData), "postgres.log");
      const code = pgctl(["-l", logFile, "-w", "start"], true);
      console.log(code === 0 ? "DriveEasy PostgreSQL started on port 5433." : `Start failed; see ${logFile}`);
      process.exit(code);
    }
    break;
  case "stop":
    if (!running) console.log("DriveEasy PostgreSQL is not running.");
    else process.exit(pgctl(["-w", "stop"]));
    break;
  case "status":
    console.log(running ? "DriveEasy PostgreSQL is running." : "DriveEasy PostgreSQL is not running.");
    break;
  default:
    console.error("Usage: pnpm db:start | db:stop | db:status");
    process.exit(1);
}
