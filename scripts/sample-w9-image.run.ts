// Makes the sample W-9's preview images (lib/server/sample.ts SAMPLE_W9_IMAGES) from sampleW9Pdf(""): the sample's W-9
// with the signature date left blank. Runs under vitest for the "@/" paths, but is never part of `npm test`:
//
//   npm run sample:w9-image      (needs poppler's pdftoppm and libwebp's cwebp: brew install poppler webp)
//
// Writes public/sample/w9-<number>-top.webp (the crop's top of the page) and w9-<number>.webp (the sheet's whole page)
// for SAMPLE_W9_IMAGES.number, and prints the page's hash for SAMPLE_W9_IMAGES.page. When the page has changed, raise
// `number` (and the two file names) first, then delete the older files.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "vitest";
import { pageHash } from "@/tests/support/page-hash";
import { SAMPLE_W9_IMAGES, sampleW9Pdf } from "@/lib/server/sample";

it("makes the sample W-9's preview images", async () => {
  const { number, crop, full } = SAMPLE_W9_IMAGES;
  const publicDir = path.join(import.meta.dirname, "..", "public");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "shipshape-w9-"));
  try {
    const pdf = await sampleW9Pdf("");
    await writeFile(path.join(tmp, "w9.pdf"), pdf);
    const page1 = ["-f", "1", "-l", "1", "-singlefile", "-png"];
    // The top of the page at the crop's width (cut to its height), and the whole page at the sheet's.
    execFileSync("pdftoppm", [...page1, "-scale-to-x", `${crop.width}`, "-scale-to-y", "-1", "-W", `${crop.width}`, "-H", `${crop.height}`, "w9.pdf", "top"], { cwd: tmp });
    execFileSync("pdftoppm", [...page1, "-scale-to-x", `${full.width}`, "-scale-to-y", `${full.height}`, "w9.pdf", "full"], { cwd: tmp });
    await mkdir(path.join(publicDir, "sample"), { recursive: true });
    execFileSync("cwebp", ["-quiet", "-q", "60", path.join(tmp, "top.png"), "-o", path.join(publicDir, crop.src)]);
    execFileSync("cwebp", ["-quiet", "-q", "60", path.join(tmp, "full.png"), "-o", path.join(publicDir, full.src)]);
    console.log(`made ${crop.src} and ${full.src}; SAMPLE_W9_IMAGES.page for number ${number}: "${await pageHash(pdf)}"`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
