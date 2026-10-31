import type { Metadata } from "next";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { cognitoConfig, type SignInProblem } from "@/lib/server/cognito";
import { localSignInAllowed } from "@/lib/server/session";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Fixed text per reason: nothing from the address is shown.
const PROBLEMS: Record<SignInProblem, string> = {
  expired: "That sign-in took too long or was already used. Start again.",
  cancelled: "Sign-in was cancelled.",
  failed: "We couldn't finish signing you in. Start again.",
  terms: "Our Terms or Privacy Policy changed while you were signing in. Read them, tick the box again and start again.",
  taken: "This email already belongs to another ShipShape account, so we didn't sign you in.",
  busy: "Too many attempts. Try again in a little while.",
};

const problem = (error: string | undefined) => Object.entries(PROBLEMS).find(([reason]) => reason === error)?.[1];

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ deleted?: string; error?: string }> }) {
  const { deleted, error } = await searchParams;
  const accounts = cognitoConfig(process.env) !== null;
  const message = problem(error);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Logo />
        {deleted === "1" && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Your account and its workspaces were deleted.
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
              {accounts
                ? "Sign in, or create an account with your email. You can also explore a sample business with made-up documents."
                : "Accounts for real documents open after our security review. Until then, explore a sample business with made-up documents."}
            </p>
          </div>
          <SignInForm allowEmail={localSignInAllowed()} accounts={accounts} />
        </div>
        <NotLegalAdvice />
      </div>
    </main>
  );
}
