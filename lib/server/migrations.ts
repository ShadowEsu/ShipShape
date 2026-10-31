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
 *
 * The connecting user needn't be a superuser (RDS's master isn't, Security MG-1): it only reads the
 * catalog itself, and reads meta.migrations as shipshape_owner, which it may become but doesn't inherit.
 */
export async function migrate(conn: MigrationConn, setup: string[], migrations: SqlFile[]): Promise<string[]> {
  const [state] = await conn.query(
    `select exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'meta' and c.relname = 'migrations') as tracked,
            exists (select 1 from pg_catalog.pg_namespace where nspname = 'app') as has_app`,
  );
  if (state.tracked !== true) {
    if (state.has_app === true) {
      throw new Error("This database has ShipShape's tables but no meta.migrations (made before migrations ran as shipshape_owner). Locally: delete .data/pglite (sample data only) and restart.");
    }
    await conn.transaction(async (t) => {
      for (const sql of setup) await t.exec(sql);
    });
  }
  let recorded: Row[] = [];
  await conn.transaction(async (t) => {
    await t.exec("set local role shipshape_owner");
    recorded = await t.query("select name from meta.migrations");
  });
  const applied = new Set(recorded.map((r) => String(r.name)));
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

/**
 * What Security R-2 requires of the roles once migrations ran, one line per problem (none: fine).
 * The app's login is no superuser, can't bypass row level security and owns nothing at all (a
 * security definer function it owned would run with its rights, MG-3); every other ShipShape role
 * can't log in (MG-2: `create role if not exists` leaves an existing role as it was).
 */
export async function roleProblems(conn: MigrationStep): Promise<string[]> {
  const [app] = await conn.query(
    `select r.rolsuper, r.rolbypassrls,
            (select count(*)::int from pg_catalog.pg_class where relowner = r.oid) as relations,
            (select count(*)::int from pg_catalog.pg_proc where proowner = r.oid) as functions,
            (select count(*)::int from pg_catalog.pg_namespace where nspowner = r.oid) as schemas,
            (select count(*)::int from pg_catalog.pg_type where typowner = r.oid) as types
       from pg_catalog.pg_roles r where r.rolname = 'shipshape_app'`,
  );
  const logins = await conn.query(
    "select rolname from pg_catalog.pg_roles where rolname in ('shipshape_owner', 'anon', 'authenticated', 'service_role') and rolcanlogin order by rolname",
  );
  if (!app) return ["shipshape_app doesn't exist"];
  const problems = [
    app.rolsuper === true && "shipshape_app is a superuser",
    app.rolbypassrls === true && "shipshape_app can bypass row level security",
    ...["relations", "functions", "schemas", "types"].map((kind) => Number(app[kind]) > 0 && `shipshape_app owns ${Number(app[kind])} ${kind}`),
    ...logins.map((r) => `${String(r.rolname)} can log in`),
  ];
  return problems.filter((p): p is string => typeof p === "string");
}
