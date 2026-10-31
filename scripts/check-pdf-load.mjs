// Fails if app code loads a PDF with pdf-lib anywhere but the places below (Security R7-3). Uploads go
// through loadUntrusted (lib/pdf/load.ts), which refuses files pdf-lib would load with objects
// missing; a plain PDFDocument.load of an upload would build them instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["app", "lib", "components"];
// Each loads only bytes ShipShape made or pinned.
const ALLOWED = new Set([
  path.join("lib", "pdf", "load.ts"), // loadUntrusted itself
  path.join("lib", "pdf", "append.ts"), // the to-sign file ShipShape saved, and its own certificate
  path.join("lib", "server", "fill.ts"), // the IRS W-9, checked against its pinned SHA-256
]);
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !ALLOWED.has(p)) {
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/PDFDocument\s*\.\s*load\b/g)) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
}

for (const r of ROOTS) walk(r);
if (bad.length) {
  console.error(`check-pdf-load: PDFDocument.load outside the allowed files; load uploads with loadUntrusted (lib/pdf/load.ts):\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log("check-pdf-load: PDFDocument.load only in lib/pdf/load.ts, lib/pdf/append.ts, lib/server/fill.ts");
