/**
 * The browser and system a User-Agent names, as Settings lists a session: "Safari on a Mac",
 * "Chrome on an iPhone", "a browser" when neither is known. Only this short name is stored, never
 * the User-Agent itself (Design row 34, Security condition 2).
 *
 * iPadOS Safari sends the same User-Agent as Safari on a Mac (only scripts in the page can tell
 * them apart), so such an iPad is listed as "a Mac". Older iPads that say "iPad" are "an iPad".
 */

// Order matters: Edge, Opera and Samsung Internet also say "Chrome", Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOPiOS\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

// iPhones and iPads also say "like Mac OS X", Android also says "Linux".
const SYSTEMS: [RegExp, string][] = [
  [/\biPad\b/, "an iPad"],
  [/\biPhone\b|\biPod\b/, "an iPhone"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMacintosh\b|\bMac OS X\b/, "a Mac"],
  [/\bLinux\b/, "Linux"],
];

// Real User-Agents are a few hundred characters; anything past this is not worth reading.
const MAX_READ = 512;

export function uaFamily(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, MAX_READ);
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "a browser";
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  return system ? `${browser} on ${system}` : browser;
}
