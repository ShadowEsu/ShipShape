import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFObject } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { flattenForm, makeInert } from "@/lib/pdf/inert";

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

async function inertCopy(bytes: Uint8Array): Promise<PDFDocument> {
  const source = await PDFDocument.load(bytes);
  expect(flattenForm(source)).toBe(true);
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(source, source.getPageIndices())) out.addPage(p);
  makeInert(out);
  return PDFDocument.load(await out.save());
}

describe("makeInert: a copy of someone's PDF can't run anything (Security F3-1..F3-4)", () => {
  it("leaves no trigger, script, unsafe action, unsafe link, active annotation or attachment anywhere", async () => {
    const before = findings(await PDFDocument.load(await hostile()));
    expect(before.length).toBeGreaterThan(20); // the fixture really is hostile

    const copy = await inertCopy(await hostile());
    expect(findings(copy).filter((f) => !f.startsWith("annot "))).toEqual([]);
    // Only display annotations stay: the note, the reply, the square, and the links (unsafe ones lose their action).
    const links = Array.from({ length: 9 }, () => "annot /Link");
    expect(findings(copy).filter((f) => f.startsWith("annot ")).sort()).toEqual([...links, "annot /Square", "annot /Text", "annot /Text"]);
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
