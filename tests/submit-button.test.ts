import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { SubmitButton } from "@/components/submit-button";

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
