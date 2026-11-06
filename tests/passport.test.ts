import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { asService, asUser } from "@/lib/server/db";
import { getDocument, pickableDocuments, setArchived } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { LINKS_BUSY } from "@/lib/server/limits";
import type { Ctx } from "@/lib/server/profile";
import { createPassport, getPassport, openLinksWith, openPassport, PASSPORT_ACCESS_SHOWN, PASSPORTS_PAGE_SIZE, pagePassports, passportFileUrl, revokePassport, workingPassports } from "@/lib/server/passport";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { listDocuments } from "./support/documents";
import { fillBucket } from "./support/rate";

/** Passport links (Security R6): secret in the fragment, hashed at rest, expiring, revocable, logged. */

let db: TestDb;
let blobDir: string;
let a: Ctx;
let b: Ctx;
const IP = "203.0.113.7";

async function sampleWorkspace(email: string): Promise<Ctx> {
  const userId = await db.user(email);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Sample", role: "owner", today: isoToday() };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-passport-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  a = await sampleWorkspace("a@example.com");
  b = await sampleWorkspace("b@example.com");
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

const docIds = async (ctx: Ctx) => (await listDocuments(ctx)).map((d) => d.id);

describe("passport links", () => {
  it("shows exactly the chosen documents to someone with the full link", async () => {
    const [w9, coi] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "For Northwind", days: 30, documentIds: [w9, coi] });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const open = await openPassport(id, token, IP);
    expect(open?.documents.map((d) => d.id).sort()).toEqual([w9, coi].sort());
    expect(open?.label).toBe("For Northwind");
  });

  it("stores only the token's hash, which members can't even read", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Hash check", days: 7, documentIds: [w9] });
    const [row] = await db.root((tx) => tx.query<{ token_hash: string }>("select token_hash from app.share_links where id = $1", [id]));
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(asUser(a.userId, (tx) => tx.query("select token_hash from app.share_links where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("gives the same nothing for a wrong token, a revoked link and an expired link", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Lifecycle", days: 7, documentIds: [w9] });
    expect(await openPassport(id, token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), IP)).toBeNull();
    expect(await openPassport(id, "short", IP)).toBeNull();
    expect(await openPassport("not-a-uuid", token, IP)).toBeNull();

    await revokePassport(a, id);
    expect(await openPassport(id, token, IP)).toBeNull();
    expect(await passportFileUrl(id, token, w9, IP)).toBeNull();
    await expect(revokePassport(a, id)).rejects.toThrow(UserError);

    const other = await createPassport(a, { label: "Expiring", days: 7, documentIds: [w9] });
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [other.id]));
    expect(await openPassport(other.id, other.token, IP)).toBeNull();
  });

  it("never lasts more than 90 days, even when the app is bypassed", async () => {
    const [w9] = await docIds(a);
    await expect(createPassport(a, { label: "Too long", days: 365, documentIds: [w9] })).rejects.toThrow();
    await expect(
      asUser(a.userId, (tx) =>
        tx.query("insert into app.share_links (org_id, label, token_hash, expires_at, created_by) values ($1, 'x', $2, now() + interval '91 days', $3)", [
          a.orgId,
          "d".repeat(64),
          a.userId,
        ]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("lasts 7, 30 or 90 days: 90 is taken, 91 is a form error", async () => {
    const [w9] = await docIds(a);
    await createPassport(a, { label: "Ninety", days: 90, documentIds: [w9] });
    await expect(createPassport(a, { label: "Ninety-one", days: 91, documentIds: [w9] })).rejects.toThrow(ZodError);
  });

  it("takes a label of up to 120 characters; 121 is a form error", async () => {
    const [w9] = await docIds(a);
    await createPassport(a, { label: "L".repeat(120), days: 7, documentIds: [w9] });
    await expect(createPassport(a, { label: "L".repeat(121), days: 7, documentIds: [w9] })).rejects.toThrow(ZodError);
  });

  it("takes up to 50 documents in one request; 51 is a form error", async () => {
    const [w9] = await docIds(a);
    await createPassport(a, { label: "Fifty", days: 7, documentIds: Array(50).fill(w9) });
    await expect(createPassport(a, { label: "Fifty-one", days: 7, documentIds: Array(51).fill(w9) })).rejects.toThrow(ZodError);
  });

  it("needs at least one document, and makes no link without one", async () => {
    const before = (await pagePassports(a)).total;
    await expect(createPassport(a, { label: "Empty", days: 7, documentIds: [] })).rejects.toThrow(ZodError);
    expect((await pagePassports(a)).total).toBe(before);
  });

  it("answers 'not found' for a malformed link id when turning a link off", async () => {
    await expect(revokePassport(a, "not-a-uuid")).rejects.toThrow(UserError);
  });

  it("W15-2 links: past 30 new links in an hour a person is refused with nothing made; someone else isn't", async () => {
    const busy = await sampleWorkspace("links-busy@example.com");
    const [w9] = await docIds(busy);
    await fillBucket(db, "links", busy.userId, 30, 3600);
    await expect(createPassport(busy, { label: "One too many", days: 7, documentIds: [w9] })).rejects.toThrow(new UserError(LINKS_BUSY));
    expect(LINKS_BUSY).toBe("That's the hourly limit for new links. Nothing was made; try again in an hour.");
    expect((await pagePassports(busy)).rows).toEqual([]);
    const next = await sampleWorkspace("links-next@example.com");
    const [theirs] = await docIds(next);
    expect((await createPassport(next, { label: "Still fine", days: 7, documentIds: [theirs] })).token).toBeTruthy();
  });

  it("can't include another workspace's documents, and others can't see or revoke the link", async () => {
    const [mine] = await docIds(a);
    const [theirs] = await docIds(b);
    await expect(createPassport(a, { label: "Sneaky", days: 7, documentIds: [mine, theirs] })).rejects.toThrow(UserError);
    const { id } = await createPassport(a, { label: "Private", days: 7, documentIds: [mine] });
    expect((await pagePassports(b)).rows).toEqual([]);
    expect(await getPassport(b, id)).toBeNull();
    await expect(revokePassport(b, id)).rejects.toThrow(UserError);
    const rows = await asUser(b.userId, (tx) => tx.query("update app.share_links set revoked_at = now() where id = $1 returning 1", [id]));
    expect(rows).toEqual([]);
  });

  it("logs each open and download for the owner, with a visitor hash instead of the IP", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Logged", days: 7, documentIds: [w9] });
    await openPassport(id, token, IP);
    const url = await passportFileUrl(id, token, w9, IP);
    const file = verifyFileParams(new URL(url!, "http://x").searchParams);
    expect(file?.inline).toBe(false);
    expect(file?.objectPath.startsWith(`${a.orgId}/${w9}/`)).toBe(true);

    const detail = await getPassport(a, id);
    expect(detail?.link.opens).toBe(1);
    expect(detail?.access.map((x) => x.action)).toEqual(["downloaded", "opened"]);
    expect(detail?.access.every((x) => /^[0-9a-f]{16}$/.test(x.visitor))).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(IP);
    // The document's own History has the download too (wave 8 #3): an outsider's row that names the link, in the hash chain.
    const history = (await getDocument(a, w9))!.audit.filter((e) => e.action.startsWith("document.link_"));
    expect(history.map((e) => [e.action, e.actor_is_me, e.about_name])).toEqual([["document.link_downloaded", false, "Logged"]]);
    const verify = async () => (await asUser(a.userId, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1)::text as broken", [a.orgId])))[0].broken;
    expect(await verify()).toBeNull();
    // Pointing the row at another link breaks the chain (0038: `about` is hashed with the rest).
    const other = await createPassport(a, { label: "Other", days: 7, documentIds: [w9] });
    const [row] = await db.root((tx) =>
      tx.query<{ seq: string }>("update app.audit_log set about = $2 where org_id = $1 and action = 'document.link_downloaded' returning seq::text", [a.orgId, other.id]),
    );
    expect(await verify()).toBe(row.seq);
    await db.root((tx) => tx.query("update app.audit_log set about = $2 where org_id = $1 and action = 'document.link_downloaded'", [a.orgId, id]));
    expect(await verify()).toBeNull();

    // Events in the same instant (PGlite's clock counts milliseconds) still list newest first.
    await db.root((tx) => tx.query("update app.share_access set at = '2026-10-31 12:00:00+00' where link_id = $1", [id]));
    expect((await getPassport(a, id))?.access.map((x) => x.action)).toEqual(["downloaded", "opened"]);
  });

  it("archiving takes a document off every link for good: restoring doesn't put it back, and the owner's page lists it no more (W14-3)", async () => {
    const ctx = await sampleWorkspace("archive-unshare@example.com");
    const [w9, coi, third] = await docIds(ctx);
    const { id, token } = await createPassport(ctx, { label: "Archive", days: 7, documentIds: [w9, coi] });
    const other = await createPassport(ctx, { label: "Other", days: 7, documentIds: [coi] });
    const off = await createPassport(ctx, { label: "Off", days: 7, documentIds: [coi] });
    await revokePassport(ctx, off.id);
    const expired = await createPassport(ctx, { label: "Expired", days: 7, documentIds: [coi] });
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [expired.id]));
    expect(await passportFileUrl(id, token, third, IP)).toBeNull();
    // What the Archive button warns about: the two links that still work, not the one turned off or the expired one.
    expect(await openLinksWith(ctx, coi)).toBe(2);
    expect(await openLinksWith(b, coi)).toBe(0);

    await setArchived(ctx, coi, true);
    expect((await openPassport(id, token, IP))?.documents.map((d) => d.id)).toEqual([w9]);
    expect(await passportFileUrl(id, token, coi, IP)).toBeNull();
    expect((await getPassport(ctx, id))?.documents.map((d) => d.id)).toEqual([w9]);
    expect(Object.fromEntries((await pagePassports(ctx)).rows.map((l) => [l.label, l.documents]))).toEqual({ Archive: 1, Other: 0, Off: 0, Expired: 0 });
    expect(await openLinksWith(ctx, coi)).toBe(0);

    await setArchived(ctx, coi, false);
    expect((await openPassport(id, token, IP))?.documents.map((d) => d.id)).toEqual([w9]);
    expect(await openPassport(other.id, other.token, IP)).toBeNull();
    expect(await passportFileUrl(id, token, coi, IP)).toBeNull();
    expect(await openLinksWith(ctx, coi)).toBe(0);
    // Archiving the last one leaves the link holding nothing: the owner's page says so (Design, wave 14).
    await setArchived(ctx, w9, true);
    expect((await getPassport(ctx, id))?.documents).toEqual([]);
    expect(await openPassport(id, token, IP)).toBeNull();
  });

  it("the owner's page shows the latest 200 opens and downloads, and says when there are more (W14-8)", async () => {
    const [w9] = await docIds(a);
    const { id } = await createPassport(a, { label: "Busy", days: 7, documentIds: [w9] });
    const add = (n: number) =>
      db.root((tx) =>
        tx.query("insert into app.share_access (link_id, org_id, action, visitor) select $1, $2, 'opened', lpad(to_hex(g), 16, '0') from generate_series(1, $3::int) g", [id, a.orgId, n]),
      );
    await add(PASSPORT_ACCESS_SHOWN);
    const all = await getPassport(a, id);
    expect(all?.access).toHaveLength(PASSPORT_ACCESS_SHOWN);
    expect(all?.moreAccess).toBe(false);
    await add(1);
    const p = await getPassport(a, id);
    expect(p?.access).toHaveLength(PASSPORT_ACCESS_SHOWN);
    expect(p?.moreAccess).toBe(true);
  });

  it("lists links a page at a time, newest first, or with the working ones first; Home's working links are the newest that work", async () => {
    const ctx = await sampleWorkspace("links-paged@example.com");
    const total = PASSPORTS_PAGE_SIZE + 3;
    // L01 is the newest. Every fifth is turned off; every seventh ended (35 both); the rest work.
    await db.root((tx) =>
      tx.query(
        `insert into app.share_links (org_id, label, token_hash, created_at, expires_at, revoked_at)
         select $1, 'L' || lpad(n::text, 2, '0'), md5(n::text || $1::text) || md5('x' || n::text || $1::text), now() - make_interval(mins => n),
                case when n % 7 = 0 then now() - make_interval(mins => n) + interval '30 seconds' else now() + interval '7 days' end,
                case when n % 5 = 0 then now() end
         from generate_series(1, $2::int) n`,
        [ctx.orgId, total],
      ),
    );
    const label = (n: number) => `L${String(n).padStart(2, "0")}`;
    const ns = Array.from({ length: total }, (_, i) => i + 1);
    const works = (n: number) => n % 5 !== 0 && n % 7 !== 0;

    const first = await pagePassports(ctx);
    expect(first).toMatchObject({ total, page: 1, pages: 2 });
    expect(first.rows.map((l) => l.label)).toEqual(ns.slice(0, PASSPORTS_PAGE_SIZE).map(label));
    const last = await pagePassports(ctx, { page: 2 });
    expect(last.rows.map((l) => l.label)).toEqual(ns.slice(PASSPORTS_PAGE_SIZE).map(label));
    // A page past the end is the last page; below the start, the first.
    expect(await pagePassports(ctx, { page: 99 })).toEqual(last);
    expect((await pagePassports(ctx, { page: 0 })).rows).toEqual(first.rows);

    // Working first across the pages, each part newest first.
    const ordered = [...(await pagePassports(ctx, { workingFirst: true })).rows, ...(await pagePassports(ctx, { workingFirst: true, page: 2 })).rows];
    expect(ordered.map((l) => l.label)).toEqual([...ns.filter(works), ...ns.filter((n) => !works(n))].map(label));

    expect((await workingPassports(ctx, 3)).map((l) => l.label)).toEqual(["L01", "L02", "L03"]);
    expect((await workingPassports(b, 3)).map((l) => l.label)).not.toContain("L01");
  });

  it("offers the documents that expire soonest up to its limit, plus any the address ticks, and counts the rest", async () => {
    const ids = await docIds(a);
    const [theirs] = await docIds(b);
    const n = ids.length;
    expect(n).toBeGreaterThan(3);
    expect(await pickableDocuments(a, [], n)).toMatchObject({ left: 0 });
    expect((await pickableDocuments(a, [], n)).docs.map((d) => d.id)).toEqual(ids);
    const capped = await pickableDocuments(a, [], 2);
    expect([capped.docs.map((d) => d.id), capped.left]).toEqual([ids.slice(0, 2), n - 2]);
    // A ticked document past the limit is offered after the rest; a malformed id and another workspace's are not.
    const ticked = await pickableDocuments(a, ["not-a-uuid", ids[n - 1], theirs, ids[0]], 2);
    expect([ticked.docs.map((d) => d.id), ticked.left]).toEqual([[ids[0], ids[1], ids[n - 1]], n - 3]);
  });

  it("records creating and revoking in the workspace history", async () => {
    const [w9] = await docIds(a);
    const { id } = await createPassport(a, { label: "Audited", days: 7, documentIds: [w9] });
    await revokePassport(a, id);
    const rows = await db.root((tx) =>
      tx.query<{ action: string; actor: string }>("select action, actor from app.audit_log where org_id = $1 and object_id = $2 order by seq", [a.orgId, id]),
    );
    expect(rows).toEqual([
      { action: "passport.created", actor: a.userId },
      { action: "passport.revoked", actor: a.userId },
    ]);
  });
});
