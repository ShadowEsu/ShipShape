import Link from "next/link";
import type { SentLinkDetail, SentSignatureDetail } from "@/lib/server/activity";
import { dayOf, timeOf } from "@/lib/today";
import { linkStatus } from "../passport/link-status";

/** One step of "Where it went": what happened and when; not `done` for what hasn't happened (yet). */
interface Step {
  label: string;
  at: string | null;
  detail: string | null;
  done: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function linkSteps(d: SentLinkDetail, zone: string): Step[] {
  const { row, opened } = d;
  const steps: Step[] = [{ label: "Made", at: row.createdAt, detail: row.mine ? "By you" : "By a teammate", done: true }];
  steps.push(
    opened.count > 0
      ? {
          label: "Opened",
          at: opened.first,
          detail: `${count(opened.count, "time", "times")}, ${count(opened.visitors, "visitor", "visitors")}${opened.last && opened.last !== opened.first ? ` · last ${timeOf(opened.last, zone)}` : ""}`,
          done: true,
        }
      : { label: "Not opened yet", at: null, detail: null, done: false },
  );
  if (d.viewed > 0) steps.push({ label: "Viewed", at: null, detail: count(d.viewed, "document view", "document views"), done: true });
  for (const dl of d.downloads) steps.push({ label: "Downloaded", at: dl.first, detail: `${dl.title}${dl.count > 1 ? ` · ${dl.count} times` : ""}`, done: true });
  const s = linkStatus({ revoked_at: row.revokedAt, expires_at: row.expiresAt }, zone);
  if (row.revokedAt) steps.push({ label: "Turned off", at: row.revokedAt, detail: null, done: true });
  else if (!s.working) steps.push({ label: "Ended", at: row.expiresAt, detail: null, done: true });
  else steps.push({ label: `Works until ${dayOf(row.expiresAt, zone)}`, at: null, detail: null, done: false });
  return steps;
}

function signatureSteps(d: SentSignatureDetail, zone: string): Step[] {
  const { row } = d;
  const steps: Step[] = [{ label: "Sent for signature", at: row.createdAt, detail: `To ${row.signerName}${row.mine ? ", by you" : ", by a teammate"}`, done: true }];
  // A withdrawn or declined request shows that, and nothing new (Security S4).
  if (row.status === "revoked") return [...steps, { label: "Withdrawn", at: null, detail: null, done: true }];
  if (row.status === "declined") return [...steps, { label: "Declined", at: null, detail: null, done: true }];
  if (d.fileDownloaded) steps.push({ label: "Signer downloaded the file", at: d.fileDownloaded, detail: null, done: true });
  if (row.consentedAt) steps.push({ label: "Signer agreed to sign electronically", at: row.consentedAt, detail: null, done: true });
  if (row.status === "signed" && row.signedAt) {
    steps.push({ label: "Signed", at: row.signedAt, detail: row.signedVersion ? `The signed copy is version ${row.signedVersion}` : null, done: true });
  } else if (new Date(row.expiresAt).getTime() <= Date.now()) {
    steps.push({ label: "Link ended", at: row.expiresAt, detail: "Not signed", done: true });
  } else {
    steps.push({ label: "Not signed yet", at: null, detail: `The signing link works until ${dayOf(row.expiresAt, zone)}`, done: false });
  }
  return steps;
}

/** The chosen row's detail: what it holds, its timeline, and where to act on it (the link's or the document's page). */
export function SentDetail({ detail, zone }: { detail: SentLinkDetail | SentSignatureDetail; zone: string }) {
  const isLink = detail.row.kind === "link";
  const steps = "opened" in detail ? linkSteps(detail, zone) : signatureSteps(detail, zone);
  return (
    <div className="sent-detail space-y-5">
      <div className="space-y-1">
        <p className="text-[13px] text-ink-3">{isLink ? "Passport link" : "For signature"}</p>
        <h2 className="text-lg leading-7 font-medium text-ink">{detail.row.kind === "link" ? detail.row.label : detail.row.title}</h2>
      </div>
      {"documents" in detail && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-medium text-ink-2">{count(detail.documents.length, "document", "documents")}</h3>
          {detail.documents.length > 0 && (
            <ul className="space-y-1 text-sm">
              {detail.documents.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/app/documents/${doc.id}`} className="underline">
                    {doc.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-[13px] font-medium text-ink-2">Where it went</h3>
        <ol className="timeline">
          {steps.map((s, n) => (
            <li key={n} data-done={s.done ? "" : undefined}>
              <span className="text-sm text-ink">{s.label}</span>
              {s.at && (
                <time dateTime={new Date(s.at).toISOString()} className="block text-[12.5px] text-ink-3">
                  {timeOf(s.at, zone)}
                </time>
              )}
              {s.detail && <span className="block text-[12.5px] text-ink-3">{s.detail}</span>}
            </li>
          ))}
        </ol>
      </div>
      <Link href={detail.row.kind === "link" ? `/app/passport/${detail.row.id}` : `/app/documents/${detail.row.documentId}`} className="btn-ghost press">
        {isLink ? "Open the link's page" : "Open the document"}
      </Link>
    </div>
  );
}
