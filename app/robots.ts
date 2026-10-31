import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/server/flags";

// The public site is for search; the app, the secret-link pages (/p, /s, /c) and the API are not.
// Those also answer "noindex" themselves (next.config.ts headers and page metadata).
export default function robots(): MetadataRoute.Robots {
  const site = appUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/p/", "/s/", "/c/", "/api/", "/auth/", "/signin"] },
    ...(site && { sitemap: new URL("/sitemap.xml", site).href }),
  };
}
