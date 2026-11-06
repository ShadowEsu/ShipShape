/**
 * Under a Deadlines group that lists only its earliest dates (DEADLINES_SHOWN): how many it has, and where the rest are.
 * Upcoming dates are all in the calendar file; lapsed ones aren't (it skips them), but Documents lists every document,
 * soonest expiry first. Both looks.
 */
export function MoreDates({ shown, total, lapsed, className }: { shown: number; total: number; lapsed: boolean; className: string }) {
  if (total <= shown) return null;
  return (
    <p className={className}>
      Showing the first {shown} of {total}. {lapsed ? "Documents lists every document, soonest expiry first." : "The calendar file has every one."}
    </p>
  );
}
