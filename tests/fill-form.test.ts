import { createElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { ErrorSummary, FillForm, formatSsn } from "@/app/app/make/[template]/fill-form";
import { templateById } from "@/lib/templates/catalog";
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

describe("the W-9's EIN step", () => {
  const w9 = templateById("irs-w9")!;
  const render = async (initial: Record<string, string>, canSaveFacts = true) => {
    const { prelude } = await prerender(createElement(FillForm, { template: w9, initial, chips: {}, ackText: "I agree.", canSaveFacts }));
    return new Response(prelude).text();
  };

  it("with no EIN saved offers a field to type it (hidden from autofill) and a box to save it to Business facts", async () => {
    const html = await render({ tin_kind: "ein", ein: "" });
    expect(html).toMatch(/<input[^>]*id="f-ein"[^>]*type="password"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="save_ein"/);
    expect(textOf(html)).toContain("Also save it to my business facts, stored encrypted");
    expect(textOf(html)).toContain("9 digits, like 12-3456789. It's on the IRS letter that confirmed your EIN (CP 575).");
  });

  it("with an EIN saved shows it masked as a labelled value, with no field and no save box", async () => {
    const html = await render({ tin_kind: "ein", ein: "••-•••6789" });
    expect(html).not.toMatch(/<input[^>]*id="f-ein"/);
    expect(html).not.toContain('name="save_ein"');
    expect(html).toMatch(/<p[^>]*aria-labelledby="f-ein-label"[^>]*>••-•••6789<\/p>/);
  });

  it("for someone who can't change Business facts (a member, a sample workspace) the field is there but the save box isn't", async () => {
    const html = await render({ tin_kind: "ein", ein: "" }, false);
    expect(html).toMatch(/<input[^>]*id="f-ein"[^>]*type="password"/);
    expect(html).not.toContain('name="save_ein"');
  });
});

describe("the W-9's Sign step", () => {
  const w9 = templateById("irs-w9")!;

  it("shows Part II's certification, word for word from the form, above the sign box, and says when the form has to be filled by hand", async () => {
    const { prelude } = await prerender(createElement(FillForm, { template: w9, initial: {}, chips: {}, ackText: "I agree.", canSaveFacts: true }));
    const html = await new Response(prelude).text();
    const sign = /<fieldset[^>]*>(?:(?!<\/fieldset>)[\s\S])*name="sign"[\s\S]*?<\/fieldset>/.exec(html)?.[0] ?? "";
    const text = textOf(sign);
    const certification = text.indexOf("Under penalties of perjury, I certify that:");
    expect(certification).toBeGreaterThan(-1);
    expect(text.indexOf("Sign the certification with my typed name")).toBeGreaterThan(certification);
    expect(sign.match(/<li>/g)).toHaveLength(4);
    expect(text).toContain("The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and");
    expect(text).toContain("I am a U.S. citizen or other U.S. person (defined below); and");
    expect(text).toContain("Certification instructions. You must cross out item 2 above if you have been notified by the IRS");
    expect(text).toContain("item 2 has to be crossed out on the form, which ShipShape can't do: fill in that W-9 by hand instead.");
  });
});
