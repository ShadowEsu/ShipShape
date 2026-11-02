import { ViewTransition } from "react";
import { uiV2 } from "@/lib/server/flags";

/**
 * Moving between the app's pages (Design spec 2026-11-02 §6.1): in the redesigned app the old page leaves in 150ms and
 * the new one fades up 8px in 240ms (app/motion.css `.v2-page`); the shell around it stays still. A template remounts
 * on every navigation between pages, so its boundary enters and exits. Off, it adds nothing.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  if (!uiV2()) return children;
  return (
    <ViewTransition enter="v2-page" exit="v2-page" default="none">
      {children}
    </ViewTransition>
  );
}
