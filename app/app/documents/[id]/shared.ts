import { PLANS } from "@/lib/plans";
import { FACT_LABELS } from "@/lib/profile-fields";
import type { SignatureRequestRow } from "@/lib/server/esign";
import type { TemplateInfo } from "@/lib/templates/types";

// The words the document page uses, in both looks (v2.tsx by default, page.tsx's own under SHIPSHAPE_UI=v1).

/** What went wrong in a form posted from this page (see backToDocument in ../actions.ts), and the one thing that fixes it. */
export const ERRORS: Record<string, { text: string; fix?: { href: string; label: string } }> = {
  limit: {
    text: `The Free plan holds ${PLANS.free.documents} active documents, so this one stays archived. Archive another one, then restore this one.`,
    fix: { href: "/app/documents", label: "Choose one to archive" },
  },
  // Nothing to fix: the request's status below is already up to date.
  closed: { text: "That signing request was already signed or withdrawn, so there was nothing to withdraw. Its status is under Signatures." },
};

export const REQUEST_STATUS: Record<SignatureRequestRow["status"], string> = {
  pending: "Waiting",
  signed: "Signed",
  declined: "Declined",
  revoked: "Withdrawn",
};

const SOURCE: Record<string, string> = {
  facts: "Business facts",
  facts_edited: "Business facts, edited",
  typed: "Typed",
  typed_not_saved: "Typed, not saved",
  typed_saved: "Typed, saved to Business facts",
};

// A non-breaking space keeps "1 KB" on one line at 390 wide (Design).
export const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}\u00A0MB` : `${Math.max(1, Math.round(n / 1024))}\u00A0KB`);

/**
 * Each filled field with the label the form showed, in the form's order: the stored record's keys
 * come back from jsonb sorted by length, and a key like `tin_kind` means nothing on its own.
 */
export function fieldSources(fields: Record<string, string>, template: TemplateInfo | undefined) {
  const defs = template?.fields ?? [];
  const rank = (key: string) => {
    const i = defs.findIndex((f) => f.key === key);
    return i === -1 ? defs.length : i;
  };
  return Object.entries(fields)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, src]) => ({
      key,
      label: defs.find((f) => f.key === key)?.label ?? FACT_LABELS[key] ?? key.replaceAll("_", " "),
      source: SOURCE[src] ?? src,
    }));
}
