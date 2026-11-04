"use client";

// Glisse's stylesheet comes in the app's own CSS bundle (a 'self' stylesheet). Its runtime copy would be an inline
// <style> the CSP blocks; the root layout's empty nonce'd #glisse-styles tells Glisse it's already there (Security,
// glisse 0.5.0 review, 4 Nov).
import "glisse/styles.css";
import { Glass, TabBar } from "glisse";
import Link from "next/link";
import { createContext, useContext } from "react";
import type { GlassLevel } from "@/lib/server/flags";

const Level = createContext<GlassLevel>("off");

/** The shell's glass level, for the client parts that draw it. */
export function GlassProvider({ level, children }: { level: GlassLevel; children: React.ReactNode }) {
  return <Level value={level}>{children}</Level>;
}

export function useGlass(): GlassLevel {
  return useContext(Level);
}

const shows = (level: GlassLevel, from: "subtle" | "full") => level === "full" || (level === "subtle" && from === "subtle");

/**
 * Glisse's glass laid behind a surface's own content (its parent is positioned and isolated): the surface keeps its
 * markup, roles and size, and only its fill changes. Nothing at all when the level doesn't reach it.
 */
export function GlassPane({ from = "subtle" }: { from?: "subtle" | "full" }) {
  const level = useGlass();
  return shows(level, from) ? <Glass aria-hidden="true" className="glass-pane" /> : null;
}

/** A list or card container that turns to glass at full: the same list in a frame holding the pane. Unchanged below full. */
export function GlassFrame({ children }: { children: React.ReactNode }) {
  const level = useGlass();
  if (level !== "full") return children;
  return (
    <div className="glass-frame">
      <Glass aria-hidden="true" className="glass-pane" />
      {children}
    </div>
  );
}

export interface GlassTab {
  href: string;
  label: React.ReactNode;
}

/**
 * A row of tabs that are links, as Glisse's tab bar: still links in a navigation landmark (the current one marked
 * aria-current), so they work without script. A segmented control would make each tab a radio that navigates.
 */
export function GlassTabs({ label, tabs, current }: { label: string; tabs: readonly GlassTab[]; current: string | null }) {
  return (
    <TabBar
      aria-label={label}
      className="glass-tabs"
      link={Link}
      items={tabs.map((t) => ({ value: t.href, label: t.label, href: t.href }))}
      value={current}
    />
  );
}
