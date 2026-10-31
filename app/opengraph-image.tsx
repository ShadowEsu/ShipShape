import { ImageResponse } from "next/og";

// The link preview for every page (shared pages too: it shows nothing about what's shared).
export const alt = "ShipShape: your business paperwork, in one passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#f7f7f5", color: "#111111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="64" height="64" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="#111111" />
          <path d="M7 19h18l-3 5H10z" fill="#ffffff" />
          <path d="M16 7v10M16 7l6 8h-6" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinejoin="round" />
        </svg>
        <div style={{ fontSize: 40 }}>ShipShape</div>
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
