import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/server/flags";

const PUBLIC_PAGES = ["/", "/for/contractors", "/for/freelancers", "/pricing", "/faq", "/status", "/privacy", "/terms"];

// Absolute URLs need the site's address; without SHIPSHAPE_APP_URL (local runs) the sitemap is empty.
export default function sitemap(): MetadataRoute.Sitemap {
  const site = appUrl();
  return site ? PUBLIC_PAGES.map((page) => ({ url: new URL(page, site).href })) : [];
}
