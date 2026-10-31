import "server-only";
import type { AllowedMime } from "./files";
import { cancelSubscriptionsBeforeDeletion } from "./billing";
import { deleteSignIn } from "./cognito";
import { asService, asUser, pgErrorCode } from "./db";
import { downloadName } from "./documents";
import { UserError } from "./errors";
import { loadProfile, NeedsRecentSignIn, type Ctx } from "./profile";
import { authIsRecent } from "./session";
import { blobStore } from "./storage";
import { zip } from "./zip";

/** delete_my_account's refusal when a billed workspace it would delete wasn't handled (0019). */
const BILLING_NOT_HANDLED = "SS001";

/** Exports are built in memory; past this, the user is asked to contact us instead. */
export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;

// Sample workspaces hold only made-up data and their visitors have no password to re-enter.
const recentEnough = (ctx: Ctx) => ctx.demo || authIsRecent(ctx);

interface ExportDoc {
  id: string;
  title: string;
  kind: string;
  status: string;
  issuer: string | null;
  counterparty: string | null;
  issued_on: string | null;
  expires_on: string | null;
  renews_on: string | null;
  created_at: string;
}

interface ExportVersion {
  document_id: string;
  version: number;
  mime: AllowedMime;
  size_bytes: number;
  sha256: string;
  origin: string;
  created_at: string;
  storage_path: string;
}

interface ExportEvent {
  seq: string;
  at: string;
  actor: string | null;
  action: string;
  object_id: string | null;
  detail_sha256: string | null;
}

interface ExportVendor {
  id: string;
  name: string;
  email: string | null;
  requested: string[];
  status: string;
  created_at: string;
}

interface ExportVendorFile {
  id: string;
  vendor_id: string;
  kind: string;
  filename: string;
  mime: AllowedMime;
  size_bytes: number;
  sha256: string;
  expires_on: string | null;
  sample: boolean;
  received_at: string;
  storage_path: string;
}

const csvCell = (v: string | null) => (v === null ? "" : /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/**
 * Everything in the workspace as a ZIP: every version of every document, their details, the
 * business facts (tax ID only as its last 4 digits) and the full history. Owners and admins only,
 * after a recent sign-in; the export itself is recorded in the history.
 */
export async function exportWorkspace(ctx: Ctx): Promise<{ filename: string; bytes: Uint8Array }> {
  if (ctx.role === "member") throw new UserError("Only owners and admins can export the workspace.");
  if (!recentEnough(ctx)) throw new NeedsRecentSignIn("For your security, sign in again to export.");

  const { docs, versions, vendors, vendorFiles, history } = await asUser(ctx.userId, async (tx) => {
    const docs = await tx.query<ExportDoc>(
      "select d.id, d.title, d.kind, d.status, d.issuer, d.counterparty, d.issued_on::text as issued_on, d.expires_on::text as expires_on, d.renews_on::text as renews_on, d.created_at::text as created_at from app.documents d where d.org_id = $1 order by d.created_at, d.id",
      [ctx.orgId],
    );
    const versions = await tx.query<ExportVersion>(
      "select v.document_id, v.version, v.mime, v.size_bytes, v.sha256, v.origin, v.created_at::text as created_at, v.storage_path from app.document_versions v join app.documents d on d.id = v.document_id where v.org_id = $1 order by d.created_at, d.id, v.version",
      [ctx.orgId],
    );
    const vendors = await tx.query<ExportVendor>(
      "select id, name, email, requested, status, created_at::text as created_at from app.vendors where org_id = $1 order by created_at, id",
      [ctx.orgId],
    );
    const vendorFiles = await tx.query<ExportVendorFile>(
      "select id, vendor_id, kind, filename, mime, size_bytes, sha256, expires_on::text as expires_on, sample, received_at::text as received_at, storage_path from app.vendor_files where org_id = $1 order by received_at, id",
      [ctx.orgId],
    );
    if ([...versions, ...vendorFiles].reduce((n, v) => n + v.size_bytes, 0) > EXPORT_MAX_BYTES) {
      throw new UserError("This workspace is too large to export in one file. Write to us and we'll send it another way.");
    }
    await tx.query("select app.audit_append($1, 'workspace.exported', $1)", [ctx.orgId]);
    const history = await tx.query<ExportEvent>(
      "select a.seq::text as seq, a.at::text as at, a.actor::text as actor, a.action, a.object_id::text as object_id, a.detail_sha256 from app.audit_log a where a.org_id = $1 order by a.seq",
      [ctx.orgId],
    );
    return { docs, versions, vendors, vendorFiles, history };
  });

  const profile = await loadProfile(ctx);
  const store = blobStore();
  const files: { name: string; data: Uint8Array }[] = [];
  const listed: (ExportDoc & { versions: (Omit<ExportVersion, "storage_path" | "document_id"> & { file: string })[] })[] = docs.map((d) => ({ ...d, versions: [] }));
  const byId = new Map(listed.map((d) => [d.id, d]));

  for (const v of versions) {
    const doc = byId.get(v.document_id);
    if (!doc) continue;
    // The short id keeps two documents with the same title apart.
    const file = `documents/${doc.id.slice(0, 8)} ${downloadName(doc.title, v.version, v.mime)}`;
    files.push({ name: file, data: await store.get(v.storage_path) });
    doc.versions.push({ version: v.version, mime: v.mime, size_bytes: v.size_bytes, sha256: v.sha256, origin: v.origin, created_at: v.created_at, file });
  }

  const listedVendors: (ExportVendor & { files: (Omit<ExportVendorFile, "storage_path" | "vendor_id"> & { file: string })[] })[] = vendors.map((v) => ({
    ...v,
    files: [],
  }));
  const vendorById = new Map(listedVendors.map((v) => [v.id, v]));
  for (const f of vendorFiles) {
    const vendor = vendorById.get(f.vendor_id);
    if (!vendor) continue;
    const { storage_path, vendor_id: _vendor, ...details } = f;
    const file = `vendor-files/${f.id.slice(0, 8)} ${f.filename}`;
    files.push({ name: file, data: await store.get(storage_path) });
    vendor.files.push({ ...details, file });
  }

  const now = new Date();
  const enc = new TextEncoder();
  const readme = [
    `ShipShape export of "${ctx.name}"`,
    `Made ${now.toISOString()}`,
    "",
    "documents/       every version of every document, as stored",
    "documents.json   each document's details, versions and SHA-256 fingerprints",
    "facts.json       your business facts (the tax ID appears only as its last 4 digits; see it in full in Business facts)",
    "vendor-files/    files your vendors sent through Collect upload links",
    "vendors.json     your vendors, what you asked each for, and the files they sent with SHA-256 fingerprints",
    "history.csv      the workspace history, oldest first",
    "",
    "Check a file against its fingerprint with: shasum -a 256 <file>",
  ].join("\n");

  return {
    filename: `ShipShape export ${now.toISOString().slice(0, 10)}.zip`,
    bytes: zip(
      [
        { name: "README.txt", data: enc.encode(readme) },
        { name: "documents.json", data: enc.encode(JSON.stringify(listed, null, 2)) },
        {
          name: "facts.json",
          data: enc.encode(JSON.stringify({ ...profile.values, ein: profile.einLast4 ? `ending ${profile.einLast4}` : null, confirmed: profile.confirmed }, null, 2)),
        },
        { name: "vendors.json", data: enc.encode(JSON.stringify(listedVendors, null, 2)) },
        {
          name: "history.csv",
          data: enc.encode(
            ["seq,at,actor,action,object_id,sha256", ...history.map((h) => [h.seq, h.at, h.actor, h.action, h.object_id, h.detail_sha256].map(csvCell).join(","))].join("\n"),
          ),
        },
        ...files,
      ],
      now,
    ),
  };
}

/** Requests older than this are the daily run's to finish: younger ones may still be finishing in the person's own request. */
const PENDING_AFTER = "15 minutes";

/**
 * Deletes the account (Security R10): workspaces where you're the only owner go entirely, with
 * their files, share links and signing requests; in other workspaces you're removed.
 * Billing stops first: a deleted workspace must never keep being charged, and if it can't be
 * stopped nothing is deleted. Then the request is recorded in a transaction of its own (Security
 * CG-3), so from here on the deletion finishes even if the person never comes back: whatever
 * doesn't finish now, the daily run finishes (finishDeletions).
 */
export async function deleteAccount(ctx: Ctx): Promise<void> {
  if (!recentEnough(ctx)) throw new NeedsRecentSignIn("For your security, sign in again to delete your account.");
  const handled = await cancelSubscriptionsBeforeDeletion(ctx.userId);
  await asService((tx) =>
    tx.query("insert into app.deletion_requests (user_id) values ($1) on conflict (user_id) do update set requested_at = now()", [ctx.userId]),
  );
  try {
    await finishDeletion(ctx.userId, handled);
  } catch (e) {
    console.error(`account deletion: didn't finish, left for the daily run (${e instanceof Error ? e.name : "unknown"})`);
    throw new UserError(
      "Deleting your account didn't finish just now. It will finish by itself within two days, so there's nothing more you need to do; pressing Delete my account again finishes it now.",
    );
  }
}

/** The person asked to delete their account and it hasn't finished yet: the app says so on every page (Security CG-I1). */
export async function deletionPending(userId: string): Promise<boolean> {
  const rows = await asService((tx) => tx.query("select 1 from app.deletion_requests where user_id = $1", [userId]));
  return rows.length > 0;
}

/**
 * The daily run (Security CG-3): finishes every recorded deletion older than PENDING_AFTER. Each
 * one that fails stays recorded for the next run; only error names are logged.
 */
export async function finishDeletions(): Promise<{ finished: number; failed: number }> {
  const due = await asService((tx) =>
    tx.query<{ user_id: string }>("select user_id from app.deletion_requests where requested_at < now() - $1::interval order by requested_at limit 100", [PENDING_AFTER]),
  );
  let finished = 0;
  for (const { user_id } of due) {
    try {
      await finishDeletion(user_id, await cancelSubscriptionsBeforeDeletion(user_id));
      finished++;
    } catch (e) {
      console.error(`account deletion: a recorded deletion didn't finish (${e instanceof Error ? e.name : "unknown"})`);
    }
  }
  return { finished, failed: due.length - finished };
}

/**
 * The rest of a recorded deletion, once `handled` (the workspaces whose billing was stopped) is
 * known. The Cognito user goes before the rows: nobody can sign back in to an emptied account, and
 * a Cognito user that's already gone counts as deleted, so this can run again. The database refuses
 * (SS001) if a billed workspace it is about to delete wasn't handled: another owner left in the
 * meantime and made this person the sole owner. Then billing is handled again, once. Deleting the
 * user removes the recorded request with it.
 */
async function finishDeletion(userId: string, handled: string[]): Promise<void> {
  await deleteSignIn(userId);
  const deleteRows = (orgs: string[]) =>
    asUser(userId, (tx) => tx.query<{ storage_path: string }>("select storage_path from app.delete_my_account($1::uuid[])", [orgs]));
  let rows: { storage_path: string }[];
  try {
    rows = await deleteRows(handled);
  } catch (e) {
    if (pgErrorCode(e) !== BILLING_NOT_HANDLED) throw e;
    rows = await deleteRows(await cancelSubscriptionsBeforeDeletion(userId));
  }
  // After the commit: if this fails the rows are already gone, so the objects are unreachable
  // orphans in private storage; the count (never the paths) goes to the log for cleanup.
  try {
    await blobStore().remove(rows.map((r) => r.storage_path));
  } catch {
    console.error(`account deletion: ${rows.length} stored files could not be removed`);
  }
}
