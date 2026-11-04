"use client";

import Link from "next/link";
import { type Ref, useActionState, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { NOT_A_LAW_FIRM } from "@/components/ui";
import { AI_REQUEST_CONSENT_TEXT, AI_REQUEST_MAX_CHARS, AI_TRAINING_SOURCE } from "@/lib/ai";
import { looksLikeRequest, routeFor, type Destination } from "@/lib/home-route";
import type { Tool } from "@/lib/server/tools";
import { askAction, type AskState } from "./ask/actions";
import { RequestAnswer } from "./ask/answer";

// The two documents Make fills, as the box offers them when they're named.
const TEMPLATES = {
  "irs-w9": { name: "Make a W-9", line: "The official IRS form, filled from your business facts.", href: "/app/make/irs-w9" },
  "common-paper-mnda": { name: "Make a mutual NDA", line: "Common Paper's mutual NDA, cover page filled for you.", href: "/app/make/common-paper-mnda" },
} as const;

type Answer = { kind: "tool"; tool: Tool; name: string; line: string; href: string } | { kind: "none" } | { kind: "ai-off" } | { kind: "check" };

/** What the box does with this text: check it as a request (AI on, and it reads like one), say AI is off, or find a tool. */
const modeOf = (text: string, aiOn: boolean) => (looksLikeRequest(text) ? (aiOn ? "check" : "ai-off") : "find");

/**
 * Home's box (Design spec 2026-11-02 §3; BOSS 01:2x): it finds the right tool, or checks a pasted request against the
 * vault with the existing "What are they asking for?" reading. Nothing else: no advice, no thread. Each answer replaces
 * the last. Finding a tool happens in the browser from the words; only checking a request sends text, after its box is
 * ticked. This holds the state; AiBoxView draws it.
 */
export function AiBox({ tools, aiOn }: { tools: readonly Tool[]; aiOn: boolean }) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Each submission gets a new card (its key), so it replaces the last one and arrives again instead of changing in place.
  const [round, setRound] = useState(0);
  const [check, runCheck, pending] = useActionState<AskState, FormData>(askAction, {});
  const [slow, setSlow] = useState(false);
  const result = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // While a check runs (about 2 s), the button says what's happening, in two stages.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 1200);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);
  // A new answer takes focus, so it's read out and the keyboard lands on its action. A refused check (consent not
  // ticked, text too short) draws no answer, so focus goes to the field it marked instead of being lost.
  useEffect(() => {
    if (pending) return;
    const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? result.current)?.focus();
  }, [answer, check, pending]);

  const toolFor = (d: Destination): Answer => {
    const tool = tools.find((t) => t.id === d.tool);
    if (!tool) return { kind: "none" };
    if ("template" in d) return { kind: "tool", tool, ...TEMPLATES[d.template] };
    return { kind: "tool", tool, name: tool.name, line: tool.line, href: tool.href };
  };

  const submit = (form: FormData) => {
    setRound((r) => r + 1);
    const mode = modeOf(text, aiOn);
    if (mode === "check") {
      setAnswer({ kind: "check" });
      runCheck(form);
      return;
    }
    if (mode === "ai-off") return setAnswer({ kind: "ai-off" });
    const d = routeFor(text);
    setAnswer(d ? toolFor(d) : { kind: "none" });
  };

  return (
    <AiBoxView
      text={text}
      aiOn={aiOn}
      onText={setText}
      onSubmit={submit}
      answer={answer}
      check={check}
      pending={pending}
      stage={slow ? "Matching your documents…" : "Reading the request…"}
      round={round}
      resultRef={result}
      formRef={form}
    />
  );
}

/**
 * The box as drawn from its state. It decides from the text alone whether this is a check, and a check always shows
 * the consent tick with the not-a-law-firm line (Security MUST-L1), so no caller can show one without the other.
 */
export function AiBoxView({
  text,
  aiOn,
  onText = () => {},
  onSubmit = () => {},
  answer = null,
  check = {},
  pending = false,
  stage = "",
  round = 0,
  resultRef,
  formRef,
}: {
  text: string;
  aiOn: boolean;
  onText?: (text: string) => void;
  onSubmit?: (form: FormData) => void;
  answer?: Answer | null;
  check?: AskState;
  pending?: boolean;
  stage?: string;
  round?: number;
  resultRef?: Ref<HTMLElement>;
  formRef?: Ref<HTMLFormElement>;
}) {
  const ids = useId();
  const mode = modeOf(text, aiOn);
  const checking = mode === "check";
  const filled = text.trim().length > 0;
  const textError = answer?.kind === "check" && check.field === "text" ? check.error : undefined;
  const consentError = answer?.kind === "check" && check.field === "consent" ? check.error : undefined;
  const items = answer?.kind === "check" && !pending ? check.items : undefined;
  const refused = answer?.kind === "check" && !pending && !check.field ? check.error : undefined;

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3">
      <form ref={formRef} action={onSubmit}>
        {/* One line that grows with what's typed (field-sizing), with no mic: the box finds a tool or checks a request. */}
        <div className="prompt">
          <span className="prompt-orb" aria-hidden="true" />
          <textarea
            name="text"
            rows={1}
            value={text}
            onChange={(e) => onText(e.target.value)}
            maxLength={AI_REQUEST_MAX_CHARS}
            aria-labelledby="home-title"
            aria-describedby={textError ? `${ids}-text-error` : undefined}
            aria-invalid={textError ? true : undefined}
            placeholder="Paste what a customer asked for, or say what you need to do."
            className="prompt-field"
          />
          <button
            disabled={!filled || pending}
            aria-label={pending ? stage : checking ? "Check this request" : "Find the right tool"}
            className="prompt-send press"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
        <span className="sr-only" aria-live="polite">
          {checking ? "Check a request" : mode === "ai-off" ? "AI is off; pick a tool below" : "Finds the right tool"}
        </span>
        {textError && (
          <p id={`${ids}-text-error`} className="mt-2 px-2 text-sm text-bad">
            {textError}
          </p>
        )}
        {mode === "ai-off" && <p className="mt-2 px-2 text-[13px] text-ink-2">AI is off right now, so it can&apos;t check a request. Pick a tool below.</p>}
        {checking && <RequestConsent id={ids} defaultChecked={check.consent} error={consentError} />}
      </form>
      {/* Always mounted, so the stage is announced when it appears (a live region added with its text can be missed). */}
      <p className={pending && answer?.kind === "check" ? "text-center text-sm text-ink-2" : "sr-only"} role="status">
        {pending && answer?.kind === "check" ? stage : ""}
      </p>

      {answer && !pending && !textError && !consentError && (
        <section key={round} ref={resultRef} tabIndex={-1} aria-label="Answer" className="arrive card space-y-4 outline-none">
          {answer.kind === "tool" && (
            <div className="flex flex-wrap items-center gap-4">
              <span className="row-icon">
                <Icon name={answer.tool.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{answer.name}</span>
                <span className="block text-sm text-ink-3">{answer.line}</span>
                {answer.tool.tag && <span className="mt-2 block text-[13px] text-ink-3">{answer.tool.tag}</span>}
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
          {items && <RequestAnswer items={items} titleId={`${ids}-answer-title`} />}
        </section>
      )}
    </div>
  );
}

/**
 * The tick that lets one check send the request to the model, with where that claim comes from and the
 * not-a-law-firm line beside it, at the same size (Security MUST-L1, 3 Nov). Shown only while the box will check.
 */
function RequestConsent({ id, defaultChecked, error }: { id: string; defaultChecked?: boolean; error?: string }) {
  return (
    <div className="mt-3.5 space-y-1.5 px-1">
      <label className="flex items-start gap-3 text-[13px] leading-[19px] text-ink-2">
        <input
          type="checkbox"
          name="consent"
          value="yes"
          // Per check, as /app/ask: the server sends the tick back only with a refusal about something else (W10-7),
          // never after a completed check, so React's reset after each check leaves the box unticked (Security SHOULD-V2a).
          defaultChecked={defaultChecked}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-source${error ? ` ${id}-consent-error` : ""}`}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>{AI_REQUEST_CONSENT_TEXT}</span>
      </label>
      <p id={`${id}-source`} className="pl-7 text-xs text-ink-3">
        Source:{" "}
        <a href={AI_TRAINING_SOURCE.href} target="_blank" rel="noopener noreferrer" className="underline">
          {AI_TRAINING_SOURCE.label}
        </a>
        , checked {AI_TRAINING_SOURCE.checked}.
      </p>
      {error && (
        <p id={`${id}-consent-error`} className="pl-7 text-sm text-bad">
          {error}
        </p>
      )}
      <p className="pl-7 text-[13px] leading-[19px] text-ink-2">{NOT_A_LAW_FIRM}</p>
    </div>
  );
}
