import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let mod: typeof import("@/lib/store");

beforeAll(async () => {
  process.env.SHIPSHAPE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "shipshape-store-"));
  mod = await import("@/lib/store");
});

describe("vault and audit log", () => {
  it("keeps every version, signs the exact version sent, and chains the audit log", async () => {
    const { store, verifyAuditChain, sha256 } = mod;
    const { doc } = await store.saveDocument("NDA", "agreement", "v1 text");
    await store.saveDocument("NDA", "agreement", "v2 text");
    const req = await store.requestSignature(doc.id, "Ada", "ada@example.com");
    expect(req.version).toBe(2);
    expect(req.sha256).toBe(sha256("v2 text"));

    await store.sign(req.id, { typedName: "Ada", at: new Date().toISOString(), ip: "203.0.113.5", userAgent: "test", consent: "I agree" });
    await expect(store.sign(req.id, { typedName: "Ada", at: "", ip: "", userAgent: "", consent: "" })).rejects.toThrow("Already signed");

    const db = await store.read();
    expect(db.documents[0].versions.map((v) => v.content)).toEqual(["v1 text", "v2 text"]);
    expect(verifyAuditChain(db.audit)).toBe(true);

    db.audit[1].detail = "quietly edited";
    expect(verifyAuditChain(db.audit)).toBe(false);
  });
});
