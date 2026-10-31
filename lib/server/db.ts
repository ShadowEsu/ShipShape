import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TransactionSql } from "postgres";
import { migrate, type MigrationStep } from "./migrations";
import { pgTls } from "./pg-tls";

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
  /**
   * Runs `fn` in a savepoint: if it throws, only its own statements are undone, the error is
   * rethrown and the transaction goes on. The only way to carry on after a failed statement:
   * postgres.js fails the whole transaction for any error inside it that didn't happen in a savepoint
   * of its own, even one the code caught.
   */
  savepoint<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
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
 * Local/test database, set up exactly as on RDS (lib/server/migrations.ts): the platform roles, then
 * each migration as shipshape_owner. `supabaseStorage` (default) adds Supabase Storage's tables so
 * 0013's lockdown runs too; without it the database is plain Postgres, like RDS. App transactions run
 * as the login role `shipshape_app` (like production), never as the superuser.
 */
export async function createLocalDriver(dataDir?: string, { supabaseStorage = true }: { supabaseStorage?: boolean } = {}): Promise<LocalDriver> {
  // Runtime-selected driver: production never loads the PGlite WebAssembly bundle.
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined);
  const step = (t: { exec(sql: string): Promise<unknown>; query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }> }): MigrationStep => ({
    exec: async (sql) => {
      await t.exec(sql);
    },
    query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
  });
  const setup = [await readFile(path.join(ROOT, "supabase/platform/plain-postgres.sql"), "utf8")];
  if (supabaseStorage) setup.push(await readFile(path.join(ROOT, "supabase/test/supabase-shim.sql"), "utf8"));
  await migrate({ ...step(pg), transaction: (fn) => pg.transaction((t) => fn(step(t))) }, setup, await sqlFiles(path.join(ROOT, "supabase/migrations")));
  const wrap = (t: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Tx => {
    const tx: Tx = {
      query: async (text, params) => (await t.query(text, params)).rows as never,
      // One fixed name: Postgres takes the most recent savepoint of a name, so nesting still works.
      savepoint: async (fn) => {
        await t.query("savepoint sp");
        try {
          const result = await fn(tx);
          await t.query("release savepoint sp");
          return result;
        } catch (e) {
          await t.query("rollback to savepoint sp");
          throw e;
        }
      },
    };
    return tx;
  };
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

/** The production driver (postgres.js, verified TLS). Exported so `SHIPSHAPE_PG_TEST_URL` runs can test it. */
export async function createRemoteDriver(url: string): Promise<Driver> {
  // Runtime-selected driver: local runs and PGlite tests never load the network client.
  const { default: postgres } = await import("postgres");
  // prepare: false because Supabase's transaction pooler doesn't keep prepared statements.
  // TLS always verified (pg-tls.ts).
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, ssl: pgTls() });
  return {
    transaction: (fn) => sql.begin((s) => fn(postgresTx(s))) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

/** A postgres.js transaction as a `Tx` (exported for the tests' superuser connection). */
export function postgresTx(s: TransactionSql): Tx {
  return {
    query: (text, params) => s.unsafe(text, (params ?? []) as never[]) as never,
    savepoint: async (fn) => (await s.savepoint(async (sp) => ({ value: await fn(postgresTx(sp)) }))).value,
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

// Every transaction states who it runs for, plus limits so a stuck request can't hold locks for
// long (a workspace's history lock stops every writer in it): a statement, lock waits included,
// gets 30 s; a transaction left open and idle (its function killed halfway, e.g. while storing a
// file) is ended after 60 s, which releases its locks. Transaction-local, so any pooler is fine.
const START = "select set_config('request.jwt.claims', $1, true), set_config('statement_timeout', '30s', true), set_config('idle_in_transaction_session_timeout', '60s', true)";

/** Runs `fn` as the signed-in user. Row level security decides what they can see and change. */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("Invalid user id");
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query(START, [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return fn(tx);
  });
}

/** Runs `fn` as an anonymous visitor (public pages). */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role anon");
    await tx.query(START, [JSON.stringify({ role: "anon" })]);
    return fn(tx);
  });
}

/** Server-only steps that no user may do directly (waitlist, webhooks, account deletion). */
export async function asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDriver()).transaction(async (tx) => {
    await tx.query("set local role service_role");
    await tx.query(START, [JSON.stringify({ role: "service_role" })]);
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
