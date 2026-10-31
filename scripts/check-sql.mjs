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
      // A query call whose first argument is a template literal containing ${...}, or a string
      // literal joined with + (concatenation).
      const template = /\.(query|unsafe)\s*(<[^>]*>)?\s*\(\s*`([^`]*)`/g;
      for (const m of src.matchAll(template)) {
        if (m[3].includes("${")) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
      }
      const concat = /\.(query|unsafe)\s*(<[^>]*>)?\s*\(\s*(["'`])(?:\\.|(?!\3).)*\3\s*\+/gs;
      for (const m of src.matchAll(concat)) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
      const leadingVar = /\.(query|unsafe)\s*(<[^>]*>)?\s*\(\s*[A-Za-z_$][\w$.]*\s*\+/g;
      for (const m of src.matchAll(leadingVar)) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
}

for (const r of ROOTS) walk(r);
if (bad.length) {
  console.error(`SQL built with interpolation (use $1 params):\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("check-sql: 0 interpolated queries");
