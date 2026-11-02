"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { AI_REQUEST_CONSENT_TEXT, AI_REQUEST_MAX_CHARS, AI_TRAINING_SOURCE } from "@/lib/ai";
import { looksLikeRequest, routeFor, type Destination } from "@/lib/home-route";
import type { Tool } from "@/lib/server/tools";
import { askAction, type AskState } from "./ask/actions";
import { currentMatchIds, RequestItemBody } from "./ask/form";

// The two documents Make fills, as the box offers them when they're named.
const TEMPLATES = {
  "irs-w9": { name: "Make a W-9", line: "The official IRS form, filled from your business facts.", href: "/app/make/irs-w9" },
  "common-paper-mnda": { name: "Make a mutual NDA", line: "Common Paper's mutual NDA, cover page filled for you.", href: "/app/make/common-paper-mnda" },
} as const;

type Answer = { kind: "tool"; tool: Tool; name: string; line: string; href: string } | { kind: "none" } | { kind: "ai-off" } | { kind: "check" };

/**
 * Home's box (Design spec 2026-11-02 §3; BOSS 01:2x): it finds the right tool, or checks a pasted request against the
 * vault with the existing "What are they asking for?" reading. Nothing else: no advice, no thread. Each answer replaces
 * the last. Finding a tool happens in the browser from the words; only checking a request sends text, after its box is ticked.
 */
export function AiBox({ tools, aiOn }: { tools: readonly Tool[]; aiOn: boolean }) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Each submission gets a new card (its key), so it replaces the last one and arrives again instead of changing in place.
  const [round, setRound] = useState(0);
  const [check, runCheck, pending] = useActionState<AskState, FormData>(askAction, {});
  const [slow, setSlow] = useState(false);
  const result = useRef<HTMLElement>(null);
  const ids = useId();
  const isRequest = looksLikeRequest(text);
  const checking = aiOn && isRequest;
  const filled = text.trim().length > 0;

  // While a check runs (about 2 s), the button says what's happening, in two stages.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 1200);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);
  const stage = slow ? "Matching your documents…" : "Reading the request…";
  // A new answer (or a refused check) takes focus, so it's read out and the keyboard lands on its action.
  useEffect(() => {
    result.current?.focus();
  }, [answer, check]);

  const toolFor = (d: Destination): Answer => {
    const tool = tools.find((t) => t.id === d.tool);
    if (!tool) return { kind: "none" };
    if ("template" in d) return { kind: "tool", tool, ...TEMPLATES[d.template] };
    return { kind: "tool", tool, name: tool.name, line: tool.line, href: tool.href };
  };

  const submit = (form: FormData) => {
    setRound((r) => r + 1);
    if (checking) {
      setAnswer({ kind: "check" });
      runCheck(form);
      return;
    }
    if (isRequest) return setAnswer({ kind: "ai-off" });
    const d = routeFor(text);
    setAnswer(d ? toolFor(d) : { kind: "none" });
  };

  const textError = answer?.kind === "check" && check.field === "text" ? check.error : undefined;
  const consentError = answer?.kind === "check" && check.field === "consent" ? check.error : undefined;
  const items = answer?.kind === "check" && !pending ? check.items : undefined;
  const refused = answer?.kind === "check" && !pending && !check.field ? check.error : undefined;
  const linkIds = currentMatchIds(items ?? []);

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-3">
      <form action={submit} className="rounded-3xl border border-line bg-paper p-3 shadow-[0_12px_40px_-24px_rgb(0_0_0/0.35)] focus-within:border-field">
        <textarea
          name="text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={AI_REQUEST_MAX_CHARS}
          aria-labelledby="home-title"
          aria-describedby={`${ids}-hint${textError ? ` ${ids}-text-error` : ""}`}
          aria-invalid={textError ? true : undefined}
          placeholder="Paste what a customer asked for, or say what you need to do."
          className="block w-full resize-none bg-transparent px-2 py-1.5 text-base leading-6 text-ink outline-none placeholder:text-ink-3"
        />
        {textError && (
          <p id={`${ids}-text-error`} className="px-2 text-sm text-bad">
            {textError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 pt-2 pl-1">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${checking ? "bg-accent-soft text-brand" : "bg-tile text-ink-2"}`} aria-live="polite">
            {checking ? "Check a request" : !aiOn && isRequest ? "AI is off; pick a tool below" : "Finds the right tool"}
          </span>
          <button
            disabled={!filled || pending}
            aria-label={pending ? stage : checking ? "Check this request" : "Find the right tool"}
            className="press grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="send" />
          </button>
        </div>
        {checking && (
          <div className="mt-2 space-y-1 border-t border-sep px-2 pt-3">
            <label className="flex items-start gap-3 text-sm text-ink-2">
              <input
                type="checkbox"
                name="consent"
                value="yes"
                aria-required="true"
                aria-invalid={consentError ? true : undefined}
                aria-describedby={`${ids}-source${consentError ? ` ${ids}-consent-error` : ""}`}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span>{AI_REQUEST_CONSENT_TEXT}</span>
            </label>
            <p id={`${ids}-source`} className="pl-7 text-xs text-ink-3">
              Source:{" "}
              <a href={AI_TRAINING_SOURCE.href} target="_blank" rel="noopener noreferrer" className="underline">
                {AI_TRAINING_SOURCE.label}
              </a>
              , checked {AI_TRAINING_SOURCE.checked}.
            </p>
            {consentError && (
              <p id={`${ids}-consent-error`} className="pl-7 text-sm text-bad">
                {consentError}
              </p>
            )}
          </div>
        )}
      </form>
      <p id={`${ids}-hint`} className="text-center text-[13px] leading-[18px] text-ink-3">
        It finds the right tool, or checks a request against your documents. It doesn&apos;t give legal advice.
      </p>
      {pending && answer?.kind === "check" && (
        <p role="status" className="text-center text-sm text-ink-2">
          {stage}
        </p>
      )}

      {answer && !pending && !textError && !consentError && (
        <section key={round} ref={result} tabIndex={-1} aria-label="Answer" className="arrive card space-y-4 outline-none">
          {answer.kind === "tool" && (
            <div data-tool={answer.tool.id} className="flex flex-wrap items-center gap-4">
              <span className="tile-icon">
                <Icon name={answer.tool.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{answer.name}</span>
                <span className="block text-sm text-ink-3">{answer.line}</span>
                {answer.tool.tag && <span className="tag mt-2">{answer.tool.tag}</span>}
              </span>
              <Link href={answer.href} className="btn press">
                Open
              </Link>
            </div>
          )}
          {answer.kind === "none" && (
            <p className="text-sm text-ink-2">
              ShipShape can&apos;t help with that one. Here&apos;s everything it does:{" "}
              <a href="#tools" className="underline">
                the tools
              </a>
              .
            </p>
          )}
          {answer.kind === "ai-off" && (
            <p className="text-sm text-ink-2">
              Reading requests with AI is switched off right now, so check the request against your documents yourself; everything else works as
              usual.{" "}
              <Link href="/app/documents" className="underline">
                Open your documents
              </Link>
            </p>
          )}
          {refused && (
            <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {refused}
            </p>
          )}
          {items && (
            <>
              <h2 className="section-title">
                {items.length === 0 ? "The request doesn't ask for any documents" : `The request asks for ${items.length} ${items.length === 1 ? "document" : "documents"}`}
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-ink-2">
                  The AI didn&apos;t find any documents asked for in that text. If it should have, paste just the part that lists them and check it again.
                </p>
              ) : (
                <ul className="group-list">
                  {items.map((item, n) => (
                    <li key={n} className="space-y-2 px-4 py-3">
                      <RequestItemBody item={item} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-3">Read by AI. Check the important ones.</p>
              {linkIds.length > 0 && (
                <div className="space-y-2">
                  <Link href={`/app/passport?docs=${linkIds.join(",")}`} className="btn btn-block press">
                    {linkIds.length === 1 ? "Share the current one in a link" : `Share the ${linkIds.length} current ones in a link`}
                  </Link>
                  <p className="text-xs text-ink-3">Nothing is sent until you make the link.</p>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
