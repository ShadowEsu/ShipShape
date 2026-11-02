import "server-only";
import type { Metadata } from "next";

type Env = Record<string, string | undefined>;

// Search Console and Bing hand out tokens of letters, digits, '-' and '_'; anything else is a paste mistake.
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const token = (value: string | undefined) => (value && TOKEN.test(value.trim()) ? value.trim() : undefined);

/**
 * The site-ownership meta tags for Google Search Console (GOOGLE_SITE_VERIFICATION, the content of its HTML tag
 * method) and Bing Webmaster Tools (BING_SITE_VERIFICATION, its msvalidate.01 tag), or none while unset.
 */
export function siteVerification(env: Env = process.env): Metadata["verification"] {
  const google = token(env.GOOGLE_SITE_VERIFICATION);
  const bing = token(env.BING_SITE_VERIFICATION);
  if (!google && !bing) return undefined;
  return { ...(google && { google }), ...(bing && { other: { "msvalidate.01": bing } }) };
}

/** The IndexNow key (INDEXNOW_KEY, 8-128 letters, digits or '-'), served at /indexnow.txt; null while unset or malformed. */
export function indexNowKey(env: Env = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();
  return key && /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : null;
}

/**
 * Home's structured data: who publishes the site, the site, and the app. Only facts the page shows. No offers while
 * nothing can be bought (payments are in test mode during the preview) and no ratings (there are no reviews).
 */
export function homeJsonLd(site: URL, description: string) {
  const home = new URL("/", site).href;
  const org = `${home}#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": org, name: "ShipShape", url: home },
      { "@type": "WebSite", "@id": `${home}#website`, name: "ShipShape", url: home, publisher: { "@id": org } },
      {
        "@type": "WebApplication",
        "@id": `${home}#app`,
        name: "ShipShape",
        description,
        url: home,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Any (runs in a web browser)",
        publisher: { "@id": org },
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json">: '<' escaped so the text can't close the tag (the Next.js JSON-LD guide). */
export const jsonLdText = (data: object) => JSON.stringify(data).replace(/</g, "\\u003c");
