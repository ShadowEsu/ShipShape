import "server-only";
import { z } from "zod";

/**
 * Security gate G3: real documents stay off until Security's GO. Server-side only, never a UI hide.
 * - Sample workspaces never take real data: no uploads, no editing business facts, no tax ids.
 * - Real workspaces work only where SHIPSHAPE_REAL_DOCS=1 (unset in production until the GO).
 */
export class GateClosed extends Error {}

export function realDocsEnabled(): boolean {
  return process.env.SHIPSHAPE_REAL_DOCS === "1";
}

/** Uploading files and editing business facts: real data only. */
export function assertRealData(ws: { demo: boolean }) {
  if (ws.demo) throw new GateClosed("This is a sample workspace, so it can't hold real documents or business details.");
  if (!realDocsEnabled()) throw new GateClosed("Real documents aren't open yet. They open after our security review.");
}

/** Filling a template: fine in a sample workspace (sample facts); real workspaces need the gate. */
export function assertCanFill(ws: { demo: boolean }) {
  if (!ws.demo && !realDocsEnabled()) throw new GateClosed("Real documents aren't open yet. They open after our security review.");
}

/**
 * Collect (asking vendors for documents) isn't sold yet: sample workspaces show it with made-up
 * files; real workspaces get it only outside production, and only with the G3 gate open.
 */
export function collectOpen(ws: { demo: boolean }): boolean {
  return ws.demo || (realDocsEnabled() && process.env.NODE_ENV !== "production");
}

type Env = Record<string, string | undefined>;

/** The address people write to: privacy requests and reporting a page (CONTACT_EMAIL). Null while unset or not an address. */
export function contactEmail(env: Env = process.env): string | null {
  const address = env.CONTACT_EMAIL?.trim() ?? "";
  return z.email().safeParse(address).success ? address : null;
}

/** The site's own origin (SHIPSHAPE_APP_URL), for absolute links in the sitemap and link previews. Null while unset or not an http(s) URL. */
export function appUrl(env: Env = process.env): URL | null {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(env.SHIPSHAPE_APP_URL?.trim() ?? "");
  return parsed.success ? new URL(new URL(parsed.data).origin) : null;
}

/**
 * Checked when the server starts (instrumentation.ts): production with real documents open must
 * have a contact address, which /privacy promises and every shared page's "Report this page" uses.
 */
export function assertLaunchConfig(env: Env) {
  if (env.NODE_ENV === "production" && env.SHIPSHAPE_REAL_DOCS === "1" && !contactEmail(env)) {
    throw new Error("Production with real documents needs CONTACT_EMAIL (not configured)");
  }
}
