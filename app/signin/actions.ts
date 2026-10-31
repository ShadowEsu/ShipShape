"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asService, asUser } from "@/lib/server/db";
import { CALLBACK_PATH, cognitoConfig, SIGN_IN_COOKIE, SIGN_IN_SECONDS, startSignIn } from "@/lib/server/cognito";
import { runReminders } from "@/lib/server/deadlines";
import { clientIp, rateLimited } from "@/lib/server/http";
import { createLocalUser, endSession, finishSignIn, localSignInAllowed, viewerToday } from "@/lib/server/session";
import { seedSampleWorkspace } from "@/lib/server/sample";

export interface SignInState {
  error?: string;
}

const Form = z.object({
  mode: z.enum(["demo", "email", "account"]),
  email: z.string().trim().toLowerCase().max(200).optional(),
  terms: z.literal("on", { error: "Tick the box to agree to the Terms and Privacy Policy." }),
});

export async function signIn(_prev: SignInState, data: FormData): Promise<SignInState> {
  const parsed = Form.safeParse({ mode: data.get("mode"), email: data.get("email") ?? undefined, terms: data.get("terms") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (await rateLimited("signin", clientIp(await headers()), 20, 3600)) return { error: "Too many attempts. Try again in a little while." };

  const { mode, email } = parsed.data;
  if (mode === "account") {
    // To Cognito's sign-in page; /auth/callback finishes (and records the agreement ticked here).
    const cognito = cognitoConfig(process.env);
    if (!cognito) return { error: "Accounts aren't open yet. Try the sample workspace, or join the waitlist." };
    const { cookie, url } = startSignIn(cognito);
    (await cookies()).set(SIGN_IN_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: CALLBACK_PATH,
      maxAge: SIGN_IN_SECONDS,
    });
    redirect(url);
  }

  let userId: string;
  if (mode === "email") {
    // Unverified email sign-in exists only for local development; production uses Cognito accounts.
    if (!localSignInAllowed()) return { error: "Email sign-in isn't open yet. Try the sample workspace, or join the waitlist." };
    if (!email || !z.email().safeParse(email).success) return { error: "Enter a valid email address." };
    userId = await createLocalUser(email, false);
  } else {
    userId = await createLocalUser(null, true);
    const [org] = await asService((tx) =>
      tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]),
    );
    const today = await viewerToday();
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId, today));
    // The sample's expired permit and expiring certificate show their reminders straight away.
    await runReminders(undefined, org.id);
  }
  await finishSignIn(userId, { demo: mode === "demo" });
  redirect("/app");
}

export async function signOut() {
  await endSession();
  redirect("/");
}
