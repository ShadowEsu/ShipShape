import "server-only";
import type { AllowedMime } from "./files";
import { cancelSubscriptionsBeforeDeletion } from "./billing";
import { asUser } from "./db";
import { downloadName } from "./documents";
import { UserError } from "./errors";
import { loadProfile, NeedsRecentSignIn, type Ctx } from "./profile";
import { authIsRecent } from "./session";
import { blobStore } from "./storage";
import { zip } from "./zip";

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

  const { docs, versions, history } = await asUser(ctx.userId, async (tx) => {
    const docs = await tx.query<ExportDoc>(
      "select d.id, d.title, d.kind, d.status, d.issuer, d.counterparty, d.issued_on::text as issued_on, d.expires_on::text as expires_on, d.renews_on::text as renews_on, d.created_at::text as created_at from app.documents d where d.org_id = $1 order by d.created_at, d.id",
      [ctx.orgId],
    );
    const versions = await tx.query<ExportVersion>(
      "select v.document_id, v.version, v.mime, v.size_bytes, v.sha256, v.origin, v.created_at::text as created_at, v.storage_path from app.document_versions v join app.documents d on d.id = v.document_id where v.org_id = $1 order by d.created_at, d.id, v.version",
      [ctx.orgId],
    );
    if (versions.reduce((n, v) => n + v.size_bytes, 0) > EXPORT_MAX_BYTES) {
      throw new UserError("This workspace is too large to export in one file. Write to us and we'll send it another way.");
    }
    await tx.query("select app.audit_append($1, 'workspace.exported', $1)", [ctx.orgId]);
    const history = await tx.query<ExportEvent>(
      "select a.seq::text as seq, a.at::text as at, a.actor::text as actor, a.action, a.object_id::text as object_id from app.audit_log a where a.org_id = $1 order by a.seq",
      [ctx.orgId],
    );
    return { docs, versions, history };
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

  const now = new Date();
  const enc = new TextEncoder();
  const readme = [
    `ShipShape export of "${ctx.name}"`,
    `Made ${now.toISOString()}`,
    "",
    "documents/       every version of every document, as stored",
    "documents.json   each document's details, versions and SHA-256 fingerprints",
    "facts.json       your business facts (the tax ID appears only as its last 4 digits; see it in full in Business facts)",
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
        { name: "history.csv", data: enc.encode(["seq,at,actor,action,object_id", ...history.map((h) => [h.seq, h.at, h.actor, h.action, h.object_id].map(csvCell).join(","))].join("\n")) },
        ...files,
      ],
      now,
    ),
  };
}

/**
 * Deletes the account (Security R10): workspaces where you're the only owner go entirely, with
 * their files, share links and signing requests; in other workspaces you're removed.
 */
export async function deleteAccount(ctx: Ctx): Promise<void> {
  if (!recentEnough(ctx)) throw new NeedsRecentSignIn("For your security, sign in again to delete your account.");
  // Stop billing first: a deleted workspace must never keep being charged.
  await cancelSubscriptionsBeforeDeletion(ctx.userId);
  const rows = await asUser(ctx.userId, (tx) => tx.query<{ storage_path: string }>("select storage_path from app.delete_my_account()"));
  // After the commit: if this fails the rows are already gone, so the objects are unreachable
  // orphans in private storage; the count (never the paths) goes to the log for cleanup.
  try {
    await blobStore().remove(rows.map((r) => r.storage_path));
  } catch {
    console.error(`account deletion: ${rows.length} stored files could not be removed`);
  }
}
