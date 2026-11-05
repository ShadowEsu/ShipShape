import Link from "next/link";
import { ViewTransition } from "react";
import { Icon, type IconName } from "@/components/icons";

/**
 * A hairline row (Design calm v2, look A), for a `.hair-list`: Home's lists, Saved, Sent, Signed copies. From sm up:
 * icon, title over meta, the chip, the chevron. On the phone the title and meta wrap and the chip goes under them
 * (Design MUST-1, 3 Nov: a dated chip beside the title cut it to "Certificate …"). Without a chip, the state is in the
 * meta line. `current`: the row whose detail is open beside the list (Sent), marked for everyone. `morph`: the title's
 * view transition name, so it morphs into the page it opens (Documents → a document, Design spec §6.1).
 */
export function HairRow({
  href,
  icon,
  title,
  line,
  chip,
  current = false,
  morph,
}: {
  href: string;
  icon: IconName;
  title: string;
  /** The meta line: words, or words around a count-up (Passport's "opened 3 times"). */
  line: React.ReactNode;
  chip?: React.ReactNode;
  current?: boolean;
  morph?: string;
}) {
  return (
    <li>
      <Link href={href} className="hair-row" aria-current={current ? "true" : undefined}>
        <span className="hair-icon row-icon">
          <Icon name={icon} size={18} />
        </span>
        <span className="hair-text">
          <span className="hair-title">
            {morph ? (
              <ViewTransition name={morph} share="v2-morph" default="none">
                <span>{title}</span>
              </ViewTransition>
            ) : (
              title
            )}
          </span>
          <span className="hair-meta">{line}</span>
        </span>
        {chip && <span className="hair-chip">{chip}</span>}
        <span className="hair-chev">
          <Icon name="chevron" size={16} />
        </span>
      </Link>
    </li>
  );
}

/**
 * A state as a dot and a word in a hairline pill (Design calm v2): green for current, done or working; amber for soon;
 * red for lapsed; grey for waiting or over. The dot colours are `.validity-chip`'s (app/globals.css), as on Documents.
 */
export function StateChip({ tone, children }: { tone: "ok" | "expiring" | "expired" | "none"; children: React.ReactNode }) {
  return tone === "none" ? (
    <span className="dot-chip">{children}</span>
  ) : (
    <span data-validity={tone} className="validity-chip inline-flex items-center rounded-full text-xs whitespace-nowrap">
      {children}
    </span>
  );
}
