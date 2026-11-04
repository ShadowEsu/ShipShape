"use server";

import { requireWorkspace } from "@/lib/server/session";
import { markStart } from "@/lib/server/start-here";

/** Deadlines opened in a sample: Start here's third step (a page can't set a cookie, so the page calls this once). */
export async function markDeadlinesSeen() {
  await markStart(await requireWorkspace(), 3);
}
