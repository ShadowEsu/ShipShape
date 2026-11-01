import type { Withdrawn } from "@/lib/server/documents";

/** "the open signing request for Jordan Lee", or "the open signing requests for Jordan Lee and 1 other". */
function openRequestsFor(signers: string[]): string {
  const others = signers.length - 1;
  if (others < 1) return `the open signing request for ${signers[0]}`;
  return `the open signing requests for ${signers[0]} and ${others} ${others === 1 ? "other" : "others"}`;
}

/** The archive confirm's sentence, shown only while a request is open (Design, wave 8 #2). */
export function archiveQuestion(signers: string[]): string {
  const them = signers.length > 1 ? "them" : "it";
  return `Archiving withdraws ${openRequestsFor(signers)}. Restoring the document won't bring ${them} back; you'd send ${them} again.`;
}

/** Under Archive (and in its confirm) while the document is on links that still work: archiving takes it off them for good (0041; Design, wave 14). */
export function archiveLinksWarning(links: number): string {
  return `Archiving takes it off ${links} passport ${links === 1 ? "link" : "links"} for good; restoring won't add it back.`;
}

/** Under the Add version file field, only while a request is open: a warning, not a question (Design, wave 8 #7). */
export function versionWarning(signers: string[]): string {
  return `Adding a version withdraws ${openRequestsFor(signers)}.`;
}

/** The success line after a new version withdrew open requests; null when nothing was withdrawn (the form's usual line stays). */
export function versionAdded(version: number, withdrawn: Withdrawn[]): string | null {
  if (!withdrawn.length) return null;
  const versions = new Set(withdrawn.map((w) => w.version));
  const was = withdrawn.length === 1 ? `was for version ${withdrawn[0].version}, so it was withdrawn` : versions.size === 1 ? `were for version ${withdrawn[0].version}, so they were withdrawn` : "were for earlier versions, so they were withdrawn";
  const them = withdrawn.length === 1 ? "it" : "them";
  return `Version ${version} added. ${openRequestsFor(withdrawn.map((w) => w.signerName)).replace(/^the/, "The")} ${was}. Send ${them} for signature again to sign this version.`;
}
