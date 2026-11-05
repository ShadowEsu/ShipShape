import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { HashLanding } from "@/components/hash-landing";
import { SubmitButton } from "@/components/submit-button";
import { WaitlistForm } from "@/components/waitlist";
import { PLANS } from "@/lib/plans";
import type { BillingView } from "@/lib/server/billing";
import type { LiveSession, SignedIn } from "@/lib/server/session";
import { RECENT_AUTH_SECONDS } from "@/lib/server/session";
import { START_PATH } from "@/lib/server/slack";
import type { SlackOutcome, SlackRow } from "@/lib/server/slack";
import { dayOf } from "@/lib/today";
import { signOut } from "../../signin/actions";
import { StateChip } from "../hair-row";
import { CelebrationSwitch } from "../motion-moments";
import { disconnectSlackChannel, sendSlackTestMessage, signOutEverywhere, signOutSession } from "./actions";
import { ManageBillingForm, UpgradeForm } from "./billing-forms";
import { ExportButton } from "./export-button";
import { DeleteAccountForm, RenameWorkspaceForm } from "./forms";
import { lastActive, ROLE, rowStart } from "./shared";

/**
 * Settings in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): the 720 column; Workspace and Plan as
 * label/value grouped lists, Where you're signed in and Sign out as rows with a neutral ghost Sign out at the right,
 * Delete its own red-titled section (red only there, Design 02 Nov). Export follows the ZIP being made. Same words,
 * forms and actions as the current page.
 */
export function SettingsV2({
  ctx,
  zone,
  billing,
  contact,
  exportError,
  view,
  goes,
  method,
  sessions,
  canRename,
  slack,
  slackOutcome,
}: {
  ctx: SignedIn;
  zone: string;
  billing: string | undefined;
  contact: string | null;
  exportError: { text: string; fix?: { href: string; label: string } } | undefined;
  view: BillingView;
  goes: { deleted: string[]; left: string[] };
  method: string;
  sessions: LiveSession[];
  canRename: boolean;
  /** Null: Slack isn't offered here (not configured, or a sample), so nothing about it shows. */
  slack: SlackRow | null;
  slackOutcome: SlackOutcome | undefined;
}) {
  return (
    <div className="mx-auto max-w-[720px] space-y-10">
      <HashLanding />
      <PageHeader eyebrow="Settings" title="Account and workspace" />

      <section id="workspace" aria-labelledby="workspace-title" className="space-y-3">
        <h2 id="workspace-title" className="section-title">
          Workspace
        </h2>
        {canRename ? <RenameWorkspaceForm name={ctx.name} v2 /> : null}
        <dl className="group-list plain">
          {!canRename && (
            <div className="group-row justify-between gap-4">
              <dt className="text-ink-2">Name</dt>
              <dd className="min-w-0 text-right">{ctx.name}</dd>
            </div>
          )}
          <div className="group-row justify-between gap-4">
            <dt className="text-ink-2">Your role</dt>
            <dd className="text-right">{ROLE[ctx.role]}</dd>
          </div>
          <div className="group-row justify-between gap-4">
            <dt className="text-ink-2">Kind</dt>
            <dd className="min-w-0 text-right">{ctx.demo ? "Sample workspace with made-up documents" : "Your workspace"}</dd>
          </div>
        </dl>
      </section>

      <section id="plan" aria-labelledby="plan-title" className="space-y-3">
        <h2 id="plan-title" className="section-title">
          Plan
        </h2>
        {billing === "success" &&
          (view.plan === "pro" ? (
            <p role="status" className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
              You&apos;re on Pro now. The limits are gone and reminders are on; they land under Deadlines.
            </p>
          ) : (
            <p role="status" className="rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
              Thanks. Pro switches on as soon as Stripe confirms the payment, usually within seconds.{" "}
              <Link href="/app/settings?billing=success" className="underline">
                Check again
              </Link>
            </p>
          ))}
        {billing === "cancelled" && <p className="text-sm text-ink-2">Checkout was cancelled. Nothing was charged.</p>}
        <ul className="group-list plain">
          <li className="group-row flex-wrap justify-between gap-x-4 gap-y-1">
            <span className="font-semibold">{PLANS[view.plan].name}</span>
            {ctx.demo && <span className="text-sm text-ink-2">the sample includes every Pro feature</span>}
            {!ctx.demo && view.plan === "pro" && view.periodEnd && (
              <span className="text-sm text-ink-2">{view.cancelAtPeriodEnd ? `ends ${dayOf(view.periodEnd, zone)}, then Free` : `renews ${dayOf(view.periodEnd, zone)}`}</span>
            )}
          </li>
        </ul>
        {/* Start here ends on the waitlist once, then leaves Home; this is where it stays in a sample (ledger 461, spot 2a). */}
        {ctx.demo && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Real accounts aren&apos;t open yet.</p>
            <WaitlistForm label="Hear when real accounts open" inSample />
          </div>
        )}
        {view.status === "past_due" && (
          <Notice>
            Your last payment didn&apos;t go through. Pro stays on for 7 days after a failed payment.{" "}
            {!view.available
              ? `Card updates are paused on our side right now; if Pro ends before they're back, write to ${contact ?? "us"}.`
              : ctx.role === "owner"
                ? "Update your card with Manage billing below."
                : "Ask the workspace owner to update the card."}
          </Notice>
        )}
        {view.plan === "free" && (
          <p className="text-sm text-ink-2">
            Free holds {PLANS.free.documents} active documents and {PLANS.free.passports} passport link at a time, with deadlines in the app and
            your calendar. Pro (${PLANS.pro.price}/month) removes the limits and adds deadline reminders on your Deadlines page.
          </p>
        )}
        {!ctx.demo &&
          (!view.available ? (
            <p className="text-sm text-ink-3">Payments are switched off right now, so the plan can&apos;t change.</p>
          ) : ctx.role !== "owner" ? (
            <p className="text-sm text-ink-3">Only the workspace owner changes the plan.</p>
          ) : (
            <div className="space-y-3">
              {view.subscribed ? (
                <ManageBillingForm />
              ) : view.paused ? (
                <p className="text-sm text-ink-3">New Pro subscriptions are paused for now.</p>
              ) : (
                <UpgradeForm price={PLANS.pro.price} tax={view.salesTax} />
              )}
              {!view.subscribed && view.customer && <ManageBillingForm />}
              {!view.live && <p className="text-xs text-ink-3">Test mode: no real money moves. Pay with card 4242 4242 4242 4242, any future date and any CVC.</p>}
            </div>
          ))}
      </section>

      <section id="export" aria-labelledby="export-title" className="space-y-3">
        <h2 id="export-title" tabIndex={-1} className="section-title">
          Export everything
        </h2>
        <div className="rounded-2xl border border-line px-4 py-4 text-sm text-ink-2">
          <p>One ZIP file with:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>every version of every document, with its details and fingerprint</li>
            <li>your business facts (the tax ID only as its last 4 digits; a W-9 you made holds the full number)</li>
            <li>your vendors and the files they sent</li>
            <li>your passport links, with when they were opened and what was downloaded</li>
            <li>your signature requests</li>
            <li>the browsers you&apos;ve signed in on and the agreements you&apos;ve accepted</li>
            <li>the workspace history</li>
          </ul>
        </div>
        {!ctx.demo && (
          <p className="text-sm text-ink-3">
            Showing your full EIN in Business facts, exporting and deleting need a sign-in from the last {RECENT_AUTH_SECONDS / 60} minutes;
            otherwise ShipShape asks you to sign in again first. A W-9 you made carries the full number, as the IRS form requires, so anyone
            in this workspace who opens it can read it.
          </p>
        )}
        {exportError && (
          <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
            {exportError.text}
          </p>
        )}
        {exportError ? (
          exportError.fix && (
            <a href={exportError.fix.href} className="btn-ghost press">
              {exportError.fix.label}
            </a>
          )
        ) : ctx.role === "member" ? (
          <p className="text-sm text-ink-3">Ask an owner or admin to export the workspace.</p>
        ) : (
          <ExportButton />
        )}
      </section>

      {slack && <SlackSection slack={slack} outcome={slackOutcome} />}

      {/* The celebration toggle (motion spec §2): on by default, kept in this browser, so nothing is stored about it. */}
      <section aria-labelledby="motion-title" className="space-y-3">
        <h2 id="motion-title" className="section-title">
          Animations
        </h2>
        <ul className="group-list plain">
          <li>
            <CelebrationSwitch />
          </li>
        </ul>
      </section>

      {/* The sign-in pool requires an authenticator app for everyone (infra/signin.yaml), so this is a statement, not a switch.
          A missing identity row only happens for local sign-ins (development); in production it shows nothing (Security INFO-R35b). */}
      {!ctx.demo && (method === "cognito" || process.env.NODE_ENV !== "production") && (
        <section aria-labelledby="two-step-title" className="space-y-3">
          <h2 id="two-step-title" className="section-title">
            Two-step sign-in
          </h2>
          {method === "cognito" ? (
            <>
              <ul className="group-list plain">
                <li className="group-row justify-between gap-4">
                  <span>Authenticator app</span>
                  <span className="font-medium text-ok">On</span>
                </li>
              </ul>
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

      <section id="sessions" aria-labelledby="sessions-title" className="space-y-3">
        <div>
          <h2 id="sessions-title" className="section-title">
            Where you&apos;re signed in
          </h2>
          <p className="text-sm text-ink-2">Each browser you&apos;re signed in on. Sign out of any you don&apos;t use or don&apos;t recognize.</p>
        </div>
        <ul className="group-list plain">
          {/* This browser's row has no button: the Sign out section below does the same (Design 02 Nov). */}
          {sessions.map((s) => (
            <li key={s.id} className="group-row justify-between gap-3">
              <p className="min-w-0 text-[15px]">
                {rowStart(s.family)} <span className="text-ink-2">· {s.current ? "this browser" : lastActive(s.idleSeconds)}</span>
              </p>
              {!s.current && (
                <form action={signOutSession} className="shrink-0">
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="btn-ghost press" pendingLabel="Signing out…" label={`Sign out ${s.family}`}>
                    Sign out
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* The sidebar's Sign out is desktop-only; on a phone this is the way out. */}
      <section aria-labelledby="sign-out-title" className="space-y-3">
        <h2 id="sign-out-title" className="section-title">
          Sign out
        </h2>
        <ul className="group-list plain">
          <li className="group-row justify-between gap-3">
            <p className="min-w-0 text-[15px]">Ends your session in this browser.</p>
            <form action={signOut} className="shrink-0">
              <SubmitButton className="btn-ghost press" pendingLabel="Signing out…">
                Sign out
              </SubmitButton>
            </form>
          </li>
          {/* A sample workspace's visitor has no password to come back with, so this would only lose the sample. */}
          {!ctx.demo && (
            <li className="group-row flex-wrap justify-between gap-3 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <h3 className="font-medium">Sign out on every device</h3>
                <p className="text-sm text-ink-2">
                  Lost a laptop or phone, or see a sign-in you don&apos;t recognize? This ends every session, here and everywhere else.
                </p>
              </div>
              <form action={signOutEverywhere} className="shrink-0">
                <SubmitButton className="btn-ghost press" pendingLabel="Signing out…">
                  Sign out everywhere
                </SubmitButton>
              </form>
            </li>
          )}
        </ul>
      </section>

      <section id="delete" aria-labelledby="delete-title" className="space-y-3">
        <h2 id="delete-title" tabIndex={-1} className="section-title text-bad">
          Delete your account
        </h2>
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

/** What the Slack row says after connecting, testing or disconnecting; ok: shown as done, otherwise as a problem. */
const SLACK_SAYS: Record<SlackOutcome, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Slack is connected. Deadline reminders will post in the channel you picked." },
  cancelled: { ok: false, text: "Slack wasn't connected: it was cancelled in Slack." },
  failed: { ok: false, text: "Slack couldn't be connected. Try again." },
  refused: { ok: false, text: "Only owners and admins of this workspace can change Slack." },
  busy: { ok: false, text: "Too many tries. Wait up to an hour, then try again." },
  tested: { ok: true, text: "Test message sent. Check the channel in Slack." },
  test_failed: { ok: false, text: "The test message didn't go through. Try again in a minute." },
  broken: { ok: false, text: "Slack says that channel is gone. Reconnect to pick a channel." },
  disconnected: { ok: true, text: "Slack is disconnected. ShipShape no longer posts there." },
  disconnect_failed: { ok: false, text: "Slack couldn't be reached to disconnect. Try again in a minute." },
};

/**
 * Slack (lib/server/slack.ts): one 52px row. Owners and admins connect (a link to the start route, which goes to
 * Slack's consent screen), send a test message, disconnect, or reconnect a channel Slack says is gone; members see the
 * row as it is. A state is a dot and a word (Quiet §1).
 */
function SlackSection({ slack, outcome }: { slack: SlackRow; outcome: SlackOutcome | undefined }) {
  const c = slack.connection;
  const says = outcome && SLACK_SAYS[outcome];
  return (
    <section id="slack" aria-labelledby="slack-title" className="space-y-3">
      <h2 id="slack-title" tabIndex={-1} className="section-title">
        Integrations
      </h2>
      {says && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${says.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          {says.text}
        </p>
      )}
      <ul className="group-list plain">
        <li className="group-row flex-wrap justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <h3 className="font-medium">Slack</h3>
            <p className="text-sm text-ink-2">{c ? `${c.channel} in ${c.team}` : "Post deadline reminders to a Slack channel"}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {!c ? (
              <span className="dot-chip">Not connected</span>
            ) : c.broken ? (
              <StateChip tone="expired">Needs reconnecting</StateChip>
            ) : (
              <StateChip tone="ok">Connected</StateChip>
            )}
            {slack.canManage && (!c || c.broken) && (
              // A plain link, not next/link: it must not be prefetched, and it leaves for Slack.
              <a href={START_PATH} className="btn press">
                {c ? "Reconnect" : "Connect"}
              </a>
            )}
            {slack.canManage && c && !c.broken && (
              <form action={sendSlackTestMessage}>
                <SubmitButton className="btn-ghost press" pendingLabel="Sending…">
                  Send a test message
                </SubmitButton>
              </form>
            )}
            {slack.canManage && c && (
              <form action={disconnectSlackChannel}>
                <SubmitButton className="btn-ghost press" pendingLabel="Disconnecting…">
                  Disconnect
                </SubmitButton>
              </form>
            )}
          </div>
        </li>
      </ul>
      {!slack.canManage && <p className="text-sm text-ink-3">Only owners and admins connect or disconnect Slack.</p>}
    </section>
  );
}
