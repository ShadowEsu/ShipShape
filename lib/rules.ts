import type { Evidence, Rule, Signals } from "./types";

/**
 * The ShipShape rules database, version 1.
 *
 * DRAFT: every rule has reviewed: false until a licensed lawyer signs off.
 * Each rule states what the code shows and cites its source. Rules never
 * promise approval or compliance.
 */
export const RULES_AS_OF = "2026-10-07";

const get = (s: Signals, key: string) => s.get(key) ?? null;
const has = (s: Signals, key: string) => s.has(key);
const withPrefix = (s: Signals, prefix: string): Evidence[] => {
  const out: Evidence[] = [];
  for (const [k, v] of s) if (k.startsWith(prefix)) out.push(...v);
  return out;
};
const orNull = (e: Evidence[]) => (e.length ? e : null);
const isApp = (s: Signals) => has(s, "platform:ios") || has(s, "platform:android");
const trackers = (s: Signals) => withPrefix(s, "tracker:");

const GUIDELINES = "https://developer.apple.com/app-store/review/guidelines/";

export const RULES: Rule[] = [
  {
    id: "apple-account-deletion",
    title: "Users can create an account but can't delete it in the app",
    area: "App store",
    severity: "blocker",
    source: { name: "App Review Guideline 5.1.1(v)", url: `${GUIDELINES}#data-collection-and-storage` },
    effective: "2022-06-30",
    summary: "Apps that let people create an account must also let them start deleting that account from inside the app.",
    reviewed: false,
    test: (s) => (has(s, "platform:ios") && has(s, "feature:signup") && !has(s, "feature:account-deletion") ? get(s, "feature:signup") : null),
  },
  {
    id: "play-account-deletion",
    title: "No account deletion path for Google Play",
    area: "App store",
    severity: "blocker",
    source: { name: "Google Play account deletion requirement", url: "https://support.google.com/googleplay/android-developer/answer/13327111" },
    effective: "2023-12-07",
    summary: "Play apps that let people create accounts must offer account deletion in the app and through a web link.",
    reviewed: false,
    test: (s) => (has(s, "platform:android") && has(s, "feature:signup") && !has(s, "feature:account-deletion") ? get(s, "feature:signup") : null),
  },
  {
    id: "apple-login-option",
    title: "Third party login without an equivalent private login option",
    area: "App store",
    severity: "warning",
    source: { name: "App Review Guideline 4.8", url: `${GUIDELINES}#login-services` },
    effective: "in force",
    summary: "Apps that use a third party login such as Google or Facebook must also offer an equivalent login that limits data collection, such as Sign in with Apple.",
    reviewed: false,
    test: (s) => (has(s, "platform:ios") && has(s, "feature:social-login") && !has(s, "feature:sign-in-with-apple") ? get(s, "feature:social-login") : null),
  },
  {
    id: "apple-iap",
    title: "Card payments found in an iOS app",
    area: "App store",
    severity: "warning",
    source: { name: "App Review Guideline 3.1.1", url: `${GUIDELINES}#in-app-purchase` },
    effective: "in force",
    summary: "Digital goods and subscriptions sold inside an iOS app generally must use in app purchase. Physical goods and services used outside the app can use other payment methods.",
    reviewed: false,
    test: (s) => (has(s, "platform:ios") && has(s, "payments:card") && !has(s, "payments:iap") ? get(s, "payments:card") : null),
  },
  {
    id: "apple-privacy-manifest",
    title: "Third party SDKs but no privacy manifest",
    area: "App store",
    severity: "warning",
    source: { name: "Apple privacy manifest files", url: "https://developer.apple.com/documentation/bundleresources/privacy-manifest-files" },
    effective: "2024-05-01",
    summary: "iOS apps and the third party SDKs they include must declare the data they collect and the reasons they use certain APIs in a PrivacyInfo.xcprivacy file.",
    reviewed: false,
    test: (s) => (has(s, "platform:ios") && !has(s, "doc:privacy-manifest") ? orNull(trackers(s)) : null),
  },
  {
    id: "policy-missing-vendor",
    title: "Your privacy policy doesn't mention a service your code sends data to",
    area: "Privacy",
    severity: "blocker",
    source: { name: "California Consumer Privacy Act, Civ. Code 1798.100", url: "https://oag.ca.gov/privacy/ccpa" },
    effective: "2020-01-01",
    summary: "A privacy policy must describe the categories of data collected and who it is shared with. The code shares data with services the policy never names.",
    reviewed: false,
    test: (s) => orNull(withPrefix(s, "gap:policy-missing-vendor:")),
  },
  {
    id: "privacy-policy-missing",
    title: "No privacy policy found",
    area: "Documents",
    severity: "missing-document",
    source: { name: "App Review Guideline 5.1.1(i)", url: `${GUIDELINES}#data-collection-and-storage` },
    effective: "in force",
    summary: "Apps and sites that collect personal data need a privacy policy that is easy to find. The stores require a link to it.",
    reviewed: false,
    test: (s) => {
      if (has(s, "doc:privacy-policy")) return null;
      const why = [...trackers(s), ...(get(s, "feature:signup") ?? [])];
      return orNull(why.length ? why : isApp(s) ? [{ file: "(whole repo)", snippet: "No privacy policy file or route found" }] : []);
    },
  },
  {
    id: "terms-missing",
    title: "No terms of service found",
    area: "Documents",
    severity: "missing-document",
    source: { name: "Common practice for apps with accounts, payments or user content", url: "https://commonpaper.com/standards/" },
    effective: "in force",
    summary: "Apps with accounts, payments or user uploads usually need terms that set the rules for users and limit liability.",
    reviewed: false,
    test: (s) =>
      !has(s, "doc:terms") && (has(s, "feature:signup") || has(s, "payments:card") || has(s, "feature:image-upload"))
        ? [...(get(s, "feature:signup") ?? []), ...(get(s, "payments:card") ?? []), ...(get(s, "feature:image-upload") ?? [])].slice(0, 5)
        : null,
  },
  {
    id: "trackers-before-consent",
    title: "Trackers load with no consent banner",
    area: "Privacy",
    severity: "blocker",
    source: { name: "California Invasion of Privacy Act, Penal Code 631", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=631" },
    effective: "in force",
    summary: "Tracking pixels that load before a visitor agrees are the basis of thousands of wiretap lawsuits and demand letters in California, and need consent under EU law.",
    reviewed: false,
    test: (s) => (has(s, "platform:web") && !has(s, "feature:consent-banner") ? orNull(trackers(s)) : null),
  },
  {
    id: "ccpa-opt-out",
    title: "Data shared with ad or analytics services but no opt out",
    area: "Privacy",
    severity: "warning",
    source: { name: "CCPA right to opt out, Civ. Code 1798.120", url: "https://oag.ca.gov/privacy/ccpa" },
    effective: "2020-01-01",
    summary: "Businesses covered by the CCPA that sell or share personal data for ads must offer a clear opt out and honor Global Privacy Control signals. A mobile game company paid $1.4M in 2025 for missing this.",
    reviewed: false,
    test: (s) => (!has(s, "feature:opt-out") ? orNull(trackers(s)) : null),
  },
  {
    id: "coppa",
    title: "App looks aimed at children",
    area: "Privacy",
    severity: "warning",
    source: { name: "FTC Children's Online Privacy Protection Rule", url: "https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa" },
    effective: "2026-04-22",
    summary: "Services aimed at children under 13 need verifiable parental consent before collecting personal data. The amended rule's compliance date was April 22, 2026.",
    reviewed: false,
    test: (s) => get(s, "audience:kids"),
  },
  {
    id: "app-store-age-laws",
    title: "No age signal handling for state app store laws",
    area: "New laws",
    severity: "warning",
    source: { name: "California AB 1043, Digital Age Assurance Act", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1043" },
    effective: "2027-01-01",
    summary: "Texas, Utah, Louisiana and California app store laws require age ratings and age signals for minors, with dates from 2026 to 2027. Texas is being challenged in court.",
    reviewed: false,
    test: (s) => (isApp(s) && has(s, "feature:signup") && !has(s, "feature:age-gate") ? get(s, "feature:signup") : null),
  },
  {
    id: "ca-companion-chatbot",
    title: "AI chat present: California's companion chatbot law may apply",
    area: "New laws",
    severity: "warning",
    source: { name: "California SB 243, companion chatbots", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB243" },
    effective: "2026-01-01",
    summary: "Chatbots that can act as companions must tell users they are talking to AI, follow suicide and self harm protocols, and add protections for minors.",
    reviewed: false,
    test: (s) => (has(s, "ai:sdk") && has(s, "ai:chat") ? get(s, "ai:chat") : null),
  },
  {
    id: "take-it-down",
    title: "Users can upload images but there's no takedown process",
    area: "New laws",
    severity: "warning",
    source: { name: "TAKE IT DOWN Act (S. 146)", url: "https://www.congress.gov/bill/119th-congress/senate-bill/146" },
    effective: "2026-05-19",
    summary: "Platforms that host user images must run a notice and removal process and take down reported intimate images within 48 hours.",
    reviewed: false,
    test: (s) => (has(s, "feature:image-upload") && !has(s, "feature:report-content") ? get(s, "feature:image-upload") : null),
  },
  {
    id: "web-accessibility",
    title: "Accessibility problems on the live site",
    area: "Accessibility",
    severity: "warning",
    source: { name: "DOJ guidance on web accessibility and the ADA", url: "https://www.ada.gov/resources/web-guidance/" },
    effective: "in force",
    summary: "Images without alt text and pages without a language are among the most common issues in ADA website lawsuits, which numbered 3,948 in federal court in 2025.",
    reviewed: false,
    test: (s) => orNull(withPrefix(s, "a11y:")),
  },
  {
    id: "copyleft-dependency",
    title: "A copyleft dependency may require you to publish your code",
    area: "Licenses",
    severity: "warning",
    source: { name: "GNU AGPL v3", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
    effective: "in force",
    summary: "GPL and AGPL licensed code can require you to release your own source code when you distribute the app or, for AGPL, run it as a network service.",
    reviewed: false,
    test: (s) => get(s, "license:copyleft"),
  },
  {
    id: "committed-secret",
    title: "A secret key is committed in the repo",
    area: "Security",
    severity: "blocker",
    source: { name: "GitHub secret scanning", url: "https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning" },
    effective: "in force",
    summary: "Anyone with access to the repo, or to an app built from it, can use this key. Revoke it, rotate it and move it to environment variables.",
    reviewed: false,
    test: (s) => orNull(withPrefix(s, "secret:")),
  },
];

export const SEVERITY_ORDER = { blocker: 0, "missing-document": 1, warning: 2 } as const;
