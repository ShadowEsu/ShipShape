import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { peopleOpen, uiV2 } from "@/lib/server/flags";
import { PEOPLE_BUSY, PEOPLE_FULL } from "@/lib/server/limits";
import { KEEP_GONE, listPeople, PEOPLE_CLOSED, type Person } from "@/lib/server/people";
import { requireWorkspace } from "@/lib/server/session";
import { HairRow } from "../hair-row";
import { PersonForm } from "./forms";

export const metadata: Metadata = { title: "People" };

/** What People says after a "Keep in People" it couldn't do (actions.ts). */
const ERRORS: Record<string, string> = { keep: KEEP_GONE, full: PEOPLE_FULL, busy: PEOPLE_BUSY, closed: PEOPLE_CLOSED };

/**
 * A person's line under their name: company, email, and their signature requests when there are any ("1 signature
 * request", "3 signature requests"), its spaces non-breaking so the count never wraps away from its words (Design #24 MUST-2).
 */
function personLine(p: Person): string {
  const requests = p.requests > 0 ? `${p.requests}\u00a0signature\u00a0${p.requests === 1 ? "request" : "requests"}` : null;
  return [p.company, p.email, requests].filter(Boolean).join(" · ");
}

/** The people this workspace keeps (spec-people-2026-11-03 §5), A to Z, and the form to add one. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireWorkspace();
  const { error } = await searchParams;
  const problem = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
  const people = await listPeople(ctx);
  const v2 = uiV2();
  // A real workspace before G3 can't add anyone, so the redesigned app says so instead of a form that can only refuse
  // (the earlier look stays as it was; its form gets the same refusal from the server).
  const closed = v2 && !peopleOpen(ctx);
  return (
    <div className={v2 ? "mx-auto max-w-[720px] space-y-6" : "max-w-3xl space-y-6"}>
      <div className="space-y-2">
        <PageHeader eyebrow="People" title="People" />
        <p className="text-ink-2">People you keep in touch with for documents.</p>
      </div>
      {problem && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {problem}
        </p>
      )}
      {people.length === 0 ? (
        <EmptyState
          icon="people"
          title="Nobody here yet"
          body={
            closed
              ? "The people you keep in touch with for documents will be listed here."
              : "Add a person below with their name, and an email and company if you like. On a document's page you can also tap Keep in People beside a signer."
          }
          note={closed ? PEOPLE_CLOSED : undefined}
        />
      ) : v2 ? (
        <ul className="hair-list">
          {people.map((p) => (
            <HairRow key={p.id} href={`/app/people/${p.id}`} icon="people" title={p.name} line={personLine(p)} />
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={`/app/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-[13px] text-ink-3">{personLine(p)}</span>
                </span>
                <span className="text-ink-3">
                  <Icon name="chevron" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!closed && (
        <section aria-labelledby="add-person-title" className="space-y-3">
          <h2 id="add-person-title" className={v2 ? "section-title" : "font-semibold"}>
            Add a person
          </h2>
          <PersonForm v2={v2} />
        </section>
      )}
    </div>
  );
}
