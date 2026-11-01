import type { Metadata } from "next";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { cognitoConfig, type SignInProblem } from "@/lib/server/cognito";
import { realDocsEnabled } from "@/lib/server/flags";
import { localSignInAllowed } from "@/lib/server/session";
import { RETURN_TO, returnTo } from "@/lib/return-to";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Fixed text per reason: nothing from the address is shown. Each says what happened, then what to do.
const PROBLEMS: Record<SignInProblem, string> = {
  expired: "That sign-in took more than 10 minutes or was already used. Sign in again below.",
  cancelled: "You cancelled signing in, so nothing changed. Sign in again below when you're ready.",
  failed: "We couldn't finish signing you in. Sign in again below.",
  terms: "Our Terms or Privacy Policy changed while you were signing in. Read them, tick the box again, and sign in again below.",
  taken: "This email already belongs to another ShipShape account, so we didn't sign you in. Sign in with a different email address.",
  deleting:
    "The account that used this email is still being deleted. Once that finishes, within 2 days, you can sign up with this email again.",
  busy: "Too many sign-in attempts from this network. Wait up to an hour, then try again.",
};

const problem = (error: string | undefined) => Object.entries(PROBLEMS).find(([reason]) => reason === error)?.[1];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; error?: string; signed_out?: string; next?: string }>;
}) {
  const { deleted, error, signed_out, next } = await searchParams;
  const accounts = cognitoConfig(process.env) !== null;
  const message = problem(error);
  // A re-sign-in for export, delete or Show full EIN goes back to that section afterwards (an allow-listed choice, never a URL).
  const back = returnTo(next);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Logo />
        {deleted === "1" && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Your account is deleted, and so is every workspace that had no other owner. There&apos;s nothing else you need to do.
          </p>
        )}
        {signed_out === "everywhere" && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            You&apos;re signed out on every device.
          </p>
        )}
        {message && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {message}
          </p>
        )}
        <div className="card space-y-5">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">Open ShipShape</h1>
            <p className="mt-2 text-sm text-ink-2">
              {back
                ? `Sign in again to continue in ${RETURN_TO[back].where}.`
                : accounts
                  ? realDocsEnabled()
                    ? "Sign in, or create an account with your email. You can also explore a sample business with made-up documents."
                    : "Create an account with your email now; real documents open after our security review. Until then, explore a sample business with made-up documents."
                  : "Accounts for real documents open after our security review. Until then, explore a sample business with made-up documents."}
            </p>
          </div>
          <SignInForm allowEmail={localSignInAllowed()} accounts={accounts} next={back} />
        </div>
        <NotLegalAdvice />
      </div>
    </main>
  );
}
