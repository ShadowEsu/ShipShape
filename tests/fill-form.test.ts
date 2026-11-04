import { createElement, createRef } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { ErrorSummary, FillForm, formatSsn, headingFocusDue, Message, SavedEinNote } from "@/app/app/make/[template]/fill-form";
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

describe("headingFocusDue: when a change of step moves focus to the heading", () => {
  const ok = { at: 1 };
  const failed = { at: 1, errors: { tax_class: "Choose one." } };

  it("moves on Continue, Back and the review arriving (each a fresh result without errors); not when nothing changed", () => {
    // Continue: a new result, one step on.
    expect(headingFocusDue({ current: 0, reviewing: false, state: { at: 0 } }, { current: 1, reviewing: false, state: { at: 1 } })).toBe(true);
    // Back is client-only: the same result, one step back.
    expect(headingFocusDue({ current: 1, reviewing: false, state: ok }, { current: 0, reviewing: false, state: ok })).toBe(true);
    // The review arriving: a new result that says so.
    expect(headingFocusDue({ current: 3, reviewing: false, state: ok }, { current: 3, reviewing: true, state: { review: true } })).toBe(true);
    expect(headingFocusDue({ current: 1, reviewing: false, state: ok }, { current: 1, reviewing: false, state: ok })).toBe(false);
  });

  it("leaves a fresh result with errors to the summary, but still moves on Back after that failed check", () => {
    // A check that fails on another step: the summary takes focus, not the heading.
    expect(headingFocusDue({ current: 0, reviewing: false, state: ok }, { current: 1, reviewing: false, state: failed })).toBe(false);
    // The same failed result, still on screen, and the person presses Back: the heading moves (the Back button unmounts).
    expect(headingFocusDue({ current: 1, reviewing: false, state: failed }, { current: 0, reviewing: false, state: failed })).toBe(true);
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
    // A label applies to an <output> (it didn't to the <p> with aria-labelledby this was): the value is read with its name.
    expect(html).toMatch(/<label id="f-ein-label" for="f-ein-value" class="label">[\s\S]*?EIN[\s\S]*?<\/label>/);
    expect(html).toMatch(/<output id="f-ein-value" class="block font-mono text-sm"[^>]*>••-•••6789<\/output>/);
    expect(html).not.toContain('aria-labelledby="f-ein-label"');
  });

  it("for someone who can't change Business facts (a member, a sample workspace) the field is there but the save box isn't", async () => {
    const html = await render({ tin_kind: "ein", ein: "" }, false);
    expect(html).toMatch(/<input[^>]*id="f-ein"[^>]*type="password"/);
    expect(html).not.toContain('name="save_ein"');
  });

  it("has a step heading that can take focus, so a step change is read out instead of dropping focus to the page", async () => {
    const html = await render({ tin_kind: "ein", ein: "" });
    expect(textOf(/<h2[^>]*tabindex="-1"[^>]*>[\s\S]*?<\/h2>/.exec(html)?.[0] ?? "")).toMatch(/^Step 1 of 4\s*Who.s filling it in$/);
  });
});

describe("the review row for a saved EIN", () => {
  const render = async (canSaveFacts: boolean, member: boolean) => {
    const { prelude } = await prerender(createElement(SavedEinNote, { canSaveFacts, member }));
    return new Response(prelude).text();
  };

  it("links to Business facts for those who can change them", async () => {
    const html = await render(true, false);
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Change in Business facts", href: "/app/facts" }]);
  });

  it("tells a member who can, with nothing to press", async () => {
    const html = await render(false, true);
    expect(textOf(html)).toBe("Only an owner or admin can change this.");
    expect(actionsOf(html)).toEqual([]);
  });

  it("says nothing in the sample workspace, where nobody can", async () => {
    expect(await render(false, false)).toBe("");
  });
});

describe("the fill form's message box", () => {
  const render = async (text: string, fix?: { href: string; label: string }) => {
    const { prelude } = await prerender(createElement(Message, { text, fix }));
    return new Response(prelude).text();
  };

  it("is an alert that can take focus, and shows the one fix as a link when there is one", async () => {
    const html = await render("The Free plan holds 10 active documents.", { href: "/app/documents", label: "Choose one to archive" });
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*tabindex="-1"/);
    expect(textOf(html)).toMatch(/^The Free plan holds 10 active documents\.\s*Choose one to archive$/);
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Choose one to archive", href: "/app/documents" }]);
  });

  it("hands the form's ref to the alert box itself, so a refusal can move focus there", () => {
    const ref = createRef<HTMLDivElement>();
    const box = Message({ text: "Real documents aren't open yet.", ref });
    expect(box.props.role).toBe("alert");
    expect(box.props.ref).toBe(ref);
  });

  it("without a fix is the message alone", async () => {
    const html = await render("Real documents aren't open yet.");
    expect(textOf(html)).toBe("Real documents aren't open yet.");
    expect(actionsOf(html)).toEqual([]);
  });
});
