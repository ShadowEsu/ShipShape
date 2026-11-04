"use client";

import { useEffect, useState } from "react";
import type { DocRow } from "@/lib/server/documents";
import { ARCHIVED_ID, TITLE_ID } from "./shared";

/** What the page says once Restore has brought the document back (Design 05:33: visible, where the Archived block was). */
export const RESTORED_TEXT = "Restored. It's back in Documents and can be shared again.";

/**
 * After Archive (in the More menu) or Restore, the control that was pressed is gone with the menu or the block, and focus
 * would drop to the page. Once the page comes back with the other status, focus moves to what replaced it, the Archived
 * block or the page heading (both tabIndex -1), and an always-there status says what happened: read out after Archive (the
 * Archived block itself shows it), and shown too after Restore, where the Archived block was. A first load says nothing.
 */
export function StatusLanding({ status }: { status: DocRow["status"] }) {
  const [shown, setShown] = useState(status);
  // The status this page changed to while open; null until it changes.
  const [changed, setChanged] = useState<DocRow["status"] | null>(null);
  if (shown !== status) {
    setShown(status);
    setChanged(status);
  }
  useEffect(() => {
    if (changed) document.getElementById(changed === "archived" ? ARCHIVED_ID : TITLE_ID)?.focus();
  }, [changed]);
  const restored = changed === "active";
  return (
    <p role="status" className={restored ? "text-sm text-ink-2" : "sr-only"}>
      {changed === "archived" ? "Document archived." : restored ? RESTORED_TEXT : ""}
    </p>
  );
}
