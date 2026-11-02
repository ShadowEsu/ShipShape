/**
 * ShipShape's own icons (Design spec 2026-11-02 §1): inline SVG on a 24 grid, 1.75 stroke, drawn at 20 px (tiles,
 * nav) or 16 px (chips), so they're sharp at any pixel density. Decorative: the label next to each says what it is.
 */
export type IconName =
  | "home"
  | "documents"
  | "add"
  | "make"
  | "check"
  | "passport"
  | "sign"
  | "collect"
  | "deadlines"
  | "facts"
  | "settings"
  | "more"
  | "send"
  | "chevron"
  | "account"
  | "close"
  | "search"
  | "open"
  | "download"
  | "tick"
  | "page";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  documents: (
    <>
      <path d="M8 3.5h6.5L19 8v11.5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V8H19M10 12.5h6M10 16h4" />
      <path d="M4.5 7v13a1 1 0 0 0 1 1" />
    </>
  ),
  add: (
    <>
      <path d="M6 3.5h7.5L18 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V8H18M11.5 11v6M8.5 14h6" />
    </>
  ),
  make: (
    <>
      <path d="M13 20.5H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1h7.5L18 8v3" />
      <path d="M13.5 3.5V8H18M8 12h5M8 15.5h3" />
      <path d="m15 20.5 .6-2.4 4.6-4.6a1.27 1.27 0 0 1 1.8 1.8l-4.6 4.6z" />
    </>
  ),
  check: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.3 15.3 4.7 4.7M7.8 10.6l1.9 1.9 3.6-3.7" />
    </>
  ),
  passport: (
    <>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3.5-3.5a3.5 3.5 0 0 0-5-5L12.4 6.6" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3.5 3.5a3.5 3.5 0 0 0 5 5l1.1-1.1" />
    </>
  ),
  sign: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M4.5 16.5c2.2-4.5 4-6.6 5.2-6.1 1.6.6-1.7 5.6.2 5.8 1.3.1 2.4-2.6 3.6-2.4 1 .2.5 2.1 1.6 2.1.9 0 1.7-1 2.4-1.8" />
    </>
  ),
  collect: (
    <>
      <path d="M4 13.5 6.2 5.3a1 1 0 0 1 1-.8h9.6a1 1 0 0 1 1 .8L20 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 13.5h4.5l1 2h5l1-2H20M12 7.5v5M9.8 10.3 12 12.5l2.2-2.2" />
    </>
  ),
  deadlines: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2" />
      <path d="M4 9.5h16M8.5 3v4M15.5 3v4M12 12.5v3.2l2 1.3" />
    </>
  ),
  facts: (
    <>
      <path d="M5 20.5V6.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14M14 10.5h4a1 1 0 0 1 1 1v9M3.5 20.5h17" />
      <path d="M8 9h3M8 12.5h3M8 16h3M16.5 14h0M16.5 17h0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
    </>
  ),
  send: <path d="M12 19V5.5M6.5 11 12 5.5 17.5 11" />,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  account: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.6 18.2c1.2-2 3.1-3 5.4-3s4.2 1 5.4 3" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  open: <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  download: <path d="M12 4v11M7 10.5 12 15.5l5-5M5 19.5h14" />,
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  page: (
    <>
      <path d="M7 3.5h7.5L19 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V8H19M9.5 13h6M9.5 16.5h4" />
    </>
  ),
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
