import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { PLANS } from "@/lib/plans";
import { TERMS_VERSION } from "@/lib/server/session";

export const metadata: Metadata = { title: "Terms (draft)" };

export default function TermsPage() {
  const { free, pro } = PLANS;
  return (
    <LegalPage title="Terms of service" version={TERMS_VERSION}>
      <p>
        These terms cover your use of ShipShape, an app for storing, filling, sharing and signing business paperwork. By creating a
        workspace you agree to them. The business that operates ShipShape will be named here before ShipShape accepts real payments.
      </p>

      <h2>ShipShape is software, not a law firm</h2>
      <ul>
        <li>ShipShape doesn&apos;t give legal, tax or financial advice, and using it creates no attorney-client relationship.</li>
        <li>It doesn&apos;t tell you which document to use or what terms to choose. You pick the document and you decide what it says.</li>
        <li>
          It doesn&apos;t promise that a document fits your situation, is enforceable, or keeps you compliant with any law. For that,
          talk to a lawyer or tax professional.
        </li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Check every field before you create, share or sign a document. You&apos;re responsible for what you enter.</li>
        <li>Only upload documents and details you have the right to store and share.</li>
        <li>Keep your sign-in safe, and don&apos;t use ShipShape to break the law, mislead anyone, or get into other people&apos;s data.</li>
      </ul>

      <h2>Templates and forms</h2>
      <p>
        ShipShape fills official or openly licensed documents and says where each one comes from: the IRS Form W-9 (a U.S. government
        form) and the Common Paper Mutual NDA, version 1.0 (CC BY 4.0, used with attribution). The text of those documents is theirs,
        not ours, and ShipShape fills in facts only; it never writes or changes the clauses.
      </p>

      <h2>Sharing and signatures</h2>
      <ul>
        <li>
          Anyone who has a passport link can see and download the documents on it until the link expires (at most 90 days) or you
          turn it off. Copies people downloaded stay with them.
        </li>
        <li>
          When you ask someone to sign, they agree to sign electronically, confirm their email with a one-time code and type their
          name. ShipShape adds a certificate page recording how the document was signed. It confirms an email address, not a
          person&apos;s identity.
        </li>
      </ul>

      <h2>Plans and payments</h2>
      <p>During the preview, payments run in Stripe&apos;s test mode: no real money moves.</p>
      <ul>
        <li>
          <strong>{free.name}</strong> costs nothing and includes {free.documents} active documents and {free.passports} passport link
          open at a time.
        </li>
        <li>
          <strong>{pro.name}</strong> costs ${pro.price} a month, billed monthly by Stripe until you cancel. It removes those limits and
          adds email reminders and signature requests.
        </li>
        <li>You can cancel any time from Settings. Pro stays on until the end of the period you paid for, then the workspace moves to Free.</li>
        <li>If a payment fails, Pro stays on for 7 days after the paid period while the payment is retried, then moves to Free.</li>
        <li>If you get a full refund, or dispute a charge, Pro ends straight away.</li>
        <li>Moving to Free never deletes anything; you just can&apos;t add more than Free allows until you&apos;re under its limits.</li>
        <li>Prices don&apos;t include taxes that may apply where you live.</li>
      </ul>

      <h2>Your documents stay yours</h2>
      <p>
        You own what you put in ShipShape. You let us store, process and show it only to run the service for you. We don&apos;t sell
        it and we don&apos;t use your documents to train AI models. How we handle your data is in the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Export and deletion</h2>
      <p>
        You can download everything in your workspace, and delete your account, from Settings at any time. Deleting your account
        cancels a running subscription and removes workspaces you own alone, with their documents, links and history.
      </p>

      <h2>The service</h2>
      <ul>
        <li>ShipShape is in preview and may change, pause or have mistakes. Keep your own copies of important documents.</li>
        <li>We may suspend an account that breaks these terms or puts other people at risk, and we&apos;ll tell you why where we can.</li>
        <li>
          To the extent the law allows, ShipShape is provided as is, and our liability is limited to what you paid us in the 12 months
          before a claim. Some places don&apos;t allow these limits, so they may not apply to you.
        </li>
        <li>Which law governs these terms, and how disputes are resolved, will be set with our lawyer before real accounts open.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        When these terms change, the version number above changes. This is a draft: the final terms will say how you&apos;re told about
        changes.
      </p>
    </LegalPage>
  );
}
