import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { Arrive, Celebrate, countDuration, CountUp, easeSmooth } from "@/app/app/motion-moments";

/** The motion moments (Design's shared spec, 4 Nov): what the server HTML holds, and the count-up's timing. */

const html = async (el: Parameters<typeof prerender>[0]) => new Response((await prerender(el)).prelude).text();

describe("motion moments in the server HTML (spec §3.4)", () => {
  it("a count-up is its final number, not 0, before any script runs", async () => {
    expect(await html(createElement(CountUp, { value: 21 }))).toBe('<span class="count-up">21</span>');
  });

  it("a list arrives on its first load, and a celebration starts as the plain check", async () => {
    expect(await html(createElement(Arrive, { list: "t", className: "hair-list" }, createElement("li", null, "a")))).toBe(
      '<ul class="hair-list m-arrive"><li>a</li></ul>',
    );
    const check = await html(createElement(Celebrate, { trigger: "check-all" }, "✓"));
    expect(check).not.toContain("celebrate-burst");
    expect(check).not.toContain("celebrate-check");
  });
});

describe("count-up timing (spec §2)", () => {
  it("runs 700ms under 100, 1000ms under 10,000, and 1200ms above", () => {
    expect([99, 100, 9_999, 10_000, 250_000].map(countDuration)).toEqual([700, 1000, 1000, 1200, 1200]);
  });

  it("eases out on the arrival curve: from 0 to 1, always rising, past halfway by the middle", () => {
    const ys = Array.from({ length: 11 }, (_, i) => easeSmooth(i / 10));
    expect(ys[0]).toBeCloseTo(0, 5);
    expect(ys[10]).toBeCloseTo(1, 5);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    // cubic-bezier(0.22, 1, 0.36, 1) is about 0.9 at x = 0.5.
    expect(ys[5]).toBeGreaterThan(0.85);
  });
});
