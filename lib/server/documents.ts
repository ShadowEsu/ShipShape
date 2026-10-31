import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACK_TEXT, ACK_VERSION } from "@/lib/legal";
import { isPrintable } from "@/lib/pdf/compose";
import { templateById } from "@/lib/templates/catalog";
import { sha256Hex } from "./crypto";
import { asUser, type Tx } from "./db";
import { checkUpload, EXTENSION, type AllowedMime } from "./files";
import { fillRecord, prefill, render, validate, type FieldSource, type Values } from "./fill";
import { assertCanFill, assertRealData } from "./flags";
import { factsForFill, type Ctx } from "./profile";
import { blobStore } from "./storage";

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

export type Validity = "expired" | "expiring" | "ok" | "none";

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

const DOC_SELECT = `
  select d.id, d.title, d.kind, d.status, d.issuer, d.counterparty, d.issued_on::text as issued_on,
         d.expires_on::text as expires_on, d.renews_on::text as renews_on, d.notes, d.template_id,
         d.created_at::text as created_at,
         case when d.expires_on is null then 'none'
              when d.expires_on < current_date then 'expired'
              when d.expires_on <= current_date + 30 then 'expiring'
              else 'ok' end as validity,
         (select count(*)::int from app.document_versions v where v.document_id = d.id) as versions,
         (select v.origin from app.document_versions v where v.document_id = d.id order by v.version desc limit 1) as latest_origin
  from app.documents d`;

const LIST_SQL =
  DOC_SELECT +
  ` where d.org_id = $1 and d.status = $2
      and ($3::text is null or d.kind = $3)
      and ($4::text = '' or d.search @@ websearch_to_tsquery('simple', $4) or d.title ilike '%' || $4 || '%')
    order by coalesce(d.expires_on, '9999-12-31') asc, d.created_at desc`;
const GET_SQL = DOC_SELECT + " where d.id = $1 and d.org_id = $2";

export async function listDocuments(ctx: Ctx, opts: { q?: string; kind?: string; archived?: boolean } = {}): Promise<DocRow[]> {
  const q = (opts.q ?? "").trim().slice(0, 100);
  const kind = opts.kind && opts.kind in DOC_KINDS ? opts.kind : null;
  return asUser(ctx.userId, (tx) => tx.query<DocRow>(LIST_SQL, [ctx.orgId, opts.archived ? "archived" : "active", kind, q]));
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
}

export async function getDocument(ctx: Ctx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return asUser(ctx.userId, async (tx) => {
    const [doc] = await tx.query<DocRow>(GET_SQL, [id, ctx.orgId]);
    if (!doc) return null;
    const versions = await tx.query<VersionRow>(
      "select version, mime, size_bytes, sha256, origin, fill_record, created_at::text as created_at from app.document_versions where document_id = $1 order by version desc",
      [id],
    );
    const audit = await tx.query<AuditRow>(
      "select seq::text as seq, at::text as at, action, actor = $3 as actor_is_me from app.audit_log where org_id = $1 and object_id = $2 order by seq desc limit 50",
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
  const objectPath = `${ctx.orgId}/${documentId}/v${version}.${EXTENSION[file.mime]}`;
  await tx.query(
    "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, fill_record, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [documentId, version, ctx.orgId, objectPath, file.mime, file.bytes.length, sha256Hex(file.bytes), origin, record ? JSON.stringify(record) : null, ctx.userId],
  );
  // Stored last, inside the transaction: if storing fails, the rows roll back with it.
  await blobStore().put(objectPath, file.bytes, file.mime);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(isPrintable, "Use letters, numbers and common punctuation.")
    .optional()
    .transform((s) => s || null);
const optionalDate = z
  .union([z.literal(""), z.iso.date()])
  .optional()
  .transform((s) => s || null);

export const DocMeta = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  kind: z.enum(Object.keys(DOC_KINDS) as [DocKind, ...DocKind[]]),
  issuer: optionalText(200),
  counterparty: optionalText(200),
  issued_on: optionalDate,
  expires_on: optionalDate,
  renews_on: optionalDate,
});

/** A file the person uploads (Security G3: real data, behind SHIPSHAPE_REAL_DOCS). */
export async function uploadDocument(ctx: Ctx, meta: unknown, bytes: Uint8Array): Promise<string> {
  assertRealData(ctx);
  const m = DocMeta.parse(meta);
  const check = checkUpload(bytes);
  if (!check.ok) throw new UserError(check.error);
  return asUser(ctx.userId, (tx) => insertDocument(tx, ctx, m, { bytes, mime: check.mime }, "upload"));
}

/** A new version of an existing document (a renewed certificate, a corrected form). */
export async function uploadVersion(ctx: Ctx, documentId: string, bytes: Uint8Array): Promise<number> {
  assertRealData(ctx);
  const check = checkUpload(bytes);
  if (!check.ok) throw new UserError(check.error);
  return asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<{ next: number }>(
      "select coalesce(max(v.version), 0) + 1 as next from app.documents d left join app.document_versions v on v.document_id = d.id where d.id = $1 and d.org_id = $2 group by d.id",
      [documentId, ctx.orgId],
    );
    if (!row) throw new UserError("Document not found.");
    await insertVersion(tx, ctx, documentId, row.next, { bytes, mime: check.mime }, "upload", null);
    return row.next;
  });
}

export class UserError extends Error {}

export type FillResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

/** Fills a template from the person's reviewed values; needs the not-a-law-firm acknowledgment. */
export async function fillTemplate(ctx: Ctx, templateId: string, values: Values, acknowledged: boolean): Promise<FillResult> {
  assertCanFill(ctx);
  const t = templateById(templateId);
  if (!t) throw new UserError("Unknown template.");
  const facts = await factsForFill(ctx);
  const errors = validate(t, values, facts);
  if (!acknowledged) errors._ack = "Tick the box to confirm you've reviewed the document.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const start = prefill(t, facts);
  const out = await render(t, values, facts);
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
  if (!rows.length) throw new UserError("Document not found.");
}

export async function setArchived(ctx: Ctx, id: string, archived: boolean) {
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("update app.documents set status = $3 where id = $1 and org_id = $2 returning 1", [id, ctx.orgId, archived ? "archived" : "active"]),
  );
  if (!rows.length) throw new UserError("Document not found.");
}

/**
 * A 5-minute link to one version, minted only after the database (under RLS) confirmed this
 * person may see it. Files the person uploaded always download; PDFs ShipShape made may open inline.
 */
export async function downloadUrl(ctx: Ctx, id: string, version: number, mode: "view" | "download"): Promise<string> {
  const [row] = await asUser(ctx.userId, async (tx) => {
    const rows = await tx.query<{ storage_path: string; mime: AllowedMime; origin: string; title: string }>(
      "select v.storage_path, v.mime, v.origin, d.title from app.document_versions v join app.documents d on d.id = v.document_id where v.document_id = $1 and v.version = $2 and d.org_id = $3",
      [id, version, ctx.orgId],
    );
    if (rows.length) await tx.query("select app.audit_append($1, $2, $3)", [ctx.orgId, mode === "view" ? "document.viewed" : "document.downloaded", id]);
    return rows;
  });
  if (!row) throw new UserError("Document not found.");
  const ext = EXTENSION[row.mime];
  const filename = `${row.title.replace(/[^\w .()-]+/g, "").slice(0, 100).trim() || "document"} v${version}.${ext}`;
  const inline = mode === "view" && row.origin !== "upload";
  return blobStore().signedUrl(row.storage_path, { filename, inline });
}
