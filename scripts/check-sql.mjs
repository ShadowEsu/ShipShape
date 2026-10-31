// Fails if app code builds SQL with template-literal interpolation (Security E7): every query is
// constant text plus a params array. Tests are exempt (they loop over table names on purpose).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["app", "lib", "components", "scripts"];
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(name) && p !== path.join("scripts", "check-sql.mjs")) {
      const src = readFileSync(p, "utf8");
      // A query call whose first argument is a template literal containing ${...}.
      const re = /\.(query|unsafe)\s*(<[^>]*>)?\s*\(\s*`([^`]*)`/g;
      for (const m of src.matchAll(re)) {
        if (m[3].includes("${")) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }
}

for (const r of ROOTS) walk(r);
if (bad.length) {
  console.error(`SQL built with interpolation (use $1 params):\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("check-sql: 0 interpolated queries");
