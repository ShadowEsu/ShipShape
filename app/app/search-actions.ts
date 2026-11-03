"use server";

import { DOC_KINDS, searchDocuments } from "@/lib/server/documents";
import { requireWorkspace } from "@/lib/server/session";

/** A document the search box found: where it opens, its title, and its kind and issuer. */
export interface SearchHit {
  id: string;
  title: string;
  line: string;
}

/**
 * The search box's documents (⌘K): the signed-in member's own workspace only, under row level security, archived
 * documents left out (Security S1, S5, S6). Anything but text finds nothing.
 */
export async function searchAction(q: unknown): Promise<SearchHit[]> {
  const ctx = await requireWorkspace();
  if (typeof q !== "string") return [];
  const rows = await searchDocuments(ctx, q);
  return rows.map((d) => ({ id: d.id, title: d.title, line: d.issuer ? `${DOC_KINDS[d.kind]} · ${d.issuer}` : DOC_KINDS[d.kind] }));
}
