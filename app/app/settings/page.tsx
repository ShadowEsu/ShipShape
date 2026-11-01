import type { Metadata } from "next";
import Link from "next/link";
import { fmtDay, Notice, PageHeader } from "@/components/app-ui";
import { HashLanding } from "@/components/hash-landing";
import { SubmitButton } from "@/components/submit-button";
import { PLANS } from "@/lib/plans";
import { deletionPreview, EXPORT_MAX_BYTES } from "@/lib/server/account";
import { billingView } from "@/lib/server/billing";
import { signInMethod } from "@/lib/server/cognito";
import { contactEmail } from "@/lib/server/flags";
import { liveSessions, RECENT_AUTH_SECONDS, requireWorkspace } from "@/lib/server/session";
import { signOut } from "../../signin/actions";
import { signOutEverywhere, signOutSession } from "./actions";
import { ManageBillingForm, UpgradeForm } from "./billing-forms";
import { DeleteAccountForm, RenameWorkspaceForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const ROLE: Record<"owner" | "admin" | "member", string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** How long ago a session was last used. requireWorkspace notes it at most every 10 minutes, so nothing finer than the hour. */
function lastActive(idleSeconds: number): string {
  const hours = Math.floor(idleSeconds / 3600);
  if (hours < 1) return "last active less than an hour ago";
  if (hours < 24) return `last active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `last active ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The browser's name starts the row, so "a browser on a Mac" reads "A browser on a Mac"; the Sign out label keeps it mid-sentence. */
const rowStart = (family: string) => family.charAt(0).toUpperCase() + family.slice(1);

/** What a refused export (`?error=` from export/route.ts) means, and the one link that fixes it when there is one. */
function exportProblem(error: string | undefined, contact: string | null): { text: string; fix?: { href: string; label: string } } | undefined {
  const tooLarge = `This workspace is over ${EXPORT_MAX_BYTES / 1024 / 1024} MB, too large to export in one file.`;
  switch (error) {
    case "reauth":
      return { text: "For your security, sign in again before you export.", fix: { href: "/signin", label: "Sign in again" } };
    case "role":
      return { text: "Only owners and admins can export this workspace. Ask one of them for the file." };
    case "size":
      return contact
        ? {
            text: `${tooLarge} Write to us and we'll send it another way.`,
            fix: { href: `mailto:${contact}?subject=${encodeURIComponent("Export my ShipShape workspace")}`, label: "Write to us" },
          }
        : { text: `${tooLarge} Download what you need from each document's page.`, fix: { href: "/app/documents", label: "Open your documents" } };
    default:
      return undefined;
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; billing?: string }> }) {
  const ctx = await requireWorkspace();
  const { error, billing } = await searchParams;
  const exportError = exportProblem(error, contactEmail());
  const [view, goes, method, sessions] = await Promise.all([billingView(ctx), deletionPreview(ctx.userId), ctx.demo ? "local" : signInMethod(ctx.userId), liveSessions(ctx)]);

  return (
    <div className="max-w-2xl space-y-6">
      <HashLanding />
      <PageHeader eyebrow="Settings" title="Account and workspace" />

      <section id="workspace" className="card space-y-3">
        <h2 className="font-semibold">Workspace</h2>
        {!ctx.demo && ctx.role !== "member" && <RenameWorkspaceForm name={ctx.name} />}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {(ctx.demo || ctx.role === "member") && (
            <>
              <dt className="text-ink-2">Name</dt>
              <dd>{ctx.name}</dd>
            </>
          )}
          <dt className="text-ink-2">Your role</dt>
          <dd>{ROLE[ctx.role]}</dd>
          <dt className="text-ink-2">Kind</dt>
          <dd>{ctx.demo ? "Sample workspace with made-up documents" : "Your workspace"}</dd>
        </dl>
      </section>

      <section id="plan" className="card space-y-3">
        <h2 className="font-semibold">Plan</h2>
        {billing === "success" &&
          (view.plan === "pro" ? (
            <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
              You&apos;re on Pro now. The limits are gone and email reminders are on.
            </p>
          ) : (
            <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
              Thanks. Pro switches on as soon as Stripe confirms the payment, usually within seconds.{" "}
              <Link href="/app/settings?billing=success" className="underline">
                Check again
              </Link>
            </p>
          ))}
        {billing === "cancelled" && <p className="text-sm text-ink-2">Checkout was cancelled. Nothing was charged.</p>}
        <p className="text-sm">
          <span className="font-semibold">{PLANS[view.plan].name}</span>
          {ctx.demo && <span className="text-ink-2"> · the sample includes every Pro feature</span>}
          {!ctx.demo && view.plan === "pro" && view.periodEnd && (
            <span className="text-ink-2">
              {" "}
              · {view.cancelAtPeriodEnd ? `ends ${fmtDay(view.periodEnd)}, then Free` : `renews ${fmtDay(view.periodEnd)}`}
            </span>
          )}
        </p>
        {view.status === "past_due" && (
          <Notice>
            Your last payment didn&apos;t go through. Pro stays on for 7 days after a payment fails;{" "}
            {ctx.role === "owner" ? "update your card with Manage billing below." : "ask the workspace owner to update the card."}
          </Notice>
        )}
        {view.plan === "free" && (
          <p className="text-sm text-ink-2">
            Free holds {PLANS.free.documents} active documents and {PLANS.free.passports} passport link at a time, with deadlines in the app and
            your calendar. Pro (${PLANS.pro.price}/month) removes the limits and adds email reminders and signature requests.
          </p>
        )}
        {!ctx.demo &&
          (!view.available ? (
            <p className="text-sm text-ink-3">Payments aren&apos;t switched on yet, so the plan can&apos;t change for now.</p>
          ) : ctx.role !== "owner" ? (
            <p className="text-sm text-ink-3">Only the workspace owner changes the plan.</p>
          ) : (
            <div className="space-y-3">
              {view.subscribed ? <ManageBillingForm /> : <UpgradeForm price={PLANS.pro.price} />}
              {!view.subscribed && view.customer && <ManageBillingForm />}
              <p className="text-xs text-ink-3">Test mode: no real money moves. Pay with card 4242 4242 4242 4242, any future date and any CVC.</p>
            </div>
          ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Export everything</h2>
        <p className="text-sm text-ink-2">
          One ZIP file with every version of every document, their details and fingerprints, your business facts (the tax ID only as its
          last 4 digits) and the workspace history.
        </p>
        {!ctx.demo && (
          <p className="text-sm text-ink-3">
            Showing your full EIN, exporting and deleting need a sign-in from the last {RECENT_AUTH_SECONDS / 60} minutes. If it has been
            longer, ShipShape asks you to sign in again first.
          </p>
        )}
        {exportError && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {exportError.text}
          </p>
        )}
        {exportError ? (
          exportError.fix && (
            <a href={exportError.fix.href} className="btn-ghost">
              {exportError.fix.label}
            </a>
          )
        ) : ctx.role === "member" ? (
          <p className="text-sm text-ink-3">Ask an owner or admin to export the workspace.</p>
        ) : (
          <form method="post" action="/app/settings/export">
            <button className="btn-ghost">Download the export</button>
          </form>
        )}
      </section>

      {/* The sign-in pool requires an authenticator app for everyone (infra/signin.yaml), so this is a statement, not a switch.
          A missing identity row only happens for local sign-ins (development); in production it shows nothing (Security INFO-R35b). */}
      {!ctx.demo && (method === "cognito" || process.env.NODE_ENV !== "production") && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Two-step sign-in</h2>
          {method === "cognito" ? (
            <>
              <p className="text-sm">
                <span className="font-medium text-ok">On</span> · authenticator app
              </p>
              <p className="text-sm text-ink-2">
                Every ShipShape account signs in with a password and a 6-digit code from an authenticator app. There&apos;s no way to
                turn it off. Before you change phones, move the app&apos;s codes to the new one.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              This is a local sign-in without a second step; accounts on ShipShape itself sign in with a password and an authenticator app.
            </p>
          )}
        </section>
      )}
      <section id="sessions" className="card space-y-3">
        <div>
          <h2 className="font-semibold">Where you&apos;re signed in</h2>
          <p className="text-sm text-ink-2">Each browser you&apos;re signed in on. Sign out of any you don&apos;t use or don&apos;t recognize.</p>
        </div>
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <p className="text-sm">
                {rowStart(s.family)} <span className="text-ink-2">· {s.current ? "this browser" : lastActive(s.idleSeconds)}</span>
              </p>
              <form action={signOutSession}>
                <input type="hidden" name="id" value={s.id} />
                <SubmitButton className="btn-ghost" pendingLabel="Signing out…" label={`Sign out ${s.family}${s.current ? " (this browser)" : ""}`}>
                  Sign out
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {/* The sidebar's Sign out is desktop-only; on a phone this is the way out. */}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Sign out</h2>
            <p className="text-sm text-ink-2">Ends your session in this browser.</p>
          </div>
          <form action={signOut}>
            <SubmitButton className="btn-ghost" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
        {/* A sample workspace's visitor has no password to come back with, so this would only lose the sample. */}
        {!ctx.demo && (
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="sm:min-w-0 sm:flex-1">
              <h3 className="font-semibold">Sign out on every device</h3>
              <p className="text-sm text-ink-2">
                Lost a laptop or phone, or see a sign-in you don&apos;t recognize? This ends every session, here and everywhere
                else. Then change your password.
              </p>
            </div>
            <form action={signOutEverywhere} className="shrink-0">
              <SubmitButton className="btn-ghost" pendingLabel="Signing out…">
                Sign out everywhere
              </SubmitButton>
            </form>
          </div>
        )}
      </section>

      <section id="delete" className="card space-y-3 border-bad/30">
        <h2 className="font-semibold text-bad">Delete your account</h2>
        <div className="space-y-2 text-sm text-ink-2">
          <p>This can&apos;t be undone. Right away, ShipShape deletes:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>every workspace where you&apos;re the only owner, with all its documents, files, business facts and history;</li>
            <li>its passport links and signature requests, so those links stop working;</li>
            <li>your membership of workspaces that have another owner (their documents stay with them);</li>
            <li>your sign-in and the agreements you accepted.</li>
          </ul>
          <p>
            Copies other people already downloaded stay with them. Export first if you want to keep anything. If deleting can&apos;t
            finish straight away, ShipShape finishes it by itself within two days.
          </p>
        </div>
        <Notice>There&apos;s no undo: once deleted, ShipShape can&apos;t bring a workspace back for you.</Notice>
        <DeleteAccountForm deleted={goes.deleted} left={goes.left} />
      </section>
    </div>
  );
}
