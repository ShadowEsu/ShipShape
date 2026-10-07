import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Signals } from "../types";
import { add, checkPolicyMentions, scanText } from "./signals";

const run = promisify(execFile);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "Pods", "vendor", ".expo", "DerivedData", "coverage", ".gradle"]);
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|swift|m|mm|h|kt|kts|java|dart|py|rb|go|rs|php|html|htm|vue|svelte|json|plist|xml|gradle|yaml|yml|toml|md|mdx|txt|env|properties|xcprivacy)$/i;
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Podfile.lock", "pubspec.lock", "Gemfile.lock"]);
const MAX_FILES = 5000;
const MAX_BYTES = 1_000_000;

const PRIVACY_FILE = /(^|\/)(privacy[-_ ]?policy[^/]*|privacy\.(md|mdx|html?|txt|tsx?|jsx?)|(privacy|privacy[-_]?policy)\/page\.(tsx?|jsx?|mdx))$/i;
const TERMS_FILE = /(^|\/)(terms[-_ ]?(of[-_ ](service|use))?[^/]*\.(md|mdx|html?|txt|tsx?|jsx?)|terms\/page\.(tsx?|jsx?|mdx))$/i;
const ENV_FILE = /(^|\/)\.env(\.[a-z]+)?$/i;

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        if (entry.name.endsWith(".xcodeproj")) out.push(full);
      } else out.push(full);
    }
  }
  return out;
}

/** Scans a folder on disk and returns the signals found. Never stores the code itself. */
export async function scanDirectory(root: string): Promise<Signals> {
  const signals: Signals = new Map();
  const files = await walk(root);
  let policy: { file: string; text: string } | null = null;

  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const base = path.basename(rel);

    if (rel.endsWith(".xcodeproj") || base === "Podfile" || base === "Info.plist") add(signals, "platform:ios", { file: rel });
    if (base === "AndroidManifest.xml" || base === "build.gradle" || base === "build.gradle.kts") add(signals, "platform:android", { file: rel });
    if (base === "PrivacyInfo.xcprivacy") add(signals, "doc:privacy-manifest", { file: rel });
    if (rel.endsWith(".xcodeproj")) continue;
    if (TERMS_FILE.test(rel)) add(signals, "doc:terms", { file: rel });
    if (ENV_FILE.test(rel) && !/\.(example|sample|template)$/i.test(base)) add(signals, "secret:env-file", { file: rel, snippet: "Environment file committed to the repo" });

    if (LOCKFILES.has(base)) {
      if (base === "package-lock.json") await scanLicenses(signals, full, rel);
      continue;
    }
    if (!TEXT_EXT.test(base) && !["Podfile", "Gemfile", "Dockerfile"].includes(base)) continue;
    const stat = await fs.stat(full);
    if (stat.size > MAX_BYTES) continue;
    const text = await fs.readFile(full, "utf8");

    if (base === "package.json") detectWebPlatform(signals, rel, text);
    if (base === "app.json" && /"ios"\s*:/.test(text)) add(signals, "platform:ios", { file: rel });
    if (base === "app.json" && /"android"\s*:/.test(text)) add(signals, "platform:android", { file: rel });
    if (PRIVACY_FILE.test(rel)) {
      add(signals, "doc:privacy-policy", { file: rel });
      policy ??= { file: rel, text };
      continue; // policy text mentions vendors on purpose; don't treat it as code
    }
    scanText(signals, rel, text, { secrets: !/\.(example|sample|template)$/i.test(base) });
  }

  if (policy) checkPolicyMentions(signals, policy.text, policy.file);
  return signals;
}

function detectWebPlatform(signals: Signals, rel: string, text: string) {
  if (/"(next|react-dom|vue|svelte|@sveltejs\/kit|nuxt|astro|vite)"\s*:/.test(text)) add(signals, "platform:web", { file: rel });
  if (/"(react-native|expo)"\s*:/.test(text)) {
    add(signals, "platform:ios", { file: rel, snippet: "React Native / Expo app" });
    add(signals, "platform:android", { file: rel, snippet: "React Native / Expo app" });
  }
}

/** Reads dependency licenses from package-lock.json (lockfile v2 and v3 record them). */
async function scanLicenses(signals: Signals, full: string, rel: string) {
  try {
    const lock = JSON.parse(await fs.readFile(full, "utf8"));
    for (const [name, info] of Object.entries<{ license?: string; dev?: boolean }>(lock.packages ?? {})) {
      if (!name || info.dev || !info.license) continue;
      if (/(^|[^L])(AGPL|GPL)|SSPL/i.test(info.license)) {
        add(signals, "license:copyleft", { file: rel, snippet: `${name.replace(/^.*node_modules\//, "")} is licensed ${info.license}` });
      }
    }
  } catch {
    // unreadable lockfile: skip license check rather than fail the scan
  }
}

/** Only plain https://github.com/owner/repo URLs are accepted, so nothing else reaches git. */
export function parseGitHubUrl(input: string): string | null {
  const m = input.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}.git` : null;
}

/** Shallow clones a public repo, scans it, and always deletes the clone. */
export async function scanGitHubRepo(url: string): Promise<Signals> {
  const cloneUrl = parseGitHubUrl(url);
  if (!cloneUrl) throw new Error("Use a public GitHub URL like https://github.com/owner/repo");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shipshape-"));
  try {
    await run("git", ["clone", "--depth", "1", "--single-branch", "--filter=blob:limit=1m", "--", cloneUrl, dir], {
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return await scanDirectory(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
