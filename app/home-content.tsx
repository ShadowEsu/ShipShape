import type { ReactNode } from "react";
import type { Status } from "@/components/site";

/** The home page's words, shared by the Quiet home (home-quiet.tsx) and the earlier one (home-v1.tsx, SHIPSHAPE_UI=v1). */

/** The pitch, said once: on the page and as the app's description in its structured data. */
export const PITCH =
  "Keep your W-9, insurance certificate, licenses and agreements together. Fill new forms from facts you confirmed once, share the packet with one link, and see what's due before it lapses.";

/** What keeps the documents safe, one line each; `key` is stable because some lines carry markup. */
export const TRUST: { key: string; text: ReactNode }[] = [
  { key: "tax-ids", text: "Tax IDs in your business facts are encrypted with a key kept outside the database and shown as the last 4 digits unless you ask." },
  { key: "storage", text: "Files sit in private storage and open through links that expire after 5 minutes." },
  { key: "walls", text: "The database itself keeps each workspace apart from every other, and our tests check that with a second account." },
  {
    key: "history",
    // "in-app" never breaks at its hyphen (Design, wave 15).
    text: (
      <>
        Every change to a document, and every <span className="whitespace-nowrap">in-app</span> view, download, share and signature of it, lands in a history
        where each entry is chained to the one before. Passport links keep their own list of opens.
      </>
    ),
  },
  { key: "no-ads", text: "No ads, no analytics trackers, and we don't train AI on your documents." },
  { key: "export", text: "Owners and admins can export everything from Settings (one ZIP, up to 200 MB); anyone can delete their account there, any time." },
];

export const WHO: { who: string; asks: string; page?: { href: string; label: string } }[] = [
  {
    who: "Contractors",
    asks: "Every new general contractor or property manager wants your W-9, insurance certificate and license. Then the certificate again when it renews.",
    page: { href: "/for/contractors", label: "ShipShape for contractors" },
  },
  {
    who: "Freelancers",
    asks: "Each client wants a W-9 and an NDA signed before the first call, and your own agreement after it.",
    page: { href: "/for/freelancers", label: "ShipShape for freelancers" },
  },
  { who: "Restaurants and shops", asks: "Landlords, suppliers and delivery apps ask for permits, certificates and tax forms, and you collect the same from your vendors." },
];

export const STEPS: { title: string; body: string }[] = [
  { title: "Keep", body: "Every document in one place, with each version, its dates and a history of who opened or shared it." },
  { title: "Fill", body: "Confirm your business facts once. ShipShape fills the official IRS W-9 and the Common Paper Mutual NDA from them, and shows where every field came from." },
  { title: "Share", body: "One link holds exactly the documents you pick. It lasts 7, 30 or 90 days, as you choose, shows each time it's opened and what was downloaded, and turns off in a click." },
  { title: "Stay current", body: "Expiry and renewal dates become deadlines and a calendar file with alerts; on Pro, reminders 90, 30 and 7 days ahead, shown to owners and admins on the Deadlines page." },
];

export type Capability = { title: string; body: string; status: Status };

/**
 * What works today, what waits on setup and what's planned, worded for whether real documents, live payments and AI
 * are open (Security MUST-4). With AI off, "What are they asking for?" matches document names (ledger 461).
 */
export function capabilities(docs: boolean, live: boolean, ai: boolean): Capability[] {
  const aiLater: Capability[] = ai
    ? []
    : [
        {
          title: "Reading requests with AI",
          body: "Also finds documents a request describes without naming them. Built and tested; it runs only when you tick the box for a request, and turns on after our security review.",
          status: "Awaiting setup",
        },
      ];
  return [
    { title: "Documents, versions and history", body: "Search, archive and see every version; every change and download recorded.", status: "Works today" },
    { title: "W-9 and NDA from your facts", body: "Official IRS form and Common Paper's standard NDA, filled and saved.", status: "Works today" },
    { title: "Passport links", body: "Expiry up to 90 days, access log, turn off any time.", status: "Works today" },
    { title: "Deadlines and calendar file", body: "Lapsed, due soon and later, with a file you can add to Google, Apple or Outlook Calendar.", status: "Works today" },
    docs
      ? { title: "Signature requests", body: "Consent, a one-time code and a certificate page on the signed copy. In the sample today; for your own documents once ShipShape sends email.", status: "Awaiting setup" }
      : { title: "Signature requests", body: "Consent, a one-time code and a certificate page on the signed copy.", status: "Works today" },
    { title: "Export and account deletion", body: "One ZIP of everything; deletion removes files and links.", status: "Works today" },
    docs
      ? { title: "Collect", body: "Ask your own vendors for W-9s and certificates through an upload link and see who's current. In the sample today; not in a plan yet.", status: "Planned" }
      : { title: "Collect", body: "Ask your own vendors for W-9s and certificates through an upload link and see who's current. Not in a plan yet.", status: "Works today" },
    docs
      ? { title: "Accounts for real documents", body: "Your own account and workspace for your real paperwork.", status: "Works today" }
      : { title: "Accounts for real documents", body: "Open after our security review, once our live servers are ready.", status: "Awaiting setup" },
    docs
      ? { title: "Upload your own files", body: "PDF, PNG or JPEG files, up to 4 MB each.", status: "Works today" }
      : { title: "Upload your own files", body: "PDF, PNG or JPEG, up to 4 MB each, once real accounts open.", status: "Awaiting setup" },
    { title: "Email reminders and signing codes", body: "Pending an email provider; the sample shows them inside the app meanwhile.", status: "Awaiting setup" },
    live
      ? { title: "Payments", body: "Pro is paid monthly through Stripe; cancel any time from Settings.", status: "Works today" }
      : { title: "Payments", body: "Paying for Pro by card through Stripe is built and tested. No real charges yet.", status: "Awaiting setup" },
    ai
      ? { title: "“What are they asking for?”", body: "Paste a request and see which documents it asks for and which you have. AI reads it only when you tick the box for that request.", status: "Works today" }
      : { title: "“What are they asking for?”", body: "Paste a request and see which documents it names and which you have, current or expired. Found by matching document names, with no AI.", status: "Works today" },
    ...aiLater,
    { title: "Dates read off certificates", body: "Expiry dates filled in from an uploaded certificate, with your OK. Opt-in AI.", status: "Planned" },
  ];
}
