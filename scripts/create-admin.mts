// Promotes an existing (registered) user to ADMIN.
//   pnpm admin:create someone@example.com
// Uses DATABASE_URL from the environment; .env.local only fills in values that are not already set.
import pg from "pg";

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.DATABASE_URL;
if (!email || !url) {
  console.error("Usage: pnpm admin:create <email>   (needs DATABASE_URL)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const res = await client.query<{ id: string; email: string }>(
    "update users set role = 'ADMIN', updated_at = now() where lower(email) = $1 returning id, email",
    [email],
  );
  if (res.rowCount === 0) {
    console.error(`No user with email ${email}. Register first at /register, then run this again.`);
    process.exitCode = 1;
  } else {
    console.log(`${res.rows[0].email} is now an admin.`);
  }
} finally {
  await client.end();
}
