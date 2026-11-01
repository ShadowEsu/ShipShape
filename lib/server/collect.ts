import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isPrintable } from "@/lib/pdf/compose";
import { samplePdf } from "@/lib/pdf/sample-pdf";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { newToken, sha256Hex } from "./crypto";
import { asAnon, asUser, type Tx } from "./db";
import { CalendarDate, DOC_KINDS, type DocKind } from "./documents";
import { UserError } from "./errors";
import { activePdf, EXTENSION, sniffMime, type AllowedMime } from "./files";
import { collectOpen, GateClosed } from "./flags";
import { rateLimited } from "./http";
import { LINKS_BUSY, VENDORS_BUSY } from "./limits";
import type { Ctx } from "./profile";
import { blobStore } from "./storage";

/**
 * Collect: the workspace asks its vendors for documents through an upload link and sees who is
 * current. Vendor files live in app.vendor_files, apart from the workspace's own documents.
 */

/** Upload links last at most 90 days (Security R6), like passport links. */
export const COLLECT_DAYS = [7, 30, 90] as const;

const KIND_KEYS = Object.keys(DOC_KINDS) as [DocKind, ...DocKind[]];
const isKind = (k: string): k is DocKind => Object.hasOwn(DOC_KINDS, k);

/** What a requested document looks like right now: received and current, close to expiry, lapsed, or not sent. */
export type CollectState = "ok" | "expiring" | "expired" | "missing";

const STATE_RANK: Record<CollectState, number> = { ok: 0, expiring: 1, missing: 2, expired: 3 };

function assertCollect(ctx: Ctx) {
  if (!collectOpen(ctx)) throw new GateClosed("Collect isn't open for real workspaces yet. Try it in the sample workspace.");
}

const text = (max: number, required: string) =>
  z.string().trim().min(1, required).max(max).refine(isPrintable, "Use letters, numbers and common punctuation.");

const NewVendor = z.object({
  name: text(120, "Give the vendor a name."),
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("That email address doesn't look right. Check it, or leave the field empty.").max(254)]))
    .optional()
    .transform((s) => s || null),
  requested: z
    .array(z.enum(KIND_KEYS))
    .min(1, "Pick at least one document to ask for.")
    .max(KIND_KEYS.length)
    .transform((ks) => [...new Set(ks)]),
});

const VendorId = z.uuid();

export async function addVendor(ctx: Ctx, input: unknown): Promise<string> {
  assertCollect(ctx);
  const v = NewVendor.parse(input);
  if (await rateLimited("vendors", ctx.userId, 30, 3600)) throw new UserError(VENDORS_BUSY);
  const [row] = await asUser(ctx.userId, (tx) =>
    tx.query<{ id: string }>("insert into app.vendors (org_id, name, email, requested, created_by) values ($1, $2, $3, $4, $5) returning id", [
      ctx.orgId,
      v.name,
      v.email,
      v.requested,
      ctx.userId,
    ]),
  );
  return row.id;
}

export async function setVendorArchived(ctx: Ctx, id: string, archived: boolean) {
  assertCollect(ctx);
  if (!VendorId.safeParse(id).success) throw new UserError("Vendor not found.");
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("update app.vendors set status = $3 where id = $1 and org_id = $2 returning 1", [id, ctx.orgId, archived ? "archived" : "active"]),
  );
  if (!rows.length) throw new UserError("Vendor not found.");
}

export interface CollectItem {
  kind: DocKind;
  label: string;
  state: CollectState;
  fileId: string | null;
  receivedAt: string | null;
  expiresOn: string | null;
}

export interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  status: "active" | "archived";
  openLinks: number;
  /** The worst state among the requested documents. */
  state: CollectState;
  items: CollectItem[];
}

const VENDOR_SQL = `
  select v.id, v.name, v.email, v.status, k.kind, f.id as file_id, f.received_at::text as received_at, f.expires_on::text as expires_on,
         case when f.id is null then 'missing'
              when f.expires_on is null then 'ok'
              when f.expires_on < $4::date then 'expired'
              when f.expires_on <= $4::date + 30 then 'expiring'
              else 'ok' end as state,
         (select count(*)::int from app.vendor_links l where l.vendor_id = v.id and l.revoked_at is null and l.expires_at > now()) as open_links
  from app.vendors v
  cross join lateral unnest(v.requested) with ordinality as k(kind, n)
  left join lateral (
    select vf.id, vf.received_at, vf.expires_on from app.vendor_files vf
    where vf.vendor_id = v.id and vf.kind = k.kind order by vf.received_at desc limit 1
  ) f on true
  where v.org_id = $1 and ($2::uuid is null or v.id = $2) and ($3::text is null or v.status = $3)
  order by lower(v.name), v.id, k.n`;

interface VendorSqlRow {
  id: string;
  name: string;
  email: string | null;
  status: "active" | "archived";
  kind: string;
  file_id: string | null;
  received_at: string | null;
  expires_on: string | null;
  state: CollectState;
  open_links: number;
}

async function queryVendors(ctx: Ctx, onlyId: string | null, status: "active" | "archived" | null): Promise<VendorRow[]> {
  const rows = await asUser(ctx.userId, (tx) => tx.query<VendorSqlRow>(VENDOR_SQL, [ctx.orgId, onlyId, status, ctx.today]));
  const byId = new Map<string, VendorRow>();
  for (const r of rows) {
    if (!isKind(r.kind)) continue;
    let v = byId.get(r.id);
    if (!v) {
      v = { id: r.id, name: r.name, email: r.email, status: r.status, openLinks: r.open_links, state: "ok", items: [] };
      byId.set(r.id, v);
    }
    v.items.push({ kind: r.kind, label: DOC_KINDS[r.kind], state: r.state, fileId: r.file_id, receivedAt: r.received_at, expiresOn: r.expires_on });
    if (STATE_RANK[r.state] > STATE_RANK[v.state]) v.state = r.state;
  }
  return [...byId.values()];
}

/** The workspace's active vendors with the state of each document asked for, A to Z. */
export async function listVendors(ctx: Ctx): Promise<VendorRow[]> {
  return queryVendors(ctx, null, "active");
}

export async function listArchivedVendors(ctx: Ctx): Promise<VendorRow[]> {
  return queryVendors(ctx, null, "archived");
}

export interface VendorFile {
  id: string;
  kind: DocKind;
  label: string;
  filename: string;
  mime: AllowedMime;
  size_bytes: number;
  expires_on: string | null;
  received_at: string;
  sample: boolean;
}

export interface VendorLink {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface VendorDetail {
  vendor: VendorRow;
  files: VendorFile[];
  links: VendorLink[];
}

export async function getVendor(ctx: Ctx, id: string): Promise<VendorDetail | null> {
  if (!VendorId.safeParse(id).success) return null;
  const [vendor] = await queryVendors(ctx, id, null);
  if (!vendor) return null;
  return asUser(ctx.userId, async (tx) => {
    const files = await tx.query<Omit<VendorFile, "label"> & { kind: string }>(
      "select id, kind, filename, mime, size_bytes, expires_on::text as expires_on, received_at::text as received_at, sample from app.vendor_files where vendor_id = $1 and org_id = $2 order by received_at desc limit 200",
      [id, ctx.orgId],
    );
    const links = await tx.query<VendorLink>(
      "select id, expires_at::text as expires_at, revoked_at::text as revoked_at, created_at::text as created_at from app.vendor_links where vendor_id = $1 and org_id = $2 order by created_at desc limit 50",
      [id, ctx.orgId],
    );
    return {
      vendor,
      files: files.flatMap((f) => (isKind(f.kind) ? [{ ...f, kind: f.kind, label: DOC_KINDS[f.kind] }] : [])),
      links,
    };
  });
}

const NewLink = z.object({
  vendorId: VendorId,
  days: z.coerce.number().refine((d) => COLLECT_DAYS.some((x) => x === d), "Choose how long the link works."),
});

/**
 * An upload link for one vendor. As with passports, the token goes only into the URL fragment and
 * the database keeps its SHA-256, so ShipShape can't show the link again.
 */
export async function createVendorLink(ctx: Ctx, input: unknown): Promise<{ id: string; token: string }> {
  assertCollect(ctx);
  const p = NewLink.parse(input);
  if (await rateLimited("links", ctx.userId, 30, 3600)) throw new UserError(LINKS_BUSY);
  const { token, hash } = newToken();
  const id = await asUser(ctx.userId, async (tx) => {
    const [active] = await tx.query("select 1 from app.vendors where id = $1 and org_id = $2 and status = 'active'", [p.vendorId, ctx.orgId]);
    if (!active) throw new UserError("This vendor is archived, so it can't get an upload link. Restore it first.");
    return insertLink(tx, ctx, p.vendorId, hash, p.days);
  });
  return { id, token };
}

async function insertLink(tx: Tx, ctx: Ctx, vendorId: string, hash: string, days: number): Promise<string> {
  const [link] = await tx.query<{ id: string }>(
    "insert into app.vendor_links (org_id, vendor_id, token_hash, expires_at, created_by) values ($1, $2, $3, now() + make_interval(days => $4), $5) returning id",
    [ctx.orgId, vendorId, hash, days, ctx.userId],
  );
  return link.id;
}

export async function revokeVendorLink(ctx: Ctx, id: string) {
  if (!VendorId.safeParse(id).success) throw new UserError("Link not found.");
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("update app.vendor_links set revoked_at = now() where id = $1 and org_id = $2 and revoked_at is null returning 1", [id, ctx.orgId]),
  );
  if (!rows.length) throw new UserError("That link is already off.");
}

/**
 * A 5-minute download link for a file a vendor sent (always a download: these files come from outside the workspace),
 * or null if it isn't this workspace's. The download goes into the workspace history ("collect.file_downloaded",
 * about the vendor) in the same transaction, before the link is made, like every other download: these files can
 * carry the vendor's tax ID (W15-4, 0042).
 */
export async function vendorFileUrl(ctx: Ctx, fileId: string): Promise<string | null> {
  if (!VendorId.safeParse(fileId).success) return null;
  const row = await asUser(ctx.userId, async (tx) => {
    const [file] = await tx.query<{ storage_path: string; filename: string; vendor_id: string }>(
      "select storage_path, filename, vendor_id from app.vendor_files where id = $1 and org_id = $2",
      [fileId, ctx.orgId],
    );
    if (file) await tx.query("select app.audit_append($1, 'collect.file_downloaded', $2)", [ctx.orgId, file.vendor_id]);
    return file;
  });
  if (!row) return null;
  return blobStore().signedUrl(row.storage_path, { filename: row.filename, inline: false });
}

// Public side: the vendor's upload page ------------------------------------------------------------

/** Cookie that carries an upload link's token, sent only to that link's own pages (see links.ts). */
export const COLLECT_COOKIE = "ss_collect";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface PublicCollect {
  orgName: string;
  vendorName: string;
  expiresAt: string;
  /** A sample workspace: the page sends made-up files instead of taking uploads. */
  sample: boolean;
  items: { kind: DocKind; label: string; receivedAt: string | null; expiresOn: string | null }[];
}

interface OpenRow {
  org_id: string;
  is_demo: boolean;
  org_name: string;
  vendor_name: string;
  expires_at: string;
  kind: string;
  received_at: string | null;
  file_expires_on: string | null;
}

const OPEN_SQL =
  "select org_id, is_demo, org_name, vendor_name, expires_at::text as expires_at, kind, received_at::text as received_at, file_expires_on::text as file_expires_on from app.collect_open($1, $2)";

function toPublic(rows: OpenRow[]): PublicCollect | null {
  if (!rows.length) return null;
  return {
    orgName: rows[0].org_name,
    vendorName: rows[0].vendor_name,
    expiresAt: rows[0].expires_at,
    sample: rows[0].is_demo,
    items: rows.flatMap((r) => (isKind(r.kind) ? [{ kind: r.kind, label: DOC_KINDS[r.kind], receivedAt: r.received_at, expiresOn: r.file_expires_on }] : [])),
  };
}

/** What an upload link shows, or null for an unknown, wrong, expired or revoked link (all look the same). */
export async function openCollect(id: string, token: string): Promise<PublicCollect | null> {
  if (!VendorId.safeParse(id).success || !TOKEN.test(token)) return null;
  return toPublic(await asAnon((tx) => tx.query<OpenRow>(OPEN_SQL, [id, sha256Hex(token)])));
}

/** Why an upload didn't go through; the page turns each into a sentence. */
export type ReceiveOutcome = "sent" | "closed" | "gate" | "kind" | "date" | "empty" | "too_big" | "type" | "active" | "link_full" | "workspace_full";

const ExpiresOn = z.union([z.literal(""), CalendarDate]).transform((s) => s || null);

/** Keeps a readable name with the right extension; never a path. */
export function cleanFilename(name: string, mime: AllowedMime): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^\p{L}\p{N} ()_.,'&+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "document"}.${EXTENSION[mime]}`;
}

/**
 * A file a vendor sends through an upload link. Real workspaces get the file as uploaded (size and
 * magic bytes checked, G3 gate open); sample workspaces get a generated SAMPLE PDF instead, so no
 * real document ever lands in one.
 */
export async function receiveFile(
  id: string,
  token: string,
  input: { kind: unknown; expiresOn: unknown; file: { name: string; bytes: Uint8Array } | null },
): Promise<ReceiveOutcome> {
  if (!VendorId.safeParse(id).success || !TOKEN.test(token)) return "closed";
  const hash = sha256Hex(token);
  return asAnon(async (tx) => {
    const rows = await tx.query<OpenRow>(OPEN_SQL, [id, hash]);
    if (!rows.length) return "closed";
    const kind = typeof input.kind === "string" ? rows.find((r) => r.kind === input.kind)?.kind : undefined;
    if (!kind || !isKind(kind)) return "kind";
    const expires = ExpiresOn.safeParse(input.expiresOn ?? "");
    if (!expires.success) return "date";

    let file: { name: string; bytes: Uint8Array; mime: AllowedMime };
    if (rows[0].is_demo) {
      file = await sampleFile(kind, rows[0].vendor_name, rows[0].org_name, expires.data);
    } else {
      if (!collectOpen({ demo: false })) return "gate";
      if (!input.file || input.file.bytes.length === 0) return "empty";
      if (input.file.bytes.length > MAX_UPLOAD_BYTES) return "too_big";
      const mime = sniffMime(input.file.bytes);
      if (!mime) return "type";
      // The same refusal an owner's upload gets (files.ts checkUpload): a vendor's link is the one path an outsider sends files in by (W11-1).
      if (mime === "application/pdf" && activePdf(input.file.bytes)) return "active";
      file = { name: cleanFilename(input.file.name, mime), bytes: input.file.bytes, mime };
    }
    return storeVendorFile(tx, id, hash, rows[0].org_id, kind, expires.data, file, rows[0].is_demo);
  });
}

async function sampleFile(kind: DocKind, vendor: string, org: string, expires: string | null): Promise<{ name: string; bytes: Uint8Array; mime: AllowedMime }> {
  const label = DOC_KINDS[kind];
  const bytes = await samplePdf(
    `${label} from ${vendor}`,
    [
      ["From", vendor],
      ["For", org],
      ["Document", label],
      ["Valid through", expires ?? "No end date given"],
    ],
    "A made-up file. This is a sample workspace, so its upload link sends a sample instead of a real document.",
  );
  return { name: `${label} (sample).pdf`, bytes, mime: "application/pdf" };
}

/** What app.collect_receive answers, as the page's outcome codes. */
const RECEIVED: Record<string, ReceiveOutcome> = { ok: "sent", closed: "closed", link_full: "link_full", workspace_full: "workspace_full" };

/**
 * Stores the object, then records it through app.collect_receive, which checks the link, the kind,
 * the workspace and the caps (Security C-2) again. Unless the database takes it, the object is removed.
 */
async function storeVendorFile(
  tx: Tx,
  linkId: string,
  hash: string,
  orgId: string,
  kind: DocKind,
  expiresOn: string | null,
  file: { name: string; bytes: Uint8Array; mime: AllowedMime },
  sample: boolean,
): Promise<ReceiveOutcome> {
  const fileId = randomUUID();
  const path = `${orgId}/${fileId}/v1.${EXTENSION[file.mime]}`;
  const store = blobStore();
  await store.put(path, file.bytes, file.mime);
  let answer: string | undefined;
  try {
    const [row] = await tx.query<{ answer: string }>("select app.collect_receive($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as answer", [
      linkId,
      hash,
      fileId,
      kind,
      file.name,
      path,
      file.mime,
      file.bytes.length,
      sha256Hex(file.bytes),
      expiresOn,
      sample,
    ]);
    answer = row?.answer;
  } catch (e) {
    await store.remove([path]);
    throw e;
  }
  const outcome = answer !== undefined && Object.hasOwn(RECEIVED, answer) ? RECEIVED[answer] : "closed";
  if (outcome !== "sent") await store.remove([path]);
  return outcome;
}

/**
 * Deletes a file a vendor sent (owners and admins; Security C-1). The row goes first and the stored
 * object is removed inside the same transaction, so if storage fails the row stays and the person
 * can try again. The history records the deletion with the file's fingerprint. Returns the vendor id.
 */
export async function deleteVendorFile(ctx: Ctx, fileId: string): Promise<string> {
  if (ctx.role === "member") throw new UserError("Ask an owner or admin to delete files.");
  if (!VendorId.safeParse(fileId).success) throw new UserError("That file is already gone.");
  const store = blobStore();
  return asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<{ vendor_id: string; storage_path: string }>(
      "delete from app.vendor_files where id = $1 and org_id = $2 returning vendor_id, storage_path",
      [fileId, ctx.orgId],
    );
    if (!row) throw new UserError("That file is already gone.");
    await store.remove([row.storage_path]);
    return row.vendor_id;
  });
}

// Sample workspace --------------------------------------------------------------------------------

/**
 * Three made-up vendors in the sample workspace, one current, one with a certificate about to
 * lapse and a missing license, one with a lapsed certificate. Files arrive through real upload
 * links, the same way a vendor's would.
 */
export async function seedSampleVendors(tx: Tx, ctx: Ctx, day: (offset: number) => string) {
  const vendors: { name: string; email: string | null; requested: DocKind[]; sent: { kind: DocKind; expires: number | null }[] }[] = [
    {
      name: "Rivera Electric (sample)",
      email: "office@rivera-electric.example",
      requested: ["w9", "coi", "license"],
      sent: [
        { kind: "w9", expires: null },
        { kind: "coi", expires: 12 },
      ],
    },
    { name: "Bayside Drywall (sample)", email: null, requested: ["w9", "coi"], sent: [{ kind: "coi", expires: -5 }] },
    {
      name: "Summit Supply Co. (sample)",
      email: "ap@summit-supply.example",
      requested: ["w9", "coi"],
      sent: [
        { kind: "w9", expires: null },
        { kind: "coi", expires: 200 },
      ],
    },
  ];
  for (const v of vendors) {
    const [row] = await tx.query<{ id: string }>("insert into app.vendors (org_id, name, email, requested, created_by) values ($1, $2, $3, $4, $5) returning id", [
      ctx.orgId,
      v.name,
      v.email,
      v.requested,
      ctx.userId,
    ]);
    const { hash } = newToken();
    const linkId = await insertLink(tx, ctx, row.id, hash, 30);
    for (const s of v.sent) {
      const expires = s.expires === null ? null : day(s.expires);
      await storeVendorFile(tx, linkId, hash, ctx.orgId, s.kind, expires, await sampleFile(s.kind, v.name, ctx.name, expires), true);
    }
  }
}
