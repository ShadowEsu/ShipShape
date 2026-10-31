#!/usr/bin/env node
// Before launch, against the real Supabase project (Security C-4, R2): proves over HTTP what SQL can't
// see. The `app` schema isn't served by the Data API, no ShipShape table or function is served from
// another schema, and the `documents` bucket is private: visitors can't list, upload or fetch.
//
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/probe-supabase.mjs
//
// Read-only except one anonymous upload attempt that must be refused (removed again if it isn't).
// Exits 1 on any failure.

const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!base || !anonKey || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const BUCKET = "documents";
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

/** Legacy keys are JWTs and go in Authorization too; the newer sb_publishable_/sb_secret_ keys only in apikey. */
const auth = (key) => (key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });

async function call(path, key, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...auth(key), ...init.headers } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, text: text.slice(0, 300), json };
}

// A schema the Data API doesn't serve answers 406 PGRST106; with the Data API switched off there is no
// /rest/v1 at all (404). Anything else (data, or an RLS/permission error) means the schema is served.
const notServed = (r) => (r.status === 406 && r.json?.code === "PGRST106") || r.status === 404;

// 1. The app schema is not served, to visitors or to the service key.
for (const [who, key] of [
  ["anon", anonKey],
  ["service", serviceKey],
]) {
  const table = await call("/rest/v1/vendor_files?select=id&limit=1", key, { headers: { "Accept-Profile": "app" } });
  check(`Data API doesn't serve app tables (${who})`, notServed(table), `${table.status} ${table.text}`);
  const rpc = await call("/rest/v1/rpc/collect_open", key, {
    method: "POST",
    headers: { "Content-Profile": "app", "Content-Type": "application/json" },
    body: JSON.stringify({ link: "00000000-0000-4000-8000-000000000000", secret_hash: "0".repeat(64) }),
  });
  check(`Data API doesn't serve app functions (${who})`, notServed(rpc), `${rpc.status} ${rpc.text}`);
}

// 2. The schemas it does serve hold nothing of ShipShape's (the app keeps everything in `app`).
const root = await call("/rest/v1/", serviceKey);
if (root.status === 404) {
  check("Data API is switched off", true, "404");
} else {
  const paths = Object.keys(root.json?.paths ?? {}).filter((p) => p !== "/");
  check("served schemas expose no tables or functions", root.status === 200 && paths.length === 0, root.status === 200 ? paths.join(", ") || "none" : `${root.status} ${root.text}`);
}

// 3. The bucket exists and is private, with the app's size and type limits.
const bucket = await call(`/storage/v1/bucket/${BUCKET}`, serviceKey);
check(
  "documents bucket is private with a 10 MB limit and PDF/PNG/JPEG only",
  bucket.status === 200 &&
    bucket.json?.public === false &&
    Number(bucket.json?.file_size_limit) === 10485760 &&
    JSON.stringify([...(bucket.json?.allowed_mime_types ?? [])].sort()) === JSON.stringify(["application/pdf", "image/jpeg", "image/png"]),
  `${bucket.status} ${bucket.text}`,
);

// 4. Visitors can't list, fetch publicly, or upload.
const list = await call(`/storage/v1/object/list/${BUCKET}`, anonKey, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 1 }),
});
check("visitors can't list the bucket", list.status >= 400 || (Array.isArray(list.json) && list.json.length === 0), `${list.status} ${list.text}`);

const realObject = await call(`/storage/v1/object/list/${BUCKET}`, serviceKey, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 1 }),
});
const someName = Array.isArray(realObject.json) && realObject.json[0]?.name ? realObject.json[0].name : "probe/missing.pdf";
const publicGet = await call(`/storage/v1/object/public/${BUCKET}/${someName}`, anonKey);
check("no public URL serves a file", publicGet.status >= 400, `${publicGet.status} for ${someName}`);
const anonGet = await call(`/storage/v1/object/${BUCKET}/${someName}`, anonKey);
check("visitors can't download by path", anonGet.status >= 400, `${anonGet.status} for ${someName}`);

const probePath = `probe-${Date.now()}/x.pdf`;
const upload = await call(`/storage/v1/object/${BUCKET}/${probePath}`, anonKey, {
  method: "POST",
  headers: { "Content-Type": "application/pdf" },
  body: "%PDF-1.7\n%%EOF\n",
});
check("visitors can't upload", upload.status >= 400, `${upload.status} ${upload.text}`);
if (upload.status < 400) {
  await call(`/storage/v1/object/${BUCKET}`, serviceKey, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [probePath] }),
  });
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `: ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
