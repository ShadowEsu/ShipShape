"use client";

import { useEffect, useState } from "react";
import { busyButton } from "@/components/submit-button";

const STARTED_MS = 4000;

/**
 * The redesigned app's export (Design spec 2026-11-02 §6.5, Design 02 Nov): the same POST as the plain form, fetched so
 * the label can follow it. "Preparing your ZIP…" with a 2px skeleton for as long as the server builds it, "Download
 * started" for 4s once the file is handed to the browser, "Couldn't make the ZIP. Try again." if it fails. A refused
 * export (stale sign-in, size, role) answers with a redirect to this page's explanation, which is followed as the form
 * would. The ZIP is at most EXPORT_MAX_BYTES (200 MB), so holding it in memory is fine.
 */
export function ExportButton() {
  const [phase, setPhase] = useState<"idle" | "busy" | "started" | "failed">("idle");
  useEffect(() => {
    if (phase !== "started") return;
    const t = setTimeout(() => setPhase("idle"), STARTED_MS);
    return () => clearTimeout(t);
  }, [phase]);

  async function run() {
    setPhase("busy");
    try {
      const res = await fetch("/app/settings/export", { method: "POST" });
      const zip = res.ok && res.headers.get("Content-Type") === "application/zip";
      if (!zip && res.redirected) {
        window.location.assign(res.url);
        return;
      }
      if (!zip) throw new Error(`export answered ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "shipshape-export.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // The click has handed the file to the browser's download; the URL isn't needed after it.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setPhase("started");
    } catch {
      setPhase("failed");
    }
  }

  const busy = phase === "busy";
  return (
    <div className="space-y-2">
      <div className="inline-flex flex-col gap-1.5">
        <button type="button" className="btn-ghost press" {...busyButton(busy, run)}>
          {busy ? "Preparing your ZIP…" : phase === "started" ? "Download started" : "Download the export"}
        </button>
        {/* Always there, so the section doesn't move when it shows. */}
        <span aria-hidden="true" className={`block h-0.5 w-full rounded-full ${busy ? "bg-line motion-safe:animate-pulse" : "bg-transparent"}`} />
      </div>
      <p role="status" className="sr-only">
        {busy ? "Preparing your ZIP…" : phase === "started" ? "Download started" : ""}
      </p>
      {phase === "failed" && (
        <p role="alert" className="text-sm text-bad">
          Couldn&apos;t make the ZIP. Try again.
        </p>
      )}
    </div>
  );
}
