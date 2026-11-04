import { beforeAll, describe, expect, it } from "vitest";
import { GET as healthGet } from "@/app/api/health/route";
import { purgeSampleAccounts } from "@/lib/server/account";
import { asService, asUser } from "@/lib/server/db";
import { createLocalUser } from "@/lib/server/session";
import { freshDb, type TestDb } from "./support/db";

/**
 * The uptime check's second question (finish list B14): has the daily run kept the privacy policy's "within two
 * days"? /api/health answers it from what the run leaves behind, so a run that stopped, or one that fails on the
 * same account every day, shows as "overdue" without a run log.
 */

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});

async function dailyRun(): Promise<unknown> {
  const body: unknown = await (await healthGet()).json();
  return typeof body === "object" && body !== null && "dailyRun" in body ? body.dailyRun : undefined;
}

const age = (userId: string, interval: string) => db.root((tx) => tx.query("update auth.users set created_at = now() - $2::interval where id = $1", [userId, interval]));

describe("health: the daily run", () => {
  it("is current until a sample the purge would take is past 48 hours (Privacy's two days), and current again once it's gone", async () => {
    expect(await dailyRun()).toBe("current");
    const sample = await createLocalUser(null, true);
    await asService((tx) => tx.query("select app.create_sample_workspace($1, 'Sample')", [sample]));
    await age(sample, "47 hours 59 minutes");
    expect(await dailyRun()).toBe("current");
    await age(sample, "48 hours 1 minute");
    expect(await dailyRun()).toBe("overdue");
    expect(await purgeSampleAccounts()).toEqual({ purged: 1, failed: 0 });
    expect(await dailyRun()).toBe("current");
  });

  it("ignores an old anonymous member of a real workspace (never the purge's), and is overdue on a recorded deletion past 48 hours", async () => {
    const owner = await db.user("owner@example.com");
    const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Real Co') as id"));
    const anonMember = await createLocalUser(null, true);
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [org.id, anonMember]));
    await age(anonMember, "30 days");
    expect(await dailyRun()).toBe("current");

    await db.root((tx) => tx.query("insert into app.deletion_requests (user_id, requested_at) values ($1, now() - interval '47 hours 59 minutes')", [owner]));
    expect(await dailyRun()).toBe("current");
    await db.root((tx) => tx.query("update app.deletion_requests set requested_at = now() - interval '48 hours 1 minute' where user_id = $1", [owner]));
    expect(await dailyRun()).toBe("overdue");
  });
});
