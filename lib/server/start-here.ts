import "server-only";
import { cookies } from "next/headers";
import { askedDocuments, currentMatchIds } from "@/lib/request-words";
import { START_SEEN_COOKIE } from "@/lib/start-seen";
import type { Ctx } from "./profile";
import { matchToDocuments } from "./request-check";

/**
 * The sample's "Start here" path (ledger 461, weakest spot 3): the product's loop in 3 steps, on the sample's own
 * documents. 1: check the request Northwind Builders sent; 2: send them the packet in a passport link; 3: see what's
 * due. A step ticks when it's done in this sample (a request checked, a link made, Deadlines opened), kept in one
 * HttpOnly cookie that names the sample workspace, so a new sample in the same browser starts over. Finished, Home
 * shows it once more (the celebration and the waitlist), then leaves it out. Nothing else is stored, and real
 * workspaces never see the path.
 */

/** Its value is `?try=` on Check a request, which then opens with the request already pasted. */
export const SAMPLE_REQUEST_KEY = "northwind";
/** What Northwind Builders asked for: one of each answer on the sample's documents (have, expires soon, expired, missing). */
export const SAMPLE_REQUEST = [
  "Hi Alex,",
  "",
  "Before your crew starts on the Elm St job, we need a few things from Harbor Plumbing:",
  "- a completed W-9",
  "- a certificate of insurance naming Northwind Builders as additional insured",
  "- your contractor license and your city business license",
  "- a signed mutual NDA",
  "- a certificate of good standing",
  "",
  "Thanks,",
  "Jordan Lee (sample)",
  "Northwind Builders",
].join("\n");

export type StartStep = 1 | 2 | 3;
const COOKIE = "ss_start";
// As long as a sample session (lib/server/session.ts TTL_SECONDS).
const KEEP_SECONDS = 12 * 60 * 60;

/** The steps done in this workspace: the cookie is `<workspace id>.<steps>`, and any other value counts as none. */
export function parseStart(raw: string | undefined, orgId: string): Set<StartStep> {
  const done = new Set<StartStep>();
  const [org, steps = ""] = (raw ?? "").split(".");
  if (org !== orgId) return done;
  for (const c of steps) {
    if (c === "1") done.add(1);
    else if (c === "2") done.add(2);
    else if (c === "3") done.add(3);
  }
  return done;
}

const doneHere = async (ctx: Ctx) => parseStart((await cookies()).get(COOKIE)?.value, ctx.orgId);

/** Ticks a step in a sample. Elsewhere, or once it's ticked, it writes nothing (a cookie write refreshes the page). */
export async function markStart(ctx: Ctx, step: StartStep) {
  if (!ctx.demo) return;
  const done = await doneHere(ctx);
  if (done.has(step)) return;
  const jar = await cookies();
  // A new sample's first step: an earlier sample's "finish shown" mark mustn't hide this one's finish.
  if (done.size === 0 && jar.get(START_SEEN_COOKIE)) jar.delete({ name: START_SEEN_COOKIE, path: "/app" });
  done.add(step);
  jar.set(COOKIE, `${ctx.orgId}.${[...done].sort().join("")}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/app",
    maxAge: KEEP_SECONDS,
  });
}

export interface StartPath {
  /** Steps 1, 2 and 3, in order: whether each is done. */
  done: [boolean, boolean, boolean];
  /** The documents step 2's link opens ticked: the current ones the request asks for, as Check's answer shares them. */
  packet: string[];
}

/** The path for this workspace; null outside a sample, and once its finish has been shown. */
export async function startPath(ctx: Ctx): Promise<StartPath | null> {
  if (!ctx.demo) return null;
  const done = await doneHere(ctx);
  if (done.size === 3 && (await cookies()).get(START_SEEN_COOKIE)?.value === "1") return null;
  const packet = done.has(2) ? [] : currentMatchIds(await matchToDocuments(ctx, askedDocuments(SAMPLE_REQUEST), SAMPLE_REQUEST));
  return { done: [done.has(1), done.has(2), done.has(3)], packet };
}

/** Whether step 3 still needs ticking here, so Deadlines only asks to tick it once. */
export async function startStepOpen(ctx: Ctx, step: StartStep): Promise<boolean> {
  return ctx.demo && !(await doneHere(ctx)).has(step);
}
