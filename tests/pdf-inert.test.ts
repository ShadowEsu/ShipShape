import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appendPages } from "@/lib/pdf/append";
import { makeInert } from "@/lib/pdf/inert";
import { buildToSign } from "@/lib/pdf/to-sign";

const N = (s: string) => PDFName.of(s);

/** Everything in the saved file that could run or carry something: one line per finding. */
function findings(doc: PDFDocument): string[] {
  const out: string[] = [];
  const visit = (obj: PDFObject, where: string) => {
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    if (dict instanceof PDFArray) return dict.asArray().forEach((x) => visit(x, where));
    if (!(dict instanceof PDFDict)) return;
    for (const k of ["JS", "AA", "OpenAction", "Next", "PresSteps", "Popup", "IRT", "EF", "RichMediaContent", "3DD"]) if (dict.has(N(k))) out.push(`${where}: /${k}`);
    const s = dict.lookup(N("S"));
    const unsafe = ["JavaScript", "Launch", "SubmitForm", "ImportData", "Named", "GoToR", "GoToE", "Hide", "Rendition", "ResetForm", "Movie", "Sound"];
    if (s instanceof PDFName && unsafe.includes(s.decodeText())) out.push(`${where}: action ${s.asString()}`);
    const uri = dict.lookup(N("URI"));
    if (uri instanceof PDFString || uri instanceof PDFHexString) {
      if (!/^(https?|mailto):/i.test(uri.decodeText())) out.push(`${where}: uri ${uri.decodeText()}`);
    }
    const sub = dict.lookupMaybe(N("Subtype"), PDFName);
    if (dict.lookupMaybe(N("Type"), PDFName) === N("Annot") && sub) out.push(`annot ${sub.asString()}`);
    for (const [, v] of dict.entries()) if (!(v instanceof PDFRef)) visit(v, where);
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) visit(obj, `obj ${ref.objectNumber}`);
  return out;
}

/** Builds an upload with scripts and active content reachable along every path Security listed. */
async function hostile(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const js = () => ctx.register(ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
  const link = (a: PDFObject, x: number) => ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [x, 0, x + 10, 10], A: a }));
  const uri = (u: string) => ctx.obj({ S: "URI", URI: PDFString.of(u) });

  // F3-1: a popup with its own trigger, presentation steps with a trigger, a form XObject carrying one,
  // an action reachable only through an unexpected key, and a script chained after a safe link.
  const popup = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Popup", Rect: [0, 0, 1, 1], AA: ctx.obj({ PO: js() }) }));
  const note = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [0, 20, 10, 30], Popup: popup, Contents: PDFString.of("note") }));
  page.node.set(N("PresSteps"), ctx.obj({ Type: "NavNode", NA: js(), AA: ctx.obj({ O: js() }) }));
  const xobject = ctx.register(ctx.stream("q Q", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1], AA: ctx.obj({ O: js() }) }));
  page.node.set(N("Resources"), ctx.obj({ XObject: ctx.obj({ X0: xobject }) }));
  const hidden = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Square", Rect: [40, 0, 50, 10], Whatever: js() }));
  // An untyped action behind a made-up key, and a reply chain (/IRT) to an annotation with triggers.
  page.node.set(N("Custom"), ctx.obj({ S: "Launch", F: PDFString.of("calc.exe") }));
  const replied = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", Rect: [0, 0, 1, 1], AA: ctx.obj({ K: js() }) }));
  const reply = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [0, 40, 10, 50], IRT: replied }));
  const chained = link(ctx.obj({ S: "URI", URI: PDFString.of("https://example.com"), Next: js() }), 60);

  // F3-2: active annotation types, one with an embedded file.
  const embedded = ctx.register(ctx.stream("secret payload", { Type: "EmbeddedFile" }));
  const attachment = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [80, 0, 90, 10], FS: ctx.obj({ Type: "Filespec", F: PDFString.of("x.exe"), EF: ctx.obj({ F: embedded }) }) }),
  );
  const media = ["RichMedia", "3D", "Movie", "Sound", "Screen"].map((t, i) => ctx.register(ctx.obj({ Type: "Annot", Subtype: t, Rect: [100 + i * 10, 0, 110 + i * 10, 10] })));

  // F3-3: links by scheme, and other action kinds.
  const links = [
    link(uri("javascript:alert(1)"), 200),
    link(uri("file:///etc/passwd"), 210),
    link(uri("smb://host/share"), 220),
    link(uri("https://example.com/ok"), 230),
    link(uri("mailto:someone@example.com"), 240),
    link(ctx.obj({ S: "Launch", F: PDFString.of("calc.exe") }), 250),
    link(ctx.obj({ S: "GoTo", D: [page.ref, N("Fit")] }), 260),
    link(PDFString.of("not an action"), 270), // F3-4: a non-dictionary /A
  ];
  page.node.set(N("Annots"), ctx.obj([note, popup, hidden, reply, chained, attachment, ...media, ...links]));
  page.node.set(N("AA"), ctx.obj({ O: js() }));
  return doc.save();
}

/** The file a signer reviews, built the way requestSignature builds it. */
async function inertCopy(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(await buildToSign(bytes, "application/pdf"));
}

describe("makeInert: a copy of someone's PDF can't run anything (Security F3-1..F3-4)", () => {
  it("leaves no trigger, script, unsafe action, unsafe link, active annotation or attachment anywhere", async () => {
    const before = findings(await PDFDocument.load(await hostile()));
    expect(before.length).toBeGreaterThan(20); // the fixture really is hostile

    const copy = await inertCopy(await hostile());
    expect(findings(copy).filter((f) => !f.startsWith("annot "))).toEqual([]);
    // Only links stay (unsafe ones lose their action); the notes and the square had nothing to draw.
    expect(findings(copy).filter((f) => f.startsWith("annot ")).sort()).toEqual(Array.from({ length: 9 }, () => "annot /Link"));
    const kept: string[] = [];
    for (const [, obj] of copy.context.enumerateIndirectObjects()) {
      const a = obj instanceof PDFDict ? obj.lookupMaybe(N("A"), PDFDict) : undefined;
      if (a) kept.push(a.lookup(N("S"), PDFName) === N("URI") ? a.lookup(N("URI"), PDFString).decodeText() : "goto");
    }
    expect(kept.sort()).toEqual(["goto", "https://example.com", "https://example.com/ok", "mailto:someone@example.com"]);
  });

  it("writes no unreachable leftovers: the attachment's file isn't in the saved copy", async () => {
    const bytes = await hostile();
    const copy = await PDFDocument.create();
    const source = await PDFDocument.load(bytes);
    for (const p of await copy.copyPages(source, source.getPageIndices())) copy.addPage(p);
    makeInert(copy);
    const saved = new TextDecoder("latin1").decode(await copy.save({ useObjectStreams: false }));
    expect(saved).not.toContain("secret payload");
    expect(saved).not.toContain("/EmbeddedFile");
  });

  it("draws filled form fields into the page instead of keeping them as fields", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const field = doc.getForm().createTextField("company");
    field.setText("Harbor Test Co");
    field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    const copy = await inertCopy(await doc.save());
    expect(findings(copy).filter((f) => f === "annot /Widget")).toEqual([]);
    const xobjects = copy.getPage(0).node.Resources()?.lookupMaybe(N("XObject"), PDFDict);
    expect(xobjects?.keys().length ?? 0).toBeGreaterThan(0); // the field's appearance is now page content
  });
});

/** A classic-xref PDF written by hand, so a fixture can do what pdf-lib won't (define an object twice). */
function rawPdf(objects: [number, string][]): { text: string; xrefAt: number } {
  let text = "%PDF-1.7\n";
  const at = new Map<number, number>();
  for (const [n, body] of objects) {
    if (!at.has(n)) at.set(n, text.length); // the xref names the first definition
    text += `${n} 0 obj\n${body}\nendobj\n`;
  }
  const size = Math.max(...objects.map(([n]) => n)) + 1;
  const xrefAt = text.length;
  text += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) text += at.has(n) ? `${String(at.get(n)).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  text += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return { text, xrefAt };
}
const bytesOf = (text: string) => new TextEncoder().encode(text);
const stream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
const HELV = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
const text = (s: string, y = 700) => stream(`BT /F1 18 Tf 72 ${y} Td (${s}) Tj ET`);
const pageWith = (extra = "") => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${HELV} >> >> /Contents 4 0 R ${extra} >>`;
const PAGES = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";

describe("the file a signer reviews (Security R2)", () => {
  it("refuses files that viewers can show differently: hidden layers, print-only layers, layer expressions, self-redrawing forms, an object defined twice", async () => {
    const hiddenLayer = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >> >>"],
      [2, PAGES],
      [3, pageWith()],
      [4, text("LATE FEE")],
      [6, "<< /Type /OCG /Name (Layer) >>"],
    ]);
    const printOnlyLayer = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /AS [<< /Event /Print /OCGs [6 0 R] /Category [/Print] >>] >> >> >>"],
      [2, PAGES],
      [3, pageWith()],
      [4, text("LATE FEE")],
      [6, "<< /Type /OCG /Name (Layer) /Usage << /Print << /PrintState /ON >> /View << /ViewState /OFF >> >> >>"],
    ]);
    const byExpression = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << >> >> >>"],
      [2, PAGES],
      [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 ${HELV} >> /Properties << /MC0 7 0 R >> >> >>`],
      [4, stream("/OC /MC0 BDC BT /F1 18 Tf 72 700 Td (LATE FEE) Tj ET EMC")],
      [6, "<< /Type /OCG /Name (Layer) >>"],
      [7, "<< /Type /OCMD /OCGs [6 0 R] /P /AllOff >>"],
    ]);
    const redraws = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /NeedAppearances true >> >>"],
      [2, PAGES],
      [3, pageWith()],
      [4, text("Amount due")],
    ]);
    const twice = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [3, pageWith()],
      [4, text("Fee: USD 100")],
      [4, text("Fee: USD 10000")],
    ]);
    for (const f of [hiddenLayer, printOnlyLayer, byExpression, redraws, twice]) {
      await expect(buildToSign(bytesOf(f.text), "application/pdf")).rejects.toMatchObject({ reason: "viewer_dependent" });
    }
  });

  it("accepts a file saved with an update on top, where redefining an object is how the format works", async () => {
    const base = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [3, pageWith()],
      [4, text("Draft")],
    ]);
    const at = base.text.length;
    const body = `4 0 obj\n${text("Final")}\nendobj\n`;
    const xrefAt = at + body.length;
    const updated = `${base.text}${body}xref\n4 1\n${String(at).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R /Prev ${base.xrefAt} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    expect((await PDFDocument.load(await buildToSign(bytesOf(updated), "application/pdf"))).getPageCount()).toBe(1);
  });

  it("prints what the screen shows: hidden-on-screen notes are dropped, covers that don't print are drawn (R3-1)", async () => {
    const form = (content: string) => `<< /Type /XObject /Subtype /Form /BBox [0 0 330 40] /Resources << /Font << /F1 ${HELV} >> >> /Length ${content.length} >>\nstream\n${content}\nendstream`;
    const e1 = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [3, pageWith("/Annots [5 0 R 6 0 R 8 0 R]")],
      [4, stream("BT /F1 18 Tf 72 700 Td (Seller may terminate at any time.) Tj 0 -60 Td (Fee: USD 100) Tj ET")],
      // NoView + Print: invisible on screen, printed on paper.
      [5, "<< /Type /Annot /Subtype /FreeText /F 36 /Rect [72 600 402 640] /DA (/F1 12 Tf 0 g) /AP << /N 7 0 R >> >>"],
      // No Print flag: a white box over the clause on screen, gone on paper.
      [6, "<< /Type /Annot /Subtype /Square /F 0 /Rect [70 690 400 730] /AP << /N 9 0 R >> >>"],
      [7, form("BT /F1 12 Tf 2 10 Td (LATE FEE USD 10000 PER DAY) Tj ET")],
      // Only a rollover appearance: viewers show nothing until the pointer is over it.
      [8, "<< /Type /Annot /Subtype /Square /F 4 /Rect [72 500 402 540] /AP << /R 10 0 R >> >>"],
      [9, form("1 1 1 rg 0 0 330 40 re f")],
      [10, form("BT /F1 12 Tf 2 10 Td (ROLLOVER TEXT) Tj ET")],
    ]);
    const bytes = await buildToSign(bytesOf(e1.text), "application/pdf");
    const saved = new TextDecoder("latin1").decode(bytes);
    expect(saved).not.toContain("LATE FEE");
    expect(saved).not.toContain("ROLLOVER");
    expect(saved).toContain("1 1 1 rg 0 0 330 40 re f"); // still written, so the page draws it
    const copy = await PDFDocument.load(bytes);
    expect(findings(copy).filter((f) => f.startsWith("annot "))).toEqual([]);
    // Two drawings: the page's own content (kept apart, R4-3) and the cover.
    expect(copy.getPage(0).node.lookup(N("Resources"), PDFDict).lookup(N("XObject"), PDFDict).keys()).toHaveLength(2);
  });

  it("keeps links but never their borders, colours or highlights, whatever their flags (R4-1)", async () => {
    const link = (extra: string) => `<< /Type /Annot /Subtype /Link /Rect [60 690 420 720] /A << /S /URI /URI (https://example.com) >> ${extra} >>`;
    const file = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [3, pageWith("/Annots [5 0 R 6 0 R 7 0 R]")],
      [4, stream("BT /F1 18 Tf 72 700 Td (Seller may terminate at any time.) Tj 0 -60 Td (Fee: USD 100) Tj ET")],
      [5, link("/Border [0 0 30] /C [1 1 1]")], // L7: a white border over the clause on screen
      [6, link("/Border [0 0 30] /C [1 1 1] /F 36")], // L10: the same, printed only
      [7, link("/BS << /W 15 /S /S >> /C [1 1 1] /H /I /BE << /S /C /I 2 >> /IC [1 1 1]")], // L8
    ]);
    const copy = await PDFDocument.load(await buildToSign(bytesOf(file.text), "application/pdf"));
    const links = copy.getPage(0).node.lookup(N("Annots"), PDFArray).asArray().map((r) => copy.context.lookup(r, PDFDict));
    expect(links).toHaveLength(3);
    for (const l of links) {
      expect(l.lookup(N("Border"), PDFArray).asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN))).toEqual([0, 0, 0]);
      for (const key of ["AP", "BS", "C", "H", "BE", "IC"]) expect(l.has(N(key))).toBe(false);
      expect(l.lookup(N("A"), PDFDict).lookup(N("URI"), PDFString).decodeText()).toBe("https://example.com");
    }
  });

  it("drops device-dependent graphics-state keys, keeping a soft mask's own transfer function (R4-2)", async () => {
    const file = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [
        3,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 ${HELV} >> /ExtGState << /G1 << /TR << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [1] /N 1 >> /CA 0.5 /SMask << /Type /Mask /S /Luminosity /G 8 0 R /TR /Identity >> >> /G2 7 0 R >> >> >>`,
      ],
      [4, stream("q /G1 gs /G2 gs BT /F1 18 Tf 72 640 Td (LATE FEE USD 10000 PER DAY) Tj ET Q")],
      [7, "<< /Type /ExtGState /TR2 /Default /BG2 /Default /UCR2 /Default /HT /Default /BG << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >>"],
      [8, "<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Length 0 >>\nstream\n\nendstream"],
    ]);
    const copy = await PDFDocument.load(await buildToSign(bytesOf(file.text), "application/pdf"));
    const states = copy.getPage(0).node.lookup(N("Resources"), PDFDict).lookup(N("ExtGState"), PDFDict);
    const [g1, g2] = ["G1", "G2"].map((k) => states.lookup(N(k), PDFDict));
    for (const g of [g1, g2]) for (const key of ["TR", "TR2", "BG", "BG2", "UCR", "UCR2", "HT"]) expect(g.has(N(key))).toBe(false);
    expect(g1.lookup(N("CA"), PDFNumber).asNumber()).toBe(0.5);
    expect(g1.lookup(N("SMask"), PDFDict).lookup(N("TR"))).toBe(N("Identity"));
  });

  it("draws annotations in a fresh graphics state even if the page leaves some open (R4-3)", async () => {
    const box = `<< /Type /XObject /Subtype /Form /BBox [0 0 330 40] /Length 24 >>\nstream\n1 1 1 rg 0 0 330 40 re f\nendstream`;
    const file = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, PAGES],
      [3, pageWith("/Annots [5 0 R]")],
      // V7d: two unclosed q, the inner one shifting everything after it up by 140.
      [4, stream("BT /F1 18 Tf 72 700 Td (Seller may terminate at any time.) Tj ET q 1 0 0 1 0 140 cm q")],
      [5, "<< /Type /Annot /Subtype /Square /Rect [70 550 400 590] /AP << /N 6 0 R >> >>"],
      [6, box],
    ]);
    const copy = await PDFDocument.load(await buildToSign(bytesOf(file.text), "application/pdf"));
    const contents = copy.getPage(0).node.lookup(N("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => copy.context.lookup(r)) : [contents];
    const content = streams.map((s) => (s instanceof PDFRawStream ? new TextDecoder("latin1").decode(decodePDFRawStream(s).decode()) : "")).join("\n");
    const count = (op: string) => content.split(/\s+/).filter((t) => t === op).length;
    expect(count("q")).toBe(count("Q")); // whatever the page left open stays inside its own drawing
    expect(content).not.toContain("0 140 cm");
  });

  it("signs ordinary forms: an empty signature field, a value the standard font can't draw, a field on no page (R2-3)", async () => {
    const form = rawPdf([
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 7 0 R] >> >>"],
      [2, PAGES],
      [3, pageWith("/Annots [5 0 R 6 0 R]")],
      [4, text("Sign below")],
      [5, "<< /Type /Annot /Subtype /Widget /FT /Sig /T (signature) /Rect [72 100 300 140] /P 3 0 R >>"],
      [6, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V <FEFF005A006F00EB0020014100F300640179> /Rect [72 200 300 230] /P 3 0 R >>"],
      [7, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (stale) /V (left over) /Rect [72 300 300 330] >>"],
    ]);
    const copy = await PDFDocument.load(await buildToSign(bytesOf(form.text), "application/pdf"));
    expect(copy.getPageCount()).toBe(1);
    expect(findings(copy).filter((f) => f === "annot /Widget")).toEqual([]);
    expect(copy.catalog.has(N("AcroForm"))).toBe(false);
  });

  it("keeps internal links pointing at the copy's own pages, with no stray duplicate page (R2-2)", async () => {
    const doc = await PDFDocument.create();
    const [one, two] = [doc.addPage([612, 792]), doc.addPage([612, 792])];
    const c = doc.context;
    const dest = c.register(c.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 700, 200, 720], Dest: [two.ref, "Fit"] }));
    const goTo = c.register(c.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 650, 200, 670], A: { S: "GoTo", D: [two.ref, "Fit"] } }));
    one.node.set(N("Annots"), c.obj([dest, goTo]));
    const copy = await inertCopy(await doc.save());
    const pageTwo = copy.getPage(1).ref;
    const annots = copy.getPage(0).node.lookup(N("Annots"), PDFArray).asArray().map((r) => copy.context.lookup(r, PDFDict));
    expect(annots[0].lookup(N("Dest"), PDFArray).get(0)).toBe(pageTwo);
    expect(annots[1].lookup(N("A"), PDFDict).lookup(N("D"), PDFArray).get(0)).toBe(pageTwo);
    const pages = copy.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.lookup(N("Type")) === N("Page"));
    expect(pages).toHaveLength(2);
  });

  it("leaves no bad-address link actions, mail links with a query, or XFA/RF/AF/PA payloads (R2-4, R2-7)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const c = doc.context;
    const mail = c.register(c.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 700, 200, 720], A: { S: "URI", URI: PDFString.of("mailto:x@example.com?attach=C:\\win.ini") } }));
    const withPa = c.register(c.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 650, 200, 670], PA: { S: "URI", URI: PDFString.of("javascript:pa()") } }));
    page.node.set(N("Annots"), c.obj([mail, withPa]));
    page.node.set(N("Bar"), c.obj({ S: "URI", URI: PDFString.of("javascript:orphan()") })); // no /Type /Action
    page.node.set(N("Extra"), c.obj({ RF: c.register(c.stream("payload")), AF: [], XFA: c.register(c.stream("<xdp/>")) }));
    const saved = new TextDecoder("latin1").decode(await buildToSign(await doc.save(), "application/pdf"));
    for (const gone of ["javascript:", "attach=", "/XFA", "/RF", "/AF", "/PA"]) expect(saved).not.toContain(gone);
  });

  it("appends the certificate as an update: the reviewed bytes are untouched and every new cross-reference entry is right", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base = await buildToSign(await doc.save(), "application/pdf");
    const extra = await PDFDocument.create();
    extra.addPage([612, 792]);
    const signed = await appendPages(base, await extra.save());
    expect(Buffer.from(signed.subarray(0, base.length)).equals(Buffer.from(base))).toBe(true);
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);

    const all = new TextDecoder("latin1").decode(signed);
    const xrefAt = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(all)?.[1]);
    const section = all.slice(xrefAt, all.indexOf("trailer", xrefAt));
    expect(section.startsWith("xref\n")).toBe(true);
    const lines = section.split("\n").slice(1).filter(Boolean);
    let checked = 0;
    for (let i = 0; i < lines.length; ) {
      const [first, count] = lines[i].split(" ").map(Number);
      for (let k = 0; k < count; k++) {
        const [offset, gen] = lines[i + 1 + k].split(" ").map(Number);
        expect(all.startsWith(`${first + k} ${gen} obj`, offset)).toBe(true);
        checked++;
      }
      i += 1 + count;
    }
    expect(checked).toBeGreaterThan(0);
    const prev = Number(/\/Prev (\d+)/.exec(all.slice(xrefAt))?.[1]);
    expect(all.startsWith("xref", prev)).toBe(true);
  });
});
