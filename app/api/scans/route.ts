import { buildResult } from "@/lib/scanner";
import { scanLiveSite } from "@/lib/scanner/live";
import { parseGitHubUrl, scanGitHubRepo } from "@/lib/scanner/repo";
import { body, fail, json } from "@/lib/http";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { target } = await body<{ target: string }>(req);
  if (typeof target !== "string" || !/^https?:\/\//.test(target.trim())) return fail("Paste a GitHub repo URL or a website URL starting with https://");
  const url = target.trim();
  try {
    const isRepo = parseGitHubUrl(url) !== null;
    const signals = isRepo ? await scanGitHubRepo(url) : await scanLiveSite(url);
    return json(await store.saveScan(buildResult(url, isRepo ? "repo" : "live", signals)));
  } catch (e) {
    return fail(`Scan failed: ${(e as Error).message}`, 422);
  }
}
