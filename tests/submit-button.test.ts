import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { busyButton, SubmitButton } from "@/components/submit-button";

// The form's status comes from React; the test sets it.
const status = { pending: false };
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), useFormStatus: () => status }));

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(SubmitButton, { pendingLabel: "Signing out…", label: "Sign out Chrome on an iPhone", children: "Sign out" }));
  return new Response(prelude).text();
}

describe("SubmitButton", () => {
  it("at rest carries the given accessible name over the repeated visible text", async () => {
    status.pending = false;
    const html = await render();
    expect(html).toContain('aria-label="Sign out Chrome on an iPhone"');
    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("data-busy");
  });

  it("while sending says so to everyone: the given name steps aside so the sending text is what's read; it can't be pressed again yet keeps focus (aria-disabled, not disabled)", async () => {
    status.pending = true;
    const html = await render();
    expect(html).toContain(">Signing out…</button>");
    expect(html).not.toContain("aria-label");
    // A disabled button drops focus to the page, so "Signing out…" would never be read.
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
    // The disabled look (globals.css .btn data-busy:).
    expect(html).toContain('data-busy="true"');
  });
});

describe("busyButton", () => {
  const press = (busy: boolean, onClick?: () => void) => {
    let prevented = false;
    busyButton(busy, onClick).onClick({ preventDefault: () => void (prevented = true) });
    return prevented;
  };

  it("while busy cancels a press (a click, or Enter in a field), so the form isn't sent twice, and doesn't run the button's own action", () => {
    const run = vi.fn();
    expect(press(true, run)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("at rest lets the press through and runs the button's own action", () => {
    const run = vi.fn();
    expect(press(false, run)).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(busyButton(false)).toMatchObject({ "aria-disabled": undefined, "data-busy": undefined });
  });
});
