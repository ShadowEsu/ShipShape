import "server-only";
import { z } from "zod";
import type { IconName } from "@/components/icons";
import { historyIcon, historyLabel, historyWho, type HistoryTab } from "@/lib/history";
import { csvCell } from "./csv";
import { asUser } from "./db";
import type { Ctx } from "./profile";

/**
 * Sent, Signed copies and History (calm v2, PR 4): what this workspace sent out and what happened to it, read from
 * tables it already keeps (links and their visits, signature requests, the audit log). Every read runs as the
 * signed-in member under row level security and names this workspace (Security S1). Archived and deleted documents
 * never come back: requests and signed copies are listed only for active documents, and a History row about one
 * says "a document" (S5). Link visitors are counted, never named (S3); a signer is the name the owner typed (S4).
 */

/** The date menus' choices (days back); Sent also has "all time". */
export const ACTIVITY_DAYS = [7, 30, 90] as const;
export type ActivityDays = (typeof ACTIVITY_DAYS)[number];
/** Reads a `?days=` value: one of the choices, or null (Sent: all time; History falls back to its default). */
export const daysParam = (v: unknown): ActivityDays | null => ACTIVITY_DAYS.find((d) => String(d) === v) ?? null;

/** The most rows a list shows; the page says so when there are more. */
export const SENT_SHOWN = 200;
export const HISTORY_SHOWN = 200;

export interface SentLink {
  kind: "link";
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Active documents on the link. */
  documents: number;
  opens: number;
  downloads: number;
  mine: boolean;
}

export interface SentSignature {
  kind: "signature";
  id: string;
  documentId: string;
  /** The document's title. */
  title: string;
  /** The name the owner typed when asking (S4); never the email here. */
  signerName: string;
  status: "pending" | "signed" | "declined" | "revoked";
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
  signedVersion: number | null;
  consentedAt: string | null;
  mine: boolean;
}

export type SentRow = SentLink | SentSignature;

const LINKS_SQL = `
  select l.id, l.label, l.created_at::text as created_at, l.expires_at::text as expires_at, l.revoked_at::text as revoked_at,
         coalesce(l.created_by = $2, false) as mine,
         (select count(*)::int from app.share_link_documents sd join app.documents d on d.id = sd.document_id and d.status = 'active'
           where sd.link_id = l.id) as documents,
         (select count(*)::int from app.share_access a where a.link_id = l.id and a.action = 'opened') as opens,
         (select count(*)::int from app.share_access a where a.link_id = l.id and a.action = 'downloaded') as downloads
  from app.share_links l
  where l.org_id = $1 and ($3::int is null or l.created_at >= now() - make_interval(days => $3)) and ($4::uuid is null or l.id = $4)
  order by l.created_at desc, l.id
  limit $5`;

// Requests on active documents only: an archived document's requests are withdrawn and stay off (S5).
const SIGNATURES_SQL = `
  select r.id, r.document_id, d.title, r.signer_name, r.status, r.created_at::text as created_at, r.expires_at::text as expires_at,
         r.signed_at::text as signed_at, r.signed_version, r.consented_at::text as consented_at, coalesce(r.created_by = $2, false) as mine
  from app.signature_requests r
  join app.documents d on d.id = r.document_id and d.org_id = r.org_id and d.status = 'active'
  where r.org_id = $1 and ($3::int is null or r.created_at >= now() - make_interval(days => $3)) and ($4::uuid is null or r.id = $4)
    and ($6::boolean is false or r.status = 'signed')
  order by coalesce(r.signed_at, r.created_at) desc, r.id
  limit $5`;

interface LinkRaw {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  mine: boolean;
  documents: number;
  opens: number;
  downloads: number;
}
interface SignatureRaw {
  id: string;
  document_id: string;
  title: string;
  signer_name: string;
  status: SentSignature["status"];
  created_at: string;
  expires_at: string;
  signed_at: string | null;
  signed_version: number | null;
  consented_at: string | null;
  mine: boolean;
}

const link = (r: LinkRaw): SentLink => ({
  kind: "link",
  id: r.id,
  label: r.label,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  documents: r.documents,
  opens: r.opens,
  downloads: r.downloads,
  mine: r.mine,
});
const signature = (r: SignatureRaw): SentSignature => ({
  kind: "signature",
  id: r.id,
  documentId: r.document_id,
  title: r.title,
  signerName: r.signer_name,
  status: r.status,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  signedAt: r.signed_at,
  signedVersion: r.signed_version,
  consentedAt: r.consented_at,
  mine: r.mine,
});

/** What this workspace sent: passport links and signature requests, newest first, from the last `days` (all when null). */
export async function listSent(ctx: Ctx, days: ActivityDays | null): Promise<SentRow[]> {
  const [links, signatures] = await asUser(ctx.userId, (tx) =>
    Promise.all([
      tx.query<LinkRaw>(LINKS_SQL, [ctx.orgId, ctx.userId, days, null, SENT_SHOWN]),
      tx.query<SignatureRaw>(SIGNATURES_SQL, [ctx.orgId, ctx.userId, days, null, SENT_SHOWN, false]),
    ]),
  );
  return [...links.map(link), ...signatures.map(signature)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, SENT_SHOWN);
}

/** Signed copies: the signature requests that were signed, on active documents, newest signature first. */
export async function listSignedCopies(ctx: Ctx): Promise<SentSignature[]> {
  const rows = await asUser(ctx.userId, (tx) => tx.query<SignatureRaw>(SIGNATURES_SQL, [ctx.orgId, ctx.userId, null, null, SENT_SHOWN, true]));
  return rows.map(signature);
}

export interface SentLinkDetail {
  row: SentLink;
  /** The active documents on the link. */
  documents: { id: string; title: string }[];
  /** Opens, views and downloads as counts; distinct visitors as a number only (S3). */
  opened: { count: number; visitors: number; first: string | null; last: string | null };
  viewed: number;
  /** Downloads per document; a document since archived or deleted is "a document" (S5). */
  downloads: { title: string; count: number; first: string }[];
}

export interface SentSignatureDetail {
  row: SentSignature;
  /** When the signer first downloaded the file to sign (0038's row about this request), if they did. */
  fileDownloaded: string | null;
}

const uuid = z.uuid();

/** A link's detail for Sent: its documents and what happened to it, counted (S3). Null when it isn't this workspace's. */
export async function sentLink(ctx: Ctx, id: string): Promise<SentLinkDetail | null> {
  if (!uuid.safeParse(id).success) return null;
  return asUser(ctx.userId, async (tx) => {
    const [raw] = await tx.query<LinkRaw>(LINKS_SQL, [ctx.orgId, ctx.userId, null, id, 1]);
    if (!raw) return null;
    const documents = await tx.query<{ id: string; title: string }>(
      "select d.id, d.title from app.share_link_documents sd join app.documents d on d.id = sd.document_id and d.status = 'active' where sd.link_id = $1 and d.org_id = $2 order by d.title",
      [id, ctx.orgId],
    );
    const counts = await tx.query<{ action: string; n: number; visitors: number; first: string; last: string }>(
      "select a.action, count(*)::int as n, count(distinct a.visitor)::int as visitors, min(a.at)::text as first, max(a.at)::text as last from app.share_access a where a.link_id = $1 and a.org_id = $2 group by a.action",
      [id, ctx.orgId],
    );
    const downloads = await tx.query<{ title: string | null; n: number; first: string }>(
      `select d.title, count(*)::int as n, min(a.at)::text as first
       from app.share_access a left join app.documents d on d.id = a.document_id and d.status = 'active'
       where a.link_id = $1 and a.org_id = $2 and a.action = 'downloaded'
       group by d.id, d.title order by min(a.at)`,
      [id, ctx.orgId],
    );
    const of = (action: string) => counts.find((c) => c.action === action);
    const opened = of("opened");
    return {
      row: link(raw),
      documents,
      opened: { count: opened?.n ?? 0, visitors: opened?.visitors ?? 0, first: opened?.first ?? null, last: opened?.last ?? null },
      viewed: of("viewed")?.n ?? 0,
      downloads: downloads.map((d) => ({ title: d.title ?? "a document", count: d.n, first: d.first })),
    };
  });
}

/** A signature request's detail for Sent. Null when it isn't this workspace's, or its document is archived or gone (S5). */
export async function sentSignature(ctx: Ctx, id: string): Promise<SentSignatureDetail | null> {
  if (!uuid.safeParse(id).success) return null;
  return asUser(ctx.userId, async (tx) => {
    const [raw] = await tx.query<SignatureRaw>(SIGNATURES_SQL, [ctx.orgId, ctx.userId, null, id, 1, false]);
    if (!raw) return null;
    const row = signature(raw);
    // A withdrawn or declined request keeps its row and shows nothing new (S4).
    if (row.status === "revoked" || row.status === "declined") return { row, fileDownloaded: null };
    const [dl] = await tx.query<{ at: string | null }>(
      "select min(a.at)::text as at from app.audit_log a where a.org_id = $1 and a.about = $2 and a.action = 'esign.file_downloaded'",
      [ctx.orgId, id],
    );
    return { row, fileDownloaded: dl?.at ?? null };
  });
}

export interface HistoryRow {
  seq: string;
  at: string;
  tab: Exclude<HistoryTab, "all">;
  /** The sidebar item's icon for what the row is about. */
  icon: IconName;
  /** The sentence: what happened, and to what. */
  what: string;
  who: string;
  /** Where the row's object lives now, when it's an active document or a link of this workspace. */
  href: string | null;
}

export interface HistoryQuery {
  tab: HistoryTab;
  /** Only what the viewer did. */
  mine: boolean;
  days: ActivityDays;
}

/** History's default range. */
export const HISTORY_DAYS_DEFAULT: ActivityDays = 30;

// Owners and admins read every row, as the workspace export already gives them; a member reads only rows about an
// active document, which is what each document's own History shows them (Security S2), so never the Account tab's.
// Rows about an archived or deleted document keep no title or link (S5). The tab is the row's kind of object:
// signatures, links (made, or visited), the documents themselves, and everything else (the workspace, its facts,
// vendors, People). A vendor's upload is the vendor's, whoever's session stored it (the sample's setup stores its made-up
// uploads as its owner). A People row names the person while they're kept; the audit row itself holds only their id
// (0046), so once deleted they're unnamed. A vendor or Collect row names the vendor the same way (its object is the
// vendor's id: 0015's trigger, collect.file_downloaded in lib/server/collect.ts), so the rows can be told apart (Design
// #25 S1). A signature request's rows name who it went to (0047; a signer's own rows since 0038) through the request,
// and only on an active document's rows: an archived document's requests don't come back here either (S5). One more
// row than shown, so the page knows there are more.
const HISTORY_SQL = `
  select h.seq, h.at, h.action, h.actor, h.doc_title, h.doc_id, h.link_id, h.link_label, h.person_id, h.person_name, h.vendor_id, h.vendor_name,
         h.about_name, h.tab
  from (
    select a.seq as n, a.seq::text as seq, a.at::text as at, a.action,
           case when a.actor is null or a.action = 'collect.received' then null when a.actor = $2 then 'me' else 'member' end as actor,
           d.title as doc_title, d.id as doc_id, l.id as link_id, l.label as link_label, c.id as person_id, c.name as person_name,
           v.id as vendor_id, v.name as vendor_name,
           coalesce(r.signer_name, al.label) as about_name,
           case when starts_with(a.action, 'esign.') or a.action = 'document.signed_version_added' then 'signatures'
                when starts_with(a.action, 'passport.') or starts_with(a.action, 'document.link_') then 'links'
                when starts_with(a.action, 'document.') then 'documents'
                else 'account' end as tab
    from app.audit_log a
    left join app.documents d on d.id = a.object_id and d.org_id = a.org_id and d.status = 'active'
    left join app.share_links l on l.id = a.object_id and l.org_id = a.org_id
    left join app.contacts c on c.id = a.object_id and c.org_id = a.org_id and starts_with(a.action, 'contact.')
    left join app.vendors v on v.id = a.object_id and v.org_id = a.org_id and (starts_with(a.action, 'vendor.') or starts_with(a.action, 'collect.'))
    left join app.signature_requests r on r.id = a.about and r.org_id = a.org_id and r.document_id = d.id
    left join app.share_links al on al.id = a.about and al.org_id = a.org_id
    where a.org_id = $1 and a.at >= now() - make_interval(days => $3)
      and ($5::boolean or d.id is not null)
  ) h
  where ($6::text = 'all' or h.tab = $6) and ($4::boolean is false or h.actor = 'me')
  order by h.n desc
  limit $7`;

interface HistoryRaw {
  seq: string;
  at: string;
  action: string;
  actor: "me" | "member" | null;
  doc_title: string | null;
  doc_id: string | null;
  link_id: string | null;
  link_label: string | null;
  person_id: string | null;
  person_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  about_name: string | null;
  tab: Exclude<HistoryTab, "all">;
}

// Rows whose object is a document: without an active one to name, they say "a document" (S5).
const DOCUMENT_ROW = /^(document|esign)\./;

function historyRow(r: HistoryRaw): HistoryRow {
  const label = historyLabel(r.action, r.about_name);
  const object = r.doc_title ?? r.link_label ?? r.person_name ?? r.vendor_name ?? (DOCUMENT_ROW.test(r.action) ? "a document" : null);
  return {
    seq: r.seq,
    at: r.at,
    tab: r.tab,
    icon: historyIcon(r.action, r.tab),
    what: object ? `${label} · ${object}` : label,
    who: historyWho(r.action, r.actor),
    href: r.doc_id
      ? `/app/documents/${r.doc_id}`
      : r.link_id
        ? `/app/passport/${r.link_id}`
        : r.person_id
          ? `/app/people/${r.person_id}`
          : r.vendor_id
            ? `/app/collect/${r.vendor_id}`
            : null,
  };
}

/** Whether this role reads the whole workspace's History (and its Account tab and Export), or only its documents' rows (S2). */
export const readsAllHistory = (ctx: Ctx) => ctx.role !== "member";

/** The History page's rows, newest first, and whether older ones in range were left out. */
export async function listHistory(ctx: Ctx, q: HistoryQuery): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const all = readsAllHistory(ctx);
  const tab = all || q.tab !== "account" ? q.tab : "all";
  const raw = await asUser(ctx.userId, (tx) => tx.query<HistoryRaw>(HISTORY_SQL, [ctx.orgId, ctx.userId, q.days, q.mine, all, tab, HISTORY_SHOWN + 1]));
  return { rows: raw.slice(0, HISTORY_SHOWN).map(historyRow), more: raw.length > HISTORY_SHOWN };
}

/** History as CSV, exactly the rows and columns the page shows (S6): when (UTC, ISO 8601), what, who. */
export const historyCsv = (rows: HistoryRow[]) =>
  ["when,what,who", ...rows.map((r) => [new Date(r.at).toISOString(), r.what, r.who].map(csvCell).join(","))].join("\r\n") + "\r\n";
