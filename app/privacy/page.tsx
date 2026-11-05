import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { AI_RECIPIENT } from "@/lib/ai";
import { BACKUP_DAYS, TERMS_VERSION } from "@/lib/legal";
import { contactEmail } from "@/lib/server/flags";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What ShipShape keeps about you and your paperwork, why, who else handles it, and how to export or delete it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const contact = contactEmail();
  return (
    <LegalPage title="Privacy policy" version={TERMS_VERSION}>
      <p>
        ShipShape holds sensitive paperwork: tax forms, licenses, insurance certificates, agreements and signatures. This page says
        what we keep, why, who else touches it, and how to get it back or delete it. ShipShape is operated by Unvibe.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address (sample visitors have none), your role in each workspace, and which
          version of these policies you agreed to and when.
        </li>
        <li>
          <strong>The browsers you&apos;re signed in on:</strong> browser and system name, when you signed in, were last active and
          signed out, so you can sign each one out; each is deleted 30 to 31 days after it ends. No IP addresses.
        </li>
        <li>
          <strong>Business facts:</strong> the details you save to fill forms (legal name, address, entity type, signer). A tax ID
          (EIN) is encrypted with a key kept outside the database; the app shows only its last 4 digits unless you ask to see it
          after signing in recently, and that request is recorded. A W-9 you fill holds the full number, as the paper form does.
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
        <li id="people">
          <strong>People:</strong> a workspace can keep a list of people it works with: a name, and an email and company if a member
          adds them. Every member of the workspace sees the list, and it&apos;s included in the workspace export. An entry is deleted when a
          member deletes it, or with the workspace.
        </li>
        <li>
          <strong>Billing (Pro):</strong> Stripe&apos;s customer and subscription IDs and your plan&apos;s status. Card details go to
          Stripe and never reach ShipShape.
        </li>
        <li>
          <strong>The reminders and signing codes</strong> ShipShape would have emailed: reminders for 90 to 91 days and signing codes
          for 1 to 2 days (a daily cleanup deletes them).
        </li>
        <li>
          <strong>Waitlist:</strong> the email address you gave us, and whether you asked to hear about Collect, only to tell you when
          ShipShape opens or, if you asked, when Collect goes on sale. Deleting your account also removes the waitlist entry for your
          account&apos;s email address. To come off the list any other time, write to us at the address below. We don&apos;t check that an
          address belongs to whoever typed it. ShipShape doesn&apos;t email the list yet; if an address on it isn&apos;t yours, write to
          us and we&apos;ll delete it.
        </li>
        <li>
          <strong>Service records:</strong> each AI read you agreed to and what it cost; your sign-in provider&apos;s account ID; and
          short keyed fingerprints of network addresses, used to limit repeated attempts and deleted within two days.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        One sign-in cookie that lasts up to 12 hours; while you&apos;re signing in, a second one that lasts 10 minutes and is only sent
        to the sign-in return page; a cookie that keeps a passport, signing or upload link open for 30 minutes on that link&apos;s own
        pages; and one that holds your browser&apos;s time zone for a year so dates are judged on your own calendar day. In a sample
        workspace, two more for up to 12 hours: which of Start here&apos;s 3 steps you&apos;ve done, and that you&apos;ve seen them
        finished. Your browser&apos;s own storage keeps whether celebrations are on (Settings) and the day each last played; it isn&apos;t
        sent to us. No advertising or analytics cookies, and no tracking scripts.
      </p>

      <h2>Who else handles your data</h2>
      <ul>
        <li>Our hosting and database providers, which run the app and store your data for us.</li>
        <li>Stripe, for payments on the Pro plan.</li>
        <li>
          Amazon Web Services&apos; sign-in service (Amazon Cognito), which sends the codes for creating an account and resetting a
          password from Amazon&apos;s own address, no-reply@verificationemail.com. ShipShape itself doesn&apos;t send email yet:
          reminders appear inside the app instead, and signing codes only in the sample workspace. Once it does, an email provider
          will send them, and this page will name it.
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
        models. Our providers are Vercel (hosting), Amazon Web Services (database, file storage and sign-in, in the United States,
        region us-east-1), Stripe (payments) and Anthropic (the AI action above).
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
          details and fingerprints, your business facts (the tax ID as its last 4 digits; a filled W-9 among the documents holds it in
          full), your vendors and the files they sent, and the history.
        </li>
        <li>
          <strong>Delete:</strong> Settings → Delete your account removes, straight away, every workspace you own alone with its
          documents, files, links and history, your membership elsewhere, and your sign-in. A running subscription is cancelled
          first. If a step can&apos;t finish straight away, we keep a note of your account&apos;s ID and when you asked (for stored
          files, a list of the files still to remove, which names no one), and finish the deletion by ourselves within two days; the
          note goes with it. Copies other people already downloaded stay with them, and Stripe keeps payment records as the law requires.
        </li>
        <li>
          <strong>Delete one document:</strong> an owner or admin can delete an archived document for good, with its versions, files and
          signature requests, unless someone has signed it. It&apos;s gone from ShipShape straight away; History keeps its lines about
          the document, without its title.
        </li>
        <li>
          <strong>Sample workspaces:</strong> a &ldquo;Try the sample&rdquo; visit makes a workspace of made-up data and no email
          address. It is deleted by itself within two days of being made, files included.
        </li>
        <li>Deleted data can remain in database backups and earlier file versions for up to {BACKUP_DAYS} days, then it&apos;s gone.</li>
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
