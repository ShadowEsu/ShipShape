import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { connection } from "next/server";
import { appUrl } from "@/lib/server/flags";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
// The italic faces of the same family (the home headline's <em>, the typed signature) aren't preloaded,
// so a page downloads them only when it shows italic serif text. Its variable class only keeps the
// loader in use; text reaches these faces through `font-serif italic`.
const newsreaderItalic = Newsreader({ subsets: ["latin"], style: "italic", variable: "--font-newsreader-italic", display: "swap", preload: false });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const TITLE = "ShipShape: your business paperwork, in one passport";
const DESCRIPTION =
  "Keep your W-9, insurance certificate, licenses and agreements in one place, fill new forms from facts you confirmed once, and share an always-current packet by link. Software, not a law firm.";

// Link previews (app/opengraph-image.tsx) need absolute URLs: SHIPSHAPE_APP_URL, else Next.js's own default.
export const metadata: Metadata = {
  metadataBase: appUrl(),
  title: { default: TITLE, template: "%s · ShipShape" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "ShipShape", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so Next.js can stamp the proxy's CSP nonce on its scripts.
  // A prerendered page has no nonce, and the strict CSP would block all of its JavaScript.
  await connection();
  return (
    <html lang="en" className={`${newsreader.variable} ${newsreaderItalic.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
