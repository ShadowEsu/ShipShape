"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { UserError } from "@/lib/server/errors";
import { PEOPLE_BUSY, PEOPLE_FULL } from "@/lib/server/limits";
import { addPerson, deletePerson, editPerson, keepSigner, PEOPLE_CLOSED } from "@/lib/server/people";
import { requireWorkspace } from "@/lib/server/session";

/** The person form's fields, as its error messages name them. */
export type PersonField = "name" | "email" | "company";

export interface PersonFormState {
  /** A problem with the whole request (the cap, the hourly limit, an address already kept), shown above the button. */
  error?: string;
  /** What to change in each field, shown next to it. */
  fieldErrors?: Partial<Record<PersonField, string>>;
  /** What was typed, sent back with an error so the form shows it again. */
  values?: { name: string; email: string; company: string };
}

const FIELDS: Record<string, PersonField> = { name: "name", email: "email", company: "company" };

function typed(data: FormData) {
  return { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), company: String(data.get("company") ?? "") };
}

function refused(e: unknown, data: FormData): PersonFormState {
  const values = typed(data);
  if (e instanceof z.ZodError) {
    const fieldErrors: Partial<Record<PersonField, string>> = {};
    for (const issue of e.issues) {
      const key = String(issue.path[0]);
      fieldErrors[Object.hasOwn(FIELDS, key) ? FIELDS[key] : "name"] ??= issue.message;
    }
    return { fieldErrors, values };
  }
  if (e instanceof UserError) return { error: e.message, values };
  throw e;
}

/** "Add a person" on People: to their page once added. */
export async function addPersonAction(_prev: PersonFormState, data: FormData): Promise<PersonFormState> {
  const ctx = await requireWorkspace();
  let id: string;
  try {
    id = await addPerson(ctx, typed(data));
  } catch (e) {
    return refused(e, data);
  }
  revalidatePath("/app/people");
  redirect(`/app/people/${id}`);
}

/** Edit on a person's page: back to it, changed. */
export async function editPersonAction(_prev: PersonFormState, data: FormData): Promise<PersonFormState> {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  try {
    await editPerson(ctx, id, typed(data));
  } catch (e) {
    return refused(e, data);
  }
  revalidatePath("/app/people");
  revalidatePath(`/app/people/${id}`);
  redirect(`/app/people/${id}`, RedirectType.replace);
}

/** Delete on a person's page (after its confirm step): to People. */
export async function deletePersonAction(data: FormData) {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  try {
    await deletePerson(ctx, id);
  } catch (e) {
    // Gone already (a second click, another tab), or someone else's: the person's page says which.
    if (e instanceof UserError) redirect(z.uuid().safeParse(id).success ? `/app/people/${id}?error=change` : "/app/people", RedirectType.replace);
    throw e;
  }
  revalidatePath("/app/people");
  redirect("/app/people", RedirectType.replace);
}

/**
 * "Keep in People" beside a signer on a document's page (Security P2): the form posts the request's id and nothing else;
 * the server reads the owner-typed name and email from the request. Back to the document, where the signer now shows
 * "In People". A request that isn't this workspace's lands on People with the same words whichever it was.
 */
export async function keepSignerAction(data: FormData) {
  const ctx = await requireWorkspace();
  let page: string;
  try {
    const kept = await keepSigner(ctx, data.get("request"));
    page = `/app/documents/${kept.documentId}${kept.kept === "already" ? "?kept=already" : ""}`;
  } catch (e) {
    // Full, the hourly limit, People not open yet, or not this workspace's request: People says which (ERRORS in page.tsx).
    if (e instanceof UserError) {
      const why = e.message === PEOPLE_FULL ? "full" : e.message === PEOPLE_BUSY ? "busy" : e.message === PEOPLE_CLOSED ? "closed" : "keep";
      redirect(`/app/people?error=${why}`, RedirectType.replace);
    }
    throw e;
  }
  revalidatePath("/app/people");
  revalidatePath(page);
  redirect(page, RedirectType.replace);
}
