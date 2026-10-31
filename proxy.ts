import { NextResponse, type NextRequest } from "next/server";

/**
 * A fresh nonce per request and a strict Content-Security-Policy (Security R9): no 'unsafe-eval'
 * in production, no inline script without the nonce, no framing. Stripe's hosted Checkout and
 * Customer Portal, and Cognito's sign-in page, are reached by redirect after a form post, so
 * form-action names them.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // The dev server injects CSS as <style> elements without a nonce; production serves <link> files.
    `style-src-elem 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Next.js and React set style attributes (route announcer, dev overlay); a nonce can't cover attributes.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self' https://checkout.stripe.com https://billing.stripe.com${signInOrigin()}`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** Cognito's managed login origin (lib/server/cognito.ts checks the rest); empty where account sign-in isn't set up. */
function signInOrigin(): string {
  try {
    const url = new URL(process.env.COGNITO_DOMAIN ?? "");
    return url.protocol === "https:" ? ` ${url.origin}` : "";
  } catch {
    return "";
  }
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
