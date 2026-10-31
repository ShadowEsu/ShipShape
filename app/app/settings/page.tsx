import type { Metadata } from "next";
import { fmtDay, Notice, PageHeader } from "@/components/app-ui";
import { PLANS } from "@/lib/plans";
import { billingView } from "@/lib/server/billing";
import { requireWorkspace } from "@/lib/server/session";
import { ManageBillingForm, UpgradeForm } from "./billing-forms";
import { DeleteAccountForm, RenameWorkspaceForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const ROLE: Record<"owner" | "admin" | "member", string> = { owner: "Owner", admin: "Admin", member: "Member" };

const EXPORT_ERRORS: Record<string, string> = {
  reauth: "For your security, sign in again to export.",
  role: "Only owners and admins can export the workspace.",
  size: "This workspace is too large to export in one file. Write to us and we'll send it another way.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; billing?: string }> }) {
  const ctx = await requireWorkspace();
  const { error, billing } = await searchParams;
  const exportError = error ? EXPORT_ERRORS[error] : undefined;
  const view = await billingView(ctx);

  return (
    <div className="max-w-2xl space-y-6">
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
        {billing === "success" && view.plan !== "pro" && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Thanks. Pro switches on as soon as Stripe confirms the payment, usually within seconds. Refresh this page in a moment.
          </p>
        )}
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
          <Notice>Your last payment didn&apos;t go through. Update your card under Manage billing; Pro stays on for 7 days after a payment fails.</Notice>
        )}
        {view.plan === "free" && (
          <p className="text-sm text-ink-2">
            Free holds {PLANS.free.documents} active documents and {PLANS.free.passports} passport link at a time, with deadlines in the app and
            your calendar. Pro (${PLANS.pro.price}/month) removes the limits and adds email reminders and signature requests.
          </p>
        )}
        {!ctx.demo &&
          (!view.available ? (
            <p className="text-sm text-ink-3">Payments aren&apos;t switched on yet.</p>
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
        {exportError && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {exportError}
          </p>
        )}
        {ctx.role === "member" ? (
          <p className="text-sm text-ink-3">Ask an owner or admin to export the workspace.</p>
        ) : (
          <form method="post" action="/app/settings/export">
            <button className="btn-ghost">Download the export</button>
          </form>
        )}
      </section>

      <section className="card space-y-3 border-bad/30">
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
        <DeleteAccountForm />
      </section>
    </div>
  );
}
