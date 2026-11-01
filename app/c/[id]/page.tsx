import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { LinkBusy, LinkUnavailable } from "@/app/link-states";
import { NamedByWorkspace, Notice, fmtDay } from "@/components/app-ui";
import { DropFragment, FragmentOpener } from "@/components/fragment-opener";
import { COLLECT_COOKIE, openCollect, type PublicCollect, type ReceiveOutcome } from "@/lib/server/collect";
import { contactEmail } from "@/lib/server/flags";
import { clientIp, rateLimited } from "@/lib/server/http";
import { SendButton } from "./send-button";

export const metadata: Metadata = { title: "Send documents", robots: { index: false, follow: false } };

type Problem = Exclude<ReceiveOutcome, "sent">;

/** What went wrong and what to do; `org` is the workspace that asked for the documents. */
const PROBLEMS: Record<Problem, (org: string) => string> = {
  closed: (org) => `This link stopped working before your file arrived, so nothing was sent. Ask ${org} for a new link.`,
  gate: (org) => `${org} can't take files through ShipShape yet, so nothing was sent. Send it to them another way.`,
  kind: () => "That document isn't on the list for this link, so nothing was sent. Send one of the documents below.",
  date: () => "Enter the end date as a full date, or leave it empty.",
  empty: () => "Choose a file to send.",
  too_big: () => "That file is over 4 MB. Send a smaller copy, such as a PDF scanned at a lower resolution.",
  type: () => "That file isn't a PDF, PNG or JPEG. Save it as one of those, then send it again.",
  link_full: (org) => `This link has taken all the files it can (25), so nothing was sent. Ask ${org} for a new link.`,
  workspace_full: (org) => `${org} has no room left for files, so nothing was sent. Let them know.`,
};

/** Problems with one field of a document's form: the message goes under that field. */
const FIELD: Partial<Record<Problem, "file" | "expires">> = { empty: "file", too_big: "file", type: "file", date: "expires" };

const isProblem = (r: string): r is Problem => Object.hasOwn(PROBLEMS, r);

/** The page's answer to the last post: `r` is the outcome, `k` the document whose form sent it. */
function outcome(r: string | undefined, k: string | undefined, collect: PublicCollect): { sent: PublicCollect["items"][number] } | { message: string; onField: { kind: string | undefined; field: "file" | "expires" } | null } | null {
  if (!r) return null;
  if (r.startsWith("sent-")) {
    const item = collect.items.find((i) => `sent-${i.kind}` === r);
    return item ? { sent: item } : null;
  }
  if (!isProblem(r)) return null;
  const field = FIELD[r];
  // A sample link has no file field, so a file problem (never expected there) stays at the top.
  const onField = field && !(field === "file" && collect.sample) && collect.items.some((i) => i.kind === k) ? { kind: k, field } : null;
  return { message: PROBLEMS[r](collect.orgName), onField };
}

export default async function CollectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string; k?: string }> }) {
  const [{ id }, { r, k }] = await Promise.all([params, searchParams]);
  const token = (await cookies()).get(COLLECT_COOKIE)?.value;
  const ip = clientIp(await headers());
  const busy = token ? await rateLimited("collect-view", ip, 60, 600) : false;
  const collect = token && !busy ? await openCollect(id, token) : null;
  const result = collect && outcome(r, k, collect);
  const left = collect ? collect.items.filter((i) => !i.receivedAt).length : 0;
  const fieldError = (kind: string, field: "file" | "expires") =>
    result && "message" in result && result.onField?.kind === kind && result.onField.field === field ? result.message : null;

  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl px-5 py-12 sm:py-16">
      <p className="eyebrow mb-6">ShipShape upload link</p>
      {token && <DropFragment />}
      {collect ? (
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="font-serif text-4xl font-semibold tracking-tight">{collect.orgName} asks for your documents</h1>
            <p className="text-ink-2">
              For {collect.vendorName} · this link works until {fmtDay(collect.expiresAt)}
            </p>
            <NamedByWorkspace contact={contactEmail()} page={`/c/${id}`} />
          </header>
          <div aria-live="polite">
            {result && "sent" in result && (
              <Notice tone="ok">
                Sent. {collect.orgName} now has your {result.sent.label}.{" "}
                {left === 0
                  ? `That's everything ${collect.orgName} asked for, so you can close this page.`
                  : `${left} more ${left === 1 ? "document" : "documents"} to send below.`}
              </Notice>
            )}
            {result && "message" in result && !result.onField && <Notice tone="bad">{result.message}</Notice>}
          </div>
          {collect.sample && (
            <Notice tone="info">
              This link belongs to a sample workspace, so it takes no files. Each button sends a made-up sample document instead.
            </Notice>
          )}
          <ul className="space-y-4">
            {collect.items.map((item) => {
              const fileError = fieldError(item.kind, "file");
              const dateError = fieldError(item.kind, "expires");
              return (
                <li key={item.kind} className="card space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold">{item.label}</h2>
                    <p className="text-sm text-ink-2">
                      {item.receivedAt ? (
                        <>
                          <span aria-hidden="true">✓ </span>
                          Received {fmtDay(item.receivedAt)}
                          {item.expiresOn && `, valid through ${fmtDay(item.expiresOn)}`}
                        </>
                      ) : (
                        "Not sent yet"
                      )}
                    </p>
                  </div>
                  <form
                    method="post"
                    action={`/c/${id}/upload?k=${encodeURIComponent(item.kind)}`}
                    encType="multipart/form-data"
                    className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                  >
                    <input type="hidden" name="kind" value={item.kind} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      {!collect.sample && (
                        <div className="min-w-0">
                          <label htmlFor={`file-${item.kind}`} className="label">
                            File (PDF, PNG or JPEG, up to 4 MB)
                          </label>
                          <input
                            id={`file-${item.kind}`}
                            name="file"
                            type="file"
                            required
                            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                            className="input"
                            aria-invalid={fileError ? true : undefined}
                            aria-describedby={fileError ? `file-${item.kind}-error` : undefined}
                            autoFocus={Boolean(fileError)}
                          />
                          {fileError && (
                            <p id={`file-${item.kind}-error`} className="mt-1 text-sm text-bad">
                              {fileError}
                            </p>
                          )}
                        </div>
                      )}
                      <div>
                        <label htmlFor={`expires-${item.kind}`} className="label">
                          Valid through <span className="font-normal text-ink-3">(if it has an end date)</span>
                        </label>
                        <input
                          id={`expires-${item.kind}`}
                          name="expires_on"
                          type="date"
                          className="input"
                          aria-invalid={dateError ? true : undefined}
                          aria-describedby={dateError ? `expires-${item.kind}-error` : undefined}
                          autoFocus={Boolean(dateError)}
                        />
                        {dateError && (
                          <p id={`expires-${item.kind}-error`} className="mt-1 text-sm text-bad">
                            {dateError}
                          </p>
                        )}
                      </div>
                    </div>
                    <SendButton label={collect.sample ? "Send a sample" : item.receivedAt ? "Send a newer one" : "Send"} />
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-ink-3">
            What you send goes only to {collect.orgName}, through ShipShape, and is never sent to AI.{" "}
            <Link href="/privacy#collect" className="underline">
              How ShipShape handles it
            </Link>
            . ShipShape is document software, not a law firm; it doesn&apos;t check or vouch for what these documents say.
          </p>
        </div>
      ) : busy ? (
        <LinkBusy href={`/c/${id}`} />
      ) : token ? (
        <LinkUnavailable noun="upload link" why="closed" />
      ) : (
        <FragmentOpener openUrl={`/c/${id}/open`} unavailable={<LinkUnavailable noun="upload link" why="incomplete" />} />
      )}
    </main>
  );
}
