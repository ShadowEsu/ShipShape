import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * One way into Postgres. Every request runs inside a transaction with a Postgres role:
 * `authenticated` (with the user's id in request.jwt.claims, exactly what Supabase's API does),
 * `anon`, or `service_role` for the few server-only steps. Row level security therefore applies
 * to every query the app makes for a user.
 *
 * Production: DATABASE_URL (Supabase or RDS Postgres) with the certificate verified.
 * Local and tests: PGlite (Postgres compiled to WebAssembly) with the same migrations.
 */

export interface Tx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Driver {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const ROOT = process.cwd();

async function sqlFiles(dir: string) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  return Promise.all(names.map(async (n) => ({ name: n, sql: await readFile(path.join(dir, n), "utf8") })));
}

export interface LocalDriver extends Driver {
  /** Superuser transaction, for test setup and tamper checks only. The app never uses it. */
  root<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Local/test database: the Supabase shim once, then each migration not applied yet (tracked in
 * public.local_migrations, like Supabase's own migration table). App transactions run as the
 * login role `shipshape_app` (like production), never as the superuser.
 */
export async function createLocalDriver(dataDir?: string): Promise<LocalDriver> {
  // Runtime-selected driver: production never loads the PGlite WebAssembly bundle.
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined);
  const fresh = (await pg.query<{ n: number }>("select count(*)::int as n from pg_namespace where nspname = 'app'")).rows[0].n === 0;
  if (fresh) await pg.exec(await readFile(path.join(ROOT, "supabase/test/supabase-shim.sql"), "utf8"));
  await pg.exec("create table if not exists public.local_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await pg.query<{ name: string }>("select name from public.local_migrations")).rows.map((r) => r.name));
  if (!fresh && applied.size === 0) {
    throw new Error("This local database predates migration tracking. Delete .data/pglite (sample data only) and restart.");
  }
  for (const f of await sqlFiles(path.join(ROOT, "supabase/migrations"))) {
    if (applied.has(f.name)) continue;
    await pg.transaction(async (t) => {
      await t.exec(f.sql);
      await t.query("insert into public.local_migrations (name) values ($1)", [f.name]);
    });
  }
  const wrap = (t: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Tx => ({
    query: async (text, params) => (await t.query(text, params)).rows as never,
  });
  // PGlite has one connection whose login user is the superuser `postgres`. Its `SET LOCAL` and
  // `RESET SESSION AUTHORIZATION` don't restore the identity, so each transaction sets it explicitly.
  return {
    transaction: (fn) =>
      pg.transaction(async (t) => {
        await t.query("set session authorization shipshape_app");
        return fn(wrap(t));
      }),
    root: (fn) =>
      pg.transaction(async (t) => {
        await t.query("set session authorization postgres");
        return fn(wrap(t));
      }),
    close: () => pg.close(),
  };
}

async function createRemoteDriver(url: string): Promise<Driver> {
  // Runtime-selected driver: local runs and tests never load the network client.
  const { default: postgres } = await import("postgres");
  // prepare: false because Supabase's transaction pooler doesn't keep prepared statements.
  // TLS is verified, chain and hostname: postgres.js's `ssl: "require"` would encrypt without
  // checking who answers. RDS and Supabase sign with their own CAs, so DATABASE_CA_CERT holds the
  // provider's CA bundle (PEM); without it Node's built-in CAs apply. Never falls back to unverified.
  const ca = process.env.DATABASE_CA_CERT;
  const ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, ssl });
  return {
    transaction: (fn) => sql.begin((s) => fn({ query: (text, params) => s.unsafe(text, (params ?? []) as never[]) as never })) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

// One driver per process. Next.js bundles route handlers and pages separately, so a module-level
// variable would open a second PGlite on the same data directory, and the two wouldn't see each
// other's writes (and a second postgres.js pool in production).
declare global {
  var shipshapeDb: Promise<Driver> | undefined;
}

function getDriver(): Promise<Driver> {
  if (!globalThis.shipshapeDb) {
    const url = process.env.DATABASE_URL;
    let d: Promise<Driver>;
    if (url) d = createRemoteDriver(url);
    else if (process.env.NODE_ENV === "production") d = Promise.reject(new Error("DATABASE_URL is not set"));
    else d = createLocalDriver(process.env.SHIPSHAPE_PGLITE_DIR ?? path.join(ROOT, ".data", "pglite"));
    d.catch(() => (globalThis.shipshapeDb = undefined));
    globalThis.shipshapeDb = d;
  }
  return globalThis.shipshapeDb;
}

/** Tests inject their own database. */
export function setDriverForTests(d: Driver) {
  globalThis.shipshapeDb = Promise.resolve(d);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs `fn` as the signed-in user. Row level security decides what they can see and change. */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("Invalid user id");
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return fn(tx);
  });
}

/** Runs `fn` as an anonymous visitor (public pages). */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role anon");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    return fn(tx);
  });
}

/** Server-only steps that no user may do directly (waitlist, webhooks, account deletion). */
export async function asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role service_role");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    return fn(tx);
  });
}

/** For the health check: can we reach the database at all? */
export async function dbUp(): Promise<boolean> {
  try {
    await asAnon((tx) => tx.query("select 1"));
    return true;
  } catch {
    return false;
  }
}

/** The SQLSTATE of a database error (PGlite and postgres.js both put it on `code`), or null. */
export function pgErrorCode(e: unknown): string | null {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : null;
}
