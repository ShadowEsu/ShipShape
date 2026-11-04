"use client";

import { useEffect, useState } from "react";
import type { DocRow } from "@/lib/server/documents";
import { ARCHIVED_ID, TITLE_ID } from "./shared";

/**
 * After Archive (in the More menu) or Restore, the control that was pressed is gone with the menu or the block, and focus
 * would drop to the page. Once the page comes back with the other status, focus moves to what replaced it, the Archived
 * block or the page heading (both tabIndex -1), and an always-there status says what happened. A first load says nothing.
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
  return (
    <p role="status" className="sr-only">
      {changed === "archived" ? "Document archived." : changed === "active" ? "Document restored." : ""}
    </p>
  );
}
