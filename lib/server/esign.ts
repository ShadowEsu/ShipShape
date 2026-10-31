import "server-only";
import { randomInt } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { ESIGN_CONSENT_TEXT, ESIGN_CONSENT_VERSION } from "@/lib/consent";
import { composePdf, isPrintable } from "@/lib/pdf/compose";
import { keyedHash, newToken, sha256Hex } from "./crypto";
import { asAnon, asUser } from "./db";
import { downloadName, UserError } from "./documents";
import type { AllowedMime } from "./files";
import { GateClosed } from "./flags";
import { visitorId } from "./passport";
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

export async function requestSignature(ctx: Ctx, input: unknown): Promise<{ id: string; token: string }> {
  if (!esignAvailable(ctx)) throw new GateClosed("Signing by email opens once ShipShape can send email.");
  const p = NewRequest.parse(input);
  const { token, hash } = newToken();
  const id = await asUser(ctx.userId, async (tx) => {
    const [latest] = await tx.query<{ version: number }>(
      "select v.version from app.document_versions v join app.documents d on d.id = v.document_id where v.document_id = $1 and d.org_id = $2 and d.status = 'active' order by v.version desc limit 1",
      [p.documentId, ctx.orgId],
    );
    if (!latest) throw new UserError("Document not found.");
    const [row] = await tx.query<{ id: string }>(
      "insert into app.signature_requests (org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by) values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8) returning id",
      [ctx.orgId, p.documentId, latest.version, p.signerName, p.signerEmail, hash, p.days, ctx.userId],
    );
    return row.id;
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
}

export async function listSignatureRequests(ctx: Ctx, documentId: string): Promise<SignatureRequestRow[]> {
  return asUser(ctx.userId, (tx) =>
    tx.query<SignatureRequestRow>(
      "select id, signer_name, signer_email, status, version, signed_version, expires_at::text as expires_at, signed_at::text as signed_at, created_at::text as created_at from app.signature_requests where org_id = $1 and document_id = $2 order by created_at desc",
      [ctx.orgId, documentId],
    ),
  );
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
}

async function open(id: string, token: string, record: boolean): Promise<OpenRow | null> {
  if (!z.uuid().safeParse(id).success || !TOKEN.test(token)) return null;
  const [row] = await asAnon((tx) =>
    tx.query<OpenRow>(
      "select org_id, org_name, is_demo, document_id, title, signer_name, signer_email, status, expires_at::text as expires_at, requested_at::text as requested_at, version, next_version, storage_path, mime, sha256, signed_at::text as signed_at from app.esign_open($1, $2, $3)",
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

/** A 5-minute download of the document to sign (or, once signed, the signed copy). */
export async function signingFileUrl(id: string, token: string): Promise<string | null> {
  const r = await open(id, token, false);
  if (!r) return null;
  return blobStore().signedUrl(r.storage_path, { filename: downloadName(r.title, r.version, r.mime), inline: false });
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

export type SignResult = "ok" | "bad_code" | "locked" | "expired_code" | "invalid" | "needs_consent" | "needs_name" | "unsupported";

/** The signed copy: the original pages (or the image on a page), then a signature certificate page. */
async function signedCopy(original: Uint8Array, mime: AllowedMime, rows: [string, string][]): Promise<Uint8Array> {
  const out = mime === "application/pdf" ? await PDFDocument.load(original, { updateMetadata: false }) : await PDFDocument.create();
  if (mime !== "application/pdf") {
    const img = mime === "image/png" ? await out.embedPng(original) : await out.embedJpg(original);
    const scale = Math.min(540 / img.width, 720 / img.height, 1);
    const page = out.addPage([612, 792]);
    page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  }
  const certificate = await PDFDocument.load(
    await composePdf(
      [
        { type: "title", text: "Signature certificate" },
        { type: "para", muted: true, runs: [{ text: "Added by ShipShape to the signed copy. ShipShape is document software, not a law firm; it records how this document was signed and doesn't vouch for what it says." }] },
        { type: "space", height: 8 },
        { type: "rows", rows },
        { type: "space", height: 12 },
        { type: "heading", text: "What the signer agreed to" },
        { type: "para", runs: [{ text: ESIGN_CONSENT_TEXT }] },
      ],
      { title: "Signature certificate", footer: "ShipShape signature certificate" },
    ),
  );
  for (const p of await out.copyPages(certificate, certificate.getPageIndices())) out.addPage(p);
  return out.save();
}

/**
 * Signs: checks consent, the typed name and the one-time code, builds the signed copy with its
 * certificate, and stores it as a new version in one transaction (the database counts wrong codes).
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
  if (!r || r.status !== "pending") return "invalid";

  const visitor = visitorId(input.ip);
  const signedAt = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  let bytes: Uint8Array;
  try {
    bytes = await signedCopy(await blobStore().get(r.storage_path), r.mime, [
      ["Document", r.title],
      ["Sent by", r.org_name],
      ["Requested", r.requested_at.slice(0, 16).replace("T", " ")],
      ["Signer named by the sender", r.signer_name],
      ["Signed as (typed name)", typedName],
      ["Email confirmed by one-time code", r.signer_email],
      ["Signed at", signedAt],
      ["Signer's network fingerprint", visitor],
      ["Original file SHA-256", r.sha256],
      ["Consent text", `${ESIGN_CONSENT_VERSION} (SHA-256 ${sha256Hex(ESIGN_CONSENT_TEXT).slice(0, 16)}…)`],
    ]);
  } catch {
    return "unsupported"; // e.g. a password-protected PDF
  }
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
