import type { FontKey, PaperMark } from "@/lib/pdf/sample-papers";

/** The PDF's standard fonts and the faces a browser has with the same widths (Arial for Helvetica, Times New Roman for Times). */
const FACE: Record<FontKey, { fontFamily: string; fontWeight?: number; fontStyle?: "italic" }> = {
  sans: { fontFamily: "Helvetica, Arial, sans-serif" },
  sansBold: { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700 },
  serif: { fontFamily: "'Times New Roman', Times, serif" },
  serifBold: { fontFamily: "'Times New Roman', Times, serif", fontWeight: 700 },
  serifItalic: { fontFamily: "'Times New Roman', Times, serif", fontStyle: "italic" },
};

/**
 * A paper's page as SVG, from the marks its drawing recorded (lib/pdf/sample-papers.ts). Every value goes in as JSX
 * text or an attribute, never as markup (Security 20261104-1327, P2). Decorative: the page around it names the document.
 */
export function PaperSvg({ marks, width, height, className }: { marks: readonly PaperMark[]; width: number; height: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} xmlSpace="preserve" aria-hidden="true" focusable="false" className={className}>
      <rect width={width} height={height} fill="#ffffff" />
      {marks.map((m, i) => {
        if (m.kind === "text")
          return (
            <text
              key={i}
              x={m.x}
              y={m.y}
              fontSize={m.size}
              {...FACE[m.font]}
              fill={m.fill}
              opacity={m.opacity}
              transform={m.rotate ? `rotate(${-m.rotate} ${m.x} ${m.y})` : undefined}
            >
              {m.text}
            </text>
          );
        if (m.kind === "rect") return <rect key={i} x={m.x} y={m.y} width={m.width} height={m.height} fill={m.fill ?? "none"} stroke={m.stroke} strokeWidth={m.strokeWidth} />;
        if (m.kind === "line") return <line key={i} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke={m.stroke} strokeWidth={m.strokeWidth} strokeDasharray={m.dash} />;
        return <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill="none" stroke={m.stroke} strokeWidth={m.strokeWidth} />;
      })}
    </svg>
  );
}
