"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setArchived, updateDocument, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { requestSignature, revokeSignatureRequest } from "@/lib/server/esign";
import { GateClosed } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";

export interface FormState {
  error?: string;
  saved?: boolean;
}

function message(e: unknown): string {
  if (e instanceof GateClosed || e instanceof UserError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form and try again.";
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

async function fileBytes(data: FormData): Promise<Uint8Array> {
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a file to upload.");
  return new Uint8Array(await file.arrayBuffer());
}

export async function addDocument(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = await uploadDocument(ctx, meta(data), await fileBytes(data));
  } catch (e) {
    return { error: message(e) };
  }
  redirect(`/app/documents/${id}`);
}

// Document ids come from a hidden field, not `action.bind(...)`: in Next.js 16.4.3 a bound action
// used with useActionState hangs the server when the form posts before JavaScript has loaded.
function documentId(data: FormData): string {
  const id = z.uuid().safeParse(data.get("id"));
  if (!id.success) throw new UserError("Document not found.");
  return id.data;
}

export async function saveDetails(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = documentId(data);
    await updateDocument(ctx, id, meta(data));
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/app/documents/${id}`);
  return { saved: true };
}

export async function addVersion(_prev: FormState, data: FormData): Promise<FormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = documentId(data);
    await uploadVersion(ctx, id, await fileBytes(data));
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/app/documents/${id}`);
  return { saved: true };
}

export async function archive(data: FormData) {
  const ctx = await requireWorkspace();
  const id = documentId(data);
  await setArchived(ctx, id, data.get("archived") === "1");
  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${id}`);
}

export interface SignFormState {
  error?: string;
  created?: { id: string; token: string };
}

export async function askToSign(_prev: SignFormState, data: FormData): Promise<SignFormState> {
  const ctx = await requireWorkspace();
  const id = documentId(data);
  try {
    const created = await requestSignature(ctx, {
      documentId: id,
      signerName: data.get("signer_name"),
      signerEmail: data.get("signer_email"),
      days: data.get("days"),
    });
    revalidatePath(`/app/documents/${id}`);
    return { created };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function withdrawSignature(data: FormData) {
  const ctx = await requireWorkspace();
  await revokeSignatureRequest(ctx, String(data.get("request") ?? ""));
  revalidatePath(`/app/documents/${documentId(data)}`);
}
