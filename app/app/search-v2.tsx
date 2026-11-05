"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { findByName, type SearchTool } from "@/components/app-sections";
import { Icon } from "@/components/icons";
import { searchAction, searchPeopleAction, type SearchHit } from "./search-actions";

/** How long typing pauses before the documents are asked for. */
const PAUSE_MS = 150;

/**
 * ⌘K: one field that finds a tool or a page by its name (in the browser), and the workspace's documents by their words
 * and its people by name or company (the server, under row level security). Up and Down move between the results,
 * Enter opens the first, Escape closes. The full list is one link away: Documents with the same words. With nothing
 * typed it lists the tools; the pages (every destination the sidebar and the tab bar have) come up by name.
 */
export function SearchDialog({ open, tools, pages }: { open: React.RefObject<HTMLDialogElement | null>; tools: readonly SearchTool[]; pages: readonly SearchTool[] }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ q: string; rows: SearchHit[]; people: SearchHit[] }>({ q: "", rows: [], people: [] });
  const [pending, startTransition] = useTransition();
  const asked = useRef("");
  const list = useRef<HTMLDivElement>(null);
  const words = q.trim();

  useEffect(() => {
    open.current?.close();
  }, [path, open]);

  useEffect(() => {
    if (words === "") return;
    const t = setTimeout(() => {
      asked.current = words;
      startTransition(async () => {
        const [rows, people] = await Promise.all([searchAction(words), searchPeopleAction(words)]);
        // Only the latest question's answer is shown; an earlier, slower one is dropped.
        if (asked.current === words) setHits({ q: words, rows, people });
      });
    }, PAUSE_MS);
    return () => clearTimeout(t);
  }, [words]);

  const toolHits = words === "" ? tools : findByName(tools, words);
  const pageHits = findByName(pages, words);
  const docs = hits.q === words ? hits.rows : [];
  const people = hits.q === words ? hits.people : [];
  const waiting = words !== "" && (pending || hits.q !== words);
  const status = words === "" ? "" : waiting ? "Searching…" : `${toolHits.length + pageHits.length + docs.length + people.length} found`;

  // Arrow keys walk the result links in order, from the field into the list and back.
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-hit]") ?? [])];
    if (links.length === 0) return;
    e.preventDefault();
    const at = links.findIndex((a) => a === document.activeElement);
    const next = e.key === "ArrowDown" ? (at + 1) % links.length : at <= 0 ? -1 : at - 1;
    if (next === -1) document.getElementById("search-field")?.focus();
    else links.at(next)?.focus();
  };

  return (
    <dialog
      ref={open}
      id="search-dialog"
      aria-label="Search"
      className="search-dialog fixed inset-x-0 top-0 m-0 w-full max-w-none bg-paper p-0 text-ink backdrop:bg-black/20 md:top-[20vh] md:mx-auto md:w-[640px] md:rounded-xl md:border md:border-line md:shadow-[var(--pop)]"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target instanceof Element && e.target.closest("a[href]"))) e.currentTarget.close();
      }}
      onClose={() => setQ("")}
      onKeyDown={move}
    >
      <form
        role="search"
        className="flex items-center gap-2 border-b border-line pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          const first = list.current?.querySelector<HTMLAnchorElement>("a[data-hit]");
          if (first) router.push(first.getAttribute("href") ?? "/app");
        }}
      >
        <Icon name="search" size={18} className="shrink-0 text-ink-3" />
        <input
          id="search-field"
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          aria-label="Search documents, people and tools"
          aria-describedby="search-status"
          placeholder="Search documents, people and tools"
          className="min-h-13 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        />
        <button type="button" onClick={() => open.current?.close()} className="grid size-11 shrink-0 place-items-center text-ink-3" aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </form>
      <p id="search-status" role="status" className="sr-only">
        {status}
      </p>
      <div ref={list} className="max-h-[60vh] overflow-y-auto p-2">
        {toolHits.length > 0 && (
          <section aria-labelledby="search-tools">
            <h2 id="search-tools" className="px-2 pt-1 pb-1.5 text-xs text-ink-3">
              Tools
            </h2>
            <ul>
              {toolHits.map((t) => (
                <li key={t.href + t.name}>
                  <Link href={t.href} data-hit="" className="search-row">
                    <span className="row-icon">
                      <Icon name={t.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.tag && <span className="shrink-0 text-xs text-ink-3">{t.tag}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {pageHits.length > 0 && (
          <section aria-labelledby="search-pages" className="mt-1">
            <h2 id="search-pages" className="px-2 pt-1 pb-1.5 text-xs text-ink-3">
              Pages
            </h2>
            <ul>
              {pageHits.map((t) => (
                <li key={t.href + t.name}>
                  <Link href={t.href} data-hit="" className="search-row">
                    <span className="row-icon">
                      <Icon name={t.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {words !== "" && (
          <section aria-labelledby="search-docs" className="mt-1">
            <h2 id="search-docs" className="px-2 pt-1 pb-1.5 text-xs text-ink-3">
              Documents
            </h2>
            {docs.length > 0 ? (
              <ul>
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/documents/${d.id}`} data-hit="" className="search-row">
                      <span className="row-icon">
                        <Icon name="documents" size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{d.title}</span>
                        <span className="block truncate text-xs text-ink-3">{d.line}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-2 text-sm text-ink-3">{waiting ? "Searching…" : "No documents match these words."}</p>
            )}
            <Link href={`/app/documents?q=${encodeURIComponent(words)}`} data-hit="" className="search-row text-ink-2">
              <span className="row-icon">
                <Icon name="search" size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate">See every match in Documents</span>
            </Link>
          </section>
        )}
        {people.length > 0 && (
          <section aria-labelledby="search-people" className="mt-1">
            <h2 id="search-people" className="px-2 pt-1 pb-1.5 text-xs text-ink-3">
              People
            </h2>
            <ul>
              {people.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/people/${p.id}`} data-hit="" className="search-row">
                    <span className="row-icon">
                      <Icon name="people" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.title}</span>
                      {p.line && <span className="block truncate text-xs text-ink-3">{p.line}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </dialog>
  );
}
