import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CALLBACK_PATH, cognitoConfig, completeSignIn, SIGN_IN_COOKIE, SignInFailed } from "@/lib/server/cognito";
import { pgErrorCode } from "@/lib/server/db";
import { clientIp, rateLimited } from "@/lib/server/http";
import { finishSignIn } from "@/lib/server/session";
import { landing } from "@/lib/return-to";

/**
 * Where Cognito's managed login sends the browser back (lib/server/cognito.ts). The sign-in cookie
 * is single-use: it's deleted before anything else happens.
 */
export async function GET(request: Request) {
  const jar = await cookies();
  const cookie = jar.get(SIGN_IN_COOKIE)?.value;
  jar.delete({ name: SIGN_IN_COOKIE, path: CALLBACK_PATH });
  const cognito = cognitoConfig(process.env);
  if (!cognito) redirect("/signin");

  let to = "/app";
  try {
    if (await rateLimited("signin-callback", clientIp(request.headers), 20, 3600)) throw new SignInFailed("busy");
    const query = new URL(request.url).searchParams;
    const { userId, authAt, returnTo } = await completeSignIn(cognito, { code: query.get("code"), state: query.get("state"), error: query.get("error") }, cookie);
    await finishSignIn(userId, { demo: false, authAt, userAgent: request.headers.get("user-agent") });
    // Back to the section a re-sign-in came from (export, delete, Show full EIN); otherwise Home.
    to = landing(returnTo);
  } catch (e) {
    // Reasons and our own details only: never the token, the code or the email.
    const detail = e instanceof SignInFailed ? e.message : `${e instanceof Error ? e.name : "unknown"}${pgErrorCode(e) ? ` ${pgErrorCode(e)}` : ""}`;
    console.error(`account sign-in refused: ${detail}`);
    to = `/signin?error=${e instanceof SignInFailed ? e.reason : "failed"}`;
  }
  redirect(to);
}
