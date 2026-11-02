"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Tool } from "@/lib/server/tools";

/** How many tiles the phone shows before "All 10 tools". */
const PHONE_FIRST = 4;

/** Every tool as a tile: 5 across on desktop; on the phone 2 across, the first 4, then the rest on request. */
export function ToolGrid({ tools }: { tools: readonly Tool[] }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  return (
    <>
      <ul ref={list} className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tools.map((t, n) => (
          <li key={t.id} data-tool={t.id} style={{ "--i": n }} className={n >= PHONE_FIRST && !all ? "hidden md:block" : undefined}>
            <Link href={t.href} className="tile press">
              <span className="tile-icon">
                <Icon name={t.icon} />
              </span>
              <span>
                <span className="block text-[15px] leading-5 font-semibold text-ink">{t.name}</span>
                <span className="mt-1 block text-[13px] leading-[18px] text-ink-3">{t.line}</span>
              </span>
              {t.tag && <span className="tag mt-auto">{t.tag}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {!all && (
        <button
          type="button"
          className="btn-ghost press w-full md:hidden"
          onClick={() => {
            setAll(true);
            // The first tile that just appeared takes focus, so the keyboard carries on where the list grew.
            requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>("a.tile")[PHONE_FIRST]?.focus());
          }}
        >
          All {tools.length} tools
        </button>
      )}
    </>
  );
}
