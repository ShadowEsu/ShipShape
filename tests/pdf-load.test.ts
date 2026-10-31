import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildToSignIsolated } from "@/lib/pdf/build-isolated";
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

  // Security R7-1: what pdf-lib builds from an object stream, not only the bytes it inflates.
  const fixture = (name: string) => readFile(path.join(import.meta.dirname, "fixtures", name));

  it("an 8 KiB file whose 50 entries all point at one 4-million-number array is refused (R7-1 A1: it ran a 2 GB process out of memory)", async () => {
    await expect(loadUntrusted(await fixture("A1-overlap-50x4M.pdf"))).rejects.toThrow(PdfTooComplex);
  });

  /** An object stream holding `body`, with object 100 + i at offsets[i]. */
  const objectStream = (offsets: number[], body: string) => {
    const header = offsets.map((offset, i) => `${100 + i} ${offset}`).join(" ") + " ";
    return stream(`/Type /ObjStm /N ${offsets.length} /First ${header.length} /Filter /FlateDecode`, deflateSync(Buffer.from(header + body)));
  };

  it("entries sharing an offset, or pointing into one nested array in increasing order, are refused however small: each would be parsed again", async () => {
    const numbers = "0 ".repeat(1000);
    await expect(loadUntrusted(pdfWith([[4, objectStream([0, 0, 0, 0, 0], `[${numbers}]`)]]))).rejects.toThrow("objects overlap");
    await expect(loadUntrusted(pdfWith([[4, objectStream([0, 1, 2, 3, 4], `[[[[[${numbers}]]]]]`)]]))).rejects.toThrow("objects overlap");
  });

  it("a stream keyword after a packed dictionary is refused: pdf-lib would copy a stream for every such object (R7-7 A6: 8 KiB took 48 s and 1.5 GB)", async () => {
    await expect(loadUntrusted(await fixture("A6-stream-in-objstm-300.pdf"))).rejects.toThrow(PdfTooComplex);
    const data = `${"0 ".repeat(1000)}\nendstream`;
    await expect(loadUntrusted(pdfWith([[4, objectStream([0], `<<>>\nstream\n${data}`)]]))).rejects.toThrow("aren't one value each");
    await expect(loadUntrusted(pdfWith([[4, objectStream([0], `[<<>>streamx\n${data}]`)]]))).rejects.toThrow("aren't one value each");
  });

  it("a packed object that is a bare reference, or is followed by a comment, still loads", async () => {
    const first = "12 0 R % the next object follows\n";
    const doc = await loadUntrusted(pdfWith([[4, objectStream([0, first.length], `${first}<< /A 1 0 R >>`)]]));
    expect(doc.context.lookup(PDFRef.of(100))).toBe(PDFRef.of(12, 0));
    expect(doc.context.lookup(PDFRef.of(101))).toBeInstanceOf(PDFDict);
  });

  it("one object stream inflating to 30 MiB is refused (R7-1 A3: 1.4 GB once parsed)", async () => {
    await expect(loadUntrusted(await fixture("A3-single-15M-array.pdf"))).rejects.toThrow(PdfTooComplex);
  });

  it("an object count given indirectly is counted as pdf-lib reads it (R7-1 A4: /N 9 0 R meaning millions)", async () => {
    const count = MAX_PACKED_OBJECTS + 1;
    const pairs: string[] = [];
    for (let i = 0; i < count; i++) pairs.push(`${1000 + i} ${i * 2}`);
    const header = `${pairs.join(" ")} `;
    const packed = stream(`/Type /ObjStm /N 9 0 R /First ${header.length} /Filter /FlateDecode`, deflateSync(Buffer.from(header + "0 ".repeat(count))));
    await expect(loadUntrusted(pdfWith([[9, Buffer.from(String(count))], [10, packed]]))).rejects.toThrow("too many objects");
  });

  it("a cross-reference stream listing more entries than its data holds is refused (pdf-lib would build them all)", async () => {
    const xref = stream("/Type /XRef /Size 1000 /W [1 2 1] /Filter /FlateDecode", deflateSync(Buffer.from([1, 0, 9, 0])));
    await expect(loadUntrusted(pdfWith([[4, xref]]))).rejects.toThrow("more entries than its data holds");
  });

  it("ordinary files with object streams load: one pdf-lib saves, Security's control, and the IRS W-9", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 60; i++) doc.addPage().drawText(`page ${i + 1}`);
    expect((await loadUntrusted(await doc.save({ useObjectStreams: true }))).getPageCount()).toBe(60);
    expect((await loadUntrusted(await fixture("C0-normal-objstm.pdf"))).context.lookup(PDFRef.of(102))).toBeDefined();
    const w9 = await readFile(path.join(import.meta.dirname, "..", "templates", "fw9.pdf"));
    expect((await loadUntrusted(w9)).getForm().getFields().length).toBeGreaterThan(20);
  });
});

describe("each upload is built in a thread of its own (Security R7-8)", () => {
  /** One page plus an array of `count` distinct names: pdf-lib keeps every name it has seen for good. */
  const names = (count: number) => pdfWith([[4, Buffer.from(`[${Array.from({ length: count }, (_, i) => `/n${i}`).join(" ")}]`)]]);

  it("builds exactly what buildToSign builds, and passes its refusals on", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Fee: USD 100");
    const bytes = await doc.save();
    expect(Buffer.from(await buildToSignIsolated(bytes, "application/pdf")).equals(Buffer.from(await buildToSign(bytes, "application/pdf")))).toBe(true);
    const a6 = await readFile(path.join(import.meta.dirname, "fixtures", "A6-stream-in-objstm-300.pdf"));
    await expect(buildToSignIsolated(a6, "application/pdf")).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("an upload needing more memory or time than its thread may use is refused as unreadable; under the normal limits it builds", async () => {
    const heavy = names(300_000);
    const outOfMemory = await buildToSignIsolated(heavy, "application/pdf", { heapMb: 16, timeoutMs: 20_000 }).catch((e: unknown) => e);
    expect(outOfMemory).toBeInstanceOf(NotSignable);
    expect(outOfMemory).toMatchObject({ reason: "unreadable", cause: { code: "ERR_WORKER_OUT_OF_MEMORY" } });
    await expect(buildToSignIsolated(heavy, "application/pdf", { heapMb: 512, timeoutMs: 1 })).rejects.toMatchObject({ reason: "unreadable" });
    expect((await buildToSignIsolated(heavy, "application/pdf")).length).toBeGreaterThan(0);
  });
});
