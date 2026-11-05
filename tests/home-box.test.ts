import { createElement, type ReactElement } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { AiBoxView } from "@/app/app/ai-box";
import { RequestAnswer } from "@/app/app/ask/answer";
import { AskForm } from "@/app/app/ask/form";
import { NOT_A_LAW_FIRM } from "@/components/ui";
import type { RequestItem } from "@/lib/server/request-check";

// Security MUST-L1 to L3 (3 Nov): the not-a-law-firm line, word for word and as visible text, beside the tick that
// sends a request to the model, and on every answer to a checked request, on Home and on Check a request alike.

const LINE = "ShipShape is document software, not a law firm, and doesn&#x27;t give legal advice.";
const REQUEST =
  "Hi! Before your crew starts on the Elm St job we need a completed W-9 and a certificate of insurance naming Northwind Builders as additional insured.";

const html = async (el: ReactElement) => new Response((await prerender(el)).prelude).text();
const box = (text: string, aiOn: boolean, more: Partial<Parameters<typeof AiBoxView>[0]> = {}) =>
  html(createElement(AiBoxView, { text, aiOn, ...more }));
/** The visible text: without any screen-reader-only element (MUST-L3). */
const visible = (h: string) => h.replace(/<(\w+) class="[^"]*\bsr-only\b[^"]*"[^>]*>.*?<\/\1>/g, "");

const ITEMS: RequestItem[] = [
  { kind: "w9", label: "W-9", quote: "a completed W-9", traced: true, state: "ready", matches: [{ id: "00000000-0000-4000-8000-000000000001", title: "W-9 (sample)", validity: "none", expires_on: null }] },
  { kind: "coi", label: "Certificate of insurance", quote: "a certificate of insurance", traced: true, state: "missing", matches: [] },
];

describe("Home's box and the legal line", () => {
  it("names the line once, as Security wrote it", () => {
    expect(NOT_A_LAW_FIRM).toBe("ShipShape is document software, not a law firm, and doesn't give legal advice.");
  });

  it("a typed request shows the consent tick with the not-a-law-firm line; the empty box shows neither", async () => {
    const typed = visible(await box(REQUEST, true));
    expect(typed).toContain('name="consent"');
    expect(typed).toContain(LINE);

    const empty = await box("", true);
    expect(empty).not.toContain('name="consent"');
    expect(empty).not.toContain("not a law firm");
  });

  it("with AI off a typed request is still checked: the line shows without the tick; a few words to find a tool show neither", async () => {
    const off = visible(await box(REQUEST, false));
    expect(off).not.toContain('name="consent"');
    expect(off).toContain(LINE);
    expect(off).toContain('aria-label="Check this request"');

    const words = await box("make a w9", true);
    expect(words).not.toContain('name="consent"');
    expect(words).not.toContain("not a law firm");
  });

  it("Home's answer to a checked request carries the line as visible text, with what was asked and what you have", async () => {
    const answer = visible(await box(REQUEST, true, { answer: { kind: "check" }, check: { items: ITEMS, by: "ai" } }));
    const card = answer.slice(answer.indexOf('aria-label="Answer"'));
    expect(card).toContain("The request asks for 2 documents");
    expect(card).toContain(LINE);
    expect(card).toContain("Share the current one in a link");
  });

  it("an answer says who found the items: the AI, or names matched without it", async () => {
    for (const v2 of [true, false]) {
      const ai = visible(await html(createElement(RequestAnswer, { items: ITEMS, titleId: "t", by: "ai", v2 })));
      const names = visible(await html(createElement(RequestAnswer, { items: ITEMS, titleId: "t", by: "names", v2 })));
      expect(ai).toContain("Read by AI.");
      expect(names).toContain("not by AI.");
      expect(names).not.toContain("Read by AI");
    }
    const noneByNames = visible(await html(createElement(RequestAnswer, { items: [], titleId: "t", by: "names" })));
    expect(noneByNames).not.toContain("The AI");
  });

  it("the shared answer carries the line in both looks and when nothing was asked for (Check a request draws the same one)", async () => {
    for (const v2 of [true, false]) {
      for (const items of [ITEMS, []]) {
        const out = visible(await html(createElement(RequestAnswer, { items, titleId: "t", by: "names", v2 })));
        expect(out).toContain(LINE);
      }
    }
    const none = await html(createElement(RequestAnswer, { items: [], titleId: "t", by: "ai" }));
    expect(none).toContain("The request doesn&#x27;t ask for any documents");
    expect(none).not.toContain("in a link");
  });

  it("Check a request's tick carries the line as visible text, in both looks (L5); with AI off there's no tick and the line stays", async () => {
    for (const v2 of [true, false]) {
      const form = visible(await html(createElement(AskForm, { v2, ai: true })));
      const tick = form.indexOf('name="consent"');
      expect(tick).toBeGreaterThan(-1);
      expect(form.indexOf(LINE, tick)).toBeGreaterThan(tick);

      const off = visible(await html(createElement(AskForm, { v2, ai: false })));
      expect(off).not.toContain('name="consent"');
      expect(off).not.toContain("Anthropic");
      expect(off).toContain(LINE);
    }
  });
});
