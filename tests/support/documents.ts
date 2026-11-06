import { expect } from "vitest";
import { pageDocuments } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";

/**
 * A workspace's documents as the Documents page lists them (soonest expiry first; `q`, `kind` and `archived` as there).
 * The page holds DOCUMENTS_PAGE_SIZE; a test workspace fits on one, and this says so rather than cut the list short.
 */
export async function listDocuments(ctx: Ctx, opts: { q?: string; kind?: string; archived?: boolean } = {}) {
  const page = await pageDocuments(ctx, opts);
  expect(page.pages).toBe(1);
  return page.rows;
}
