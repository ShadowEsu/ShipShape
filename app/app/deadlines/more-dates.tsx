import Link from "next/link";

/**
 * Under a Deadlines group that lists only some of its dates (the earliest DEADLINES_SHOWN of each part): how many it
 * shows of how many, and where the rest are, as a link there (Design #59 S-1). Not "the first N": Lapsed holds two parts
 * (lapsed expiries, passed renewal notices), each cut at its own earliest 100 (Security #59 INFO). Upcoming dates are all
 * in the calendar file; lapsed ones aren't (it skips them), but Documents lists every document, soonest expiry first.
 * Both looks.
 */
export function MoreDates({ shown, total, lapsed, className }: { shown: number; total: number; lapsed: boolean; className: string }) {
  if (total <= shown) return null;
  return (
    <p className={className}>
      Showing {shown} of {total}.{" "}
      {lapsed ? (
        <>
          <Link href="/app/documents" className="text-ink underline">
            Documents
          </Link>{" "}
          lists every document, soonest expiry first.
        </>
      ) : (
        <>
          <a href="/app/deadlines/calendar.ics" className="text-ink underline">
            The calendar file
          </a>{" "}
          has every one.
        </>
      )}
    </p>
  );
}
