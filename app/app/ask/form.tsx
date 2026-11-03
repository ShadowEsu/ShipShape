"use client";

import { useActionState, useEffect, useRef } from "react";
import { NOT_A_LAW_FIRM } from "@/components/ui";
import { AI_REQUEST_CONSENT_TEXT, AI_REQUEST_MAX_CHARS, AI_TRAINING_SOURCE } from "@/lib/ai";
import { askAction, type AskState } from "./actions";
import { RequestAnswer } from "./answer";

/**
 * `v2`: the redesigned app (Design 02 Nov, PR 8): the request in a --tile well and the consent as a checkbox row, no card;
 * "Read the request" stays green (--brand marks the one action that sends text to the model). Same action, words and
 * consent behaviour in both looks.
 */
export function AskForm({ v2 = false }: { v2?: boolean }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {});
  const items = state.items;
  const form = useRef<HTMLFormElement>(null);
  const textError = state.field === "text" ? state.error : undefined;
  const consentError = state.field === "consent" ? state.error : undefined;
  const formError = state.field ? undefined : state.error;

  // After a refused read, the thing to fix gets focus.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);

  return (
    <div className="space-y-8">
      <form ref={form} action={action} className={v2 ? "space-y-4" : "card space-y-4"}>
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
            className={v2 ? "request-well" : "input font-normal"}
            aria-invalid={textError ? true : undefined}
            aria-describedby={textError ? "text-error text-hint" : "text-hint"}
          />
          {textError && (
            <p id="text-error" className="mt-1 text-sm text-bad">
              {textError}
            </p>
          )}
          <p id="text-hint" className="mt-1 text-xs text-ink-3">
            The email or checklist that asks for your documents. Up to {AI_REQUEST_MAX_CHARS.toLocaleString("en-US")} characters.
          </p>
        </div>
        {v2 ? (
          <ul className="group-list plain">
            <li>
              <label className="group-row cursor-pointer items-start gap-3 hover:bg-tile">
                <span className="min-w-0 flex-1 text-[15px]">{AI_REQUEST_CONSENT_TEXT}</span>
                <input
                  type="checkbox"
                  name="consent"
                  value="yes"
                  defaultChecked={state.consent}
                  aria-required="true"
                  aria-invalid={consentError ? true : undefined}
                  aria-describedby={consentError ? "consent-error consent-source" : "consent-source"}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
                />
              </label>
            </li>
          </ul>
        ) : (
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="consent"
              value="yes"
              defaultChecked={state.consent}
              aria-required="true"
              aria-invalid={consentError ? true : undefined}
              aria-describedby={consentError ? "consent-error consent-source" : "consent-source"}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            <span>{AI_REQUEST_CONSENT_TEXT}</span>
          </label>
        )}
        <p id="consent-source" className="text-xs text-ink-3">
          Source:{" "}
          <a href={AI_TRAINING_SOURCE.href} target="_blank" rel="noopener noreferrer" className="underline">
            {AI_TRAINING_SOURCE.label}
          </a>
          , checked {AI_TRAINING_SOURCE.checked}.
        </p>
        {/* Beside the tick that sends the request, as on Home's box (Security MUST-L1, L5). */}
        <p className="text-[13px] leading-[19px] text-ink-2">{NOT_A_LAW_FIRM}</p>
        {consentError && (
          <p id="consent-error" className="text-sm text-bad">
            {consentError}
          </p>
        )}
        {formError && (
          <p role="alert" tabIndex={-1} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {formError}
          </p>
        )}
        <button className={v2 ? "btn-accent press" : "btn-accent"} disabled={pending}>
          {pending ? "Reading…" : "Read the request"}
        </button>
      </form>

      {items && (
        <section aria-labelledby="result-title" aria-live="polite">
          <RequestAnswer items={items} titleId="result-title" v2={v2} />
        </section>
      )}
    </div>
  );
}
