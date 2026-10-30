// Confirms the app can connect to both local databases and that btree_gist is installed.
import { Client } from "pg";

const targets = { dev: process.env.DATABASE_URL, test: process.env.TEST_DATABASE_URL };
let ok = true;

for (const [label, url] of Object.entries(targets)) {
  if (!url) {
    console.log(`✗ ${label}: no connection URL set`);
    ok = false;
    continue;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select current_database() as db, current_user as "user",
              (select extversion from pg_extension where extname = 'btree_gist') as btree_gist`,
    );
    const { db, user, btree_gist } = rows[0];
    const extOk = Boolean(btree_gist);
    ok &&= extOk;
    console.log(`${extOk ? "✓" : "✗"} ${label}: connected to ${db} as ${user}, btree_gist ${btree_gist ?? "MISSING"}`);
  } catch (err) {
    ok = false;
    console.log(`✗ ${label}: ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

process.exit(ok ? 0 : 1);
