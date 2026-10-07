import { LegalPage } from "@/components/legal";

export const metadata = { title: "Privacy Policy · ShipShape" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>ShipShape ("we") helps small teams check their apps and websites. This policy explains what we collect and why.</p>
      <h2>What we collect</h2>
      <p>Your email if you join the waitlist or create an account. The URLs of the repos and sites you ask us to scan. Scan results, documents you save, and signature records, including the signer's typed name, time, IP address and browser.</p>
      <h2>Your code</h2>
      <p>We clone a repo only to scan it and delete our copy when the scan ends. We keep the findings, which can include short snippets of the lines that triggered them, with secrets masked. We never use your code to train AI models.</p>
      <h2>Who we share with</h2>
      <p>Our hosting and database providers, only to run the service. We don't sell or share personal information for advertising, and this website runs no ad or analytics trackers.</p>
      <h2>Your choices</h2>
      <p>You can export your data or delete your account at any time. California residents can ask what we hold about them and ask us to delete it. Email privacy@shipshape.dev.</p>
      <h2>Children</h2>
      <p>ShipShape is for businesses and adults. We don't knowingly collect data from children under 13.</p>
    </LegalPage>
  );
}
