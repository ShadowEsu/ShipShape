"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asService, asUser } from "@/lib/server/db";
import { CALLBACK_PATH, cognitoConfig, SIGN_IN_COOKIE, SIGN_IN_SECONDS, startSignIn } from "@/lib/server/cognito";
import { runReminders } from "@/lib/server/deadlines";
import { clientIp, rateLimited } from "@/lib/server/http";
import { createLocalUser, finishSignIn, localSignInAllowed, signOutHere, viewerToday } from "@/lib/server/session";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { landing, returnTo } from "@/lib/return-to";

export interface SignInState {
  error?: string;
  /** The field the error is about, so the page shows it next to that field. */
  field?: "terms" | "email";
  /** What the person typed and ticked, put back after a refusal. */
  email?: string;
  terms?: boolean;
}

const Form = z.object({
  mode: z.enum(["demo", "email", "account"]),
  email: z.string().trim().toLowerCase().max(200, "Use an email address of up to 200 characters.").optional(),
  terms: z.literal("on", { error: "Check the box to agree to the Terms and Privacy Policy." }),
});

export async function signIn(_prev: SignInState, data: FormData): Promise<SignInState> {
  const typedEmail = data.get("email");
  const typed = { email: typeof typedEmail === "string" ? typedEmail : "", terms: data.get("terms") === "on" };
  const parsed = Form.safeParse({ mode: data.get("mode"), email: data.get("email") ?? undefined, terms: data.get("terms") ?? undefined });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path[0];
    const field = key === "terms" || key === "email" ? key : undefined;
    return { ...typed, error: issue?.message ?? "Choose how to open ShipShape, then try again.", field };
  }
  if (await rateLimited("signin", clientIp(await headers()), 20, 3600)) {
    return { ...typed, error: "Too many sign-in attempts from this network. Wait up to an hour, then try again." };
  }

  const { mode, email } = parsed.data;
  // Where a re-sign-in for export, delete or Show full EIN goes afterwards: an allow-listed choice, else Home (W9-12).
  const back = returnTo(data.get("next"));
  if (mode === "account") {
    // To Cognito's sign-in page; /auth/callback finishes (and records the agreement ticked here).
    const cognito = cognitoConfig(process.env);
    if (!cognito) return { ...typed, error: "Accounts aren't open yet. Try the sample workspace instead." };
    const { cookie, url } = startSignIn(cognito, { returnTo: back });
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
    if (!localSignInAllowed()) return { ...typed, error: "Email sign-in isn't open yet. Try the sample workspace instead." };
    if (!email || !z.email().safeParse(email).success) return { ...typed, error: "Enter your email address, like you@business.com.", field: "email" };
    userId = await createLocalUser(email, false);
  } else {
    userId = await createLocalUser(null, true);
    const [org] = await asService((tx) =>
      tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]),
    );
    const today = await viewerToday();
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId, today));
    // The sample's expired permit and expiring certificate show their reminders straight away, counted
    // from the same day the sample was seeded on, so the outbox and Deadlines agree (W10-2).
    await runReminders(today, org.id);
  }
  await finishSignIn(userId, { demo: mode === "demo", userAgent: (await headers()).get("user-agent") });
  // The sample workspace has nothing to export or delete: it lands on Home.
  redirect(mode === "demo" ? "/app" : landing(back));
}

export async function signOut() {
  await signOutHere();
  redirect("/");
}
