/**
 * One way to bring a database up to date, used by the local driver (PGlite) and by
 * scripts/migrate.ts (RDS). Plain Node: no `server-only` and no `@/` imports, so the script can load
 * it. It reads no files: callers pass the SQL. (A file read here through a path built from an
 * argument made Next's dev server watch the whole project, local database included, and reload
 * every page on each query.)
 */

type Row = Record<string, unknown>;

export interface MigrationStep {
  /** Several statements, no parameters. */
  exec(sql: string): Promise<void>;
  query(text: string, params?: string[]): Promise<Row[]>;
}

export interface MigrationConn extends MigrationStep {
  /** Runs `fn` in one transaction: all of it applies, or none. */
  transaction(fn: (t: MigrationStep) => Promise<void>): Promise<void>;
}

export interface SqlFile {
  name: string;
  sql: string;
}

/**
 * Sets up a fresh database (`setup`: supabase/platform/plain-postgres.sql, plus the Supabase
 * Storage shim locally), then applies each of `migrations` (in name order) not yet recorded in
 * meta.migrations, each in its own transaction as shipshape_owner, never as the user who
 * connected. Returns the names applied.
 */
export async function migrate(conn: MigrationConn, setup: string[], migrations: SqlFile[]): Promise<string[]> {
  const [state] = await conn.query(
    "select to_regclass('meta.migrations') is not null as tracked, exists (select 1 from pg_namespace where nspname = 'app') as has_app",
  );
  if (state.tracked !== true) {
    if (state.has_app === true) {
      throw new Error("This database has ShipShape's tables but no meta.migrations (made before migrations ran as shipshape_owner). Locally: delete .data/pglite (sample data only) and restart.");
    }
    await conn.transaction(async (t) => {
      for (const sql of setup) await t.exec(sql);
    });
  }
  const applied = new Set((await conn.query("select name from meta.migrations")).map((r) => String(r.name)));
  const done: string[] = [];
  for (const f of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(f.name)) continue;
    await conn.transaction(async (t) => {
      await t.exec("set local role shipshape_owner");
      await t.exec(f.sql);
      await t.query("insert into meta.migrations (name) values ($1)", [f.name]);
    });
    done.push(f.name);
  }
  return done;
}
