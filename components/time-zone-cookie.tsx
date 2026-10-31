"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isTimeZone, TZ_COOKIE } from "@/lib/today";

// Pages whose server render depends on the viewer's date (lib/today.ts). The marketing site doesn't.
const DATED = /^\/(app|p|s|c)(\/|$)/;

/**
 * Tells the server which calendar date the person is on: stores the browser's time zone in a
 * cookie (a year, not HttpOnly: it holds nothing secret, and only the browser knows the zone). The
 * first dated page a browser opens was rendered on UTC; once the cookie is set it is rendered again
 * with the person's date. Every later request carries the cookie.
 */
export function TimeZoneCookie() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!isTimeZone(zone)) return;
    const stored = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1);
    if (stored === zone) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TZ_COOKIE}=${zone}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    if (DATED.test(pathname)) router.refresh();
  }, [router, pathname]);
  return null;
}
