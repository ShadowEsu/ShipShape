import "server-only";
import { z } from "zod";
import { isPrintable } from "@/lib/pdf/compose";
import { keyedHash, newToken, sha256Hex } from "./crypto";
import { asAnon, asUser } from "./db";
import { DOC_KINDS, downloadName, type DocKind } from "./documents";
import { UserError } from "./errors";
import type { AllowedMime } from "./files";
import { assertWithinPlan } from "./plans";
import type { Ctx } from "./profile";
import { blobStore } from "./storage";

/** Passport links last at most 90 days (Security R6); the person picks how long. */
export const PASSPORT_DAYS = [7, 30, 90] as const;

const NewPassport = z.object({
  label: z.string().trim().min(1, "Name the link, e.g. who it's for.").max(120).refine(isPrintable, "Use letters, numbers and common punctuation."),
  days: z.coerce.number().refine((d) => PASSPORT_DAYS.some((x) => x === d), "Choose how long the link works."),
  documentIds: z.array(z.uuid()).min(1, "Pick at least one document.").max(50),
});

export interface PassportRow {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  documents: number;
  opens: number;
  last_opened: string | null;
}

/**
 * Makes a link to the chosen documents. The token goes only into the URL fragment, which browsers
 * never send to servers or in Referer headers; the database keeps its SHA-256.
 */
export async function createPassport(ctx: Ctx, input: unknown): Promise<{ id: string; token: string }> {
  const p = NewPassport.parse(input);
  const { token, hash } = newToken();
  const id = await asUser(ctx.userId, async (tx) => {
    await assertWithinPlan(tx, ctx, "passports");
    const [link] = await tx.query<{ id: string }>(
      "insert into app.share_links (org_id, label, token_hash, expires_at, created_by) values ($1, $2, $3, now() + make_interval(days => $4), $5) returning id",
      [ctx.orgId, p.label, hash, p.days, ctx.userId],
    );
    // Only active documents of this workspace (the insert trigger rejects any other workspace's).
    const docs = await tx.query<{ id: string }>("select id from app.documents where org_id = $1 and status = 'active' and id = any($2::uuid[])", [
      ctx.orgId,
      p.documentIds,
    ]);
    if (docs.length !== new Set(p.documentIds).size) throw new UserError("Some of those documents aren't in this workspace any more.");
    for (const d of docs) {
      await tx.query("insert into app.share_link_documents (link_id, document_id, org_id) values ($1, $2, $3)", [link.id, d.id, ctx.orgId]);
    }
    return link.id;
  });
  return { id, token };
}

/** The workspace's links, newest first; `onlyId` narrows to one. */
export async function listPassports(ctx: Ctx, onlyId: string | null = null): Promise<PassportRow[]> {
  return asUser(ctx.userId, (tx) =>
    tx.query<PassportRow>(
      `select l.id, l.label, l.expires_at::text as expires_at, l.revoked_at::text as revoked_at, l.created_at::text as created_at,
         (select count(*)::int from app.share_link_documents sd where sd.link_id = l.id) as documents,
         (select count(*)::int from app.share_access a where a.link_id = l.id and a.action = 'opened') as opens,
         (select max(a.at)::text from app.share_access a where a.link_id = l.id) as last_opened
       from app.share_links l where l.org_id = $1 and ($2::uuid is null or l.id = $2) order by l.created_at desc`,
      [ctx.orgId, onlyId],
    ),
  );
}

export interface PassportDetail {
  link: PassportRow;
  documents: { id: string; title: string; kind: DocKind }[];
  /** The latest PASSPORT_ACCESS_SHOWN events, newest first; `moreAccess` when there are older ones (the export has every one). */
  access: { at: string; action: string; title: string | null; visitor: string }[];
  moreAccess: boolean;
}

export const PASSPORT_ACCESS_SHOWN = 200;

export async function getPassport(ctx: Ctx, id: string): Promise<PassportDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [link] = await listPassports(ctx, id);
  if (!link) return null;
  return asUser(ctx.userId, async (tx) => {
    const documents = await tx.query<{ id: string; title: string; kind: DocKind }>(
      "select d.id, d.title, d.kind from app.share_link_documents sd join app.documents d on d.id = sd.document_id where sd.link_id = $1 order by d.title",
      [id],
    );
    // seq (0027) only breaks ties in time. Never select or export it: its gaps count other workspaces' events (Security S-0027a).
    const access = await tx.query<{ at: string; action: string; title: string | null; visitor: string }>(
      "select a.at::text as at, a.action, d.title, a.visitor from app.share_access a left join app.documents d on d.id = a.document_id where a.link_id = $1 order by a.at desc, a.seq desc limit $2",
      [id, PASSPORT_ACCESS_SHOWN + 1],
    );
    return { link, documents, access: access.slice(0, PASSPORT_ACCESS_SHOWN), moreAccess: access.length > PASSPORT_ACCESS_SHOWN };
  });
}

/** How many links that still work (not turned off, not expired) hold this document: archiving takes it off them for good (0041). */
export async function openLinksWith(ctx: Ctx, documentId: string): Promise<number> {
  const [row] = await asUser(ctx.userId, (tx) =>
    tx.query<{ n: number }>(
      "select count(*)::int as n from app.share_link_documents sd join app.share_links l on l.id = sd.link_id where sd.document_id = $1 and l.org_id = $2 and l.revoked_at is null and l.expires_at > now()",
      [documentId, ctx.orgId],
    ),
  );
  return row?.n ?? 0;
}

export async function revokePassport(ctx: Ctx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new UserError("Link not found.");
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("update app.share_links set revoked_at = now() where id = $1 and org_id = $2 and revoked_at is null returning 1", [id, ctx.orgId]),
  );
  if (!rows.length) throw new UserError("That link is already off.");
}

// Public side -------------------------------------------------------------------------------------

/** Cookie that carries a passport token, sent only to that link's own pages (see links.ts). */
export const PASSPORT_COOKIE = "ss_passport";

export interface PublicPassport {
  orgName: string;
  label: string;
  expiresAt: string;
  documents: { id: string; title: string; kind: DocKind; kindLabel: string; issuer: string | null; issued_on: string | null; expires_on: string | null }[];
}

/** A short, non-reversible label for the visitor (keyed hash of the IP), for the owner's access log. */
export const visitorId = (ip: string) => keyedHash(ip, "visitor").slice(0, 16);

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** What a link shows, or null for an unknown, wrong, expired or revoked link (all look the same). */
export async function openPassport(id: string, token: string, ip: string): Promise<PublicPassport | null> {
  if (!z.uuid().safeParse(id).success || !TOKEN.test(token)) return null;
  const rows = await asAnon((tx) =>
    tx.query<{ org_name: string; label: string; expires_at: string; document_id: string; title: string; kind: DocKind; issuer: string | null; issued_on: string | null; expires_on: string | null }>(
      "select org_name, label, expires_at::text as expires_at, document_id, title, kind, issuer, issued_on::text as issued_on, expires_on::text as expires_on from app.passport_open($1, $2, $3)",
      [id, sha256Hex(token), visitorId(ip)],
    ),
  );
  if (!rows.length) return null;
  return {
    orgName: rows[0].org_name,
    label: rows[0].label,
    expiresAt: rows[0].expires_at,
    documents: rows.map((r) => ({ id: r.document_id, title: r.title, kind: r.kind, kindLabel: DOC_KINDS[r.kind], issuer: r.issuer, issued_on: r.issued_on, expires_on: r.expires_on })),
  };
}

/** A 5-minute download link for one document on a valid passport; the access is logged. */
export async function passportFileUrl(id: string, token: string, documentId: string, ip: string): Promise<string | null> {
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(documentId).success || !TOKEN.test(token)) return null;
  const [row] = await asAnon((tx) =>
    tx.query<{ storage_path: string; mime: AllowedMime; title: string; version: number }>(
      "select storage_path, mime, title, version from app.passport_file($1, $2, $3, $4, 'downloaded')",
      [id, sha256Hex(token), documentId, visitorId(ip)],
    ),
  );
  if (!row) return null;
  // Always a download for someone outside the workspace: their browser never renders our files inline.
  return blobStore().signedUrl(row.storage_path, { filename: downloadName(row.title, row.version, row.mime), inline: false });
}
