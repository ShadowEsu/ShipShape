"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TERMS_VERSION } from "@/lib/legal";
import { asService, asUser } from "@/lib/server/db";
import { runReminders } from "@/lib/server/deadlines";
import { clientIp, rateLimited } from "@/lib/server/http";
import { createLocalUser, endSession, localSignInAllowed, startSession } from "@/lib/server/session";
import { seedSampleWorkspace } from "@/lib/server/sample";

export interface SignInState {
  error?: string;
}

const Form = z.object({
  mode: z.enum(["demo", "email"]),
  email: z.string().trim().toLowerCase().max(200).optional(),
  terms: z.literal("on", { error: "Tick the box to agree to the Terms and Privacy Policy." }),
});

export async function signIn(_prev: SignInState, data: FormData): Promise<SignInState> {
  const parsed = Form.safeParse({ mode: data.get("mode"), email: data.get("email") ?? undefined, terms: data.get("terms") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (await rateLimited("signin", clientIp(await headers()), 20, 3600)) return { error: "Too many attempts. Try again in a little while." };

  const { mode, email } = parsed.data;
  let userId: string;
  if (mode === "email") {
    // Unverified email sign-in exists only for local development; production uses Supabase Auth.
    if (!localSignInAllowed()) return { error: "Email sign-in isn't open yet. Try the sample workspace, or join the waitlist." };
    if (!email || !z.email().safeParse(email).success) return { error: "Enter a valid email address." };
    userId = await createLocalUser(email, false);
  } else {
    userId = await createLocalUser(null, true);
  }

  if (mode === "demo") {
    const [org] = await asService((tx) =>
      tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]),
    );
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    // The sample's expired permit and expiring certificate show their reminders straight away.
    await runReminders(undefined, org.id);
  }
  await asUser(userId, async (tx) => {
    await tx.query("insert into app.consents (user_id, item, policy_version) values ($1, 'terms_privacy', $2)", [userId, TERMS_VERSION]);
    const [has] = await tx.query("select 1 from app.members where user_id = $1", [userId]);
    if (!has) await tx.query("select app.create_workspace('My business')");
  });
  await startSession({ userId, demo: mode === "demo" });
  redirect("/app");
}

export async function signOut() {
  await endSession();
  redirect("/");
}
