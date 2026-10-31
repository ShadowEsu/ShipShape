"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AI_REQUEST_CONSENT_TEXT, AI_REQUEST_MAX_CHARS } from "@/lib/ai";
import type { RequestItem } from "@/lib/server/ai";
import { askAction, type AskState } from "./actions";

const STATE: Record<RequestItem["state"], { label: string; cls: string; icon: string }> = {
  ready: { label: "You have it", cls: "bg-ok-soft text-ok", icon: "✓" },
  expiring: { label: "Expires soon", cls: "bg-warn-soft text-warn", icon: "◷" },
  expired: { label: "Expired", cls: "bg-bad-soft text-bad", icon: "!" },
  missing: { label: "Not in your documents", cls: "bg-bad-soft text-bad", icon: "✕" },
  unmatched: { label: "Check this one yourself", cls: "bg-canvas text-ink-2", icon: "?" },
};

export function AskForm() {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {});
  const items = state.items;
  // The best current match of each item, once: what a passport link for this request would hold.
  const linkIds = [...new Set((items ?? []).flatMap((i) => (i.state === "ready" || i.state === "expiring" ? [i.matches[0].id] : [])))];

  return (
    <div className="space-y-8">
      <form action={action} className="card space-y-4">
        <div>
          <label htmlFor="text" className="label">
            The request
          </label>
          <textarea
            id="text"
            name="text"
            required
            minLength={20}
            maxLength={AI_REQUEST_MAX_CHARS}
            rows={9}
            defaultValue={state.text}
            placeholder={"e.g. Before your first job we need: a W-9, a certificate of insurance naming Northwind Builders as additional insured, and a copy of your contractor license."}
            className="input font-normal"
          />
          <p className="mt-1 text-xs text-ink-3">The email or checklist that asks for your documents. Up to {AI_REQUEST_MAX_CHARS.toLocaleString("en-US")} characters.</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            value="yes"
            aria-required="true"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "ask-error" : undefined}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          />
          <span>{AI_REQUEST_CONSENT_TEXT}</span>
        </label>
        {state.error && (
          <p id="ask-error" role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {state.error}
          </p>
        )}
        <button className="btn-accent" disabled={pending}>
          {pending ? "Reading…" : "Read the request"}
        </button>
      </form>

      {items && (
        <section aria-labelledby="result-title" aria-live="polite" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="result-title" className="font-serif text-2xl font-semibold">
              {items.length === 0 ? "No documents asked for" : `They're asking for ${items.length} ${items.length === 1 ? "document" : "documents"}`}
            </h2>
            <p className="text-sm text-ink-3">Draft from AI, not legal advice. Check it against the request.</p>
          </div>
          {items.length === 0 ? (
            <p className="card text-sm text-ink-2">The AI didn&apos;t find a request for documents in that text.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {items.map((item, n) => {
                const s = STATE[item.state];
                return (
                  <li key={n} className="space-y-2 px-4 py-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <span className="min-w-0 font-medium">{item.label}</span>
                      <span className={`shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                        <span aria-hidden="true">{s.icon} </span>
                        {s.label}
                      </span>
                    </div>
                    {item.quote && (
                      <p className="text-sm text-ink-3">
                        &ldquo;{item.quote}&rdquo;
                        {item.traced === false && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">Not found in the request</span>}
                      </p>
                    )}
                    {item.matches.length > 0 && (
                      <ul className="flex flex-wrap gap-2 text-sm">
                        {item.matches.map((m) => (
                          <li key={m.id}>
                            <Link href={`/app/documents/${m.id}`} className="underline">
                              {m.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.state === "missing" && (
                      <p className="text-sm">
                        <Link href={item.kind === "w9" ? "/app/make/irs-w9" : item.kind === "nda" ? "/app/make/common-paper-mnda" : "/app/documents/new"} className="underline">
                          {item.kind === "w9" || item.kind === "nda" ? "Make it now" : "Add it"}
                        </Link>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {linkIds.length > 0 && (
            <Link href={`/app/passport?docs=${linkIds.join(",")}`} className="btn-ghost">
              Make a passport link with the {linkIds.length} {linkIds.length === 1 ? "document" : "documents"} you have
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
