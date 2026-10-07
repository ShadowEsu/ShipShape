import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScanResult } from "./types";

/**
 * Local store for development: one JSON file in .data/.
 * Production uses the same shapes in Postgres (see supabase/migrations).
 */

export interface DocVersion {
  version: number;
  createdAt: string;
  content: string;
  sha256: string;
  fromScan?: string;
}
export interface VaultDoc {
  id: string;
  title: string;
  kind: "privacy-policy" | "terms" | "store-answers" | "agreement";
  versions: DocVersion[];
}
export interface SignatureRequest {
  id: string;
  documentId: string;
  version: number;
  sha256: string;
  signerName: string;
  signerEmail: string;
  status: "pending" | "signed";
  createdAt: string;
  signed?: { typedName: string; at: string; ip: string; userAgent: string; consent: string };
}
export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  detail: string;
  prevHash: string;
  hash: string;
}
interface DB {
  scans: ScanResult[];
  documents: VaultDoc[];
  signatures: SignatureRequest[];
  audit: AuditEntry[];
  waitlist: { email: string; at: string }[];
}

const FILE = path.join(process.env.SHIPSHAPE_DATA_DIR ?? path.join(process.cwd(), ".data"), "db.json");
const EMPTY: DB = { scans: [], documents: [], signatures: [], audit: [], waitlist: [] };

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function load(): Promise<DB> {
  try {
    return { ...EMPTY, ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function save(db: DB) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, FILE);
}

// Serialize writes so two requests can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function write<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await load();
    const out = await fn(db);
    await save(db);
    return out;
  });
  queue = next.catch(() => undefined);
  return next;
}

/** Append only, and each entry hashes the one before it, so a quiet edit breaks the chain. */
function audit(db: DB, action: string, detail: string) {
  const prev = db.audit.at(-1);
  const entry = { seq: (prev?.seq ?? 0) + 1, at: new Date().toISOString(), action, detail, prevHash: prev?.hash ?? "genesis" };
  db.audit.push({ ...entry, hash: sha256(JSON.stringify(entry)) });
}

export function verifyAuditChain(entries: AuditEntry[]) {
  return entries.every((e, i) => {
    const { hash, ...rest } = e;
    return hash === sha256(JSON.stringify(rest)) && e.prevHash === (i === 0 ? "genesis" : entries[i - 1].hash);
  });
}

export const store = {
  read: load,

  saveScan: (scan: ScanResult) =>
    write((db) => {
      db.scans.unshift(scan);
      audit(db, "scan.completed", `${scan.kind} scan of ${scan.target}: ${scan.findings.length} findings`);
      return scan;
    }),

  /** Adds a new version of a document. Old versions are never changed or removed. */
  saveDocument: (title: string, kind: VaultDoc["kind"], content: string, fromScan?: string) =>
    write((db) => {
      let doc = db.documents.find((d) => d.title === title && d.kind === kind);
      if (!doc) {
        doc = { id: randomUUID(), title, kind, versions: [] };
        db.documents.unshift(doc);
      }
      const version = { version: doc.versions.length + 1, createdAt: new Date().toISOString(), content, sha256: sha256(content), fromScan };
      doc.versions.push(version);
      audit(db, "document.version", `${title} v${version.version} sha256:${version.sha256.slice(0, 12)}`);
      return { doc, version };
    }),

  requestSignature: (documentId: string, signerName: string, signerEmail: string) =>
    write((db) => {
      const doc = db.documents.find((d) => d.id === documentId);
      if (!doc) throw new Error("Document not found");
      const latest = doc.versions.at(-1)!;
      const req: SignatureRequest = {
        id: randomUUID(),
        documentId,
        version: latest.version,
        sha256: latest.sha256,
        signerName,
        signerEmail,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      db.signatures.unshift(req);
      audit(db, "signature.requested", `${doc.title} v${latest.version} sent to ${signerEmail}`);
      return req;
    }),

  sign: (id: string, signed: NonNullable<SignatureRequest["signed"]>) =>
    write((db) => {
      const req = db.signatures.find((s) => s.id === id);
      if (!req) throw new Error("Signature request not found");
      if (req.status === "signed") throw new Error("Already signed");
      const doc = db.documents.find((d) => d.id === req.documentId)!;
      const version = doc.versions.find((v) => v.version === req.version)!;
      if (version.sha256 !== req.sha256) throw new Error("Document changed after the request was sent");
      req.status = "signed";
      req.signed = signed;
      audit(db, "signature.signed", `${doc.title} v${req.version} signed by ${signed.typedName} from ${signed.ip}`);
      return req;
    }),

  joinWaitlist: (email: string) =>
    write((db) => {
      if (!db.waitlist.some((w) => w.email === email)) db.waitlist.push({ email, at: new Date().toISOString() });
    }),
};
