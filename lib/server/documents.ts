import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACK_TEXT, ACK_VERSION } from "@/lib/legal";
import { isPrintable } from "@/lib/pdf/compose";
import { templateById } from "@/lib/templates/catalog";
import type { Validity } from "@/lib/today";
import { sha256Hex } from "./crypto";
import { asUser, type Tx } from "./db";
import { checkUpload, EXTENSION, UploadRefused, type AllowedMime } from "./files";
import { fillRecord, prefill, render, validate, type FieldSource, type Values } from "./fill";
import { UserError } from "./errors";
import { assertCanFill, assertRealData, realDocsEnabled } from "./flags";
import { rateLimited } from "./http";
import { FILL_BUSY, UPLOAD_BUSY } from "./limits";
import { assertRoomForFile, assertWithinPlan, sampleFull } from "./plans";
import { factsForFill, saveEin, type Ctx } from "./profile";
import { blobStore, foldName, putVersionFile } from "./storage";

export const DOC_KINDS = {
  w9: "W-9",
  coi: "Insurance certificate",
  license: "License",
  permit: "Permit",
  nda: "NDA",
  agreement: "Agreement",
  registration: "Registration",
  tax: "Tax document",
  other: "Other",
} as const;
export type DocKind = keyof typeof DOC_KINDS;

export interface DocRow {
  id: string;
  title: string;
  kind: DocKind;
  status: "active" | "archived";
  issuer: string | null;
  counterparty: string | null;
  issued_on: string | null;
  expires_on: string | null;
  renews_on: string | null;
  notes: string | null;
  template_id: string | null;
  created_at: string;
  validity: Validity;
  versions: number;
  latest_origin: "upload" | "filled" | "signed" | "sample" | null;
}

// $1 is the viewer's date (ctx.today): a document is current through its last day where the person is.
const DOC_SELECT = `
  select d.id, d.title, d.kind, d.status, d.issuer, d.counterparty, d.issued_on::text as issued_on,
         d.expires_on::text as expires_on, d.renews_on::text as renews_on, d.notes, d.template_id,
         d.created_at::text as created_at,
         case when d.expires_on is null then 'none'
              when d.expires_on < $1::date then 'expired'
              when d.expires_on <= $1::date + 30 then 'expiring'
              else 'ok' end as validity,
         (select count(*)::int from app.document_versions v where v.document_id = d.id) as versions,
         (select v.origin from app.document_versions v where v.document_id = d.id order by v.version desc limit 1) as latest_origin
  from app.documents d`;

const LIST_WHERE = ` where d.org_id = $2 and d.status = $3
      and ($4::text is null or d.kind = $4)
      and ($5::text = '' or d.search @@ websearch_to_tsquery('simple', $5) or d.title ilike '%' || $5 || '%')`;
// d.id last: created_at ties within one transaction (the sample workspace), and limit/offset needs a total order.
const LIST_ORDER = ` order by coalesce(d.expires_on, '9999-12-31') asc, d.created_at desc, d.id`;
const LIST_SQL = DOC_SELECT + LIST_WHERE + LIST_ORDER;
const PAGE_SQL = LIST_SQL + " limit $6 offset $7";
// $1 is unused here, so the page and the count share one parameter list.
const COUNT_SQL = `select count(*)::int as n, $1::date as today from app.documents d` + LIST_WHERE;
const GET_SQL = DOC_SELECT + " where d.id = $2 and d.org_id = $3";

/**
 * Characters that don't belong in one line of text: C0 and C1 controls (line breaks, tabs, NUL,
 * which Postgres can't store in text), the Unicode line and paragraph separators, and the bidi
 * embedding, override and isolate controls that make text display in another order (Security N-88a).
 */
function breaksOneLine(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  return n < 0x20 || (n >= 0x7f && n < 0xa0) || (n >= 0x2028 && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
}

type ListOpts = { q?: string; kind?: string; archived?: boolean };

function listParams(ctx: Ctx, opts: ListOpts): [string, string, string, string | null, string] {
  const q = Array.from(opts.q ?? "", (c) => (breaksOneLine(c) ? " " : c)).join("").trim().slice(0, 100);
  const kind = opts.kind && opts.kind in DOC_KINDS ? opts.kind : null;
  return [ctx.today, ctx.orgId, opts.archived ? "archived" : "active", kind, q];
}

export async function listDocuments(ctx: Ctx, opts: ListOpts = {}): Promise<DocRow[]> {
  return asUser(ctx.userId, (tx) => tx.query<DocRow>(LIST_SQL, listParams(ctx, opts)));
}

/** How many documents Home lists under "Needs attention" at once; the rest are a count and a link to the list. */
export const ATTENTION_MAX = 20;

/** A document on Home's "Needs attention": the date that put it there, and whether that's its expiry or a renewal notice. */
export interface AttentionRow extends DocRow {
  attention_kind: "expiry" | "renewal";
  attention_on: string;
}

export interface HomeSummary {
  /** Active documents, and how many of those need nothing now (no expiry or more than 30 days left, and no renewal notice due in 30 days). */
  total: number;
  current: number;
  hasW9: boolean;
  hasDates: boolean;
  /** The first document in the list's order (none when there are none): the setup step's "start with" document. */
  first: { id: string; title: string } | null;
  /**
   * Expired, expiring, or with a renewal notice due in the next 30 days; at most ATTENTION_MAX, most urgent first:
   * what can still be acted on in time (soonest date first), then what has lapsed (most recent first).
   * `attentionTotal` counts them all, `lapsedTotal` those that have lapsed.
   */
  attention: AttentionRow[];
  attentionTotal: number;
  lapsedTotal: number;
}

const SUMMARY_SQL = `
  select count(*)::int as total,
         count(*) filter (where (d.expires_on is null or d.expires_on > $1::date + 30) and (d.renews_on is null or d.renews_on not between $1::date and $1::date + 30))::int as current,
         coalesce(bool_or(d.template_id = 'irs-w9'), false) as has_w9,
         coalesce(bool_or(d.expires_on is not null or d.renews_on is not null), false) as has_dates
  from app.documents d where d.org_id = $2 and d.status = 'active'`;
const FIRST_SQL = `select d.id, d.title from app.documents d where d.org_id = $1 and d.status = 'active'` + LIST_ORDER + " limit 1";
// Each document once: a lapsed expiry always decides the row; otherwise the sooner of an expiring expiry and an
// upcoming renewal date (today..+30; a passed renewal date drops off Home, Deadlines keeps it). The totals come from
// the same statement as the rows (window counts run before the limit), so the "N more" line can't disagree with the list.
const ATTENTION_SQL =
  `with a as (` +
  DOC_SELECT +
  LIST_WHERE +
  ` and (d.expires_on <= $1::date + 30 or d.renews_on between $1::date and $1::date + 30))` +
  ` select a.*, k.attention_kind, k.attention_on::text as attention_on,` +
  ` count(*) over ()::int as attention_total, count(*) filter (where a.validity = 'expired') over ()::int as lapsed_total` +
  ` from a cross join lateral (select case when a.validity in ('expired', 'expiring')` +
  ` and (a.renews_on is null or a.renews_on::date < $1::date or a.renews_on::date > $1::date + 30 or a.expires_on::date <= a.renews_on::date)` +
  ` then 'expiry' else 'renewal' end as attention_kind) k0` +
  ` cross join lateral (select k0.attention_kind, case when k0.attention_kind = 'expiry' then a.expires_on::date else a.renews_on::date end as attention_on) k` +
  ` order by (a.validity = 'expired'), abs(k.attention_on - $1::date), a.created_at::timestamptz desc, a.id limit $6`;

/** What Home needs, without reading every document: Pro has no document limit. */
export async function homeSummary(ctx: Ctx): Promise<HomeSummary> {
  return asUser(ctx.userId, async (tx) => {
    const [counts] = await tx.query<{ total: number; current: number; has_w9: boolean; has_dates: boolean }>(SUMMARY_SQL, [ctx.today, ctx.orgId]);
    const [first] = await tx.query<{ id: string; title: string }>(FIRST_SQL, [ctx.orgId]);
    const attention = await tx.query<AttentionRow & { attention_total: number; lapsed_total: number }>(ATTENTION_SQL, [...listParams(ctx, {}), ATTENTION_MAX]);
    return {
      total: counts.total,
      current: counts.current,
      hasW9: counts.has_w9,
      hasDates: counts.has_dates,
      first: first ?? null,
      attention,
      attentionTotal: attention[0]?.attention_total ?? 0,
      lapsedTotal: attention[0]?.lapsed_total ?? 0,
    };
  });
}

/** The first active document in the list's order, or null: the "start with" document for an expiry date. */
export async function firstDocument(ctx: Ctx): Promise<{ id: string; title: string } | null> {
  const [row] = await asUser(ctx.userId, (tx) => tx.query<{ id: string; title: string }>(FIRST_SQL, [ctx.orgId]));
  return row ?? null;
}

// Ordered as passport_open lists a link's documents (0003), so the preview shows them as the link will (W14-10).
const BY_ID_SQL = DOC_SELECT + ` where d.org_id = $2 and d.status = 'active' and d.id = any($3::uuid[]) order by d.kind, d.title`;

/** The given active documents of this workspace (others' ids and unknown ids drop out), in the order a passport link lists them. */
export async function documentsById(ctx: Ctx, ids: readonly string[]): Promise<DocRow[]> {
  if (ids.length === 0) return [];
  return asUser(ctx.userId, (tx) => tx.query<DocRow>(BY_ID_SQL, [ctx.today, ctx.orgId, ids]));
}

/** How many documents the documents page lists at once (Pro has no document limit, so the list is paged). */
export const DOCUMENTS_PAGE_SIZE = 50;

export interface DocPage {
  rows: DocRow[];
  /** All the documents the filter matches, across every page. */
  total: number;
  /** The page shown, 1-based, clamped to the pages there are (an empty list is page 1 of 1). */
  page: number;
  pages: number;
}

/** One page of the documents list, in the list's order, with the count the filter matches. */
export async function pageDocuments(ctx: Ctx, opts: ListOpts & { page?: number } = {}): Promise<DocPage> {
  const params = listParams(ctx, opts);
  return asUser(ctx.userId, async (tx) => {
    const [{ n: total }] = await tx.query<{ n: number }>(COUNT_SQL, params);
    const pages = Math.max(1, Math.ceil(total / DOCUMENTS_PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1)));
    const rows = await tx.query<DocRow>(PAGE_SQL, [...params, DOCUMENTS_PAGE_SIZE, (page - 1) * DOCUMENTS_PAGE_SIZE]);
    return { rows, total, page, pages };
  });
}

export interface VersionRow {
  version: number;
  mime: AllowedMime;
  size_bytes: number;
  sha256: string;
  origin: DocRow["latest_origin"];
  fill_record: { template?: string; templateVersion?: string; fields?: Record<string, FieldSource> } | null;
  created_at: string;
}

export interface AuditRow {
  seq: string;
  at: string;
  action: string;
  actor_is_me: boolean;
  /** Who or what the row is about, when it names one (0038): a signing request's signer, a passport link's label. Null once that's gone. */
  about_name: string | null;
}

export async function getDocument(ctx: Ctx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return asUser(ctx.userId, async (tx) => {
    const [doc] = await tx.query<DocRow>(GET_SQL, [ctx.today, id, ctx.orgId]);
    if (!doc) return null;
    const versions = await tx.query<VersionRow>(
      "select version, mime, size_bytes, sha256, origin, fill_record, created_at::text as created_at from app.document_versions where document_id = $1 order by version desc",
      [id],
    );
    const audit = await tx.query<AuditRow>(
      // Order by the table's bigint column; the text alias `seq` would sort "10" before "9".
      `select a.seq::text as seq, a.at::text as at, a.action, coalesce(a.actor = $3, false) as actor_is_me, coalesce(r.signer_name, l.label) as about_name
       from app.audit_log a
       left join app.signature_requests r on r.id = a.about and r.document_id = $2
       left join app.share_links l on l.id = a.about and l.org_id = $1
       where a.org_id = $1 and a.object_id = $2 order by a.seq desc limit 50`,
      [ctx.orgId, id, ctx.userId],
    );
    return { doc, versions, audit };
  });
}

interface NewDoc {
  title: string;
  kind: DocKind;
  issuer?: string | null;
  counterparty?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  renews_on?: string | null;
  template_id?: string | null;
}

/** Inserts the document and its first version, and stores the file, in one transaction. */
export async function insertDocument(
  tx: Tx,
  ctx: Ctx,
  meta: NewDoc,
  file: { bytes: Uint8Array; mime: AllowedMime },
  origin: "upload" | "filled" | "sample",
  record: VersionRow["fill_record"] = null,
): Promise<string> {
  await assertWithinPlan(tx, ctx, "documents");
  const id = randomUUID();
  await tx.query(
    "insert into app.documents (id, org_id, title, kind, issuer, counterparty, issued_on, expires_on, renews_on, template_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, ctx.orgId, meta.title, meta.kind, meta.issuer ?? null, meta.counterparty ?? null, meta.issued_on ?? null, meta.expires_on ?? null, meta.renews_on ?? null, meta.template_id ?? null, ctx.userId],
  );
  await insertVersion(tx, ctx, id, 1, file, origin, record);
  return id;
}

async function insertVersion(
  tx: Tx,
  ctx: Ctx,
  documentId: string,
  version: number,
  file: { bytes: Uint8Array; mime: AllowedMime },
  origin: "upload" | "filled" | "sample" | "signed",
  record: VersionRow["fill_record"],
) {
  // Every stored version passes here (uploads, new versions, filled and seeded documents), so the plan's file total holds for all of them.
  await assertRoomForFile(tx, ctx, file.bytes.length);
  const objectPath = `${ctx.orgId}/${documentId}/v${version}.${EXTENSION[file.mime]}`;
  // `$9::text`: the JSON goes over as text and Postgres parses it. Untyped, postgres.js sees the jsonb
  // column and encodes the string again, storing a JSON string instead of the object (PGlite doesn't).
  await tx.query(
    "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, fill_record, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10)",
    [documentId, version, ctx.orgId, objectPath, file.mime, file.bytes.length, sha256Hex(file.bytes), origin, record ? JSON.stringify(record) : null, ctx.userId],
  );
  // Stored last, inside the transaction: if storing fails, the rows roll back with it.
  await putVersionFile(objectPath, file.bytes, file.mime);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Shorten this to ${max} characters or fewer.`)
    .refine(isPrintable, "Use letters, numbers and common punctuation.")
    .optional()
    .transform((s) => s || null);
/** A YYYY-MM-DD date the database can store: a real calendar date (zod) in year 1 or later (Postgres has no year 0). */
export const CalendarDate = z.iso.date("Enter a real date.").refine((s) => !s.startsWith("0000-"), "Enter a real date.");
const optionalDate = z
  .union([z.literal(""), CalendarDate], "Enter a real date.")
  .optional()
  .transform((s) => s || null);

export const DocMeta = z.object({
  // Any language (uploads keep their own titles; the certificate draws what its font can), one line.
  title: z
    .string()
    .trim()
    .min(1, "Give the document a title, like “General liability certificate 2026”.")
    .max(200, "Shorten the title to 200 characters or fewer.")
    .refine((s) => !Array.from(s).some(breaksOneLine), "Keep the title to one line of ordinary text."),
  kind: z.enum(Object.keys(DOC_KINDS) as [DocKind, ...DocKind[]], "Choose a kind from the list."),
  issuer: optionalText(200),
  counterparty: optionalText(200),
  issued_on: optionalDate,
  expires_on: optionalDate,
  renews_on: optionalDate,
});

/** Shown when a form acts on a document this workspace no longer has (deleted, or open in another workspace). */
export const DOCUMENT_GONE = "This document isn't in this workspace any more. Go to Documents to see what's there.";

/** A file the person uploads (Security G3: real data, behind SHIPSHAPE_REAL_DOCS). */
export async function uploadDocument(ctx: Ctx, meta: unknown, bytes: Uint8Array): Promise<string> {
  assertRealData(ctx);
  if (await rateLimited("upload", ctx.userId, 60, 3600)) throw new UserError(UPLOAD_BUSY);
  const m = DocMeta.parse(meta);
  const check = checkUpload(bytes);
  if (!check.ok) throw new UploadRefused(check.error);
  return asUser(ctx.userId, (tx) => insertDocument(tx, ctx, m, { bytes, mime: check.mime }, "upload"));
}

/** An open signing request withdrawn by a new version or by archiving: who it was for, and the version it was made on. */
export interface Withdrawn {
  signerName: string;
  version: number;
}

/** Withdraws the document's open (pending, not lapsed) signing requests inside `tx`; the signer's link then reads as turned off. Newest first, as the page lists them. */
async function withdrawOpenRequests(tx: Tx, ctx: Ctx, documentId: string): Promise<Withdrawn[]> {
  const rows = await tx.query<{ signer_name: string; version: number; created_at: string }>(
    "update app.signature_requests set status = 'revoked' where document_id = $1 and org_id = $2 and status = 'pending' and expires_at > now() returning signer_name, version, created_at::text as created_at",
    [documentId, ctx.orgId],
  );
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => ({ signerName: r.signer_name, version: r.version }));
}

/**
 * A new version of an existing document (a renewed certificate, a corrected form). A signature belongs
 * to the version the signer saw, so the document's open signing requests are withdrawn (Design, wave 8 #7).
 */
export async function uploadVersion(ctx: Ctx, documentId: string, bytes: Uint8Array): Promise<{ version: number; withdrawn: Withdrawn[] }> {
  assertRealData(ctx);
  if (await rateLimited("upload", ctx.userId, 60, 3600)) throw new UserError(UPLOAD_BUSY);
  const check = checkUpload(bytes);
  if (!check.ok) throw new UploadRefused(check.error);
  return asUser(ctx.userId, async (tx) => {
    // The request rows first, then the document: the order esign_complete locks them in, so an owner
    // and a signer finishing at the same moment take turns instead of deadlocking (Security W8a).
    const withdrawn = await withdrawOpenRequests(tx, ctx, documentId);
    // Locks the document (no key update: it doesn't block readers or the version rows' key-share
    // locks) so two uploads at once get consecutive numbers instead of the same one.
    const [doc] = await tx.query("select 1 from app.documents where id = $1 and org_id = $2 for no key update", [documentId, ctx.orgId]);
    if (!doc) throw new UserError(DOCUMENT_GONE);
    const [row] = await tx.query<{ next: number }>("select coalesce(max(v.version), 0) + 1 as next from app.document_versions v where v.document_id = $1", [documentId]);
    await insertVersion(tx, ctx, documentId, row.next, { bytes, mime: check.mime }, "upload", null);
    return { version: row.next, withdrawn };
  });
}

export type FillResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

/** Who may tick "also save it to my business facts" on a W-9: the same people who can edit Business facts. */
export function canSaveFacts(ctx: Pick<Ctx, "demo" | "role">): boolean {
  return !ctx.demo && realDocsEnabled() && ctx.role !== "member";
}

/** A sample that already holds all the documents it can: the Make page says so instead of offering a form (W15-2). */
export async function sampleIsFull(ctx: Ctx): Promise<boolean> {
  return ctx.demo && asUser(ctx.userId, (tx) => sampleFull(tx, ctx));
}

/** The template and the facts it fills from, with what's wrong in the values (field key -> what to fix). */
async function checked(ctx: Ctx, templateId: string, values: Values) {
  assertCanFill(ctx);
  const t = templateById(templateId);
  if (!t) throw new UserError("ShipShape doesn't fill that form. Pick one from Make a document.");
  const facts = await factsForFill(ctx);
  const errors = await validate(t, values, facts);
  // The box is hidden for people who can't change Business facts; a post that carries it anyway is refused here, not at the database.
  if (values.save_ein === "on" && !facts.ein && !canSaveFacts(ctx)) {
    errors.save_ein = ctx.demo
      ? "A sample workspace can't save business facts. Untick this to make the W-9 with the number typed above."
      : ctx.role === "member"
        ? "Only owners and admins can save business facts. Untick this, or ask one of them to add the EIN."
        : "Business facts open after our security review. Untick this to make the W-9 with the number typed above.";
  }
  // A sample never takes a real tax number (G3): its EIN is the made-up one, and an SSN can only be the visitor's own (W14-2).
  if (ctx.demo && values.tin_kind === "ssn" && t.fields.some((f) => f.key === "ssn")) {
    errors.ssn = "This sample uses its made-up EIN, so choose EIN. Your own SSN can go in once real accounts open.";
  }
  return { t, facts, errors };
}

/** The review step: what to fix before the person approves. Nothing is saved. */
export async function checkFill(ctx: Ctx, templateId: string, values: Values): Promise<Record<string, string>> {
  return (await checked(ctx, templateId, values)).errors;
}

/**
 * Fills a template from the person's reviewed values; needs the not-a-law-firm acknowledgment. `ip` is the
 * caller's network, for the per-network hourly limit next to the per-person one (W15-2).
 */
export async function fillTemplate(ctx: Ctx, templateId: string, values: Values, acknowledged: boolean, ip: string): Promise<FillResult> {
  const { t, facts, errors } = await checked(ctx, templateId, values);
  if (!acknowledged) errors._ack = "Check the box to confirm you've reviewed the document.";
  if (Object.keys(errors).length) return { ok: false, errors };
  // Counted only once the values pass, so fixing a typo doesn't use up the hour; before the render, the costly part.
  if ((await rateLimited("fill", ctx.userId, 30, 3600)) || (await rateLimited("fill-net", ip, 60, 3600))) throw new UserError(FILL_BUSY);
  const start = prefill(t, facts, ctx.today);
  const out = await render(t, values, facts, ctx.today, ctx.demo);
  // An EIN typed here with "also save it" goes into Business facts (encrypted) once the form rendered, before the document is stored.
  if (!facts.ein && values.tin_kind === "ein" && values.save_ein === "on" && t.fields.some((f) => f.fact === "ein")) {
    await saveEin(ctx, values.ein ?? "");
  }
  const record = { template: t.id, templateVersion: t.source.version, fields: fillRecord(t, values, start) };
  const id = await asUser(ctx.userId, async (tx) => {
    const docId = await insertDocument(
      tx,
      ctx,
      { title: out.title, kind: t.kind, counterparty: out.counterparty, issued_on: out.issuedOn, expires_on: out.expiresOn, template_id: t.id },
      { bytes: out.bytes, mime: "application/pdf" },
      "filled",
      record,
    );
    await tx.query(
      "insert into app.acknowledgments (org_id, user_id, document_id, text_version, text_sha256) values ($1, $2, $3, $4, $5)",
      [ctx.orgId, ctx.userId, docId, ACK_VERSION, sha256Hex(ACK_TEXT)],
    );
    return docId;
  });
  return { ok: true, id };
}

export async function updateDocument(ctx: Ctx, id: string, meta: unknown) {
  const m = DocMeta.parse(meta);
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query(
      "update app.documents set title = $3, kind = $4, issuer = $5, counterparty = $6, issued_on = $7, expires_on = $8, renews_on = $9 where id = $1 and org_id = $2 returning 1",
      [id, ctx.orgId, m.title, m.kind, m.issuer, m.counterparty, m.issued_on, m.expires_on, m.renews_on],
    ),
  );
  if (!rows.length) throw new UserError(DOCUMENT_GONE);
}

export async function setArchived(ctx: Ctx, id: string, archived: boolean) {
  const rows = await asUser(ctx.userId, async (tx) => {
    if (!archived) await assertWithinPlan(tx, ctx, "restore");
    // An archived document isn't shared: its open signing links stop working too (the page hides Withdraw while
    // it's archived). The request rows go first, in esign_complete's lock order (Security W8a).
    if (archived) await withdrawOpenRequests(tx, ctx, id);
    return tx.query("update app.documents set status = $3 where id = $1 and org_id = $2 returning 1", [id, ctx.orgId, archived ? "archived" : "active"]);
  });
  if (!rows.length) throw new UserError(DOCUMENT_GONE);
}

/** The name a downloaded file gets: the title in header-safe characters (accents folded), plus its version. */
export function downloadName(title: string, version: number, mime: AllowedMime): string {
  return `${foldName(title).slice(0, 100).trim() || "document"} v${version}.${EXTENSION[mime]}`;
}

/**
 * A 5-minute link to one version, minted only after the database (under RLS) confirmed this
 * person may see it. Only PDFs ShipShape made from its own templates (filled, sample) may open inline;
 * uploads and signed copies, which carry pages from an upload, always download (Security F3).
 */
export async function downloadUrl(ctx: Ctx, id: string, version: number, mode: "view" | "download"): Promise<string> {
  // A mangled link is "not found", never a database error: the id must be a UUID and the version
  // fit document_versions.version (int).
  if (!z.uuid().safeParse(id).success || !Number.isInteger(version) || version < 1 || version > 2_147_483_647) throw new UserError("Document not found.");
  const [row] = await asUser(ctx.userId, async (tx) => {
    const rows = await tx.query<{ storage_path: string; mime: AllowedMime; origin: string; title: string }>(
      "select v.storage_path, v.mime, v.origin, d.title from app.document_versions v join app.documents d on d.id = v.document_id where v.document_id = $1 and v.version = $2 and d.org_id = $3",
      [id, version, ctx.orgId],
    );
    if (rows.length) await tx.query("select app.audit_append($1, $2, $3)", [ctx.orgId, mode === "view" ? "document.viewed" : "document.downloaded", id]);
    return rows;
  });
  if (!row) throw new UserError("Document not found.");
  const inline = mode === "view" && (row.origin === "filled" || row.origin === "sample");
  return blobStore().signedUrl(row.storage_path, { filename: downloadName(row.title, version, row.mime), inline });
}
