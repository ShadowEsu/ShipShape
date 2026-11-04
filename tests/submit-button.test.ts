import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { GlassProvider } from "@/components/glass";
import { SubmitButton } from "@/components/submit-button";
import type { GlassLevel } from "@/lib/server/flags";

// The form's status comes from React; the test sets it.
const status = { pending: false };
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), useFormStatus: () => status }));

async function render(level: GlassLevel = "off", className?: string): Promise<string> {
  const button = createElement(SubmitButton, { pendingLabel: "Signing out…", label: "Sign out Chrome on an iPhone", className, children: "Sign out" });
  const { prelude } = await prerender(createElement(GlassProvider, { level }, button));
  return new Response(prelude).text();
}

describe("SubmitButton", () => {
  it("at rest carries the given accessible name over the repeated visible text", async () => {
    status.pending = false;
    const html = await render();
    expect(html).toContain('aria-label="Sign out Chrome on an iPhone"');
    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain('disabled=""');
  });

  it("while sending says so to everyone: the given name steps aside so the sending text is what's read, and it can't be pressed again", async () => {
    status.pending = true;
    const html = await render();
    expect(html).toContain(">Signing out…</button>");
    expect(html).not.toContain("aria-label");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("SubmitButton under glass", () => {
  it("the primary is Glisse's filled button in ink that still submits, says it's sending and can't be pressed again", async () => {
    status.pending = true;
    const html = await render("subtle");
    expect(html).toContain('type="submit"');
    expect(html).toContain('data-variant="filled"');
    expect(html).toContain("--lg-tint:var(--ink)");
    expect(html).toContain(">Signing out…</button>");
    expect(html).not.toContain("aria-label");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
  });

  it("a secondary turns to glass and keeps its other classes; a class Glisse has no look for stays the app's own button", async () => {
    status.pending = false;
    const ghost = await render("full", "btn-ghost w-full");
    expect(ghost).toContain('class="lg-glass lg-button glass-button w-full"');
    expect(ghost).not.toContain("data-variant");
    expect(ghost).toContain('aria-label="Sign out Chrome on an iPhone"');
    const plain = await render("full", "menu-row");
    expect(plain).toContain('class="menu-row"');
    expect(plain).not.toContain("lg-button");
  });
});
