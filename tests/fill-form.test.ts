import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { ErrorSummary, formatSsn } from "@/app/app/make/[template]/fill-form";
import { actionsOf, textOf } from "./support/render";

async function render(problems: { key: string; label: string; message: string }[]) {
  const { prelude } = await prerender(createElement(ErrorSummary, { problems }));
  return new Response(prelude).text();
}

describe("the fill form's error summary", () => {
  it("counts the answers to fix and links each one, with its label and what to do, to its field", async () => {
    const html = await render([
      { key: "name", label: "Line 1: Name", message: "Fill this in." },
      { key: "ssn", label: "SSN", message: "Enter the SSN as 9 digits, like 123-45-6789." },
    ]);
    expect(textOf(html)).toContain("2 answers need fixing");
    expect(actionsOf(html)).toEqual([
      { tag: "a", label: "Line 1: Name – Fill this in.", href: "#f-name" },
      { tag: "a", label: "SSN – Enter the SSN as 9 digits, like 123-45-6789.", href: "#f-ssn" },
    ]);
    // It takes focus when it appears, and screen readers announce it.
    expect(html).toMatch(/<div[^>]*tabindex="-1"[^>]*role="alert"/);
  });

  it("speaks of one answer in the singular, and the approval box links to its own id", async () => {
    const html = await render([{ key: "_ack", label: "Approval", message: "Check the box to confirm you've reviewed the document." }]);
    expect(textOf(html)).toContain("1 answer needs fixing");
    expect(actionsOf(html)[0]?.href).toBe("#ack");
  });
});

describe("formatSsn", () => {
  it("shows 9 digits as 123-45-6789 however they were typed, and leaves anything else as typed", () => {
    expect(formatSsn("900123456")).toBe("900-12-3456");
    expect(formatSsn("900 12 3456")).toBe("900-12-3456");
    expect(formatSsn("900-12-3456")).toBe("900-12-3456");
    expect(formatSsn("90012345")).toBe("90012345");
    expect(formatSsn("9001234567")).toBe("9001234567");
    expect(formatSsn("")).toBe("");
  });
});
