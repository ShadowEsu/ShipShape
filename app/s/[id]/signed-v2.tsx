import { NamedByWorkspace } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import type { SigningView } from "@/lib/server/esign";
import { dayOf, timeOf } from "@/lib/today";
import { StampMoment } from "./stamp";

/**
 * The signer's done page in the redesigned look (the default; Design's `signed-390`, spec §4 and §6.4): the
 * green stamp, "Signed", the document, the name they typed on a signature rule, when and how it was confirmed, what
 * happens next, and the one download. Every fact of today's done card stays (lib/server/esign.ts completeSigning
 * is what they describe): the sender has the same signed copy, what the certificate records, how long this link
 * works. The stamp is decoration; "Signed" says it.
 */
export function SignedV2({ id, view, zone, contact }: { id: string; view: SigningView; zone: string; contact: string | null }) {
  const day = view.signedAt ? dayOf(view.signedAt, zone) : null;
  return (
    <StampMoment>
      <div className="ui-v2 space-y-6">
        <div className="text-center">
          <svg className="stamp mx-auto block text-brand" width="168" height="168" viewBox="0 0 168 168" aria-hidden="true" focusable="false">
            <g transform="rotate(-8 84 84)" fill="none" stroke="currentColor">
              <circle cx="84" cy="84" r="76" strokeWidth="3" />
              <circle cx="84" cy="84" r="66" strokeWidth="1.5" />
              <path id="stamp-arc" d="M31.4 103.2 A56 56 0 1 1 136.6 103.2" stroke="none" />
              <text fill="currentColor" stroke="none" fontSize="13" fontWeight="700" letterSpacing="2.6">
                <textPath href="#stamp-arc" startOffset="50%" textAnchor="middle">
                  {day ? `SIGNED · ${day.toUpperCase()}` : "SIGNED"}
                </textPath>
              </text>
              <path d="M60 92l16 16 34-36" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
          {/* Takes focus right after signing (stamp.tsx), as the Sign button that had it is gone; never shows a ring (ui-v2.css). */}
          <h1 tabIndex={-1} className="stamp-title stamp-rise mt-4 font-serif text-[32px] leading-9 font-semibold tracking-tight">
            Signed
          </h1>
          <p className="stamp-rise mt-1.5 text-ink-2">{view.title}</p>
          {view.signedName && (
            <div className="mt-6">
              {/* The name as typed, as the certificate prints it: real text, so it stays sharp and can be read out. */}
              <p className="stamp-sig font-serif text-3xl font-normal italic">
                <span className="sr-only">Signed as </span>
                {view.signedName}
              </p>
              <div className="stamp-line mx-auto mt-0.5 h-px w-56 bg-ink-3" />
            </div>
          )}
          {view.signedAt && <p className="stamp-line mt-2 text-[13px] text-ink-3">Signed {timeOf(view.signedAt, zone)} · code confirmed</p>}
        </div>

        {/* The label and the card arrive with the first row; the rows keep their own stagger inside (stamp.tsx). */}
        <section aria-labelledby="next-title" className="stamp-card">
          <h2 id="next-title" className="mx-4 mb-1.5 text-[13px] tracking-[0.04em] text-ink-3 uppercase">
            What happens next
          </h2>
          <ul className="stamp-next group-list plain">
            <li className="flex gap-3 px-4 py-3">
              <Icon name="tick" className="mt-0.5 shrink-0 text-brand" />
              <div>
                <p>{view.orgName} sees it&apos;s signed.</p>
                <p className="mt-0.5 text-sm text-ink-2">They have the same signed copy, saved to their documents in ShipShape.</p>
              </div>
            </li>
            <li className="flex gap-3 px-4 py-3">
              <Icon name="page" className="mt-0.5 shrink-0 text-ink-2" />
              <div>
                <p>A certificate page is added to the signed copy.</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  It records the name you typed, when you signed, that a one-time code confirmed it, and a fingerprint of your network
                  connection (not your address).
                </p>
              </div>
            </li>
          </ul>
        </section>

        {/* The action never waits on the moment: here from the first frame. Centred under the stamp from sm up. */}
        <div className="space-y-2 sm:text-center">
          <a href={`/s/${id}/file`} className="btn btn-block gap-2">
            <Icon name="download" />
            Download the signed copy
          </a>
          <p className="text-sm text-ink-3">This link works until {dayOf(view.expiresAt, zone)}.</p>
        </div>
        <NamedByWorkspace contact={contact} page={`/s/${id}`} />
      </div>
    </StampMoment>
  );
}
