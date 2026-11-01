// The decisions scripts/probe-supabase.mjs makes, kept here because the probe runs the moment it is
// loaded: tests/probe-supabase-rules.test.ts calls these directly. Node strips the types on import.

/**
 * The app schema isn't served to this caller. A schema the Data API doesn't serve answers 406 PGRST106.
 * A 404 counts only when /rest/v1/ itself answered 404 (the Data API is off): with the API on, a 404 is
 * a served schema whose table or function PostgREST's cache doesn't list (PGRST205, PGRST202; W12-7).
 */
export function appSchemaNotServed(answer: { status: number; json: unknown }, restRootStatus: number): boolean {
  if (answer.status === 404) return restRootStatus === 404;
  const json = answer.json;
  return answer.status === 406 && typeof json === "object" && json !== null && "code" in json && json.code === "PGRST106";
}

/**
 * TLS for the superuser SQL connection: chain and hostname verified against DATABASE_CA_CERT (the
 * Supabase project's CA, the value the app uses), as for every network Postgres connection (W12-6).
 * Null when it isn't set, and the probe then refuses to run.
 */
export function supabaseSqlTls(ca: string | undefined) {
  return ca?.trim() ? { rejectUnauthorized: true, ca } : null;
}
