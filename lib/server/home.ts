import "server-only";
import { listVendors } from "./collect";
import { asUser } from "./db";
import { collectOpen } from "./flags";
import type { Ctx } from "./profile";

/** A signature request still out: who it went to (the name the owner typed) and for which document. */
export interface WaitingSignature {
  id: string;
  documentId: string;
  title: string;
  signerName: string;
  sentAt: string;
}

/** A Collect vendor who hasn't sent everything asked for, or whose copy has lapsed. */
export interface WaitingVendor {
  id: string;
  name: string;
  /** What's outstanding, in the order it was asked for, as one sentence: "W-9 missing", "insurance certificate lapsed". */
  outstanding: string[];
}

export interface Waiting {
  signatures: WaitingSignature[];
  vendors: WaitingVendor[];
}

/** How many of each Home's "Waiting on others" lists. */
export const WAITING_MAX = 3;
/** How many of the person's newest saves Home's "Saved" shows (View all opens the rest). */
export const SAVED_MAX = 3;

// Open requests on documents still in the workspace (an archived document's requests are withdrawn, and never come back
// here: Security S5). The signer's name is the one the owner typed; the email stays on the document's page (S4).
const PENDING_SQL = `
  select s.id, s.document_id, d.title, s.signer_name, s.created_at::text as sent_at
  from app.signature_requests s
  join app.documents d on d.id = s.document_id and d.org_id = s.org_id
  where s.org_id = $1 and s.status = 'pending' and s.expires_at > now() and d.status = 'active'
  order by s.created_at desc, s.id
  limit $2`;

/**
 * Home's "Waiting on others": signature requests nobody has signed yet, newest first, then the vendors who still owe a
 * document, A to Z. Read as the signed-in member under row level security, so a workspace sees only its own (S1); the
 * vendors only while Collect is open here, as the Collect page itself.
 */
export async function waitingOnOthers(ctx: Ctx): Promise<Waiting> {
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query<{ id: string; document_id: string; title: string; signer_name: string; sent_at: string }>(PENDING_SQL, [ctx.orgId, WAITING_MAX]),
  );
  const signatures = rows.map((r) => ({ id: r.id, documentId: r.document_id, title: r.title, signerName: r.signer_name, sentAt: r.sent_at }));
  const vendors: WaitingVendor[] = [];
  if (collectOpen(ctx)) {
    for (const v of await listVendors(ctx)) {
      const outstanding = v.items.flatMap((i) => (i.state === "missing" ? [`${i.label} missing`] : i.state === "expired" ? [`${i.label} lapsed`] : []));
      // Read as one sentence: "W-9 missing, insurance certificate lapsed". A name that starts with an acronym (W-9, NDA) keeps it.
      const sentence = outstanding.map((s, n) => (n > 0 && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s));
      if (sentence.length > 0) vendors.push({ id: v.id, name: v.name, outstanding: sentence });
      if (vendors.length === WAITING_MAX) break;
    }
  }
  return { signatures, vendors };
}
