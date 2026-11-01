import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { AI_RECIPIENT } from "@/lib/ai";
import { TERMS_VERSION } from "@/lib/legal";
import { contactEmail } from "@/lib/server/flags";

export const metadata: Metadata = { title: "Privacy (draft)" };

export default function PrivacyPage() {
  const contact = contactEmail();
  return (
    <LegalPage title="Privacy policy" version={TERMS_VERSION}>
      <p>
        ShipShape holds sensitive paperwork: tax forms, licenses, insurance certificates, agreements and signatures. This page says
        what we keep, why, who else touches it, and how to get it back or delete it.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address (sample visitors have none), your role in each workspace, and which
          version of these policies you agreed to and when.
        </li>
        <li>
          <strong>The browsers you&apos;re signed in on:</strong> browser and system name, when you signed in, were last active and
          signed out, so you can sign each one out; each is deleted 30 days after it ends. No IP addresses.
        </li>
        <li>
          <strong>Business facts:</strong> the details you save to fill forms (legal name, address, entity type, signer). A tax ID
          (EIN) is encrypted with a key kept outside the database; the app shows only its last 4 digits unless you ask to see it
          after signing in recently, and that request is recorded.
        </li>
        <li>
          <strong>Documents:</strong> the files you upload or make, every version, their dates and details, and a SHA-256 fingerprint
          of each file. Files sit in private storage and open only through links that expire after 5 minutes.
        </li>
        <li>
          <strong>History:</strong> who added, changed, viewed, downloaded, shared or signed each document, and when. It never holds
          document contents or tax IDs.
        </li>
        <li>
          <strong>Passport links and signatures:</strong> who a link is for, when it was opened and what was downloaded; for a
          signature, the signer&apos;s name and email, the name they typed, when they signed and what they agreed to. Visitors and
          signers are recorded as a short keyed fingerprint of their network address, never the address itself.
        </li>
        <li id="collect">
          <strong>Collect (files your vendors send):</strong> a workspace can ask its vendors and subcontractors for documents through
          an upload link. ShipShape keeps the vendor&apos;s name and, if the workspace adds one, their email address (shown only to
          the workspace; ShipShape doesn&apos;t email vendors), the files they send, which can include tax IDs (on a W-9, for
          example), with their dates, a SHA-256 fingerprint and when each arrived. A sender&apos;s network address is used only as a
          short keyed fingerprint to limit how often a link can be used, cleared within two days, and is never stored with the file.
          Vendor files are never sent to AI. They stay until the workspace deletes them (owners and admins can delete any file) or
          the workspace is deleted.
        </li>
        <li>
          <strong>Billing (Pro):</strong> Stripe&apos;s customer and subscription IDs and your plan&apos;s status. Card details go to
          Stripe and never reach ShipShape.
        </li>
        <li>
          <strong>Waitlist:</strong> the email address you gave us, and whether you asked to hear about Collect, only to tell you when
          ShipShape opens or, if you asked, when Collect goes on sale.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        One sign-in cookie that lasts up to 12 hours; while you&apos;re signing in, a second one that lasts 10 minutes and is only sent
        to the sign-in return page; a cookie that keeps a passport, signing or upload link open for 30 minutes on that link&apos;s own
        pages; and one that holds your browser&apos;s time zone for a year so dates are judged on your own calendar day. No advertising
        or analytics cookies, and no tracking scripts.
      </p>

      <h2>Who else handles your data</h2>
      <ul>
        <li>Our hosting and database providers, which run the app and store your data for us.</li>
        <li>Stripe, for payments on the Pro plan.</li>
        <li>
          An email provider, once ShipShape sends email (reminders and signing codes). During the preview nothing is emailed: those
          messages appear inside the app instead.
        </li>
        <li>
          {AI_RECIPIENT}, only when you choose an AI action and tick the box for that action. Today there is one, &ldquo;What are they
          asking for?&rdquo;: it receives the request text you paste, with numbers shaped like an SSN or EIN removed, and never your
          documents. ShipShape keeps neither that text nor the answer; your history records only that a request was read. Anthropic
          deletes what it receives through its API within 30 days, except when its systems flag a request under its usage policy (then
          up to 2 years) or the law requires longer (
          <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data">Anthropic&apos;s
          retention policy</a>). AI actions are switched on after our security review.
        </li>
      </ul>
      <p>
        We don&apos;t sell your data, we don&apos;t share it for advertising, and we don&apos;t use your documents to train AI
        models. The providers above will be named, with where they store data, before real accounts open.
      </p>

      <h2>Security</h2>
      <p>
        Data travels encrypted (HTTPS). Every workspace is walled off from every other one in the database itself, and our test suite
        checks that wall with a second account. Our server logs blank out anything shaped like an SSN or EIN. No system is perfectly
        secure; if a breach affects you, we&apos;ll tell you as the law requires.
      </p>

      <h2>Getting your data, or deleting it</h2>
      <ul>
        <li>
          <strong>Export:</strong> Settings → Export everything gives you one file with every version of every document, their
          details and fingerprints, your business facts (the tax ID as its last 4 digits), your vendors and the files they sent, and
          the history.
        </li>
        <li>
          <strong>Delete:</strong> Settings → Delete your account removes, straight away, every workspace you own alone with its
          documents, files, links and history, your membership elsewhere, and your sign-in. A running subscription is cancelled
          first. If a step can&apos;t finish straight away, we keep a note of your account&apos;s ID and when you asked (for stored
          files, a list of the files still to remove, which names no one), and finish the deletion by ourselves within two days; the
          note goes with it. Copies other people already downloaded stay with them, and Stripe keeps payment records as the law requires.
        </li>
        <li>
          <strong>Sample workspaces:</strong> a &ldquo;Try the sample&rdquo; visit makes a workspace of made-up data and no email
          address. It is deleted by itself two days after it was made, files included.
        </li>
        <li>
          Deleted data can remain in our providers&apos; backups until those backups expire; the exact period will be stated here
          before real accounts open.
        </li>
      </ul>
      <p>
        Depending on where you live (California, for example), you may have further rights to know, correct or delete your data. The
        export and delete tools above are the quickest way;{" "}
        {contact ? (
          <>
            for privacy requests, or to report a page someone shared with you through ShipShape, write to{" "}
            <a href={`mailto:${contact}`} className="underline">
              {contact}
            </a>
            .
          </>
        ) : (
          "a contact address for privacy requests will be listed here before real accounts open."
        )}{" "}
        See also the <Link href="/terms">terms</Link>.
      </p>
    </LegalPage>
  );
}
