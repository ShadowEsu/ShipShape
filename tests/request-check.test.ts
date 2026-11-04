import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ASKED_MAX, askedDocuments, QUOTE_MAX } from "@/lib/request-words";
import { setAiProviderForTests } from "@/lib/server/ai";
import { asUser } from "@/lib/server/db";
import { UserError } from "@/lib/server/errors";
import type { Ctx } from "@/lib/server/profile";
import { readRequestByNames, RequestInputError } from "@/lib/server/request-check";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { fillBucket } from "./support/rate";

/** Check a request without AI (ledger 461): the documents a request names, found by name, against the vault. */

const REQUEST =
  "Hi! Before your crew starts on the Elm St job we need a few things: a completed W-9, a certificate of insurance naming " +
  "Northwind Builders as additional insured, and a copy of your contractor license. Also please send your plumbing permit.";

const kinds = (text: string) => askedDocuments(text).map((d) => [d.kind, d.label]);

describe("what a request names", () => {
  it("lists each document in the order the request names it, quoting the clause that names it", () => {
    expect(askedDocuments(REQUEST)).toEqual([
      { kind: "w9", label: "Form W-9", quote: "a completed W-9" },
      { kind: "coi", label: "Certificate of insurance", quote: "a certificate of insurance naming Northwind Builders as additional insured" },
      { kind: "license", label: "Contractor license", quote: "a copy of your contractor license" },
      { kind: "permit", label: "Plumbing permit", quote: "please send your plumbing permit" },
    ]);
  });

  it("gives longer names their own document: an NDA isn't also an agreement, a license bond isn't also a license", () => {
    expect(kinds("Please sign the non-disclosure agreement and send a license bond.")).toEqual([
      ["nda", "Non-disclosure agreement"],
      ["other", "License bond"],
    ]);
    expect(kinds("Send a W-8BEN, a resale certificate, your certificate of good standing and the master services agreement.")).toEqual([
      ["tax", "W-8BEN"],
      ["tax", "Resale certificate"],
      ["registration", "Certificate of good standing"],
      ["agreement", "Master services agreement"],
    ]);
  });

  it("names a workers' comp certificate as its own document, not as the general liability certificate", () => {
    expect(kinds("A certificate of insurance and a workers' comp certificate.")).toEqual([
      ["coi", "Certificate of insurance"],
      ["other", "Workers' compensation certificate"],
    ]);
  });

  it("counts a document named twice once, and a bare name after a fuller one as that same document", () => {
    expect(kinds("Send your COI today. The COI must name us as additional insured.")).toEqual([["coi", "Certificate of insurance"]]);
    expect(kinds("We need your contractor license. The license must be current, and so must the licenses of your subs.")).toEqual([
      ["license", "Contractor license"],
    ]);
    // Two different licenses stay two.
    expect(kinds("Your business license and your contractor license, please.")).toEqual([
      ["license", "Business license"],
      ["license", "Contractor license"],
    ]);
  });

  it("skips the verb and the phrase: please permit, permit access, in agreement, contract with", () => {
    expect(askedDocuments("Please permit our crew access to the site. We are in agreement on dates and will contract with you.")).toEqual([]);
    expect(kinds("Your permit, a signed agreement and the contract.")).toEqual([
      ["permit", "Permit"],
      ["agreement", "Agreement"],
      ["agreement", "Contract"],
    ]);
  });

  it("finds nothing in text that names no document", () => {
    expect(askedDocuments("Thanks for the call yesterday, see you Monday at 9.")).toEqual([]);
  });

  it("quotes word for word: a slice of the request, cut at a clause, not at a comma inside a number", () => {
    const text = "Send proof of insurance with $1,000,000 per occurrence; and a W-9";
    expect(askedDocuments(text).map((d) => d.quote)).toEqual(["Send proof of insurance with $1,000,000 per occurrence", "a W-9"]);
    for (const d of askedDocuments(REQUEST)) expect(REQUEST).toContain(d.quote);
    // A list's bullets aren't part of the quote.
    expect(askedDocuments("We need:\n- a completed W-9\n• your COI\n2) a signed NDA").map((d) => d.quote)).toEqual(["a completed W-9", "your COI", "a signed NDA"]);
  });

  it("keeps a long clause to its limit, around the words", () => {
    const long = `${"word ".repeat(80)}your plumbing permit ${"word ".repeat(80)}`;
    const [permit] = askedDocuments(long);
    expect(permit.quote.length).toBeLessThanOrEqual(QUOTE_MAX);
    expect(permit.quote).toContain("plumbing permit");
    expect(long).toContain(permit.quote);
  });

  it("lists at most its limit of documents, the first ones named", () => {
    const names = [
      ...["building", "health", "occupancy", "food", "business", "work", "plumbing", "electrical", "mechanical", "fire"].map((q) => `${q} permit`),
      ...["zoning", "demolition", "grading", "encroachment"].map((q) => `${q} permit`),
      ...["contractor", "trade", "state", "liquor", "hvac"].map((q) => `${q} license`),
      ...["surety", "performance", "payment"].map((q) => `${q} bond`),
    ];
    expect(names.length).toBeGreaterThan(ASKED_MAX);
    const asked = askedDocuments(`We need your ${names.join(", your ")}.`);
    expect(asked.map((d) => d.label.toLowerCase())).toEqual(names.slice(0, ASKED_MAX));
  });
});

describe("checking a request by names", () => {
  let db: TestDb;
  let seq = 0;

  async function workspace(): Promise<Ctx> {
    const userId = await db.user(`names${++seq}@example.com`);
    const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Elm Plumbing') as id"));
    return { userId, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Elm Plumbing", role: "owner", today: isoToday() };
  }
  const addDoc = (ctx: Ctx, title: string, kind: string, expiresInDays: number | null) =>
    db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, $2, $3, current_date + $4::int)", [ctx.orgId, title, kind, expiresInDays]),
    );
  const count = async (sql: string, param: string) => (await db.root((tx) => tx.query<{ n: number }>(sql, [param])))[0].n;

  beforeAll(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setAiProviderForTests(null);
  });

  it("answers what you have, what's expired and what's missing, with AI off, and leaves no trace of the text", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "");
    let calls = 0;
    setAiProviderForTests(async () => {
      calls++;
      return { text: "{}", inputTokens: 1, outputTokens: 1, truncated: false };
    });
    const ctx = await workspace();
    await addDoc(ctx, "W-9 2026", "w9", null);
    await addDoc(ctx, "Liability certificate", "coi", -3);
    const items = await readRequestByNames(ctx, REQUEST, "net-1");
    expect(items.map((i) => [i.kind, i.state, i.traced, i.matches.map((m) => m.title)])).toEqual([
      ["w9", "ready", true, ["W-9 2026"]],
      ["coi", "expired", true, ["Liability certificate"]],
      ["license", "missing", true, []],
      ["permit", "missing", true, []],
    ]);
    expect(calls).toBe(0);
    expect(await count("select count(*)::int as n from app.ai_calls where org_id = $1", ctx.orgId)).toBe(0);
    expect(await count("select count(*)::int as n from app.consents where user_id = $1", ctx.userId)).toBe(0);
    expect(await count("select count(*)::int as n from app.audit_log where org_id = $1 and action like 'ai.%'", ctx.orgId)).toBe(0);
  });

  it("doesn't count a general liability certificate as the workers' comp certificate asked for", async () => {
    const ctx = await workspace();
    await addDoc(ctx, "Certificate of liability insurance", "coi", 200);
    const [item] = await readRequestByNames(ctx, "Please send your workers' comp certificate before Monday.", "net-6");
    expect([item.state, item.matches]).toEqual(["unmatched", []]);
  });

  it("refuses text too short or too long for the text field, as the AI does", async () => {
    const ctx = await workspace();
    for (const text of ["W-9 please", "W-9 ".repeat(1600)]) {
      const e = await readRequestByNames(ctx, text, "net-2").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RequestInputError);
      expect(e instanceof RequestInputError && e.field).toBe("text");
    }
  });

  it("stops at 60 checks a person an hour and 180 a network", async () => {
    const ctx = await workspace();
    await fillBucket(db, "check-user", ctx.userId, 59, 3600);
    await expect(readRequestByNames(ctx, REQUEST, "net-3")).resolves.toHaveLength(4);
    await expect(readRequestByNames(ctx, REQUEST, "net-3")).rejects.toThrow("That's the hourly limit for checking requests. Try again in an hour.");

    const other = await workspace();
    await fillBucket(db, "check-net", "net-4", 180, 3600);
    await expect(readRequestByNames(other, REQUEST, "net-4")).rejects.toBeInstanceOf(UserError);
    await expect(readRequestByNames(other, REQUEST, "net-5")).resolves.toHaveLength(4);
  });
});
