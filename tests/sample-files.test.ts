import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asService, asUser } from "@/lib/server/db";
import { seedSampleActivity, seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser } from "@/lib/server/session";
import { blobStore, setBlobStoreForTests, storeFromEnv } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * A sample-only deployment (SHIPSHAPE_SAMPLE_FILES=database, 0053) on a real server through the production driver:
 * the sample is seeded the way "Try the sample" does it (app/signin/actions.ts), so the store writes while the
 * seeding transaction holds one of the app pool's 3 connections. More samples at once than that pool has
 * connections must still finish (the store has a pool of its own). PGlite has one connection, so this runs only
 * with SHIPSHAPE_PG_TEST_URL.
 */
describe.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("sample files in Postgres, on a real server", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await freshDb();
    setBlobStoreForTests(storeFromEnv({ NODE_ENV: "production", SHIPSHAPE_SAMPLE_FILES: "database", DATABASE_URL: db.appUrl ?? undefined }));
  }, 120_000);
  afterAll(() => db.driver.close());

  async function sample(): Promise<string> {
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await seedSampleActivity(org.id, userId);
    return org.id;
  }

  // A seeding that waited on its own pool would hang until the test's timeout fails it.
  it("seeds 5 samples at once, each version's file readable, and a workspace's files go with its prefix", async () => {
    const orgs = await Promise.all(Array.from({ length: 5 }, sample));
    for (const org of orgs) {
      const versions = await db.root((tx) => tx.query<{ storage_path: string }>("select storage_path from app.document_versions where org_id = $1", [org]));
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) expect((await blobStore().get(v.storage_path)).length).toBeGreaterThan(0);
    }
    const count = async (org: string) =>
      (await db.root((tx) => tx.query<{ n: number }>("select count(*)::int as n from app.sample_files where starts_with(path, $1)", [`${org}/`])))[0].n;
    const files = await count(orgs[0]);
    expect(await blobStore().removePrefix(`${orgs[0]}/`)).toBe(files);
    expect(await count(orgs[0])).toBe(0);
    expect(await count(orgs[1])).toBeGreaterThan(0);
  }, 120_000);
});
