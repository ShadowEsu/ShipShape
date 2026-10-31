import { composePdf, type Block } from "./compose";

const FOOTER = "SAMPLE DOCUMENT made by ShipShape for its demo. The business, people and numbers are fictional.";

/** A one-page made-up document for sample workspaces, stamped SAMPLE. */
export async function samplePdf(title: string, rows: [string, string][], note: string): Promise<Uint8Array> {
  const blocks: Block[] = [
    { type: "title", text: title },
    { type: "para", muted: true, runs: [{ text: note }] },
    { type: "rows", rows },
    { type: "stamp", text: "SAMPLE" },
  ];
  return composePdf(blocks, { title: `${title} (sample)`, footer: FOOTER });
}
