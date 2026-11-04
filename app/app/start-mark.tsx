"use client";

import { useEffect } from "react";
import { START_SEEN_COOKIE } from "@/lib/start-seen";
import { markDeadlinesSeen } from "./start-actions";

/** Rendered on Deadlines only while a sample's third Start-here step is open: ticks it once, draws nothing. */
export function DeadlinesSeen() {
  useEffect(() => {
    void markDeadlinesSeen();
  }, []);
  return null;
}

/**
 * Rendered with a finished Start here: notes in this browser that it was shown, so the next Home leaves it out. Set
 * here, not by the server, so this Home keeps it on screen. As long as a sample session lasts.
 */
export function StartFinishShown() {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${START_SEEN_COOKIE}=1; Path=/app; Max-Age=43200; SameSite=Lax${secure}`;
  }, []);
  return null;
}
