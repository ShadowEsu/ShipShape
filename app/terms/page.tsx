import { LegalPage } from "@/components/legal";

export const metadata = { title: "Terms of Service · ShipShape" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <h2>What ShipShape is, and isn't</h2>
      <p>ShipShape reports facts about your code and live product and the published rules they relate to. ShipShape is not a law firm and does not give legal advice. Findings are information, not a guarantee of app store approval, legal compliance or freedom from claims. You decide what to do with them, and you should consult a licensed lawyer for legal decisions.</p>
      <h2>Documents we draft</h2>
      <p>Drafts are templates filled in from your scan. You are responsible for reviewing, editing and approving them before you use them.</p>
      <h2>Your account and content</h2>
      <p>You must have the right to let us scan the repos and sites you submit. You keep ownership of your code and documents.</p>
      <h2>Signatures</h2>
      <p>Signers agree to use electronic records and signatures. We record the signer's typed name, consent, time, IP address, browser and the fingerprint of the exact document version signed.</p>
      <h2>Limitation of liability</h2>
      <p>To the extent the law allows, ShipShape's total liability for any claim is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential damages, including app rejections, fines or lost profits.</p>
      <h2>Disputes</h2>
      <p>Disputes will be resolved by individual binding arbitration, not class actions, except where the law doesn't allow this. [Lawyer to finalize venue and governing law.]</p>
    </LegalPage>
  );
}
