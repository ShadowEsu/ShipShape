import { asUser } from "@/lib/server/db";
import { requireWorkspace } from "@/lib/server/session";

export default async function AppHome() {
  const ws = await requireWorkspace();
  const [counts] = await asUser(ws.userId, (tx) =>
    tx.query<{ documents: number }>("select count(*)::int as documents from app.documents where org_id = $1 and status = 'active'", [ws.orgId]),
  );
  return (
    <section className="space-y-2">
      <p className="eyebrow">{ws.name}</p>
      <h1 className="font-serif text-4xl font-semibold tracking-tight">What do you need to get done?</h1>
      <p className="text-ink-2">{counts.documents} documents in your vault.</p>
    </section>
  );
}
