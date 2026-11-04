"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { deleteDocument, DOCUMENT_GONE, setArchived, updateDocument, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { requestSignature, revokeSignatureRequest } from "@/lib/server/esign";
import { UploadRefused } from "@/lib/server/files";
import { GateClosed } from "@/lib/server/flags";
import { clientIp } from "@/lib/server/http";
import { NeedsRecentSignIn } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";
import { versionAdded } from "./messages";

export interface FormState {
  error?: string;
  /** With a plan-limit message: the one page where room can be made. */
  fix?: { href: string; label: string };
  /** The field the error is about (its input's name): the form shows the message there and moves focus to it. */
  field?: string;
  saved?: boolean;
  /** With `saved`: a line that replaces the form's usual one (a new version that withdrew open signing requests). */
  savedText?: string;
  /** What was typed, sent back with an error so the form shows it again after React resets it. */
  values?: DetailInput;
}

function problem(e: unknown): Pick<FormState, "error" | "field" | "fix"> {
  if (e instanceof UploadRefused) return { error: e.message, field: "file" };
  if (e instanceof PlanLimit) return e.fix ? { error: e.message, fix: e.fix } : { error: e.message };
  if (e instanceof GateClosed || e instanceof UserError) return { error: e.message };
  if (e instanceof z.ZodError) {
    const issue = e.issues[0];
    const field = issue?.path[0];
    return { error: issue?.message ?? "Check the form and try again.", field: typeof field === "string" ? field : undefined };
  }
  throw e;
}

const meta = (data: FormData) => ({
  title: String(data.get("title") ?? ""),
  kind: String(data.get("kind") ?? ""),
  issuer: String(data.get("issuer") ?? ""),
  counterparty: String(data.get("counterparty") ?? ""),
  issued_on: String(data.get("issued_on") ?? ""),
  expires_on: String(data.get("expires_on") ?? ""),
  renews_on: String(data.get("renews_on") ?? ""),
});
export type DetailInput = ReturnType<typeof meta>;

async function fileBytes(data: FormData): Promise<Uint8Array> {
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UploadRefused("Choose a file to upload.");
  return new Uint8Array(await file.arrayBuffer());
}

export async function addDocument(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = await uploadDocument(ctx, meta(data), await fileBytes(data));
  } catch (e) {
    return { ...problem(e), values: meta(data) };
  }
  // `added`: the document's page says it's done and what to do next.
  redirect(`/app/documents/${id}?added=1`);
}

// Document ids come from a hidden field, not `action.bind(...)`: in Next.js 16.4.3 a bound action
// used with useActionState hangs the server when the form posts before JavaScript has loaded.
function documentId(data: FormData): string {
  const id = z.uuid().safeParse(data.get("id"));
  if (!id.success) throw new UserError(DOCUMENT_GONE);
  return id.data;
}

export async function saveDetails(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = documentId(data);
    await updateDocument(ctx, id, meta(data));
  } catch (e) {
    return { ...problem(e), values: meta(data) };
  }
  revalidatePath(`/app/documents/${id}`);
  return { saved: true };
}

export async function addVersion(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  let added: Awaited<ReturnType<typeof uploadVersion>>;
  try {
    id = documentId(data);
    added = await uploadVersion(ctx, id, await fileBytes(data));
  } catch (e) {
    return problem(e);
  }
  revalidatePath(`/app/documents/${id}`);
  const savedText = versionAdded(added.version, added.withdrawn);
  return savedText ? { saved: true, savedText } : { saved: true };
}

/**
 * Back to the document's page after a plain form post. A code makes the page say what went wrong
 * (ERRORS in [id]/page.tsx); without one, a message from an earlier attempt leaves the address.
 */
function backToDocument(id: string, error?: "limit" | "closed"): never {
  redirect(error ? `/app/documents/${id}?error=${error}` : `/app/documents/${id}`, RedirectType.replace);
}

export async function archive(data: FormData) {
  const ctx = await requireWorkspace();
  const id = documentId(data);
  try {
    await setArchived(ctx, id, data.get("archived") === "1");
  } catch (e) {
    if (e instanceof PlanLimit) backToDocument(id, "limit");
    // Otherwise the document isn't in this workspace any more, which its page shows.
    if (e instanceof UserError) backToDocument(id);
    throw e;
  }
  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${id}`);
  backToDocument(id);
}

export interface DeleteDocumentState {
  error?: string;
  /** The sign-in is too old for this: the fix is signing in again. */
  reauth?: boolean;
}

/**
 * Delete for good, from an archived document's confirm dialog. A server action, so Next.js refuses a post whose Origin
 * isn't this site (Security D3's CSRF condition). Refused, the dialog stays open with the reason; done, Documents
 * says so.
 */
export async function deleteForGood(_prev: DeleteDocumentState, data: FormData): Promise<DeleteDocumentState> {
  const ctx = await requireWorkspace();
  try {
    await deleteDocument(ctx, documentId(data));
  } catch (e) {
    if (e instanceof NeedsRecentSignIn) return { error: e.message, reauth: true };
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/app/documents");
  redirect("/app/documents?deleted=1", RedirectType.replace);
}

export interface SignFormState {
  error?: string;
  /** The input the error is about: the form shows the message there and moves focus to it. */
  field?: "signer_name" | "signer_email" | "days";
  created?: { id: string; token: string };
  /** What was typed, sent back with an error so the form shows it again after React resets it. */
  values?: { signer_name: string; signer_email: string; days: string };
}

/** requestSignature's input keys (zod's issue path) as the form's input names. */
function signField(field: string | undefined): SignFormState["field"] {
  switch (field) {
    case "signerName":
      return "signer_name";
    case "signerEmail":
      return "signer_email";
    case "days":
      return "days";
    default:
      return undefined;
  }
}

export async function askToSign(_prev: SignFormState, data: FormData): Promise<SignFormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = documentId(data);
    const created = await requestSignature(
      ctx,
      { documentId: id, signerName: data.get("signer_name"), signerEmail: data.get("signer_email"), days: data.get("days") },
      clientIp(await headers()),
    );
    revalidatePath(`/app/documents/${id}`);
    return { created };
  } catch (e) {
    const typed = (name: string) => String(data.get(name) ?? "");
    const { error, field } = problem(e);
    return { error, field: signField(field), values: { signer_name: typed("signer_name"), signer_email: typed("signer_email"), days: typed("days") } };
  }
}

export async function withdrawSignature(data: FormData) {
  const ctx = await requireWorkspace();
  const id = documentId(data);
  try {
    await revokeSignatureRequest(ctx, String(data.get("request") ?? ""));
  } catch (e) {
    // The request isn't open any more: signed in the meantime, or a second click on Withdraw.
    if (e instanceof UserError) backToDocument(id, "closed");
    throw e;
  }
  revalidatePath(`/app/documents/${id}`);
  backToDocument(id);
}
