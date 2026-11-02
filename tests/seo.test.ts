import type { Metadata } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata as faq } from "@/app/faq/page";
import { metadata as home } from "@/app/page";
import { metadata as pricing } from "@/app/pricing/page";
import { metadata as privacy } from "@/app/privacy/page";
import sitemap from "@/app/sitemap";
import { metadata as status } from "@/app/status/page";
import { metadata as terms } from "@/app/terms/page";
import { homeJsonLd, indexNowKey, jsonLdText, siteVerification } from "@/lib/server/seo";

const SITE = new URL("https://shipshape.example");

afterEach(() => vi.unstubAllEnvs());

describe("what search engines are told", () => {
  it("every page in the sitemap names itself as canonical and has its own description", () => {
    const pages: Record<string, Metadata> = { "/": home, "/pricing": pricing, "/faq": faq, "/status": status, "/privacy": privacy, "/terms": terms };
    vi.stubEnv("SHIPSHAPE_APP_URL", SITE.href);
    expect(sitemap().map((e) => new URL(e.url).pathname).sort()).toEqual(Object.keys(pages).sort());
    for (const [path, meta] of Object.entries(pages)) {
      expect(meta.alternates?.canonical, path).toBe(path);
      // Home keeps the site's own description (the root layout's); every other page says what it is.
      if (path !== "/") expect(typeof meta.description === "string" && meta.description.length >= 50, path).toBe(true);
    }
  });

  it("Home's structured data claims no price, offer or rating: nothing can be bought yet and there are no reviews", () => {
    const text = jsonLdText(homeJsonLd(SITE, "A sentence from the page."));
    for (const claim of ["offers", "price", "aggregateRating", "review"]) expect(text).not.toContain(claim);
    expect(JSON.parse(text)["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite", "WebApplication"]);
  });

  it("structured data can't close its own script tag, whatever text goes in", () => {
    const text = jsonLdText(homeJsonLd(SITE, "</script><script>alert(1)</script>"));
    expect(text).not.toContain("<");
    expect(JSON.parse(text)["@graph"][2].description).toBe("</script><script>alert(1)</script>");
  });

  it("ownership tags appear only for well-formed tokens, each under its own engine", () => {
    expect(siteVerification({})).toBeUndefined();
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "abcDEF123_-xyz" })).toEqual({ google: "abcDEF123_-xyz" });
    expect(siteVerification({ BING_SITE_VERIFICATION: "0123456789ABCDEF" })).toEqual({ other: { "msvalidate.01": "0123456789ABCDEF" } });
    // A pasted whole tag, or a value with quotes, is refused rather than written into the page.
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="abc" />' })).toBeUndefined();
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: 'abc"onload="x' })).toBeUndefined();
  });

  it("the IndexNow key is served only when it has the shape IndexNow requires", () => {
    expect(indexNowKey({})).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "short" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "has space in it" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: " made-up-test-key " })).toBe("made-up-test-key");
  });
});
