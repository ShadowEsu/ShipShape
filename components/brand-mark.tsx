/**
 * ShipShape's mark (Design, 5 Nov, after Council's blind test: agents/design/shipshape-logo-2026-11-04/README.md):
 * S2 "Paper boat", a folded-paper boat (the paperwork, afloat) on a 64-unit grid, filled, one colour (currentColor):
 * ink on white, white on ink. These are the paths of Design's public/brand/shipshape-mark.svg, drawn inline so the
 * mark takes the text colour; the link preview (app/opengraph-image.tsx) and the loading mark draw them too. The
 * favicons and app icons are Design's own exports, copied byte for byte (README).
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
