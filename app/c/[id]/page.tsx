import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Notice, fmtDay } from "@/components/app-ui";
import { DropFragment, FragmentOpener } from "@/components/fragment-opener";
import { COLLECT_COOKIE, openCollect, type PublicCollect, type ReceiveOutcome } from "@/lib/server/collect";
import { clientIp, rateLimited } from "@/lib/server/http";

export const metadata: Metadata = { title: "Send documents", robots: { index: false, follow: false } };

const PROBLEMS: Record<Exclude<ReceiveOutcome, "sent">, string> = {
  closed: "This link stopped working before your file arrived. Ask for a new link.",
  gate: "This workspace can't take files yet. Nothing was sent.",
  kind: "That document isn't on the list for this link.",
  date: "The end date doesn't look right. Use the date picker, or leave it empty.",
  empty: "Choose a file first.",
  too_big: "That file is over 10 MB. Send a smaller copy, such as a PDF scan at a lower resolution.",
  type: "That file isn't a PDF, PNG or JPEG. Save it as one of those and send it again.",
};

const isProblem = (r: string): r is Exclude<ReceiveOutcome, "sent"> => Object.hasOwn(PROBLEMS, r);

function Outcome({ r, collect }: { r: string | undefined; collect: PublicCollect }) {
  if (!r) return null;
  if (r.startsWith("sent-")) {
    const item = collect.items.find((i) => `sent-${i.kind}` === r);
    if (!item) return null;
    return (
      <Notice tone="ok">
        Thanks. Your {item.label} went to {collect.orgName}.
      </Notice>
    );
  }
  return isProblem(r) ? <Notice tone="bad">{PROBLEMS[r]}</Notice> : null;
}

export default async function CollectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string }> }) {
  const [{ id }, { r }] = await Promise.all([params, searchParams]);
  const token = (await cookies()).get(COLLECT_COOKIE)?.value;
  const ip = clientIp(await headers());
  const collect = token && !(await rateLimited("collect-view", ip, 60, 600)) ? await openCollect(id, token) : null;

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
          </header>
          <div aria-live="polite">
            <Outcome r={r} collect={collect} />
          </div>
          {collect.sample && (
            <Notice tone="info">
              This link belongs to a sample workspace, so it takes no files. Each button sends a made-up sample document instead.
            </Notice>
          )}
          <ul className="space-y-4">
            {collect.items.map((item) => (
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
                <form method="post" action={`/c/${id}/upload`} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <input type="hidden" name="kind" value={item.kind} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {!collect.sample && (
                      <div className="min-w-0">
                        <label htmlFor={`file-${item.kind}`} className="label">
                          File (PDF, PNG or JPEG, up to 10 MB)
                        </label>
                        <input id={`file-${item.kind}`} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="input" />
                      </div>
                    )}
                    <div>
                      <label htmlFor={`expires-${item.kind}`} className="label">
                        Valid through <span className="font-normal text-ink-3">(if it has an end date)</span>
                      </label>
                      <input id={`expires-${item.kind}`} name="expires_on" type="date" className="input" />
                    </div>
                  </div>
                  <button className="btn">{collect.sample ? "Send a sample" : item.receivedAt ? "Send a newer one" : "Send"}</button>
                </form>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-3">
            What you send goes only to {collect.orgName}, through ShipShape. ShipShape is document software, not a law firm; it doesn&apos;t
            check or vouch for what these documents say.
          </p>
        </div>
      ) : token ? (
        <Unavailable />
      ) : (
        <FragmentOpener openUrl={`/c/${id}/open`} unavailable={<Unavailable />} />
      )}
    </main>
  );
}

function Unavailable() {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-3xl font-semibold">This link isn&apos;t available</h1>
      <p className="text-ink-2">
        It may have expired or been turned off, or the address was copied without its last part. Ask the person who sent it for a
        new link.
      </p>
    </div>
  );
}
