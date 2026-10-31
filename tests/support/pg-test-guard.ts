import type postgres from "postgres";

/**
 * Security T-afc1. A SHIPSHAPE_PG_TEST_URL run creates databases and sets shipshape_app's password,
 * so pointed at production it would take the app down. It runs only against this machine (or the one
 * host named in SHIPSHAPE_PG_TEST_ALLOW_HOST), and never against Amazon RDS, even through a tunnel.
 */

const LOOPBACK = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)$/;

/**
 * Checks where the client will really connect: postgres.js's own reading of the URL, which a `?host=`
 * parameter, a list of hosts or PGHOST can change. Creating the client doesn't connect.
 */
export function hostProblem(sql: postgres.Sql, allowHost: string | undefined): string | null {
  const hosts: string[] = sql.options.host;
  const away = hosts.filter((h) => !LOOPBACK.test(h.toLowerCase()) && h !== allowHost);
  if (hosts.length > 0 && away.length === 0) return null;
  return `SHIPSHAPE_PG_TEST_URL connects to ${away.join(", ") || "no host"}, not this machine. These tests create databases and change shipshape_app's password: use a throwaway server (to allow a remote one, set SHIPSHAPE_PG_TEST_ALLOW_HOST to its host name).`;
}

/**
 * RDS keeps its own `rdsadmin` database on every instance, so its presence means a real RDS server.
 * Any other database this suite didn't make, or ShipShape's `app` schema in the database the URL
 * names (production could live in `postgres` itself), means the server is in use.
 */
export function serverProblem(databases: string[], adminHasApp: boolean): string | null {
  if (databases.includes("rdsadmin")) return "SHIPSHAPE_PG_TEST_URL reaches an Amazon RDS server (it has an rdsadmin database). These tests only run on a throwaway server.";
  const others = databases.filter((d) => !["postgres", "template0", "template1"].includes(d) && !d.startsWith("shipshape_test_"));
  if (others.length > 0) return `SHIPSHAPE_PG_TEST_URL reaches a server that holds other databases (${others.join(", ")}). These tests create databases and change shipshape_app's password: use an empty throwaway server.`;
  return adminHasApp ? "The database in SHIPSHAPE_PG_TEST_URL already holds ShipShape's app schema: it's in use. These tests only run on an empty throwaway server." : null;
}
