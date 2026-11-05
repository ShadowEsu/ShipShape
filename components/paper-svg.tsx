import type { FontKey, PaperMark } from "@/lib/pdf/surface";

/**
 * The PDF's standard fonts and the faces a browser has with the same widths (Arial or Liberation Sans for Helvetica,
 * Times New Roman or Liberation Serif for Times). Where there's none of them (Android), each text is still fitted to
 * the PDF's width for it (textLength below), so words land where the file has them.
 */
const FACE: Record<FontKey, { fontFamily: string; fontWeight?: number; fontStyle?: "italic" }> = {
  sans: { fontFamily: "Helvetica, Arial, 'Liberation Sans', sans-serif" },
  sansBold: { fontFamily: "Helvetica, Arial, 'Liberation Sans', sans-serif", fontWeight: 700 },
  serif: { fontFamily: "'Times New Roman', Times, 'Liberation Serif', serif" },
  serifBold: { fontFamily: "'Times New Roman', Times, 'Liberation Serif', serif", fontWeight: 700 },
  serifItalic: { fontFamily: "'Times New Roman', Times, 'Liberation Serif', serif", fontStyle: "italic" },
};

/**
 * A paper's page as SVG, from the marks its drawing recorded (lib/pdf/surface.ts). Every value goes in as JSX
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
              textLength={m.width > 0 ? m.width : undefined}
              lengthAdjust={m.width > 0 ? "spacingAndGlyphs" : undefined}
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
