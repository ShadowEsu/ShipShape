import "server-only";
import type { IconName } from "@/components/icons";
import { esignAvailable } from "./esign";
import { collectOpen, realDocsEnabled } from "./flags";
import type { Ctx } from "./profile";

/** One of ShipShape's tools as Home's tiles and the AI box's answers show it. */
export interface Tool {
  id: "documents" | "add" | "make" | "check" | "passport" | "sign" | "collect" | "deadlines" | "facts" | "settings";
  name: string;
  /** Its one-word label under Home's icon (Design calm v2): Documents, Add, Make, Check, Passport, Sign, Collect, Deadlines, Facts, Settings. */
  short: string;
  /** What it does, in one line. */
  line: string;
  href: string;
  icon: IconName;
  /** Why it can't be used yet here (the gate that's closed), or its limit ("View only"), or null when it works. Shown as it is. */
  tag: string | null;
  /** The tool's page refuses what it's for here: Home draws it as a dashed square. "View only" (Business facts) still opens and shows. */
  closed: boolean;
}

/**
 * Every tool, each a real page (agents/shipshape/tools-inventory-20261102.md). A tool behind a gate stays on the list
 * with that gate's honest state, worked out from the same checks the pages and actions enforce: nothing is promised
 * that the page then refuses.
 */
export function appTools(ctx: Pick<Ctx, "demo" | "role">): Tool[] {
  const realOpen = !ctx.demo && realDocsEnabled();
  const review = "Opens after our security review";
  const tools: Omit<Tool, "closed">[] = [
    { id: "documents", name: "Documents", short: "Documents", line: "Every document with its versions, dates and history.", href: "/app/documents", icon: "documents", tag: null },
    {
      id: "add",
      name: "Add a document",
      short: "Add",
      line: "Upload a PDF, PNG or JPEG, up to 4 MB.",
      href: "/app/documents/new",
      icon: "add",
      tag: ctx.demo ? "Not in the sample" : realOpen ? null : review,
    },
    {
      id: "make",
      name: "Make a document",
      short: "Make",
      line: "A W-9 or a mutual NDA, filled from your business facts.",
      href: "/app/make",
      icon: "make",
      tag: ctx.demo || realOpen ? null : review,
    },
    {
      id: "check",
      name: "Check a request",
      short: "Check",
      line: "Paste what a customer asked for; see what you have.",
      href: "/app/ask",
      icon: "check",
      // With AI off it checks by document names (ledger 461), so it's never closed.
      tag: null,
    },
    { id: "passport", name: "Passport", short: "Passport", line: "One link with exactly the documents you pick.", href: "/app/passport", icon: "passport", tag: null },
    {
      id: "sign",
      name: "Ask to sign",
      short: "Sign",
      line: "Open a document, then send it for an e-signature.",
      href: "/app/documents",
      icon: "sign",
      tag: esignAvailable(ctx) ? null : "Opens once ShipShape can send email",
    },
    {
      id: "collect",
      name: "Collect",
      short: "Collect",
      line: "Ask vendors for their W-9s and certificates.",
      href: "/app/collect",
      icon: "collect",
      tag: collectOpen(ctx) ? null : "Not open yet",
    },
    { id: "deadlines", name: "Deadlines", short: "Deadlines", line: "Every expiry and renewal date, in one list.", href: "/app/deadlines", icon: "deadlines", tag: null },
    {
      id: "facts",
      name: "Business facts",
      short: "Facts",
      line: "Legal name, address and EIN, confirmed once.",
      href: "/app/facts",
      icon: "facts",
      tag: ctx.demo || ctx.role === "member" || !realDocsEnabled() ? "View only" : null,
    },
    { id: "settings", name: "Settings", short: "Settings", line: "Workspace, plan, export and your account.", href: "/app/settings", icon: "settings", tag: null },
  ];
  return tools.map((t) => ({ ...t, closed: t.tag !== null && t.id !== "facts" }));
}
