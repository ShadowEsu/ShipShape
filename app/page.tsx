import type { Metadata } from "next";
import { aiEnabled } from "@/lib/server/ai";
import { paymentsLive } from "@/lib/server/billing-config";
import { accountSignIn } from "@/lib/server/cognito";
import { appUrl, realDocsEnabled, uiV2 } from "@/lib/server/flags";
import { homeJsonLd, jsonLdText } from "@/lib/server/seo";
import { PITCH } from "./home-content";
import { HomeQuiet } from "./home-quiet";
import { HomeV1 } from "./home-v1";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** The home page: Quiet, unless SHIPSHAPE_UI=v1 brings back the earlier one exactly as it was. */
export default function Home() {
  // Absolute URLs need the site's address (SHIPSHAPE_APP_URL); local runs without it skip the structured data.
  const site = appUrl();
  const open = { docs: realDocsEnabled(), live: paymentsLive(), ai: aiEnabled() };
  return (
    <>
      {site && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(homeJsonLd(site, PITCH)) }} />}
      {uiV2() ? <HomeQuiet {...open} accounts={accountSignIn(process.env) !== null} /> : <HomeV1 {...open} />}
    </>
  );
}
