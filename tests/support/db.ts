import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { createLocalDriver, createRemoteDriver, setDriverForTests, type Driver, type Tx } from "@/lib/server/db";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { pgTls } from "@/lib/server/pg-tls";

export interface TestDb {
  driver: Driver;
  /** Superuser access for test setup and tamper checks only. */
  root<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Adds a row to auth.users and returns its id (null email: like a sample-workspace visitor). */
  user(email: string | null): Promise<string>;
}

/**
 * SHIPSHAPE_PG_TEST_URL: a superuser URL on a throwaway PostgreSQL server (TLS verified with
 * DATABASE_CA_CERT). Each test file then gets its own new database there, migrated like RDS, and
 * the app's queries go through the production driver as shipshape_app over TLS, instead of PGlite.
 * It creates databases and sets shipshape_app's password: never point it at a real server.
 */
const PG_TEST_URL = process.env.SHIPSHAPE_PG_TEST_URL;

/** A fresh database with every migration applied, wired in as the app's database. */
export async function freshDb(): Promise<TestDb> {
  const { driver, root } = PG_TEST_URL ? await remoteDb(PG_TEST_URL) : await localDb();
  setDriverForTests(driver);
  return {
    driver,
    root,
    async user(email) {
      const [row] = await root((tx) => tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]));
      return row.id;
    },
  };
}

async function localDb() {
  const driver = await createLocalDriver();
  return { driver, root: <T>(fn: (tx: Tx) => Promise<T>) => driver.root(fn) };
}

async function remoteDb(adminUrl: string) {
  const options = { max: 1, ssl: pgTls(), onnotice: () => {} };
  const name = `shipshape_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, options);
  // Test files run in parallel, but migrations and the password change touch server-wide roles,
  // which Postgres refuses to update concurrently ("tuple concurrently updated"): one setup at a time.
  await admin`select pg_advisory_lock(hashtext('shipshape-test-setup'))`;
  await admin.unsafe(`create database ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const su = postgres(url.toString(), options);
  const step = (s: postgres.Sql | postgres.TransactionSql): MigrationStep => ({
    exec: async (text) => {
      await s.unsafe(text);
    },
    query: async (text, params) => s.unsafe(text, params ?? []),
  });
  const root = path.resolve(import.meta.dirname, "../..");
  const dir = path.join(root, "supabase/migrations");
  const files = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  await migrate(
    {
      ...step(su),
      transaction: async (fn) => {
        await su.begin((t) => fn(step(t)));
      },
    },
    [await readFile(path.join(root, "supabase/platform/plain-postgres.sql"), "utf8"), await readFile(path.join(root, "supabase/test/supabase-shim.sql"), "utf8")],
    await Promise.all(files.map(async (n) => ({ name: n, sql: await readFile(path.join(dir, n), "utf8") }))),
  );
  // Roles are server-wide and test files run in parallel, so every file sets the same password.
  const password = createHash("sha256").update(`shipshape-test:${adminUrl}`).digest("hex");
  const [{ q }] = await su<{ q: string }[]>`select format('alter role shipshape_app login password %L', ${password}::text) as q`;
  await su.unsafe(q);
  await admin`select pg_advisory_unlock(hashtext('shipshape-test-setup'))`;
  await admin.end();

  const appUrl = new URL(url);
  appUrl.username = "shipshape_app";
  appUrl.password = password;
  return {
    driver: await createRemoteDriver(appUrl.toString()),
    root: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
      su.begin((t) => fn({ query: (text, params) => t.unsafe(text, (params ?? []) as never[]) as never })) as Promise<T>,
  };
}
