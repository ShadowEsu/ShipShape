/**
 * The size cap on every uploaded file, and the words a file over it is refused with. Shared by the
 * server's check (lib/server/files.ts) and the forms, which refuse such a file in the browser before
 * posting it: Next's action body limit (next.config.ts) and Vercel's 4.5 MB request cap answer a
 * larger post with a bare 413 before any ShipShape code runs, so only the browser can say this.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TOO_BIG = "That file is over 4 MB. Choose a smaller file, or save it as a smaller PDF.";
