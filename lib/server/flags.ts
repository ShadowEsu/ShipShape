import "server-only";

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
