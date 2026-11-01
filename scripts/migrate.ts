#!/usr/bin/env node
/**
 * Brings a plain-Postgres database (Amazon RDS) up to date: `node scripts/migrate.ts`.
 *
 * MIGRATE_DATABASE_URL  the master user's connection string, from Secrets Manager for this run only;
 *                       never stored in Vercel or the repo. The app itself connects as shipshape_app.
 * DATABASE_CA_CERT      the provider's CA bundle (PEM); the certificate is always verified.
 *
 * First run: the platform file (roles, auth schema), then every migration as shipshape_owner, each
 * in its own transaction (lib/server/migrations.ts). Later runs apply only new migrations, and
 * refuse, before changing anything, when an applied migration's file has changed since or a new one
 * sorts before an applied one; `--allow-late <file name>` (exact, repeatable) lets a named late one
 * run. Ends by checking BOSS's rule 2: shipshape_app isn't a superuser, can't bypass row level
 * security, create roles or databases, or replicate, owns nothing and is a member of exactly anon,
 * authenticated and service_role (no ADMIN; Security S-PG1).
 * Its login (password or IAM auth) is set separately (aws-plan.md); IAM auth would add rds_iam,
 * which this check refuses until that choice is made here too.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { appMemberships, migrate, roleProblems, type MigrationStep } from "../lib/server/migrations.ts";
import { pgTls } from "../lib/server/pg-tls.ts";

const { values: args } = parseArgs({ options: { "allow-late": { type: "string", multiple: true } } });

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error("Set MIGRATE_DATABASE_URL to the master user's connection string.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 10, ssl: pgTls(), onnotice: () => {} });
const step = (s: postgres.Sql | postgres.TransactionSql): MigrationStep => ({
  exec: async (text) => {
    await s.unsafe(text);
  },
  query: async (text, params) => s.unsafe(text, params ?? []),
});

try {
  const root = path.resolve(import.meta.dirname, "..");
  const dir = path.join(root, "supabase/migrations");
  const files = (await readdir(dir)).filter((n) => n.endsWith(".sql"));
  const allowLate = args["allow-late"] ?? [];
  const unknown = allowLate.filter((name) => !files.includes(name));
  if (unknown.length) throw new Error(`--allow-late names no migration file: ${unknown.join(", ")} (exact file names only)`);
  const migrations = await Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), "utf8") })));
  const applied = await migrate(
    {
      ...step(sql),
      transaction: async (fn) => {
        await sql.begin((t) => fn(step(t)));
      },
    },
    [await readFile(path.join(root, "supabase/platform/plain-postgres.sql"), "utf8")],
    migrations,
    { allowLate, log: (line) => console.log(line) },
  );
  console.log(applied.length ? `Applied ${applied.length}: ${applied.join(", ")}` : "Up to date.");

  const problems = await roleProblems(step(sql));
  const memberships = await appMemberships(step(sql));
  const [app] = await sql`select rolcanlogin from pg_roles where rolname = 'shipshape_app'`;
  // Recorded in the run log (Security R-3): SCRAM only, TLS forced (an RDS parameter; empty elsewhere).
  const [settings] = await sql`select current_setting('password_encryption') as pe, coalesce(current_setting('rds.force_ssl', true), '') as force_ssl`;
  console.log(`password_encryption=${settings.pe} rds.force_ssl=${settings.force_ssl || "(not RDS)"}`);
  // Security S-PG1: exactly anon, authenticated and service_role, none with ADMIN.
  console.log(`shipshape_app is a member of: ${memberships.map((m) => (m.admin ? `${m.role} (ADMIN)` : m.role)).join(", ") || "(nothing)"}`);
  if (problems.length) {
    console.error(`FAIL: ${problems.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Roles OK: shipshape_app is no superuser, has no BYPASSRLS, can't create roles or databases or replicate, owns nothing and holds only the three request roles (no ADMIN); the other roles can't log in. shipshape_app's login is ${app?.rolcanlogin ? "set" : "not set yet (see aws-plan.md)"}.`,
    );
  }
} catch (e) {
  // One line, no stack: a refused certificate (DEPTH_ZERO_SELF_SIGNED_CERT, ERR_TLS_CERT_ALTNAME_INVALID)
  // or a failed migration (rolled back; nothing recorded) both stop here.
  const code = e instanceof Error && "code" in e ? ` [${String(e.code)}]` : "";
  console.error(`FAIL${code}: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
