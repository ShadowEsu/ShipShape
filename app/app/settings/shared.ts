import { EXPORT_MAX_BYTES } from "@/lib/server/account";

export const ROLE: Record<"owner" | "admin" | "member", string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** How long ago a session was last used. requireWorkspace notes it at most every 10 minutes, so nothing finer than the hour. */
export function lastActive(idleSeconds: number): string {
  const hours = Math.floor(idleSeconds / 3600);
  if (hours < 1) return "last active less than an hour ago";
  if (hours < 24) return `last active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `last active ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The browser's name starts the row, so "a browser on a Mac" reads "A browser on a Mac"; the Sign out label keeps it mid-sentence. */
export const rowStart = (family: string) => family.charAt(0).toUpperCase() + family.slice(1);

/** What a refused export (`?error=` from export/route.ts) means, and the one link that fixes it when there is one. */
export function exportProblem(error: string | undefined, contact: string | null): { text: string; fix?: { href: string; label: string } } | undefined {
  const tooLarge = `This workspace is over ${EXPORT_MAX_BYTES / 1024 / 1024} MB, too large to export in one file.`;
  switch (error) {
    case "reauth":
      return { text: "For your security, sign in again before you export.", fix: { href: "/signin?next=export", label: "Sign in again" } };
    case "role":
      return { text: "Only owners and admins can export this workspace. Ask one of them for the file." };
    case "size":
      return contact
        ? {
            text: `${tooLarge} Write to us and we'll send it another way.`,
            fix: { href: `mailto:${contact}?subject=${encodeURIComponent("Export my ShipShape workspace")}`, label: "Write to us" },
          }
        : { text: `${tooLarge} Download what you need from each document's page.`, fix: { href: "/app/documents", label: "Open your documents" } };
    default:
      return undefined;
  }
}
