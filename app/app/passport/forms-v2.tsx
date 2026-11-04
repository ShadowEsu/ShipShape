"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { DaysChoice } from "@/components/days-choice";
import { Icon } from "@/components/icons";
import { fmtDay, plusDays } from "@/lib/today";
import { type PassportFormProps, usePassportForm, WhoCanOpen } from "./forms";

const WIDE = "(min-width: 768px)";
const REDUCE = "(prefers-reduced-motion: reduce)";

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1.5 px-1 text-sm text-bad">
      {error}
    </p>
  );
}

/**
 * What was made, what happens next, the one thing to do (copy it), and Done. The same words as PassportReady. No live
 * region: Copy link takes focus when it arrives, which reads it out without saying the whole panel twice.
 */
function Ready({ label, documents, days, url, onDone }: { label: string; documents: number; days: number; url: string; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <h2 id="ready-title" className="section-title">
        Your link for {label} is ready
      </h2>
      <p className="text-sm text-ink-2">
        It shares {documents} {documents === 1 ? "document" : "documents"} for {days} days. Copy it now and send it yourself: ShipShape keeps only a
        fingerprint of it and can&apos;t show it again. Each time someone opens it, you&apos;ll see it under Your links.
      </p>
      <CopyLink id="passport-url" label="Passport link" url={url} v2 />
      <button type="button" className="btn-ghost press" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/**
 * The redesigned new-link form (Design spec 2026-11-02 §4, PR 7): who it's for as a field row, the documents as rows
 * with their box at the right, the days as a 3-part control with the end day under it, the "Who can open it" well, then
 * Make the link. Same fields, checks, words and action as NewPassportForm.
 *
 * Made (§6.4, the second-biggest moment): from md up the panel grows out of the Make the link button (from its box,
 * uniform scale .96 → 1 and a clip opening to the whole panel, 320ms on the spring; Design, 02 Nov) while the form,
 * left where it was and out of use, fades out in 150ms; on the phone it rises as a sheet over the form. Done (or
 * closing the sheet) starts a new form. Web Animations on the elements themselves: React plays a view transition only
 * for a commit made of transitions alone, and the action's answer arrives with the router's refresh.
 */
function NewPassportFormV2({ onDone, ...props }: PassportFormProps & { onDone: () => void }) {
  const { docs, days, preselected, today } = props;
  const { state, action, pending, typed, errors, form, startLabel, startDays, chosen, setPicked, setLabel, tick, chosenDocs, previewHref, label, taxId } =
    usePassportForm(props);
  // Read when the form is sent: where the button was (the panel grows from there), whether this is the phone (a sheet),
  // and whether to move at all (from md up, without reduced motion: then the form stays to fade out under the panel).
  const from = useRef<DOMRect | null>(null);
  const [sheet, setSheet] = useState(false);
  const [fading, setFading] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const made = state.created;
  // Only ever after making a link, so never on the server: the origin is the address bar's.
  const url = made ? `${window.location.origin}/p/${made.id}#${made.token}` : null;
  const inPlace = made !== undefined && !sheet;

  // The one thing to do next is Copy link: it takes focus (in the sheet too, which would otherwise focus the address).
  useEffect(() => {
    if (!made) return;
    if (sheet) dialog.current?.showModal();
    (sheet ? dialog.current : panel.current)?.querySelector<HTMLButtonElement>("button.btn")?.focus();
  }, [made, sheet]);

  // Before the first paint of the panel: it starts as the button's box and grows to its own, while the form fades where
  // it was. The column keeps the form's height until the form has gone, so nothing under it moves mid-moment.
  useLayoutEffect(() => {
    const box = from.current;
    const to = panel.current;
    const old = form.current;
    const col = column.current;
    if (!made || !fading || !box || !to || !old || !col) return;
    col.style.minHeight = `${old.offsetHeight}px`;
    const at = to.getBoundingClientRect();
    const spring = getComputedStyle(document.documentElement).getPropertyValue("--ease-spring").trim() || "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const grow = to.animate(
      [
        {
          transform: `translate(${box.left - at.left}px, ${box.top - at.top}px) scale(0.96)`,
          opacity: 0,
          clipPath: `inset(0px ${Math.max(0, at.width - box.width)}px ${Math.max(0, at.height - box.height)}px 0px round 22px)`,
        },
        { transform: "none", opacity: 1, clipPath: "inset(0px round 16px)" },
      ],
      { id: "link-ready", duration: 320, easing: spring, fill: "both" },
    );
    const fade = old.animate([{ opacity: 1 }, { opacity: 0 }], { id: "link-form-out", duration: 150, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
    // The panel ends as rendered (nothing left composited); the form goes once it has faded, and the column with it.
    grow.finished.then(() => grow.cancel(), () => {});
    fade.finished.then(
      () => {
        col.style.minHeight = "";
        setFading(false);
      },
      () => {},
    );
    return () => {
      grow.cancel();
      fade.cancel();
      col.style.minHeight = "";
    };
    // Once per link made, as it arrives: the form leaving (fading turning false at 150ms) must not cut the 320ms grow short.
  }, [made]);

  if (docs.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">A link shares documents from this workspace, so it needs at least one. Add one, then choose it here.</p>
        <Link href="/app/documents/new" className="btn press">
          Add a document
        </Link>
      </div>
    );
  }

  return (
    <div ref={column} className="relative">
      {/* Made in place: the form stays only while it fades, where it was, out of reach, under the panel. */}
      {(!inPlace || fading) && (
        <form
          ref={form}
          action={action}
          className={inPlace ? "pointer-events-none absolute inset-x-0 top-0 space-y-6" : "space-y-6"}
          inert={inPlace}
          aria-hidden={inPlace || undefined}
          noValidate
          onSubmit={(e) => {
            from.current = e.currentTarget.querySelector("button.btn")?.getBoundingClientRect() ?? null;
            const wide = window.matchMedia(WIDE).matches;
            setSheet(!wide);
            setFading(wide && !window.matchMedia(REDUCE).matches);
          }}
        >
          <div>
            <ul className="group-list plain">
              <li className="field-row">
                {/* "(required)" as the fill form shows it: the placeholder is only an example. Screen readers hear `required`. */}
                <label htmlFor="label">
                  Who is it for?
                  <span aria-hidden="true" className="text-ink-3">
                    {" (required)"}
                  </span>
                </label>
                <input
                  id="label"
                  name="label"
                  required
                  maxLength={120}
                  placeholder="e.g. Northwind Builders onboarding"
                  defaultValue={startLabel}
                  onChange={(e) => setLabel(e.target.value)}
                  className="row-field"
                  aria-invalid={errors.label ? true : undefined}
                  aria-describedby={errors.label ? "label-error" : undefined}
                />
              </li>
            </ul>
            <FieldError id="label-error" error={errors.label} />
          </div>
          {/* min-w-0: a fieldset is otherwise as wide as its longest unbroken title, wider than the phone. */}
          <fieldset className="min-w-0" aria-describedby={errors.docs ? "docs-error" : undefined}>
            <legend className="mb-2 px-1 text-[13px] text-ink-3">Documents to include</legend>
            <ul className="group-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className="group-row cursor-pointer hover:bg-tile">
                    <span className="row-icon">
                      <Icon name="documents" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.title}</span>
                      <span className="block text-[13px] text-ink-3">
                        {d.kindLabel}
                        {d.note && ` · ${d.note}`}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      name="doc"
                      value={d.id}
                      defaultChecked={(typed?.docs ?? preselected).includes(d.id)}
                      onChange={(e) => tick(d.id, e.target.checked)}
                      className="size-5 shrink-0 accent-[var(--accent)]"
                      aria-invalid={errors.docs ? true : undefined}
                      aria-describedby={errors.docs ? "docs-error" : undefined}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <FieldError id="docs-error" error={errors.docs} />
          </fieldset>
          <fieldset
            className="min-w-0"
            aria-describedby={[days.includes(chosen) ? "days-end" : null, errors.days ? "days-error" : null].filter(Boolean).join(" ") || undefined}
          >
            <legend className="mb-2 px-1 text-[13px] text-ink-3">The link stops working after</legend>
            <DaysChoice days={days} defaultDays={startDays} onPick={setPicked} invalid={!!errors.days} describedBy={errors.days ? "days-error" : undefined} />
            {/* The server counts the days from the moment the link is made; the day shown is in the viewer's zone, as on Your links. */}
            {days.includes(chosen) && (
              <p id="days-end" className="mt-2 px-1 text-sm text-ink-2">
                {`Stops working on ${fmtDay(plusDays(today, chosen))}. You can turn it off sooner.`}
              </p>
            )}
            <FieldError id="days-error" error={errors.days} />
          </fieldset>
          <WhoCanOpen label={label} documents={chosenDocs.length} taxId={taxId} v2 />
          {state.error && (
            <div role="alert" tabIndex={-1} className="space-y-2 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
              <p>{state.error}</p>
              {state.fix && (
                <Link href={state.fix.href} className="underline">
                  {state.fix.label}
                </Link>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn press" disabled={pending || inPlace}>
              {pending || inPlace ? "Making the link…" : "Make the link"}
            </button>
            {chosenDocs.length > 0 && (
              <Link href={previewHref} className="btn-ghost press">
                Preview what they&apos;ll see
              </Link>
            )}
          </div>
        </form>
      )}
      {made && url && inPlace && (
        <div ref={panel} className="relative origin-top-left rounded-2xl border border-line bg-paper p-5">
          <Ready label={made.label} documents={made.documents} days={made.days} url={url} onDone={onDone} />
        </div>
      )}
      {made && url && sheet && (
        <dialog
          ref={dialog}
          aria-labelledby="ready-title"
          className="sheet fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-[20px] bg-paper p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30"
          onClose={onDone}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line" aria-hidden="true" />
          <div className="px-4 pt-3 pb-5">
            <Ready label={made.label} documents={made.documents} days={made.days} url={url} onDone={() => dialog.current?.close()} />
          </div>
        </dialog>
      )}
    </div>
  );
}

/**
 * The new-link form; each Done starts a fresh one (nothing ticked, nothing typed), as the link it made is now listed.
 * Done (or closing the sheet) removes the control that had focus, so focus goes to Your links, where the new link now
 * shows, or to the fresh form's first field.
 */
export function NewLinkV2(props: PassportFormProps) {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (round) (document.getElementById("links-title") ?? document.getElementById("label"))?.focus();
  }, [round]);
  return (
    <NewPassportFormV2
      key={round}
      {...props}
      preselected={round ? [] : props.preselected}
      initial={round ? undefined : props.initial}
      onDone={() => setRound((n) => n + 1)}
    />
  );
}
