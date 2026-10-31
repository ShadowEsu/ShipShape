import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * One way into Postgres. Every request runs inside a transaction with a Postgres role:
 * `authenticated` (with the user's id in request.jwt.claims, exactly what Supabase's API does),
 * `anon`, or `service_role` for the few server-only steps. Row level security therefore applies
 * to every query the app makes for a user.
 *
 * Production: DATABASE_URL (Supabase Postgres through its pooler).
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

/** Local/test database: the Supabase shim, then every migration in order. */
export async function createLocalDriver(dataDir?: string): Promise<Driver> {
  // Runtime-selected driver: production never loads the PGlite WebAssembly bundle.
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined);
  const fresh = (await pg.query<{ n: number }>("select count(*)::int as n from pg_namespace where nspname = 'app'")).rows[0].n === 0;
  if (fresh) {
    await pg.exec(await readFile(path.join(ROOT, "supabase/test/supabase-shim.sql"), "utf8"));
    for (const f of await sqlFiles(path.join(ROOT, "supabase/migrations"))) await pg.exec(f.sql);
  }
  return {
    transaction: (fn) => pg.transaction((t) => fn({ query: async (text, params) => (await t.query(text, params)).rows as never })),
    close: () => pg.close(),
  };
}

async function createRemoteDriver(url: string): Promise<Driver> {
  // Runtime-selected driver: local runs and tests never load the network client.
  const { default: postgres } = await import("postgres");
  // prepare: false because Supabase's transaction pooler doesn't keep prepared statements.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, ssl: "require" });
  return {
    transaction: (fn) => sql.begin((s) => fn({ query: (text, params) => s.unsafe(text, (params ?? []) as never[]) as never })) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

let driver: Promise<Driver> | undefined;

function getDriver(): Promise<Driver> {
  if (!driver) {
    const url = process.env.DATABASE_URL;
    if (url) driver = createRemoteDriver(url);
    else if (process.env.NODE_ENV === "production" && process.env.SHIPSHAPE_LOCAL_DB !== "1") {
      driver = Promise.reject(new Error("DATABASE_URL is not set"));
    } else driver = createLocalDriver(process.env.SHIPSHAPE_PGLITE_DIR ?? path.join(ROOT, ".data", "pglite"));
    driver.catch(() => (driver = undefined));
  }
  return driver;
}

/** Tests inject their own database. */
export function setDriverForTests(d: Driver) {
  driver = Promise.resolve(d);
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
