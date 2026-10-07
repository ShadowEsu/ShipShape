import { lookup } from "node:dns/promises";
import net from "node:net";
import type { Signals } from "../types";
import { add, checkPolicyMentions, scanText } from "./signals";

const UA = "ShipShapeBot/0.1 (+https://shipshape.dev/bot)";

/** Blocks loopback, private and link local addresses so the checker can't be aimed at internal services. */
function isPrivate(ip: string) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https sites can be checked");
  const addrs = await lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("That address is not a public website");
  return url;
}

async function fetchPage(url: URL, hops = 0): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (hops >= 5) throw new Error("Too many redirects");
    return fetchPage(await assertPublicUrl(new URL(res.headers.get("location")!, url).toString()), hops + 1);
  }
  if (!res.ok) throw new Error(`The site answered with HTTP ${res.status}`);
  return (await res.text()).slice(0, 3_000_000);
}

/** Reads one page's HTML and records trackers, consent, accessibility basics and policy links. */
export function analyzeHtml(signals: Signals, where: string, html: string) {
  add(signals, "platform:web", { file: where });
  scanText(signals, where, html, { secrets: true });

  // Accessibility basics that show up in most ADA website suits.
  if (!/<html[^>]*\slang=["'][^"']+["']/i.test(html)) add(signals, "a11y:no-lang", { file: where, snippet: "The page has no language set on <html>" });
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((t) => !/\salt=/i.test(t));
  if (noAlt.length) add(signals, "a11y:img-alt", { file: where, snippet: `${noAlt.length} of ${imgs.length} images have no alt text` });

  const terms = html.match(/href=["']([^"']*terms[^"']*)["']/i);
  if (terms) add(signals, "doc:terms", { file: new URL(terms[1], where).toString() });
  const privacy = html.match(/href=["']([^"']*privacy[^"']*)["']/i);
  const policyUrl = privacy ? new URL(privacy[1], where).toString() : null;
  if (policyUrl) add(signals, "doc:privacy-policy", { file: policyUrl });
  return { policyUrl };
}

/**
 * Loads a live page the way a first time visitor would, before clicking any banner.
 * Version 1 reads the HTML; version 2 swaps in a real browser to watch network requests.
 */
export async function scanLiveSite(raw: string): Promise<Signals> {
  const url = await assertPublicUrl(raw);
  const signals: Signals = new Map();
  const { policyUrl } = analyzeHtml(signals, url.toString(), await fetchPage(url));
  if (policyUrl) {
    try {
      const policyHtml = await fetchPage(await assertPublicUrl(policyUrl));
      checkPolicyMentions(signals, policyHtml.replace(/<[^>]+>/g, " "), policyUrl);
    } catch {
      // policy page unreachable: the link itself still counts as a policy
    }
  }
  return signals;
}
