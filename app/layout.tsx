import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { connection } from "next/server";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import { appUrl } from "@/lib/server/flags";
import { siteVerification } from "@/lib/server/seo";
import "./globals.css";

// Newsreader comes as the static weights the site uses, not the variable files: roman 600 (every
// serif heading is font-semibold) and italic 400 (the typed signature). Each loader asks Google for
// one weight, which serves a static file; two weights in one call get the variable file.
const newsreader = Newsreader({ subsets: ["latin"], weight: "600", variable: "--font-newsreader", display: "swap" });
// The italic face isn't preloaded, so a page downloads it only when it shows a typed signature. Both
// faces share the family name Newsreader; the variable class only keeps the loader in use, and text
// reaches the face through `font-serif italic font-normal`.
const newsreaderItalic400 = Newsreader({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-newsreader-italic-400", display: "swap", preload: false });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const TITLE = "ShipShape: your business paperwork, in one passport";
const DESCRIPTION =
  "Keep your W-9, insurance certificate, licenses and agreements in one place, fill new forms from facts you confirmed once, share the packet with one link, and see what's due before it lapses. Software, not a law firm.";

// Link previews (app/opengraph-image.tsx) need absolute URLs: SHIPSHAPE_APP_URL, else Next.js's own default.
export const metadata: Metadata = {
  metadataBase: appUrl(),
  title: { default: TITLE, template: "%s · ShipShape" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "ShipShape", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // Search Console and Bing Webmaster ownership tags, from env (lib/server/seo.ts); none while unset.
  verification: siteVerification(),
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so Next.js can stamp the proxy's CSP nonce on its scripts.
  // A prerendered page has no nonce, and the strict CSP would block all of its JavaScript.
  await connection();
  return (
    <html lang="en" className={`${newsreader.variable} ${newsreaderItalic400.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg"
        >
          Skip to content
        </a>
        <TimeZoneCookie />
        {children}
      </body>
    </html>
  );
}
