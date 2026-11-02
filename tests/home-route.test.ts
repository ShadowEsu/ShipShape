import { describe, expect, it } from "vitest";
import { looksLikeRequest, routeFor } from "@/lib/home-route";

/** What Home's box does with typed words before anything is sent anywhere: which tool, or "check this request". */
describe("routing typed words to a tool", () => {
  it.each([
    ["Make a W-9 for a new customer", { tool: "make", template: "irs-w9" }],
    ["draft an NDA", { tool: "make", template: "common-paper-mnda" }],
    ["send my W-9 to Northwind", { tool: "passport" }],
    ["get W-9s from my subcontractors", { tool: "collect" }],
    ["ask the landlord to sign the lease", { tool: "sign" }],
    ["sign out of this laptop", { tool: "settings" }],
    ["my contractor license expires soon, remind me", { tool: "deadlines" }],
    ["update our EIN", { tool: "facts" }],
    ["upload the insurance certificate", { tool: "add" }],
    ["where is my COI", { tool: "documents" }],
    ["what are they asking for in this email", { tool: "check" }],
  ])("%s", (text, to) => {
    expect(routeFor(text)).toEqual(to);
  });

  it("answers nothing for words no tool covers, rather than guessing", () => {
    expect(routeFor("what's the weather in Austin")).toBeNull();
    expect(routeFor("")).toBeNull();
  });

  it("matches whole words only: 'redesign' and 'assignment' aren't 'sign'", () => {
    expect(routeFor("redesign the logo")).toBeNull();
    expect(routeFor("assignment due Friday")).toEqual({ tool: "deadlines" });
  });
});

describe("spotting a pasted request", () => {
  it("a customer's checklist naming documents is a request", () => {
    expect(
      looksLikeRequest(
        "Hi! Before your crew starts on the Elm St job we need a completed W-9, a certificate of insurance naming Northwind Builders as additional insured, and a copy of your contractor license.",
      ),
    ).toBe(true);
  });

  it("one document named with asking words is a request; one named without them isn't", () => {
    expect(looksLikeRequest("Please send your current certificate of insurance before Monday so we can pay you")).toBe(true);
    expect(looksLikeRequest("I think my insurance renews sometime in the spring this year maybe")).toBe(false);
  });

  it("short commands are never requests, even when they name documents", () => {
    expect(looksLikeRequest("make a W-9 and an NDA")).toBe(false);
  });
});
