"use client";

import { useEffect } from "react";
import { markDeadlinesSeen } from "./start-actions";

/** Rendered on Deadlines only while a sample's third Start-here step is open: ticks it once, draws nothing. */
export function DeadlinesSeen() {
  useEffect(() => {
    void markDeadlinesSeen();
  }, []);
  return null;
}
