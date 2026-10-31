import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/server/flags";

// Only the API and the sign-in callback are kept from crawlers. The app (/app, /signin) and the
// secret-link pages (/p, /s, /c) stay crawlable on purpose: they answer "noindex" themselves
// (next.config.ts headers and page metadata), and a crawler only sees that if robots lets it in.
// A Disallowed URL can still be indexed from links to it.
export default function robots(): MetadataRoute.Robots {
  const site = appUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] },
    ...(site && { sitemap: new URL("/sitemap.xml", site).href }),
  };
}
