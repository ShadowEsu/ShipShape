import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { loadUntrusted, MAX_INFLATED_BYTES, MAX_PACKED_OBJECTS, PdfTooComplex } from "@/lib/pdf/load";
import { buildToSign, NotSignable } from "@/lib/pdf/to-sign";

/** Loading uploads: what pdf-lib unpacks while loading is bounded per file (Security R6-3). */

const MiB = 1024 * 1024;

/** A one-page PDF plus `extra` objects, with a classic cross-reference table. */
function pdfWith(extra: [number, Buffer][]): Uint8Array {
  const objects: [number, Buffer][] = [
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>")],
    [2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [3, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>")],
    ...extra,
  ];
  const parts = [Buffer.from("%PDF-1.7\n")];
  let length = parts[0].length;
  const at = new Map<number, number>();
  for (const [n, body] of objects) {
    at.set(n, length);
    const chunk = Buffer.concat([Buffer.from(`${n} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  }
  const size = Math.max(...objects.map(([n]) => n)) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const offset = at.get(n);
    xref += offset === undefined ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref)]);
}

const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]);

/** An object stream holding object `n` after `padding` bytes of white space. */
function paddedObjectStream(n: number, padding: number): Buffer {
  const head = `${n} 0 `;
  const body = Buffer.alloc(head.length + padding + 4, 0x20);
  body.write(head, 0);
  body.write("<<>>", body.length - 4);
  return stream(`/Type /ObjStm /N 1 /First ${head.length} /Filter /FlateDecode`, deflateSync(body));
}

/** An object stream packing `count` tiny objects (the number 0), numbered from 1000. */
function manyObjectsStream(count: number): Buffer {
  const pairs: string[] = [];
  for (let i = 0; i < count; i++) pairs.push(`${1000 + i} ${i * 2}`);
  const header = `${pairs.join(" ")} `;
  const body = Buffer.from(header + "0 ".repeat(count));
  return stream(`/Type /ObjStm /N ${count} /First ${header.length} /Filter /FlateDecode`, deflateSync(body));
}

describe("loading an upload", () => {
  it("Security's 512 KiB object-stream bomb (512 MiB inflated) is refused before pdf-lib unpacks it", async () => {
    const bomb = await readFile(path.join(import.meta.dirname, "fixtures/objstm-bomb-512MiB.pdf"));
    await expect(loadUntrusted(bomb)).rejects.toThrow(PdfTooComplex);
    await expect(buildToSign(bomb, "application/pdf")).rejects.toEqual(new NotSignable("unreadable"));
  });

  it("a cross-reference stream that inflates past the limit is refused too", async () => {
    const xref = stream("/Type /XRef /Size 4 /W [1 2 1] /Filter /FlateDecode", deflateSync(Buffer.alloc(MAX_INFLATED_BYTES + MiB)));
    await expect(loadUntrusted(pdfWith([[4, xref]]))).rejects.toThrow(PdfTooComplex);
  });

  it("the limit is for the whole file: two object streams under it each, but over it together, are refused", async () => {
    const half = Math.floor(MAX_INFLATED_BYTES / 2) + MiB;
    await expect(loadUntrusted(pdfWith([[4, paddedObjectStream(50, half)], [5, paddedObjectStream(51, half)]]))).rejects.toThrow(PdfTooComplex);
    // One of them is fine, and each file has its own allowance: the same file loads twice.
    const one = pdfWith([[4, paddedObjectStream(50, half)]]);
    for (let i = 0; i < 2; i++) expect((await loadUntrusted(one)).context.lookup(PDFRef.of(50))).toBeInstanceOf(PDFDict);
  });

  it("more packed objects than the limit are refused, however small", async () => {
    await expect(loadUntrusted(pdfWith([[4, manyObjectsStream(MAX_PACKED_OBJECTS + 1)]]))).rejects.toThrow("too many objects");
    const fine = await loadUntrusted(pdfWith([[4, manyObjectsStream(1000)]]));
    expect(fine.context.enumerateIndirectObjects().length).toBeGreaterThanOrEqual(1000);
  });

  it("an ordinary file saved with object streams loads", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 60; i++) doc.addPage().drawText(`page ${i + 1}`);
    const loaded = await loadUntrusted(await doc.save({ useObjectStreams: true }));
    expect(loaded.getPageCount()).toBe(60);
  });
});
