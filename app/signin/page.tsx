import type { Metadata } from "next";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { localSignInAllowed } from "@/lib/server/session";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Logo />
        {deleted === "1" && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Your account and its workspaces were deleted.
          </p>
        )}
        <div className="card space-y-5">
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">Open ShipShape</h1>
            <p className="mt-2 text-sm text-ink-2">
              Accounts for real documents open after our security review. Until then, explore a sample business with made-up
              documents.
            </p>
          </div>
          <SignInForm allowEmail={localSignInAllowed()} />
        </div>
        <NotLegalAdvice />
      </div>
    </main>
  );
}
