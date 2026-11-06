import "server-only";
import { z } from "zod";
import { pageBounds, type Page } from "@/lib/paging";
import type { Validity } from "@/lib/today";
import { asUser, type Tx } from "./db";
import { DOC_KINDS, type DocKind } from "./documents";
import { UserError } from "./errors";
import type { Ctx } from "./profile";

/**
 * Saved (0045): a person's own bookmarks to documents and passport links in their workspace. Personal: row
 * level security shows each person only their own, and nobody else in the workspace sees them. Any member
 * may save, the sample workspace too (it's the visitor's own state, not real data).
 */

export type SavedKind = "document" | "link";

export interface SavedDocument {
  kind: "document";
  id: string;
  title: string;
  /** The document's kind, as the app names it ("W-9"). */
  kindLabel: string;
  expiresOn: string | null;
  validity: Validity;
  href: string;
  savedAt: string;
}

export interface SavedLink {
  kind: "link";
  id: string;
  label: string;
  documents: number;
  expiresAt: string;
  revokedAt: string | null;
  state: "working" | "revoked" | "expired";
  href: string;
  savedAt: string;
}

export type SavedRow = SavedDocument | SavedLink;

/** Shown when a save points at a document or link this workspace no longer has (or an archived document). */
export const SAVED_GONE = "That isn't in this workspace any more, so it can't be saved.";

interface Raw {
  kind: SavedKind;
  id: string;
  saved_at: string;
  title: string | null;
  doc_kind: DocKind | null;
  expires_on: string | null;
  validity: Validity;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  link_state: SavedLink["state"];
  documents: number;
}

// $3 is the viewer's date (ctx.today), as documents.ts's DOC_SELECT. Archived documents and anything deleted
// never show (Security S5; a deleted object's row is gone with it, on delete cascade). Turned-off and expired
// links do, with their state. s.kind and s.object_id last: saves made in one transaction share created_at.
const SAVED_FROM = `
  from app.saved_items s
  left join app.documents d on s.kind = 'document' and d.id = s.object_id and d.org_id = s.org_id and d.status = 'active'
  left join app.share_links l on s.kind = 'link' and l.id = s.object_id and l.org_id = s.org_id
  where s.org_id = $1 and s.user_id = $2 and (d.id is not null or l.id is not null)`;
const LIST_SQL =
  `
  select s.kind, s.object_id::text as id, s.created_at::text as saved_at,
         d.title, d.kind as doc_kind, d.expires_on::text as expires_on,
         case when d.expires_on is null then 'none'
              when d.expires_on < $3::date then 'expired'
              when d.expires_on <= $3::date + 30 then 'expiring'
              else 'ok' end as validity,
         l.label, l.expires_at::text as expires_at, l.revoked_at::text as revoked_at,
         case when l.revoked_at is not null then 'revoked' when l.expires_at <= now() then 'expired' else 'working' end as link_state,
         (select count(*)::int from app.share_link_documents sd where sd.link_id = l.id) as documents
  ` +
  SAVED_FROM +
  ` order by s.created_at desc, s.kind, s.object_id limit $4::int offset $5::int`;
const COUNT_SQL = `select count(*)::int as n` + SAVED_FROM;

function display(r: Raw): SavedRow | null {
  if (r.kind === "document") {
    if (r.title === null || r.doc_kind === null) return null;
    return {
      kind: "document",
      id: r.id,
      title: r.title,
      kindLabel: DOC_KINDS[r.doc_kind],
      expiresOn: r.expires_on,
      validity: r.validity,
      href: `/app/documents/${r.id}`,
      savedAt: r.saved_at,
    };
  }
  if (r.label === null || r.expires_at === null) return null;
  return {
    kind: "link",
    id: r.id,
    label: r.label,
    documents: r.documents,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    state: r.link_state,
    href: `/app/passport/${r.id}`,
    savedAt: r.saved_at,
  };
}

/** How many saved items the Saved page lists at once (saves are one per document or link, which Pro doesn't limit). */
export const SAVED_PAGE_SIZE = 50;

/** One page of the caller's saved documents and links in this workspace, newest first, as display rows. */
export async function pageSaved(ctx: Ctx, wanted = 1, size = SAVED_PAGE_SIZE): Promise<Page<SavedRow>> {
  return asUser(ctx.userId, async (tx) => {
    const [{ n: total }] = await tx.query<{ n: number }>(COUNT_SQL, [ctx.orgId, ctx.userId]);
    const { page, pages } = pageBounds(total, wanted, size);
    const rows = await tx.query<Raw>(LIST_SQL, [ctx.orgId, ctx.userId, ctx.today, size, (page - 1) * size]);
    return { rows: rows.flatMap((r) => display(r) ?? []), total, page, pages };
  });
}

const Kind = z.enum(["document", "link"]);

/** Whether the caller saved this document or link (false for an id that isn't one). */
export async function isSaved(ctx: Ctx, kind: SavedKind, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("select 1 from app.saved_items where org_id = $1 and user_id = $2 and kind = $3 and object_id = $4", [ctx.orgId, ctx.userId, kind, id]),
  );
  return rows.length > 0;
}

/**
 * Saves inside `tx` (the sample seeder's transaction, or setSaved's): an active document or any link of this
 * workspace. Saving twice is one save. Anything else is refused with SAVED_GONE; the insert policy refuses it too.
 */
export async function saveInTx(tx: Tx, ctx: Ctx, kind: SavedKind, id: string): Promise<void> {
  const found =
    kind === "document"
      ? await tx.query("select 1 from app.documents where id = $1 and org_id = $2 and status = 'active'", [id, ctx.orgId])
      : await tx.query("select 1 from app.share_links where id = $1 and org_id = $2", [id, ctx.orgId]);
  if (!found.length) throw new UserError(SAVED_GONE);
  await tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, $3, $4) on conflict do nothing", [ctx.orgId, ctx.userId, kind, id]);
}

const Toggle = z.object({ kind: Kind, id: z.uuid(), saved: z.boolean() });

/**
 * The Save button: `saved` is the state the person asked for (the form sends it, so a second click of the same
 * form changes nothing). Returns the saved thing's page.
 */
export async function setSaved(ctx: Ctx, input: unknown): Promise<string> {
  const t = Toggle.parse(input);
  await asUser(ctx.userId, async (tx) => {
    if (t.saved) await saveInTx(tx, ctx, t.kind, t.id);
    else await tx.query("delete from app.saved_items where org_id = $1 and user_id = $2 and kind = $3 and object_id = $4", [ctx.orgId, ctx.userId, t.kind, t.id]);
  });
  return t.kind === "document" ? `/app/documents/${t.id}` : `/app/passport/${t.id}`;
}
