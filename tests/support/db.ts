import { createLocalDriver, setDriverForTests, type LocalDriver, type Tx } from "@/lib/server/db";

export interface TestDb {
  driver: LocalDriver;
  /** Superuser access for test setup and tamper checks only. */
  root<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Adds a row to auth.users and returns its id (null email: like a sample-workspace visitor). */
  user(email: string | null): Promise<string>;
}

/** A fresh in-memory Postgres with every migration applied, wired in as the app's database. */
export async function freshDb(): Promise<TestDb> {
  const driver = await createLocalDriver();
  setDriverForTests(driver);
  const root = <T>(fn: (tx: Tx) => Promise<T>) => driver.root(fn);
  return {
    driver,
    root,
    async user(email) {
      const [row] = await root((tx) => tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]));
      return row.id;
    },
  };
}
