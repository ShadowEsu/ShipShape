import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";

/**
 * A hairline row (Design calm v2, look A), for a `.hair-list`: Home's lists and the Saved page. From sm up: icon, title
 * over meta, the chip, the chevron. On the phone the title and meta wrap and the chip goes under them (Design MUST-1,
 * 3 Nov: a dated chip beside the title cut it to "Certificate …"). Without a chip, the state is in the meta line.
 */
export function HairRow({ href, icon, title, line, chip }: { href: string; icon: IconName; title: string; line: string; chip?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="hair-row">
        <span className="hair-icon row-icon">
          <Icon name={icon} size={17} />
        </span>
        <span className="hair-text">
          <span className="hair-title">{title}</span>
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
