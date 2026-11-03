import "server-only";
import type { AllowedMime } from "./files";
import { cancelSubscriptionsBeforeDeletion } from "./billing";
import { deleteSignIn } from "./cognito";
import { asService, asUser, pgErrorCode } from "./db";
import { csvCell } from "./csv";
import { downloadName } from "./documents";
import { UserError } from "./errors";
import { loadProfile, NeedsRecentSignIn, type Ctx } from "./profile";
import { recentEnough } from "./session";
import { blobStore, ObjectMissing } from "./storage";
import { zip } from "./zip";

/** delete_my_account's refusal when a billed workspace it would delete wasn't handled (0019). */
const BILLING_NOT_HANDLED = "SS001";

/** Exports are built in memory; past this, the user is asked to contact us instead. */
export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;

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

interface ExportSession {
  ua_family: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

interface ExportLink {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface ExportLinkAccess {
  link_id: string;
  at: string;
  action: string;
  document_id: string | null;
  visitor: string;
}

/** A signature request without its token or code hashes and without storage paths. */
interface ExportSignature {
  id: string;
  document_id: string;
  version: number;
  signed_version: number | null;
  signer_name: string;
  signer_email: string;
  status: string;
  created_at: string;
  expires_at: string;
  signed_at: string | null;
  consented_at: string | null;
  consent_version: string | null;
  signed_name: string | null;
  to_sign_sha256: string | null;
}

interface ExportAgreement {
  item: string;
  policy_version: string;
  object_id: string | null;
  at: string;
}

interface ExportContact {
  name: string;
  email: string | null;
  company: string | null;
  source: string;
  created_at: string;
}


/**
 * Everything in the workspace as a ZIP: every version of every document, their details, the
 * business facts (tax ID only as its last 4 digits), the full history, the passport links with their
 * access log and the signature requests (never a token or code hash, W9-9), the people kept in People, and the exporting
 * person's own sessions (browser and system name and times, Design row 34) and agreements. Owners
 * and admins only, after a recent sign-in; the export itself is recorded in the history.
 */
export async function exportWorkspace(ctx: Ctx): Promise<{ filename: string; bytes: Uint8Array }> {
  if (ctx.role === "member") throw new UserError("Only owners and admins can export the workspace.");
  if (!recentEnough(ctx)) throw new NeedsRecentSignIn("For your security, sign in again to export.");

  const { docs, versions, vendors, vendorFiles, sessions, links, linkDocs, linkAccess, signatures, agreements, contacts } = await asUser(ctx.userId, async (tx) => {
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
    // The exporting person's own sign-ins only: another member's are theirs to export.
    const sessions = await tx.query<ExportSession>(
      "select ua_family, created_at::text as created_at, last_seen_at::text as last_seen_at, revoked_at::text as revoked_at from app.sessions where user_id = $1 order by created_at, id",
      [ctx.userId],
    );
    const links = await tx.query<ExportLink>(
      "select id, label, created_at::text as created_at, expires_at::text as expires_at, revoked_at::text as revoked_at from app.share_links where org_id = $1 order by created_at, id",
      [ctx.orgId],
    );
    const linkDocs = await tx.query<{ link_id: string; document_id: string }>(
      "select link_id, document_id from app.share_link_documents where org_id = $1 order by link_id, document_id",
      [ctx.orgId],
    );
    const linkAccess = await tx.query<ExportLinkAccess>(
      "select link_id, at::text as at, action, document_id, visitor from app.share_access where org_id = $1 order by at, seq",
      [ctx.orgId],
    );
    const signatures = await tx.query<ExportSignature>(
      "select id, document_id, version, signed_version, signer_name, signer_email, status, created_at::text as created_at, expires_at::text as expires_at, signed_at::text as signed_at, consented_at::text as consented_at, consent_version, signed_name, to_sign_sha256 from app.signature_requests where org_id = $1 order by created_at, id",
      [ctx.orgId],
    );
    // The exporting person's own agreements only, as with sessions.
    const agreements = await tx.query<ExportAgreement>(
      "select item, policy_version, object_id, at::text as at from app.consents where user_id = $1 order by at, id",
      [ctx.userId],
    );
    // People (0046): the workspace's contacts, as every member sees them on People.
    const contacts = await tx.query<ExportContact>(
      "select name, email, company, source, created_at::text as created_at from app.contacts where org_id = $1 order by lower(name), id",
      [ctx.orgId],
    );
    return { docs, versions, vendors, vendorFiles, sessions, links, linkDocs, linkAccess, signatures, agreements, contacts };
  });

  const passports: (ExportLink & { documents: string[]; access: Omit<ExportLinkAccess, "link_id">[] })[] = links.map((l) => ({ ...l, documents: [], access: [] }));
  const passportById = new Map(passports.map((p) => [p.id, p]));
  for (const d of linkDocs) passportById.get(d.link_id)?.documents.push(d.document_id);
  for (const { link_id, ...a } of linkAccess) passportById.get(link_id)?.access.push(a);

  const profile = await loadProfile(ctx);
  const store = blobStore();
  const files: { name: string; data: Uint8Array }[] = [];
  // A file whose stored object is gone (review #17) is named in the README and listed with no file,
  // rather than making the whole workspace impossible to export. A storage fault still throws.
  const missing: string[] = [];
  const fetch = async (file: string, storagePath: string): Promise<string | null> => {
    try {
      files.push({ name: file, data: await store.get(storagePath) });
      return file;
    } catch (e) {
      if (!(e instanceof ObjectMissing)) throw e;
      missing.push(file);
      return null;
    }
  };
  const listed: (ExportDoc & { versions: (Omit<ExportVersion, "storage_path" | "document_id"> & { file: string | null })[] })[] = docs.map((d) => ({ ...d, versions: [] }));
  const byId = new Map(listed.map((d) => [d.id, d]));

  for (const v of versions) {
    const doc = byId.get(v.document_id);
    if (!doc) continue;
    // The short id keeps two documents with the same title apart.
    const file = await fetch(`documents/${doc.id.slice(0, 8)} ${downloadName(doc.title, v.version, v.mime)}`, v.storage_path);
    doc.versions.push({ version: v.version, mime: v.mime, size_bytes: v.size_bytes, sha256: v.sha256, origin: v.origin, created_at: v.created_at, file });
  }

  const listedVendors: (ExportVendor & { files: (Omit<ExportVendorFile, "storage_path" | "vendor_id"> & { file: string | null })[] })[] = vendors.map((v) => ({
    ...v,
    files: [],
  }));
  const vendorById = new Map(listedVendors.map((v) => [v.id, v]));
  for (const f of vendorFiles) {
    const vendor = vendorById.get(f.vendor_id);
    if (!vendor) continue;
    const { storage_path, vendor_id: _vendor, ...details } = f;
    const file = await fetch(`vendor-files/${f.id.slice(0, 8)} ${f.filename}`, storage_path);
    vendor.files.push({ ...details, file });
  }
  if (missing.length) console.error(`export: ${missing.length} stored files were not found`);

  // Recorded once the files are in hand, so the history never claims an export that didn't happen.
  const history = await asUser(ctx.userId, async (tx) => {
    await tx.query("select app.audit_append($1, 'workspace.exported', $1)", [ctx.orgId]);
    return tx.query<ExportEvent>(
      "select a.seq::text as seq, a.at::text as at, a.actor::text as actor, a.action, a.object_id::text as object_id, a.detail_sha256 from app.audit_log a where a.org_id = $1 order by a.seq",
      [ctx.orgId],
    );
  });

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
    "sessions.json    the browsers you signed in on: browser and system name, when you signed in, were last active and signed out",
    "passports.json   your passport links: who each is for, when it was made, expires or was revoked, its documents, and every open, view and download with the visitor's keyed network fingerprint (a short code, not their address)",
    "signatures.json  your signature requests: the document and version, the signer's name and email, the status, when it was made, expires and was signed, the name they typed, when and to which version of the consent they agreed, and the reviewed file's SHA-256 fingerprint",
    "agreements.json  what you agreed to (such as the Terms and Privacy Policy), which version, and when",
    "contacts.csv     the people your workspace keeps in People: name, email, company, where each came from (typed, signer or sample) and when it was added",
    "",
    "Check a file against its fingerprint with: shasum -a 256 <file>",
    ...(missing.length ? ["", "NOT INCLUDED: the stored copy of these files could not be found. Their details and fingerprints are still listed.", ...missing.map((m) => `  ${m}`)] : []),
  ].join("\n");

  return {
    filename: `ShipShape export ${ctx.today}.zip`,
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
        { name: "sessions.json", data: enc.encode(JSON.stringify(sessions, null, 2)) },
        { name: "passports.json", data: enc.encode(JSON.stringify(passports, null, 2)) },
        { name: "signatures.json", data: enc.encode(JSON.stringify(signatures, null, 2)) },
        { name: "agreements.json", data: enc.encode(JSON.stringify(agreements, null, 2)) },
        {
          name: "contacts.csv",
          data: enc.encode(
            ["name,email,company,source,created_at", ...contacts.map((c) => [c.name, c.email, c.company, c.source, c.created_at].map(csvCell).join(","))].join("\n"),
          ),
        },
        ...files,
      ],
      now,
    ),
  };
}

/**
 * What deleting the account would do, by workspace name, for the confirm step: the workspaces where
 * the person is the only owner go (app.delete_my_account's rule), and they leave the others.
 */
export async function deletionPreview(userId: string): Promise<{ deleted: string[]; left: string[] }> {
  const rows = await asService((tx) =>
    tx.query<{ name: string; doomed: boolean }>(
      `select o.name, (m.role = 'owner' and not exists (select 1 from app.members x where x.org_id = m.org_id and x.role = 'owner' and x.user_id <> $1)) as doomed
       from app.members m join app.organizations o on o.id = m.org_id
       where m.user_id = $1 order by o.name`,
      [userId],
    ),
  );
  return { deleted: rows.filter((r) => r.doomed).map((r) => r.name), left: rows.filter((r) => !r.doomed).map((r) => r.name) };
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

/** The daily run's work budget: well inside the cron function's 60 s limit (Security N-091b, review #15). */
export const DAILY_RUN_BUDGET_MS = 50_000;

/**
 * The daily run (Security CG-3): finishes every recorded deletion older than PENDING_AFTER, until
 * none are left or `until` (ms since epoch) passes; the rest wait for the next run. Each one that
 * fails stays recorded, stamped with when it was tried, and the run takes the least recently tried
 * first (never tried, then oldest attempt, then oldest request), so requests that keep failing
 * rotate instead of holding up the ones behind them (W11-9). Only error names are logged.
 */
export async function finishDeletions(until = Date.now() + DAILY_RUN_BUDGET_MS): Promise<{ finished: number; failed: number }> {
  const due = await asService((tx) =>
    tx.query<{ user_id: string }>(
      "select user_id from app.deletion_requests where requested_at < now() - $1::interval order by attempted_at nulls first, attempted_at, requested_at limit 100",
      [PENDING_AFTER],
    ),
  );
  let finished = 0;
  let tried = 0;
  for (const { user_id } of due) {
    if (Date.now() >= until) break;
    tried++;
    try {
      await finishDeletion(user_id, await cancelSubscriptionsBeforeDeletion(user_id, until));
      finished++;
    } catch (e) {
      console.error(`account deletion: a recorded deletion didn't finish (${e instanceof Error ? e.name : "unknown"})`);
      await asService((tx) => tx.query("update app.deletion_requests set attempted_at = now() where user_id = $1", [user_id]));
    }
  }
  return { finished, failed: tried - finished };
}

/**
 * Sample visitors' sessions last 12 hours; their accounts go after this, with everything in them.
 * One day, and the daily run takes what's older: a sample is gone one to two days after it was
 * made, inside /privacy's "within two days" (W11-8).
 */
const SAMPLE_KEPT_FOR = "1 day";
const SAMPLE_BATCH = 50;

/**
 * The daily run: deletes sample-workspace visitors' accounts older than SAMPLE_KEPT_FOR, oldest
 * first, batch after batch until none are left or `until` passes (W11-2: one batch a day fell behind
 * what sample sign-ins allow), with the same steps as a recorded deletion. Every batch takes only
 * anonymous accounts that belong to no workspace but samples (is_demo), so a real workspace is
 * never deleted here. Sample workspaces are never billed, so the database refusing over billing
 * counts as a failure and isn't retried in this run; one already gone counts as purged. Only counts
 * and error names are logged.
 */
export async function purgeSampleAccounts(until = Date.now() + DAILY_RUN_BUDGET_MS): Promise<{ purged: number; failed: number }> {
  let purged = 0;
  let tried = 0;
  const failed: string[] = [];
  while (Date.now() < until) {
    const due = await asService((tx) =>
      tx.query<{ id: string }>(
        `select u.id from auth.users u
         where u.is_anonymous and u.created_at < now() - $1::interval and u.id <> all($2::uuid[])
           and not exists (select 1 from app.members m join app.organizations o on o.id = m.org_id where m.user_id = u.id and not o.is_demo)
         order by u.created_at limit $3`,
        [SAMPLE_KEPT_FOR, failed, SAMPLE_BATCH],
      ),
    );
    if (due.length === 0) break;
    for (const { id } of due) {
      if (Date.now() >= until) break;
      tried++;
      try {
        // A sample visitor has no Cognito identity, so this finds none and calls nothing.
        await deleteSignIn(id);
        await removeAfterDeletion(await deleteRows(id, []));
        purged++;
      } catch (e) {
        failed.push(id);
        console.error(`sample purge: a sample account wasn't deleted (${e instanceof Error ? e.name : "unknown"})`);
      }
    }
    if (due.length < SAMPLE_BATCH) break;
  }
  return { purged, failed: tried - purged };
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
  let rows: { storage_path: string }[];
  try {
    rows = await deleteRows(userId, handled);
  } catch (e) {
    if (pgErrorCode(e) !== BILLING_NOT_HANDLED) throw e;
    rows = await deleteRows(userId, await cancelSubscriptionsBeforeDeletion(userId));
  }
  await removeAfterDeletion(rows);
}

/** Deletes the user's rows (app.delete_my_account) and returns the stored files they leave behind. */
const deleteRows = (userId: string, handled: string[]) =>
  asUser(userId, (tx) => tx.query<{ storage_path: string }>("select storage_path from app.delete_my_account($1::uuid[])", [handled]));

/**
 * After the commit. The deletion queued these paths (app.storage_cleanup, 0028), so if storage
 * fails now they stay queued and the daily run retries them (Security N-091a); only the count is
 * logged.
 */
async function removeAfterDeletion(rows: { storage_path: string }[]): Promise<void> {
  try {
    await removeQueued(rows.map((r) => r.storage_path));
  } catch {
    console.error(`account deletion: ${rows.length} stored files could not be removed yet; queued for the daily run`);
  }
}

/** Removes stored files whose rows are gone, then their queue entries. Removal is idempotent, so a retry is safe. */
async function removeQueued(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await blobStore().remove(paths);
  await asService((tx) => tx.query("delete from app.storage_cleanup where path = any($1::text[])", [paths]));
}

const CLEANUP_BATCH = 1000;

/**
 * The daily run: removes stored files an account deletion couldn't remove (Security N-091a), in
 * batches of 1,000 until none are left or `until` passes; past `until` it doesn't start a batch at
 * all (W11-16). Returns how many. A batch storage refuses (one key under a policy or lock) goes to
 * the back of the queue so the paths behind it still get their turn (review #16); the run then
 * still throws, so it reports the failure (error name only).
 */
export async function retryStorageCleanup(until = Date.now() + DAILY_RUN_BUDGET_MS): Promise<number> {
  const started = new Date();
  let removed = 0;
  let refused: unknown = null;
  while (Date.now() < until) {
    const queued = await asService((tx) =>
      tx.query<{ path: string }>("select path from app.storage_cleanup where queued_at < $2 order by queued_at, path limit $1", [CLEANUP_BATCH, started]),
    );
    const paths = queued.map((q) => q.path);
    if (!paths.length) break;
    try {
      await removeQueued(paths);
      removed += paths.length;
    } catch (e) {
      await asService((tx) => tx.query("update app.storage_cleanup set queued_at = now() where path = any($1::text[])", [paths]));
      console.error(`stored-file cleanup: a batch of ${paths.length} wasn't removed (${e instanceof Error ? e.name : "unknown"}); it goes to the back of the queue`);
      refused = e;
    }
    if (paths.length < CLEANUP_BATCH) break;
  }
  if (refused) throw refused;
  return removed;
}

const SWEEP_BATCH = 100;

/**
 * The daily run (W11-7): removes whatever is still stored under each deleted workspace's
 * `<org id>/` prefix, queued by delete_my_account (0040) — objects whose row was never written.
 * Each prefix is checked again before anything is listed (removePrefix), and a prefix whose
 * workspace still exists is never swept. A prefix storage refuses goes to the back of the queue
 * and the run throws at the end, like retryStorageCleanup. Returns how many objects were removed.
 */
export async function sweepDeletedWorkspaces(until = Date.now() + DAILY_RUN_BUDGET_MS): Promise<number> {
  const started = new Date();
  let removed = 0;
  let refused: unknown = null;
  while (Date.now() < until) {
    const queued = await asService((tx) =>
      tx.query<{ prefix: string }>(
        `select p.prefix from app.storage_prefix_cleanup p
         where p.queued_at < $2 and not exists (select 1 from app.organizations o where o.id::text || '/' = p.prefix)
         order by p.queued_at, p.prefix limit $1`,
        [SWEEP_BATCH, started],
      ),
    );
    if (!queued.length) break;
    for (const { prefix } of queued) {
      if (Date.now() >= until) break;
      try {
        removed += await blobStore().removePrefix(prefix);
        await asService((tx) => tx.query("delete from app.storage_prefix_cleanup where prefix = $1", [prefix]));
      } catch (e) {
        await asService((tx) => tx.query("update app.storage_prefix_cleanup set queued_at = now() where prefix = $1", [prefix]));
        console.error(`workspace sweep: a deleted workspace's files weren't removed (${e instanceof Error ? e.name : "unknown"}); it goes to the back of the queue`);
        refused = e;
      }
    }
    if (queued.length < SWEEP_BATCH) break;
  }
  if (refused) throw refused;
  return removed;
}
