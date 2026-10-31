import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { ESIGN_CONSENT_TEXT, ESIGN_CONSENT_VERSION } from "@/lib/consent";
import { appendPages } from "@/lib/pdf/append";
import { composePdf, isPrintable, printableOnly } from "@/lib/pdf/compose";
import { buildToSign, NotSignable } from "@/lib/pdf/to-sign";
import { keyedHash, newToken, sha256Hex } from "./crypto";
import { asAnon, asUser } from "./db";
import { downloadName } from "./documents";
import { UserError } from "./errors";
import { MAX_UPLOAD_BYTES, type AllowedMime } from "./files";
import { GateClosed } from "./flags";
import { visitorId } from "./passport";
import { assertWithinPlan } from "./plans";
import type { Ctx } from "./profile";
import { blobStore } from "./storage";

export const SIGN_DAYS = [7, 14, 30] as const;

/**
 * Signers prove they read their email with a one-time code. Email sending is off, so codes land in
 * the workspace outbox, which the sender can read: fine for sample workspaces (fictional signers),
 * not for real ones. Real workspaces can request signatures in production only once email is on.
 */
export const esignAvailable = (ctx: { demo: boolean }) => ctx.demo || process.env.NODE_ENV !== "production";

const NewRequest = z.object({
  documentId: z.uuid(),
  signerName: z.string().trim().min(1, "Who should sign?").max(120).refine(isPrintable, "Use letters, numbers and common punctuation."),
  signerEmail: z.email("Enter the signer's email address.").max(200),
  days: z.coerce.number().refine((d) => SIGN_DAYS.some((x) => x === d), "Choose how long the request stays open."),
});

/**
 * Creates a signature request and the file the signer will review: ShipShape's inert copy of the
 * latest version (Security R2-1). Signing appends the certificate to exactly that file.
 */
export async function requestSignature(ctx: Ctx, input: unknown): Promise<{ id: string; token: string }> {
  if (!esignAvailable(ctx)) throw new GateClosed("Signing by email opens once ShipShape can send email.");
  const p = NewRequest.parse(input);
  const { token, hash } = newToken();
  const id = randomUUID();
  const toSignPath = `${ctx.orgId}/${id}/v1.pdf`;
  await asUser(ctx.userId, async (tx) => {
    await assertWithinPlan(tx, ctx.orgId, "esign");
    const [latest] = await tx.query<{ version: number; storage_path: string; mime: AllowedMime; sha256: string }>(
      "select v.version, v.storage_path, v.mime, v.sha256 from app.document_versions v join app.documents d on d.id = v.document_id where v.document_id = $1 and d.org_id = $2 and d.status = 'active' order by v.version desc limit 1",
      [p.documentId, ctx.orgId],
    );
    if (!latest) throw new UserError("Document not found.");
    const original = await blobStore().get(latest.storage_path);
    // The certificate names the upload's fingerprint, so the file read now must be that upload (Security R3-3).
    if (sha256Hex(original) !== latest.sha256) throw new UserError("The stored copy of this document doesn't match its fingerprint, so it can't be sent. Upload it again as a new version.");
    let toSign: Uint8Array;
    try {
      toSign = await buildToSign(original, latest.mime);
    } catch (e) {
      if (!(e instanceof NotSignable)) throw e;
      throw new UserError(
        e.reason === "viewer_dependent"
          ? "This PDF can look different in different apps (hidden layers or self-updating form fields), so it can't be sent for signature. Print it to a new PDF and upload that as a new version."
          : "ShipShape can't read this file well enough to send it for signature. If it's password-protected, remove the password, or print it to a new PDF and upload that.",
      );
    }
    if (toSign.length > MAX_UPLOAD_BYTES) throw new UserError("This document is too large to send for signature.");
    await tx.query(
      "insert into app.signature_requests (id, org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by, to_sign_path, to_sign_sha256) values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8), $9, $10, $11)",
      [id, ctx.orgId, p.documentId, latest.version, p.signerName, p.signerEmail, hash, p.days, ctx.userId, toSignPath, sha256Hex(toSign)],
    );
    // Stored last, inside the transaction: if storing fails, the request rolls back with it.
    await blobStore().put(toSignPath, toSign, "application/pdf");
  });
  return { id, token };
}

export interface SignatureRequestRow {
  id: string;
  signer_name: string;
  signer_email: string;
  status: "pending" | "signed" | "declined" | "revoked";
  version: number;
  signed_version: number | null;
  expires_at: string;
  signed_at: string | null;
  created_at: string;
  /** The request has its own file to sign (every request since Security R2-1). */
  has_review_file: boolean;
}

export async function listSignatureRequests(ctx: Ctx, documentId: string): Promise<SignatureRequestRow[]> {
  return asUser(ctx.userId, (tx) =>
    tx.query<SignatureRequestRow>(
      "select id, signer_name, signer_email, status, version, signed_version, expires_at::text as expires_at, signed_at::text as signed_at, created_at::text as created_at, to_sign_sha256 is not null as has_review_file from app.signature_requests where org_id = $1 and document_id = $2 order by created_at desc",
      [ctx.orgId, documentId],
    ),
  );
}

/**
 * A 5-minute download link to exactly the file a signature request sent (Security R3-2), so the
 * sender can check what the signer will see before sharing the link. Members of the workspace only;
 * the file has the name the signer's download gets. The download lands in the document's history
 * (R4-5).
 */
export async function reviewFileUrl(ctx: Ctx, documentId: string, requestId: string): Promise<string> {
  if (!z.uuid().safeParse(requestId).success || !z.uuid().safeParse(documentId).success) throw new UserError("Request not found.");
  const [row] = await asUser(ctx.userId, async (tx) => {
    const rows = await tx.query<{ title: string; version: number }>(
      "select d.title, r.version from app.signature_requests r join app.documents d on d.id = r.document_id where r.id = $1 and r.document_id = $2 and r.org_id = $3 and r.to_sign_sha256 is not null",
      [requestId, documentId, ctx.orgId],
    );
    if (rows.length) await tx.query("select app.audit_append($1, 'esign.review_downloaded', $2)", [ctx.orgId, documentId]);
    return rows;
  });
  if (!row) throw new UserError("Request not found.");
  return blobStore().signedUrl(`${ctx.orgId}/${requestId}/v1.pdf`, { filename: downloadName(row.title, row.version, "application/pdf"), inline: false });
}

export async function revokeSignatureRequest(ctx: Ctx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new UserError("Request not found.");
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query("update app.signature_requests set status = 'revoked' where id = $1 and org_id = $2 and status = 'pending' returning 1", [id, ctx.orgId]),
  );
  if (!rows.length) throw new UserError("That request is no longer open.");
}

// Signer side -------------------------------------------------------------------------------------

/** Cookie that carries a signing token for 30 minutes, sent only to that request's own pages. */
export const SIGN_COOKIE = "ss_sign";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface OpenRow {
  org_id: string;
  org_name: string;
  is_demo: boolean;
  document_id: string;
  title: string;
  signer_name: string;
  signer_email: string;
  status: "pending" | "signed";
  expires_at: string;
  requested_at: string;
  version: number;
  next_version: number;
  storage_path: string;
  mime: AllowedMime;
  sha256: string;
  signed_at: string | null;
  /** The file the signer reviews, while the request is pending (0018). */
  to_sign_path: string | null;
  to_sign_sha256: string | null;
}

async function open(id: string, token: string, record: boolean): Promise<OpenRow | null> {
  if (!z.uuid().safeParse(id).success || !TOKEN.test(token)) return null;
  const [row] = await asAnon((tx) =>
    tx.query<OpenRow>(
      "select org_id, org_name, is_demo, document_id, title, signer_name, signer_email, status, expires_at::text as expires_at, requested_at::text as requested_at, version, next_version, storage_path, mime, sha256, signed_at::text as signed_at, to_sign_path, to_sign_sha256 from app.esign_open($1, $2, $3)",
      [id, sha256Hex(token), record],
    ),
  );
  return row ?? null;
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, (_, first: string, domain: string) => `${first}•••${domain}`);

export interface SigningView {
  orgName: string;
  /** A sample workspace: the code goes to its outbox, which the page explains. */
  demo: boolean;
  title: string;
  signerName: string;
  signerEmail: string;
  status: "pending" | "signed";
  expiresAt: string;
  signedAt: string | null;
}

/** What the signer sees; null for an unknown, wrong, expired, revoked or declined request. */
export async function openSigning(id: string, token: string): Promise<SigningView | null> {
  const r = await open(id, token, true);
  if (!r) return null;
  return {
    orgName: r.org_name,
    demo: r.is_demo,
    title: r.title,
    signerName: r.signer_name,
    signerEmail: maskEmail(r.signer_email),
    status: r.status,
    expiresAt: r.expires_at,
    signedAt: r.signed_at,
  };
}

/** A 5-minute download of the file to sign, exactly the bytes that will be signed (or, once signed, the signed copy). */
export async function signingFileUrl(id: string, token: string): Promise<string | null> {
  const r = await open(id, token, false);
  if (!r) return null;
  if (r.status === "signed") return blobStore().signedUrl(r.storage_path, { filename: downloadName(r.title, r.version, r.mime), inline: false });
  if (!r.to_sign_path) return null;
  return blobStore().signedUrl(r.to_sign_path, { filename: downloadName(r.title, r.version, "application/pdf"), inline: false });
}

const codeHash = (id: string, code: string) => sha256Hex(keyedHash(code, `esign-code:${id}`));

/** Sends a 6-digit code to the signer (into the outbox while email is off). */
export async function sendSigningCode(id: string, token: string): Promise<"ok" | "too_many" | "invalid"> {
  const r = await open(id, token, false);
  if (!r || r.status !== "pending") return "invalid";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const body = [
    `Your code to sign "${r.title}" for ${r.org_name} is ${code}.`,
    "It works for 10 minutes. If you didn't ask for it, ignore this message; nothing is signed without it.",
  ].join("\n\n");
  const [row] = await asAnon((tx) =>
    tx.query<{ result: "ok" | "too_many" | "invalid" }>("select app.esign_issue_code($1, $2, $3, $4, $5) as result", [
      id,
      sha256Hex(token),
      codeHash(id, code),
      "Your ShipShape signing code",
      body,
    ]),
  );
  return row.result;
}

export type SignResult = "ok" | "bad_code" | "locked" | "expired_code" | "invalid" | "needs_consent" | "needs_name" | "unsupported" | "too_large" | "file_changed";

/** The certificate page(s) appended to the reviewed file to make the signed copy. */
function certificatePdf(rows: [string, string][]): Promise<Uint8Array> {
  return composePdf(
    [
      { type: "title", text: "Signature certificate" },
      {
        type: "para",
        muted: true,
        runs: [
          {
            text: "Added by ShipShape to the signed copy. The pages before this one are, byte for byte, the file the signer reviewed; its SHA-256 is below. ShipShape is document software, not a law firm; it records how this document was signed and doesn't vouch for what it says.",
          },
        ],
      },
      { type: "space", height: 8 },
      // Names and titles can hold characters the certificate's font can't draw (Security F4).
      { type: "rows", rows: rows.map(([k, v]) => [k, printableOnly(v)]) },
      { type: "space", height: 12 },
      { type: "heading", text: "What the signer agreed to" },
      { type: "para", runs: [{ text: ESIGN_CONSENT_TEXT }] },
    ],
    { title: "Signature certificate", footer: "ShipShape signature certificate" },
  );
}

/**
 * Signs: checks consent, the typed name and the one-time code, appends the certificate to the file
 * the signer reviewed, and stores the result as a new version in one transaction (the database
 * counts wrong codes).
 */
export async function completeSigning(
  id: string,
  token: string,
  input: { code: string; typedName: string; consented: boolean; ip: string },
): Promise<SignResult> {
  if (!input.consented) return "needs_consent";
  const typedName = input.typedName.trim();
  if (!typedName || typedName.length > 120 || !isPrintable(typedName)) return "needs_name";
  if (!/^\d{6}$/.test(input.code)) return "bad_code";
  const r = await open(id, token, false);
  if (!r || r.status !== "pending" || !r.to_sign_path || !r.to_sign_sha256) return "invalid";

  const toSign = await blobStore().get(r.to_sign_path);
  // The signature covers what the signer downloaded; a stored file that changed since is never signed (R3-4).
  if (sha256Hex(toSign) !== r.to_sign_sha256) return "file_changed";
  const visitor = visitorId(input.ip);
  const signedAt = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  let bytes: Uint8Array;
  try {
    const certificate = await certificatePdf([
      ["Document", r.title],
      ["Sent by", r.org_name],
      ["Requested", r.requested_at.slice(0, 16).replace("T", " ")],
      ["Signer named by the sender", r.signer_name],
      ["Signed as (typed name)", typedName],
      ["Email confirmed by one-time code", r.signer_email],
      ["Signed at", signedAt],
      ["Signer's network fingerprint", visitor],
      ["Reviewed file SHA-256", r.to_sign_sha256],
      ["Original upload SHA-256", r.sha256],
      ["Consent text", `${ESIGN_CONSENT_VERSION} (SHA-256 ${sha256Hex(ESIGN_CONSENT_TEXT).slice(0, 16)}…)`],
    ]);
    bytes = await appendPages(toSign, certificate);
  } catch {
    return "unsupported";
  }
  // Every stored version is at most 10 MiB; a signed copy over that is refused up front, not by the database.
  if (bytes.length > MAX_UPLOAD_BYTES) return "too_large";
  const path = `${r.org_id}/${r.document_id}/v${r.next_version}.pdf`;
  return asAnon(async (tx) => {
    const [row] = await tx.query<{ result: SignResult }>("select app.esign_complete($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result", [
      id,
      sha256Hex(token),
      codeHash(id, input.code),
      ESIGN_CONSENT_VERSION,
      sha256Hex(ESIGN_CONSENT_TEXT),
      typedName,
      visitor,
      path,
      sha256Hex(bytes),
      bytes.length,
    ]);
    // Stored last, inside the transaction: if storing fails, the signature rolls back with it.
    if (row.result === "ok") await blobStore().put(path, bytes, "application/pdf");
    return row.result;
  });
}
