#!/usr/bin/env node
// Before launch, against the real Supabase project (Security C-4, C4-a..c, R2): proves over HTTP what
// SQL can't see, and reruns the database's own lockdown check.
//
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_DB_URL=postgres://postgres:...@.../postgres \
//   DATABASE_CA_CERT="$(cat <the Supabase project's CA>.crt)" node scripts/probe-supabase.mjs
//
// Checks, for a visitor (anon key) and for a signed-in user (a throwaway account made for the run):
// - the `app` schema isn't served by the Data API, and the served schemas expose nothing;
// - the `documents` bucket is private with the app's limits;
// - a canary file the service key puts in the bucket can't be listed, downloaded, fetched by public
//   URL or given a signed URL, and nothing can be uploaded;
// and over SQL (TLS verified against DATABASE_CA_CERT), app.storage_lockdown_problems() reports nothing.
// The canary, any upload that wrongly succeeded, and the throwaway user are removed at the end.
// Exits 1 on any failure, 2 when a setting is missing.

import postgres from "postgres";
import { appSchemaNotServed, supabaseSqlTls } from "./probe-supabase-rules.ts";

const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const sqlTls = supabaseSqlTls(process.env.DATABASE_CA_CERT);
if (!base || !anonKey || !serviceKey || !dbUrl || !sqlTls) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL and DATABASE_CA_CERT.");
  process.exit(2);
}

const BUCKET = "documents";
const run = Date.now().toString(36);
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

/** Legacy keys are JWTs and go in Authorization too; the newer sb_publishable_/sb_secret_ keys only in apikey. */
const keyHeaders = (key) => (key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });
const service = keyHeaders(serviceKey);
const visitor = keyHeaders(anonKey);

async function call(path, headers, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, text: text.slice(0, 300), json };
}
const jsonBody = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// A signed-in user: a throwaway confirmed account, signed in with a password.
const email = `probe-${run}@example.com`;
const password = `Pr0be-${run}-${Math.random().toString(36).slice(2)}`;
const created = await call("/auth/v1/admin/users", service, jsonBody({ email, password, email_confirm: true }));
const userId = created.json?.id ?? created.json?.user?.id ?? null;
const signin = await call("/auth/v1/token?grant_type=password", visitor, jsonBody({ email, password }));
const userToken = signin.json?.access_token ?? null;
// Status codes only: the responses can hold the throwaway user's access token.
check("a throwaway signed-in user for the run", Boolean(userId && userToken), `create ${created.status}; sign-in ${signin.status}`);
const roles = [["visitor", visitor]];
if (userToken) roles.push(["signed-in user", { apikey: anonKey, Authorization: `Bearer ${userToken}` }]);

// Whether the Data API is on at all: section 1 accepts a 404 only when this is 404 too (W12-7).
const root = await call("/rest/v1/", service);

// 1. The app schema is not served, to anyone.
for (const [who, headers] of [...roles, ["service key", service]]) {
  const table = await call("/rest/v1/vendor_files?select=id&limit=1", headers, { headers: { "Accept-Profile": "app" } });
  check(`Data API doesn't serve app tables (${who})`, appSchemaNotServed(table, root.status), `${table.status} ${table.text}`);
  const rpc = await call("/rest/v1/rpc/collect_open", headers, {
    ...jsonBody({ link: "00000000-0000-4000-8000-000000000000", secret_hash: "0".repeat(64) }),
    headers: { "Content-Type": "application/json", "Content-Profile": "app" },
  });
  check(`Data API doesn't serve app functions (${who})`, appSchemaNotServed(rpc, root.status), `${rpc.status} ${rpc.text}`);
}

// 2. The schemas it does serve hold nothing of ShipShape's (the app keeps everything in `app`).
if (root.status === 404) {
  check("Data API is switched off", true, "404");
} else {
  const paths = Object.keys(root.json?.paths ?? {}).filter((p) => p !== "/");
  check("served schemas expose no tables or functions", root.status === 200 && paths.length === 0, root.status === 200 ? paths.join(", ") || "none" : `${root.status} ${root.text}`);
}

// 3. The bucket exists and is private, with the app's size and type limits.
const bucket = await call(`/storage/v1/bucket/${BUCKET}`, service);
check(
  "documents bucket is private with a 10 MB limit and PDF/PNG/JPEG only",
  bucket.status === 200 &&
    bucket.json?.public === false &&
    Number(bucket.json?.file_size_limit) === 10485760 &&
    JSON.stringify([...(bucket.json?.allowed_mime_types ?? [])].sort()) === JSON.stringify(["application/pdf", "image/jpeg", "image/png"]),
  `${bucket.status} ${bucket.text}`,
);

// 4. A canary the server stores can't be reached by anyone else; nobody else can upload (C4-a, C4-b).
const canaryDir = `probe-${run}`;
const canary = `${canaryDir}/canary.pdf`;
const put = await call(`/storage/v1/object/${BUCKET}/${canary}`, service, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "%PDF-1.7\n%canary\n%%EOF\n" });
check("the service key can store the canary", put.status === 200, `${put.status} ${put.text}`);
const strayUploads = [];
for (const [who, headers] of roles) {
  const list = await call(`/storage/v1/object/list/${BUCKET}`, headers, jsonBody({ prefix: canaryDir, limit: 10 }));
  check(`${who} can't list the bucket`, list.status >= 400 || (Array.isArray(list.json) && list.json.length === 0), `${list.status} ${list.text}`);
  const get = await call(`/storage/v1/object/${BUCKET}/${canary}`, headers);
  check(`${who} can't download the canary`, get.status >= 400, `${get.status} ${get.text}`);
  const authGet = await call(`/storage/v1/object/authenticated/${BUCKET}/${canary}`, headers);
  check(`${who} can't download the canary as authenticated`, authGet.status >= 400, `${authGet.status} ${authGet.text}`);
  const pub = await call(`/storage/v1/object/public/${BUCKET}/${canary}`, headers);
  check(`${who} can't fetch the canary by public URL`, pub.status >= 400, `${pub.status} ${pub.text}`);
  const sign = await call(`/storage/v1/object/sign/${BUCKET}/${canary}`, headers, jsonBody({ expiresIn: 60 }));
  check(`${who} can't sign a URL for the canary`, sign.status >= 400, `${sign.status} ${sign.text}`);
  const path = `${canaryDir}/${who.replace(/\W+/g, "-")}.pdf`;
  const upload = await call(`/storage/v1/object/${BUCKET}/${path}`, headers, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "%PDF-1.7\n%%EOF\n" });
  check(`${who} can't upload`, upload.status >= 400, `${upload.status} ${upload.text}`);
  if (upload.status < 400) strayUploads.push(path);
}

// 5. The database's own check (C4-c), as postgres over TLS with the chain and hostname verified (W12-6).
const sql = postgres(dbUrl, { max: 1, prepare: false, ssl: sqlTls });
try {
  const problems = await sql`select p from app.storage_lockdown_problems() p`;
  check("app.storage_lockdown_problems() reports nothing", problems.length === 0, problems.map((r) => r.p).join("; "));
} catch (e) {
  check("app.storage_lockdown_problems() reports nothing", false, e instanceof Error ? e.message : String(e));
} finally {
  await sql.end();
}

// Clean up: the canary, anything uploaded by mistake, the throwaway user.
const removed = await call(`/storage/v1/object/${BUCKET}`, service, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [canary, ...strayUploads] }) });
check("the canary is removed again", removed.status === 200, `${removed.status} ${removed.text}`);
if (userId) {
  const gone = await call(`/auth/v1/admin/users/${userId}`, service, { method: "DELETE" });
  check("the throwaway user is removed again", gone.status === 200, `${gone.status} ${gone.text}`);
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `: ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
