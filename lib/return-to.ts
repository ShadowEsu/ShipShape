/**
 * Where a person goes after signing in again for a sensitive action (export, delete, Show full EIN):
 * back to the section they came from, not Home (Design, wave 9 #7). A fixed list, never a URL from
 * the request: anything else lands on Home, and nothing is echoed (Security W9-12).
 */
export const RETURN_TO = {
  export: { path: "/app/settings#export", where: "Settings" },
  delete: { path: "/app/settings#delete", where: "Settings" },
  ein: { path: "/app/facts#ein", where: "Business facts" },
  history: { path: "/app/history", where: "History" },
} as const;

export type ReturnTo = keyof typeof RETURN_TO;

/** The allow-listed choice named by a form field or query value, else null. */
export function returnTo(raw: unknown): ReturnTo | null {
  return raw === "export" || raw === "delete" || raw === "ein" || raw === "history" ? raw : null;
}

/** The landing page after a sign-in: the chosen section, or Home. */
export function landing(choice: ReturnTo | null): string {
  return choice ? RETURN_TO[choice].path : "/app";
}
