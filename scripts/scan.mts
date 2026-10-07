// Usage: npm run scan -- <folder | https://github.com/owner/repo | https://site.com>
import { buildResult } from "../lib/scanner";
import { scanLiveSite } from "../lib/scanner/live";
import { parseGitHubUrl, scanDirectory, scanGitHubRepo } from "../lib/scanner/repo";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run scan -- <folder | GitHub URL | website URL>");
  process.exit(1);
}

const kind = /^https?:\/\//.test(target) && !parseGitHubUrl(target) ? "live" : "repo";
const signals = kind === "live" ? await scanLiveSite(target) : parseGitHubUrl(target) ? await scanGitHubRepo(target) : await scanDirectory(target);
const scan = buildResult(target, kind, signals);

console.log(`\nShipShape ${kind} scan of ${target}  ·  score ${scan.score}/100  ·  rules as of ${scan.rulesAsOf}\n`);
for (const f of scan.findings) {
  console.log(`[${f.severity}] ${f.title}`);
  for (const e of f.evidence.slice(0, 3)) console.log(`    ${e.file}${e.line ? `:${e.line}` : ""}${e.snippet ? `  ${e.snippet}` : ""}`);
  console.log(`    Rule: ${f.source.name} (${f.effective})  ${f.source.url}\n`);
}
if (!scan.findings.length) console.log("No findings. This is not a guarantee of approval or compliance.");
