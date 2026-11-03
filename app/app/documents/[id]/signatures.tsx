import { ViewTransition } from "react";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import type { SignatureRequestRow } from "@/lib/server/esign";
import { dayOf, timeOf } from "@/lib/today";
import { StateChip } from "../../hair-row";
import { keepSignerAction } from "../../people/actions";
import { withdrawSignature } from "../actions";
import { REQUEST_STATUS } from "./shared";

/**
 * A document's signing requests: who, its state, the file sent, and Withdraw while it can still be signed. Both looks
 * use it; redesigned (`v2`), the state is the app's dot chip (green once signed, grey otherwise, as on Sent), the name
 * and address wrap instead of being cut (Design #27 INFO), and a state that changes in place (Waiting → Withdrawn, or
 * Signed on a refresh) crossfades as the chips do (Design spec 2026-11-02 §6.4 owner side, §6.3). With `kept` (the
 * redesigned page), each signer has "Keep in People", which posts the request's id only (Security P2), or "In People"
 * once their address is there.
 */
export function SignatureRequests({
  docId,
  requests,
  zone,
  now,
  v2 = false,
  kept,
}: {
  docId: string;
  requests: SignatureRequestRow[];
  zone: string;
  now: number;
  v2?: boolean;
  kept?: ReadonlySet<string>;
}) {
  return (
    <ul className="divide-y divide-line text-sm">
      {requests.map((r) => {
        const lapsed = r.status === "pending" && Date.parse(r.expires_at) <= now;
        return (
          <li key={r.id} className="space-y-1 py-2">
            <p className={v2 ? "flex items-start justify-between gap-2" : "flex justify-between gap-2"}>
              <span className={v2 ? "min-w-0 font-medium [overflow-wrap:anywhere]" : "min-w-0 truncate font-medium"}>{r.signer_name}</span>
              {v2 ? (
                <ViewTransition update="v2-chip" default="none">
                  <StateChip tone={r.status === "signed" ? "ok" : "none"}>{lapsed ? "Expired" : REQUEST_STATUS[r.status]}</StateChip>
                </ViewTransition>
              ) : (
                <span className="shrink-0 text-xs text-ink-2">{lapsed ? "Expired" : REQUEST_STATUS[r.status]}</span>
              )}
            </p>
            <p className={v2 ? "text-xs text-ink-3 [overflow-wrap:anywhere]" : "truncate text-xs text-ink-3"}>
              {r.signer_email} · version {r.version}
              {r.status === "signed" && r.signed_at && <> · signed {timeOf(r.signed_at, zone)}</>}
              {r.status === "pending" && !lapsed && <> · open until {dayOf(r.expires_at, zone)}</>}
            </p>
            {(kept || r.has_review_file || (r.status === "pending" && !lapsed)) && (
              <div className="flex flex-wrap gap-x-4">
                {r.has_review_file && (
                  <a href={`/app/documents/${docId}/file?request=${r.id}`} data-stays className="inline-flex min-h-6 items-center text-xs text-ink-2 underline">
                    File sent for signing
                  </a>
                )}
                {r.status === "pending" && !lapsed && (
                  <ConfirmForm
                    compact
                    action={withdrawSignature}
                    fields={{ id: docId, request: r.id }}
                    trigger="Withdraw"
                    question={`Withdraw this request? ${r.signer_name} won't be able to sign. You can make a new link any time.`}
                    confirm="Withdraw the request"
                    pendingLabel="Withdrawing…"
                  />
                )}
                {kept &&
                  (kept.has(r.signer_email.toLowerCase()) ? (
                    <span className="inline-flex min-h-6 items-center text-xs text-ink-3">In People</span>
                  ) : (
                    <form action={keepSignerAction}>
                      <input type="hidden" name="request" value={r.id} />
                      <SubmitButton className="inline-flex min-h-6 items-center text-xs text-ink-2 underline" pendingLabel="Keeping…">
                        Keep in People
                      </SubmitButton>
                    </form>
                  ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
