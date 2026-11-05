import { headers } from "next/headers";
import { LogoMark } from "@/components/ui";
import { introScript } from "@/lib/site-intro";

const OVERLAY_ID = "site-intro";

/**
 * The site's intro (Quiet SPEC §5, lib/site-intro.ts), first in the page: a white screen with the mark over a page that
 * is already rendered under it. Hidden unless its script turns it on, which happens before anything below it is parsed.
 * The script carries this request's CSP nonce (proxy.ts); the overlay's class is the script's, so React keeps it.
 */
export async function SiteIntro() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <div id={OVERLAY_ID} className="site-intro" aria-hidden="true" suppressHydrationWarning>
        <span className="site-intro-mark">
          <LogoMark size={56} />
        </span>
      </div>
      {/* Browsers hide a script's nonce from the DOM once it runs, so hydration sees an empty one. */}
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: introScript(OVERLAY_ID) }} />
    </>
  );
}
