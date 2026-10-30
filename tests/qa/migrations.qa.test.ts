import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { applyMigrations, createScratchDb, hasMigrations } from "./helpers/db";

// Brief: "Test database migrations on a clean database". Each run creates a brand-new empty
// database (no btree_gist pre-installed, like a fresh Neon branch), applies ./drizzle, checks the
// schema against the brief's database rules, re-applies to prove it is a no-op, then drops it.

const REQUIRED_TABLES = [
  "users", "driver_profiles", "branches", "vehicle_categories", "vehicles", "vehicle_features",
  "vehicle_feature_map", "pricing_rules", "extras", "reservations", "reservation_extras", "payments",
  "deposits", "rental_agreements", "damage_reports", "maintenance_blocks", "audit_logs",
];
const VEHICLE_STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"];
const RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"];
// Join tables may use composite keys instead of a UUID id.
const COMPOSITE_KEY_OK = ["vehicle_feature_map", "reservation_extras"];

describe.skipIf(!hasMigrations())("migrations on a clean database", () => {
  let scratch: Awaited<ReturnType<typeof createScratchDb>>;
  let c: Client;
  const q = async <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await c.query<T>(sql, params)).rows;

  beforeAll(async () => {
    scratch = await createScratchDb();
    await applyMigrations(scratch.url);
    c = new Client({ connectionString: scratch.url });
    await c.connect();
  });
  afterAll(async () => {
    await c?.end();
    await scratch?.drop();
  });

  it("creates every table from the brief", async () => {
    const rows = await q<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    expect(REQUIRED_TABLES.filter((t) => !names.includes(t))).toEqual([]);
  });

  it("installs btree_gist itself (a fresh Neon database will not have it)", async () => {
    expect(await q(`select 1 from pg_extension where extname = 'btree_gist'`)).toHaveLength(1);
  });

  it("uses UUID primary keys on every brief table", async () => {
    const rows = await q<{ table_name: string; data_type: string }>(`
      select tc.table_name, col.data_type
      from information_schema.table_constraints tc
      join information_schema.key_column_usage k
        on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
      join information_schema.columns col
        on col.table_schema = k.table_schema and col.table_name = k.table_name and col.column_name = k.column_name
      where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'`);
    const bad = rows.filter(
      (r) => REQUIRED_TABLES.includes(r.table_name) && !COMPOSITE_KEY_OK.includes(r.table_name) && r.data_type !== "uuid",
    );
    expect(bad).toEqual([]);
    const withPk = new Set(rows.map((r) => r.table_name));
    expect(REQUIRED_TABLES.filter((t) => !withPk.has(t))).toEqual([]);
  });

  it("stores timestamps with time zone (UTC), never naive timestamps", async () => {
    const rows = await q(`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp without time zone'`);
    expect(rows).toEqual([]);
  });

  it("never stores money as floating point or numeric", async () => {
    const rows = await q(`select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'
        and data_type in ('real', 'double precision', 'numeric', 'money')
        and column_name ~* '(amount|price|rate|fee|total|tax|vat|deposit|fils|cost|charge)'`);
    expect(rows).toEqual([]);
  });

  it("has unique constraints for plate numbers, VINs and branch codes", async () => {
    const rows = await q<{ table: string; def: string }>(`
      select cl.relname as table, pg_get_indexdef(i.indexrelid) as def
      from pg_index i join pg_class cl on cl.oid = i.indrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and i.indisunique`);
    const has = (table: string, re: RegExp) => rows.some((r) => r.table === table && re.test(r.def));
    expect(has("vehicles", /plate/i), "unique plate").toBe(true);
    expect(has("vehicles", /vin/i), "unique VIN").toBe(true);
    expect(has("branches", /code/i), "unique branch code").toBe(true);
  });

  it("protects vehicle periods with GiST exclusion constraints", async () => {
    const rows = await q<{ table: string; def: string }>(`
      select cl.relname as table, pg_get_constraintdef(con.oid) as def
      from pg_constraint con join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and con.contype = 'x'`);
    expect(rows.length, JSON.stringify(rows)).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.def).toMatch(/USING gist/i);
      expect(r.def).toMatch(/WITH &&/);
      expect(r.def).toMatch(/WITH =/);
    }
  });

  it("stores rental periods as tstzrange", async () => {
    const rows = await q<{ table_name: string; udt_name: string }>(`select table_name, udt_name
      from information_schema.columns where table_schema = 'public' and udt_name in ('tstzrange', 'tsrange')`);
    expect(rows.some((r) => r.table_name === "reservations"), JSON.stringify(rows)).toBe(true);
    expect(rows.some((r) => r.table_name === "maintenance_blocks"), JSON.stringify(rows)).toBe(true);
    expect(rows.filter((r) => r.udt_name === "tsrange")).toEqual([]);
  });

  it("defines the vehicle and reservation status values from the brief", async () => {
    const enums = await q<{ name: string; labels: string[] }>(`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`);
    const checks = await q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where contype = 'c'`,
    );
    const defined = (values: string[]) =>
      enums.some((e) => values.every((v) => e.labels.includes(v)) && e.labels.length === values.length) ||
      checks.some((ch) => values.every((v) => ch.def.includes(`'${v}'`)));
    expect(defined(VEHICLE_STATUSES), "vehicle status enum").toBe(true);
    expect(defined(RESERVATION_STATUSES), "reservation status enum").toBe(true);
  });

  it("keeps payment and deposit status separate from reservation status", async () => {
    const rows = await q<{ table_name: string; column_name: string }>(`select table_name, column_name
      from information_schema.columns where table_schema = 'public' and column_name ~* 'status'`);
    expect(rows.some((r) => r.table_name === "payments")).toBe(true);
    expect(rows.some((r) => r.table_name === "deposits")).toBe(true);
  });

  it("records mileage and fuel at pick-up and return on the rental agreement", async () => {
    const cols = (
      await q<{ column_name: string }>(`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'rental_agreements'`)
    ).map((r) => r.column_name);
    const any = (re: RegExp) => cols.some((col) => re.test(col));
    expect(any(/(pick_?up|out|start).*(mileage|odometer|km)|(mileage|odometer|km).*(pick_?up|out|start)/i), cols.join()).toBe(true);
    expect(any(/(return|in|end).*(mileage|odometer|km)|(mileage|odometer|km).*(return|in|end)/i), cols.join()).toBe(true);
    expect(any(/(pick_?up|out|start).*fuel|fuel.*(pick_?up|out|start)/i), cols.join()).toBe(true);
    expect(any(/(return|in|end).*fuel|fuel.*(return|in|end)/i), cols.join()).toBe(true);
  });

  it("indexes every foreign key column", async () => {
    const rows = await q<{ table: string; col: string }>(`
      select cl.relname as table, a.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      where n.nspname = 'public' and con.contype = 'f'
        and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1])
        and not exists (select 1 from pg_constraint x where x.conrelid = con.conrelid and x.contype = 'x'
                          and x.conkey[1] = con.conkey[1])`);
    expect(rows).toEqual([]);
  });

  it("re-applying the migrations is a no-op", async () => {
    const before = await q(`select count(*)::int as n from drizzle.__drizzle_migrations`);
    await applyMigrations(scratch.url);
    expect(await q(`select count(*)::int as n from drizzle.__drizzle_migrations`)).toEqual(before);
  });
});

describe("migration files", () => {
  it("exist in ./drizzle", () => {
    expect(hasMigrations(), "no Drizzle migrations generated yet (pnpm db:generate)").toBe(true);
  });
});
