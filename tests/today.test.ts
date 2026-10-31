import { describe, expect, it } from "vitest";
import { isTimeZone, plusDays, todayIn, validityOn } from "@/lib/today";

/** The viewer's calendar date (lib/today.ts): where the person is, not UTC. */
describe("today", () => {
  it("is the date where the person is: 11:30 pm UTC on the 31st is still the 31st in Los Angeles and already the 1st in Auckland", () => {
    const at = new Date("2026-10-31T23:30:00Z");
    expect(todayIn("UTC", at)).toBe("2026-10-31");
    expect(todayIn("America/Los_Angeles", at)).toBe("2026-10-31");
    expect(todayIn("Pacific/Auckland", at)).toBe("2026-11-01");
    // 2 am UTC on the 1st: the evening of the 31st in the US.
    expect(todayIn("America/New_York", new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
  });

  it("knows real zone names and refuses junk, so a cookie can't break the date", () => {
    for (const ok of ["UTC", "America/Los_Angeles", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "Asia/Kolkata"]) expect(isTimeZone(ok), ok).toBe(true);
    for (const bad of ["", "Mars/Olympus_Mons", "America/Los Angeles", "../etc", "x".repeat(70), "+05:00", "<script>"]) expect(isTimeZone(bad), bad).toBe(false);
  });

  it("counts validity by calendar days: current through the last day, expiring within 30 days, expired after", () => {
    expect(validityOn(null, "2026-10-31")).toBe("none");
    expect(validityOn("2026-10-31", "2026-10-31")).toBe("expiring");
    expect(validityOn("2026-10-30", "2026-10-31")).toBe("expired");
    expect(validityOn("2026-11-30", "2026-10-31")).toBe("expiring");
    expect(validityOn("2026-12-01", "2026-10-31")).toBe("ok");
  });

  it("adds days across month and year ends", () => {
    expect(plusDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(plusDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(plusDays("2026-10-31", 30)).toBe("2026-11-30");
  });
});
