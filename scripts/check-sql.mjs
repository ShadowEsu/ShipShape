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
      // SQL built before the call (Security F9): any template literal with ${...}, or any string joined
      // with +, whose literal text reads as SQL. App SQL is lowercase, so UI copy ("Select a file")
      // doesn't match.
      const SQL = /\b(select\b[\s\S]*\bfrom|insert\s+into|update\s+[\w.]+\s+set|delete\s+from)\b/;
      for (const m of src.matchAll(/`(?:\\.|[^`\\])*`/g)) {
        if (m[0].includes("${") && SQL.test(m[0].replace(/\$\{[^}]*\}/g, ""))) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
      }
      for (const m of src.matchAll(/(["'])((?:\\.|(?!\1).)*)\1\s*\+|\+\s*(["'])((?:\\.|(?!\3).)*)\3/g)) {
        if (SQL.test(m[2] ?? m[4] ?? "")) bad.push(`${p}:${src.slice(0, m.index).split("\n").length}`);
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
