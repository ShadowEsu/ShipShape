/** Code and HTML patterns that turn into signals. Shared by the repo scan and the live check. */
export interface Pattern {
  signal: string;
  re: RegExp;
  /** For trackers: the names a privacy policy should mention. */
  vendor?: { name: string; keywords: string[] };
}

export const PATTERNS: Pattern[] = [
  // Trackers and ad SDKs
  { signal: "tracker:meta", re: /react-native-fbsdk|facebook-android-sdk|FBSDKCoreKit|FacebookCore|fbevents\.js|facebook_app_events|connect\.facebook\.net/, vendor: { name: "Meta (Facebook)", keywords: ["meta", "facebook"] } },
  { signal: "tracker:google-analytics", re: /firebase\/analytics|@react-native-firebase\/analytics|firebase-analytics|FirebaseAnalytics|googletagmanager\.com|google-analytics\.com|\bgtag\(/, vendor: { name: "Google Analytics", keywords: ["google"] } },
  { signal: "tracker:tiktok", re: /analytics\.tiktok\.com|ttq\.load/, vendor: { name: "TikTok", keywords: ["tiktok"] } },
  { signal: "tracker:mixpanel", re: /mixpanel/i, vendor: { name: "Mixpanel", keywords: ["mixpanel"] } },
  { signal: "tracker:amplitude", re: /@amplitude\/|amplitude-js|cdn\.amplitude\.com/i, vendor: { name: "Amplitude", keywords: ["amplitude"] } },
  { signal: "tracker:segment", re: /@segment\/|cdn\.segment\.com/, vendor: { name: "Segment", keywords: ["segment"] } },
  { signal: "tracker:posthog", re: /posthog/i, vendor: { name: "PostHog", keywords: ["posthog"] } },
  { signal: "tracker:hotjar", re: /hotjar/i, vendor: { name: "Hotjar", keywords: ["hotjar"] } },
  { signal: "tracker:clarity", re: /clarity\.ms/, vendor: { name: "Microsoft Clarity", keywords: ["microsoft", "clarity"] } },
  { signal: "tracker:ads", re: /google-mobile-ads|GoogleMobileAds|\badmob\b|applovin|unity-ads|googlesyndication\.com/i, vendor: { name: "advertising networks", keywords: ["advertis"] } },

  // Payments
  { signal: "payments:card", re: /@stripe\/|stripe\.com\/v3|\bStripe\(|stripe_android|StripePaymentSheet|paypal/i },
  { signal: "payments:iap", re: /react-native-iap|StoreKit|SKPaymentQueue|revenuecat|purchases_flutter|BillingClient|in_app_purchase/i },

  // Accounts and logins
  { signal: "feature:signup", re: /createUserWithEmailAndPassword|auth\.signUp\(|\bsignUp\(|registerUser|createAccount\(|\/api\/register|Auth\.signUp/ },
  { signal: "feature:account-deletion", re: /deleteUser|deleteAccount|delete_account|currentUser\.delete\(|auth\.admin\.deleteUser|\/account\/delete/i },
  { signal: "feature:social-login", re: /GoogleSignin|signInWithGoogle|GoogleAuthProvider|FacebookAuthProvider|provider:\s*["'](google|facebook)["']/ },
  { signal: "feature:sign-in-with-apple", re: /AppleAuthentication|ASAuthorizationAppleIDProvider|sign_in_with_apple|signInWithApple|provider:\s*["']apple["']/ },
  { signal: "feature:age-gate", re: /ageGate|age_gate|dateOfBirth|date_of_birth|birthdate|isOver13|minimumAge|AgeRangeService|ageSignal/i },

  // Content features
  { signal: "feature:image-upload", re: /launchImageLibrary|ImagePicker|image_picker|UIImagePickerController|PHPickerViewController|uploadBytes|accept=["']image\/|storage\.from\([^)]*\)\.upload/ },
  { signal: "feature:report-content", re: /reportContent|report_content|reportPost|flagContent|takedown|\/api\/report/i },
  { signal: "ai:sdk", re: /from ["']openai["']|require\(["']openai["']\)|@anthropic-ai\/sdk|@google\/genai|@google\/generative-ai|generativelanguage\.googleapis\.com|api\.openai\.com/ },
  { signal: "ai:chat", re: /chat\.completions\.create|messages\.create\(|role:\s*["'](user|assistant)["']|startChat\(/ },

  // Privacy controls
  { signal: "feature:consent-banner", re: /cookieconsent|cookiebot|onetrust|osano|klaro|iubenda|usercentrics|consentmanager|CookieConsent|cookie-consent|gtag\(\s*["']consent["']/i },
  { signal: "feature:opt-out", re: /do not sell|do-not-sell|doNotSell|globalPrivacyControl|Global Privacy Control|opt[- ]?out of (sale|sharing)/i },

  // Audience
  { signal: "audience:kids", re: /\b(for kids|kids app|children's app|designed for children|ages [4-9] ?(to|-) ?1[0-2])\b/i },
];

/** Secret patterns. Matches are redacted before they are stored. */
export const SECRET_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "secret:aws", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { signal: "secret:stripe", re: /\bsk_live_[0-9a-zA-Z]{20,}/ },
  { signal: "secret:openai", re: /\bsk-(?!ant-)(proj-)?[A-Za-z0-9_-]{32,}/ },
  { signal: "secret:anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { signal: "secret:github", re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { signal: "secret:slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { signal: "secret:private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

export const redact = (line: string, re: RegExp) =>
  line.replace(re, (m) => `${m.slice(0, 6)}${"*".repeat(Math.max(4, m.length - 6))}`).trim().slice(0, 160);
