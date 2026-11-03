import "server-only";

/**
 * One CSV cell, for every CSV in the workspace export. A cell that starts like a formula (=, +, -, @, a tab or a carriage
 * return) gets a ' in front first, so a spreadsheet shows it as text instead of running it (Security P1); then a cell
 * holding a quote, comma or line break is quoted, as RFC 4180. Null is an empty cell.
 */
export function csvCell(v: string | null): string {
  if (v === null) return "";
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
