import { ImageResponse } from "next/og";
import { MARK_PATHS } from "@/components/brand-mark";

// The link preview for every page (shared pages too: it shows nothing about what's shared).
export const alt = "ShipShape: your business paperwork, in one passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#ffffff", color: "#0a0a0a" }}>
      {/* The lockup at 2.5x the app's: the mark about 1.4x the name's cap height, a 20px gap (16 + its own 3.75px side margin), then "ShipShape" at 600. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg width="60" height="60" viewBox="0 0 64 64">
          {MARK_PATHS.map((d) => (
            <path key={d} d={d} fill="#0a0a0a" />
          ))}
        </svg>
        <div style={{ fontSize: 40, fontWeight: 600 }}>ShipShape</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>Your business paperwork, in one passport.</div>
        <div style={{ fontSize: 32, color: "#4a4a4a", maxWidth: 1056, lineHeight: 1.35 }}>
          Keep your W-9, insurance and licenses in one place, fill forms from facts you confirmed once, and share a current packet by link.
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: "#6b6b6b", borderTop: "2px solid #e4e4e0", paddingTop: 24 }}>
        Document software, not a law firm. It doesn&apos;t give legal advice.
      </div>
    </div>,
    size,
  );
}
