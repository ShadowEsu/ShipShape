/**
 * "Today" is a calendar date, and whose calendar depends on where the person is: at 7 pm in
 * California it is still the 31st, while UTC has moved to the 1st. The browser reports its time
 * zone in a cookie; the server turns that into the viewer's date once per request, and every
 * expiry check and dated form uses that date. Unknown or junk zone: UTC.
 */

export const TZ_COOKIE = "ss_tz";

/** An IANA zone name the runtime knows (`America/Los_Angeles`, `Etc/GMT+5`, `UTC`). */
export function isTimeZone(s: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(s)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date in a zone as YYYY-MM-DD (en-CA formats dates that way). */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The UTC date: the cron's day, and the fallback when the viewer's zone is unknown. */
export const isoToday = () => todayIn("UTC");

/** A date (YYYY-MM-DD, or a timestamp whose first 10 characters are one) in the chips' form ("Nov 7, 2026"), no zone involved. */
export const fmtDay = (iso: string): string => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The calendar day of an instant (a `timestamptz`, as PostgreSQL prints it or ISO) where the viewer is,
 * in the chips' form ("Nov 7, 2026"). A link that ends at 01:00 UTC on the 8th ended on the 7th in Los Angeles.
 */
export function dayOf(instant: string, timeZone: string): string {
  return new Date(instant).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}

/**
 * An instant as the viewer's wall-clock time with the zone's short name ("Nov 1, 2026, 7:04 AM PST";
 * "… UTC" when the zone is unknown), for the owner's History, Versions and access logs.
 */
export function timeOf(instant: string, timeZone: string): string {
  return new Date(instant).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone });
}

/** An instant's wall-clock time where the viewer is ("7:04 AM"), for rows already grouped under their day (History). */
export function clockOf(instant: string, timeZone: string): string {
  return new Date(instant).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

/** Adds days to a YYYY-MM-DD date. */
export function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Validity = "none" | "ok" | "expiring" | "expired";

/** Same rule as the documents SQL: expired after its last day, expiring within 30 days of it. */
export function validityOn(expiresOn: string | null, today: string): Validity {
  if (!expiresOn) return "none";
  if (expiresOn < today) return "expired";
  return expiresOn <= plusDays(today, 30) ? "expiring" : "ok";
}
