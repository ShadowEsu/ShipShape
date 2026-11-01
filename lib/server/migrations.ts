/**
 * One way to bring a database up to date, used by the local driver (PGlite) and by
 * scripts/migrate.ts (RDS). Plain Node: no `server-only` and no `@/` imports, so the script can load
 * it. It reads no files: callers pass the SQL. (A file read here through a path built from an
 * argument made Next's dev server watch the whole project, local database included, and reload
 * every page on each query.)
 */
import { createHash } from "node:crypto";

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
  /** The file as read (UTF-8): its hash is over these bytes. */
  sql: string;
}

export interface MigrateOptions {
  /** Pending migrations that may run although a later-named one is applied: exact names only. */
  allowLate?: string[];
  /** Where to say which applied migrations had their hash recorded for the first time. */
  log?: (line: string) => void;
}

/**
 * Sets up a fresh database (`setup`: supabase/platform/plain-postgres.sql, plus the Supabase
 * Storage shim locally), then applies each of `migrations` (in name order) not yet recorded in
 * meta.migrations, each in its own transaction as shipshape_owner, never as the user who
 * connected. Returns the names applied.
 *
 * Each applied migration's SHA-256 is recorded (W12-8). Before anything changes, the run refuses
 * when an applied migration's file no longer matches its hash (production would skip the edit that
 * every fresh test database runs) or is gone (a fresh database would never run it), or when a
 * pending one sorts before the newest applied one (a branch merged after a later number shipped)
 * unless `allowLate` names it. Migrations applied before hashes were kept have theirs recorded
 * once, and logged.
 *
 * The connecting user needn't be a superuser (RDS's master isn't, Security MG-1): it only reads the
 * catalog itself, and reads meta.migrations as shipshape_owner, which it may become but doesn't inherit.
 */
export async function migrate(conn: MigrationConn, setup: string[], migrations: SqlFile[], options: MigrateOptions = {}): Promise<string[]> {
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
    // Through to_jsonb: a database set up before W12-8 has no sha256 column yet.
    recorded = await t.query("select m.name, to_jsonb(m) ->> 'sha256' as sha256 from meta.migrations m");
  });
  const applied = new Map(recorded.map((r) => [String(r.name), typeof r.sha256 === "string" ? r.sha256 : null]));
  const files = [...migrations].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ ...f, sha256: createHash("sha256").update(f.sql, "utf8").digest("hex") }));
  const newest = [...applied.keys()].sort((a, b) => a.localeCompare(b)).at(-1);
  const allowLate = options.allowLate ?? [];
  const problems: string[] = [];
  for (const f of files) {
    const hash = applied.get(f.name);
    if (hash && hash !== f.sha256) problems.push(`${f.name} changed after it was applied (recorded ${hash.slice(0, 12)}, now ${f.sha256.slice(0, 12)})`);
    if (hash === undefined && newest !== undefined && f.name.localeCompare(newest) < 0 && !allowLate.includes(f.name)) {
      problems.push(`${f.name} sorts before ${newest}, which is applied (to run it anyway, name it with --allow-late)`);
    }
  }
  const named = new Set(files.map((f) => f.name));
  for (const name of [...applied.keys()].sort((a, b) => a.localeCompare(b))) if (!named.has(name)) problems.push(`${name} is applied but its file is gone`);
  if (problems.length) throw new Error(`Nothing was changed: ${problems.join("; ")}. Locally: delete .data/pglite (sample data only) and restart.`);

  const unhashed = files.filter((f) => applied.get(f.name) === null);
  await conn.transaction(async (t) => {
    await t.exec("set local role shipshape_owner");
    await t.exec("alter table meta.migrations add column if not exists sha256 text");
    for (const f of unhashed) await t.query("update meta.migrations set sha256 = $1 where name = $2 and sha256 is null", [f.sha256, f.name]);
  });
  for (const f of unhashed) options.log?.(`Recorded the hash of ${f.name} (applied before hashes were kept): ${f.sha256}`);
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f.name)) continue;
    await conn.transaction(async (t) => {
      await t.exec("set local role shipshape_owner");
      await t.exec(f.sql);
      await t.query("insert into meta.migrations (name, sha256) values ($1, $2)", [f.name, f.sha256]);
    });
    done.push(f.name);
  }
  return done;
}

/** The request roles the app's login switches to (`set local role`), and nothing else. */
const APP_ROLES = ["anon", "authenticated", "service_role"];

/**
 * Every role shipshape_app is a member of, directly or through another role, and whether any grant
 * on the way carries ADMIN. Printed in the migrate log (Security S-PG1).
 */
export async function appMemberships(conn: MigrationStep): Promise<{ role: string; admin: boolean }[]> {
  const rows = await conn.query(
    `with recursive m (roleid, admin) as (
       select am.roleid, am.admin_option
         from pg_catalog.pg_auth_members am join pg_catalog.pg_roles r on r.oid = am.member
        where r.rolname = 'shipshape_app'
       union
       select am.roleid, am.admin_option from pg_catalog.pg_auth_members am join m on am.member = m.roleid
     )
     select r.rolname as role, bool_or(m.admin) as admin
       from m join pg_catalog.pg_roles r on r.oid = m.roleid
      group by r.rolname order by r.rolname`,
  );
  return rows.map((r) => ({ role: String(r.role), admin: r.admin === true }));
}

/**
 * What Security R-2 requires of the roles once migrations ran, one line per problem (none: fine).
 * The app's login is no superuser, can't bypass row level security, create roles or databases, or
 * replicate (aws-plan R-2: NOCREATEROLE NOCREATEDB; a role made earlier keeps whatever it had, MG-2),
 * and owns nothing at all (a security definer function it owned would run with its rights, MG-3); it
 * is a member of exactly the three request roles, none with ADMIN (S-PG1: no table forces row level
 * security, so membership in the owner, or any other role, would let it read everything); every other
 * ShipShape role can't log in (MG-2: `create role if not exists` leaves an existing role as it was).
 */
export async function roleProblems(conn: MigrationStep): Promise<string[]> {
  const [app] = await conn.query(
    `select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
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
  const memberships = await appMemberships(conn);
  const roles = memberships.map((m) => m.role);
  const problems = [
    app.rolsuper === true && "shipshape_app is a superuser",
    app.rolbypassrls === true && "shipshape_app can bypass row level security",
    app.rolcreaterole === true && "shipshape_app can create roles",
    app.rolcreatedb === true && "shipshape_app can create databases",
    app.rolreplication === true && "shipshape_app can replicate",
    ...["relations", "functions", "schemas", "types"].map((kind) => Number(app[kind]) > 0 && `shipshape_app owns ${Number(app[kind])} ${kind}`),
    ...roles.filter((r) => !APP_ROLES.includes(r)).map((r) => `shipshape_app is a member of ${r}`),
    ...APP_ROLES.filter((r) => !roles.includes(r)).map((r) => `shipshape_app isn't a member of ${r}`),
    ...memberships.filter((m) => m.admin).map((m) => `shipshape_app has ADMIN on ${m.role}`),
    ...logins.map((r) => `${String(r.rolname)} can log in`),
  ];
  return problems.filter((p): p is string => typeof p === "string");
}
