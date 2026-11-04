import type { IconName } from "@/components/icons";
import { WaitlistForm } from "@/components/waitlist";
import { SAMPLE_REQUEST_KEY, type StartPath } from "@/lib/server/start-here";
import { HairRow, StateChip } from "./hair-row";

/**
 * A sample's "Start here" (ledger 461, weakest spot 3): the request Northwind Builders sent, answered in 3 steps on the
 * sample's own documents, each ticked once it's done here (lib/server/start-here.ts). The first step not done is
 * marked Next. Done, it ends on the waitlist, since real accounts aren't open yet (spot 2a).
 */
export function StartHere({ path }: { path: StartPath }) {
  const packet = path.packet.length > 0 ? `&docs=${path.packet.join(",")}` : "";
  const steps: { href: string; icon: IconName; title: string; line: string }[] = [
    { href: `/app/ask?try=${SAMPLE_REQUEST_KEY}`, icon: "check", title: "See what Northwind asked for", line: "Check their request against your documents." },
    {
      href: `/app/passport?label=${encodeURIComponent("Northwind Builders")}${packet}`,
      icon: "passport",
      title: "Send them the packet",
      line: "The current documents they asked for, in one link.",
    },
    { href: "/app/deadlines", icon: "deadlines", title: "See what's due", line: "What expires soon, and what has already lapsed." },
  ];
  const next = path.done.indexOf(false);
  const count = path.done.filter(Boolean).length;
  return (
    <section aria-labelledby="start-title" className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="start-title" className="home-section-title">
          Start here
        </h2>
        <p className="text-[13px] text-ink-3">{count} of 3 done</p>
      </div>
      <p className="text-sm text-ink-2">Northwind Builders (sample) asked Harbor Plumbing for its paperwork. Answer them in 3 steps.</p>
      <ol className="hair-list">
        {steps.map((s, i) => (
          <HairRow
            key={s.href}
            href={s.href}
            icon={s.icon}
            title={`${i + 1}. ${s.title}`}
            line={s.line}
            chip={path.done[i] ? <StateChip tone="ok">Done</StateChip> : i === next ? <span className="dot-chip">Next</span> : undefined}
          />
        ))}
      </ol>
      {next === -1 && (
        <div className="space-y-3 pt-2">
          <p className="text-sm text-ink-2">That&apos;s ShipShape: the request in, the packet out, the dates watched. Real accounts aren&apos;t open yet.</p>
          <WaitlistForm label="Hear when real accounts open" />
        </div>
      )}
    </section>
  );
}
