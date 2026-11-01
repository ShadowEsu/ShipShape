"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

/**
 * A server-action form for a step that can't be undone, in two steps: the first button asks, then a
 * sentence says what will happen, with the button that does it and Cancel. The second step is in the
 * page from the start, hidden, so it needs no round trip. Focus follows: to the sentence when it
 * opens, back to the first button on Cancel.
 */
export function ConfirmForm({
  action,
  fields,
  trigger,
  question,
  confirm,
  pendingLabel,
  compact = false,
}: {
  action: (data: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  trigger: string;
  question: string;
  confirm: string;
  pendingLabel: string;
  /** Small text buttons, for a row in a list. */
  compact?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const moved = useRef(false);
  const first = useRef<HTMLButtonElement>(null);
  const sentence = useRef<HTMLParagraphElement>(null);

  // Only after a click: the page loading doesn't move focus.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (asking ? sentence : first).current?.focus();
  }, [asking]);

  const toggle = (next: boolean) => () => {
    moved.current = true;
    setAsking(next);
  };
  const small = "inline-flex min-h-6 items-center text-xs text-ink-2 underline";

  return (
    <div>
      <button ref={first} type="button" hidden={asking} className={compact ? small : "btn-ghost"} onClick={toggle(true)}>
        {trigger}
      </button>
      <form action={action} hidden={!asking} className="space-y-2">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <p ref={sentence} tabIndex={-1} className={compact ? "text-xs text-ink-2" : "text-sm"}>
          {question}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SubmitButton className={compact ? `${small} font-medium` : "btn"} pendingLabel={pendingLabel}>
            {confirm}
          </SubmitButton>
          <button type="button" className={compact ? small : "btn-ghost"} onClick={toggle(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
