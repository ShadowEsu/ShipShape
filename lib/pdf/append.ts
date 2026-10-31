import { PDFDocument, PDFPageTree, type PDFObject, type PDFRef } from "pdf-lib";

/**
 * Appends `extra`'s pages to `base` as an incremental update (PDF 32000-1 7.5.6): `base`'s bytes
 * stay exactly as they are, followed by the new objects, the page-tree nodes that now list the new
 * pages, a cross-reference section for just those, and a trailer pointing back at `base`'s own.
 * So the first base.length bytes of the result hash to the same SHA-256 as `base` (Security R2-1:
 * the signed copy is the reviewed file plus its certificate, provably).
 *
 * `base` must end in a classic cross-reference table (buildToSign saves it that way).
 */
export async function appendPages(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const prev = lastXrefOffset(base);
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const existing = doc.context.largestObjectNumber;
  const add = await PDFDocument.load(extra, { updateMetadata: false });
  for (const page of await doc.copyPages(add, add.getPageIndices())) doc.addPage(page);

  const changed: [PDFRef, PDFObject][] = doc.context
    .enumerateIndirectObjects()
    .filter(([ref, obj]) => ref.objectNumber > existing || obj instanceof PDFPageTree)
    .sort(([a], [b]) => a.objectNumber - b.objectNumber);

  const ascii = new TextEncoder();
  const parts: Uint8Array[] = [base];
  let offset = base.length;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    offset += bytes.length;
  };
  push(ascii.encode("\n"));
  const entries: { num: number; gen: number; at: number }[] = [];
  for (const [ref, obj] of changed) {
    entries.push({ num: ref.objectNumber, gen: ref.generationNumber, at: offset });
    push(ascii.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    const body = new Uint8Array(obj.sizeInBytes());
    obj.copyBytesInto(body, 0);
    push(body);
    push(ascii.encode("\nendobj\n"));
  }

  const xrefAt = offset;
  let xref = "xref\n";
  for (let i = 0; i < entries.length; ) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++;
    xref += `${entries[i].num} ${j - i + 1}\n`;
    // Each entry is exactly 20 bytes, ending in CR LF.
    for (const e of entries.slice(i, j + 1)) xref += `${String(e.at).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n\r\n`;
    i = j + 1;
  }
  const t = doc.context.trailerInfo;
  if (!t.Root) throw new Error("the file has no catalog");
  const info = t.Info ? ` /Info ${t.Info.toString()}` : "";
  const id = t.ID ? ` /ID ${t.ID.toString()}` : "";
  push(
    ascii.encode(
      `${xref}trailer\n<< /Size ${doc.context.largestObjectNumber + 1} /Root ${t.Root.toString()} /Prev ${prev}${info}${id} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
    ),
  );

  const out = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Where `pdf`'s last cross-reference table starts; throws unless it is a classic table. */
function lastXrefOffset(pdf: Uint8Array): number {
  const tail = new TextDecoder("latin1").decode(pdf.subarray(Math.max(0, pdf.length - 1024)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!m) throw new Error("no startxref at the end of the file");
  const at = Number(m[1]);
  if (new TextDecoder("latin1").decode(pdf.subarray(at, at + 4)) !== "xref") throw new Error("the last cross-reference section isn't a classic table");
  return at;
}
