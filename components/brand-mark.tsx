/**
 * ShipShape's mark (Design, 5 Nov, after Council's blind test: agents/design/shipshape-logo-2026-11-04/README.md):
 * S2 "Paper boat", a folded-paper boat (the paperwork, afloat) on a 64-unit grid, filled, one colour (currentColor):
 * ink on white, white on ink. The favicon and app icons (app/icon.svg, app/icon1.png, app/icon2.png,
 * app/apple-icon.png) and the link preview (app/opengraph-image.tsx) draw the same paths;
 * `python3 scripts/brand-icons.py` makes the icons again after a change.
 */
export const MARK_PATHS = ["M4 31l18 6h20l18-6-9 20H13z", "M23 32L32 9l9 23z"];

export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
