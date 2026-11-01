import type { NextConfig } from "next";

const BUILT_AT = new Date().toISOString();

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()",
  },
];

// Shared passports (/p/…), signing pages (/s/…) and upload links (/c/…) carry a secret in the path: never indexed,
// never sent on as a referrer, never cached by shared caches.
const SECRET_LINK_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store" },
];

// Upload pages post a plain form, and under no-referrer a browser sends "Origin: null" with it,
// which the same-origin check rightly refuses. same-origin still sends nothing to other sites (and
// the link's token is only ever in the fragment or its cookie, never in a Referer).
const UPLOAD_LINK_HEADERS = SECRET_LINK_HEADERS.map((h) => (h.key === "Referrer-Policy" ? { ...h, value: "same-origin" } : h));

// proxy.ts sets the per-request CSP for pages and skips /api, so a path under /api that no route
// answers would get the app's not-found page with no policy at all (W12-13). API routes answer JSON,
// files or calendars, which need nothing. /api/files sets its own policy (inline images need
// img-src 'self'), and a second one would be enforced on top of it.
const API_HEADERS = [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Development logs every server action's arguments and result by default; ours carry pasted
  // requests, business facts and form values, which must never reach a log line (Security R4, G4 §4).
  logging: { serverFunctions: false },
  env: { SHIPSHAPE_BUILT_AT: BUILT_AT },
  serverExternalPackages: ["@electric-sql/pglite"],
  // Uploads go through server actions: 4 MB files plus form overhead, inside Vercel's 4.5 MB
  // request body cap (a larger request gets Vercel's 413 before the app sees it).
  experimental: { serverActions: { bodySizeLimit: "4500kb" } },
  // The official forms and templates are read from disk at request time. lib/pdf/build-isolated.ts
  // runs to-sign.child.ts in a child process as plain TypeScript (Node strips the types), so it
  // and what it imports ship as files: the bundle doesn't contain them in a form Node can start.
  outputFileTracingIncludes: {
    "/**": [
      "./templates/**/*",
      "./supabase/**/*.sql",
      "./package.json",
      "./lib/pdf/{to-sign.child,to-sign,inert,load,append}.ts",
      "./node_modules/pdf-lib/package.json",
      "./node_modules/pdf-lib/cjs/**/*.js",
      "./node_modules/pdf-lib/node_modules/tslib/**/*",
      "./node_modules/@pdf-lib/{standard-fonts,upng}/**/*",
      "./node_modules/pako/**/*",
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/p/:path*", headers: SECRET_LINK_HEADERS },
      { source: "/s/:path*", headers: SECRET_LINK_HEADERS },
      { source: "/c/:path*", headers: UPLOAD_LINK_HEADERS },
      { source: "/api/:path((?!files$).*)", headers: API_HEADERS },
      { source: "/app/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
