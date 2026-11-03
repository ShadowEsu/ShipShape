/**
 * How long a link lasts, in the redesigned app (Design spec 2026-11-02 §4; calm v2: hairlines, no grey track): the
 * choices side by side in a hairline frame, the chosen one ringed in ink. Real radios (hidden, still keyboard- and
 * form-driven) inside each part. The caller gives the fieldset and its legend.
 */
export function DaysChoice({
  days,
  defaultDays,
  onPick,
  invalid,
  describedBy,
}: {
  days: readonly number[];
  defaultDays: number;
  onPick?: (days: number) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-paper p-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map((d) => (
        <label
          key={d}
          className="flex min-h-10 cursor-pointer items-center justify-center rounded-lg text-[15px] text-ink-2 has-checked:font-medium has-checked:text-ink has-checked:ring-1 has-checked:ring-ink has-focus-visible:ring-2 has-focus-visible:ring-brand"
        >
          <input
            type="radio"
            name="days"
            value={d}
            defaultChecked={d === defaultDays}
            onChange={onPick && (() => onPick(d))}
            className="sr-only"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          />
          {d} days
        </label>
      ))}
    </div>
  );
}
