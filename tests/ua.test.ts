import { describe, expect, it } from "vitest";
import { uaFamily } from "@/lib/server/ua";

/** The browser and system a session is listed by in Settings (Design row 34, Security condition 2), from real User-Agents. */

const REAL: [string, string][] = [
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari on a Mac"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1", "Safari on an iPhone"],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
    "Chrome on an iPhone",
  ],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15", "Firefox on an iPhone"],
  ["Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1", "Safari on an iPad"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0", "Firefox on Windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", "Chrome on Windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.65", "Edge on Windows"],
  ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 EdgA/123.0.2420.65", "Edge on Android"],
  ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36", "Chrome on Android"],
  [
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
    "Samsung Internet on Android",
  ],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0", "Opera on Windows"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0", "Firefox on Linux"],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", "Chrome on ChromeOS"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", "Chrome on a Mac"],
];

describe("browser and system names", () => {
  it.each(REAL)("%s is %s", (ua, family) => {
    expect(uaFamily(ua)).toBe(family);
  });

  it("an iPad in its default desktop mode sends exactly what a Mac sends, so it is listed as a Mac", () => {
    // iPadOS 17 Safari, as sent by an iPad: the same bytes as Safari on macOS.
    expect(uaFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")).toBe("Safari on a Mac");
  });

  it("says just 'a browser' when it can't tell, and never repeats the User-Agent", () => {
    expect(uaFamily(null)).toBe("a browser");
    expect(uaFamily(undefined)).toBe("a browser");
    expect(uaFamily("")).toBe("a browser");
    expect(uaFamily("curl/8.4.0")).toBe("a browser");
    expect(uaFamily("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("a browser");
    expect(uaFamily(`Mozilla/5.0 (Windows NT 10.0) ${"x".repeat(10_000)}`)).toBe("a browser on Windows");
  });

  it("is never longer than 40 characters, the database's limit", () => {
    for (const [ua] of REAL) expect(uaFamily(ua).length).toBeLessThanOrEqual(40);
  });
});
