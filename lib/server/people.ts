import "server-only";
import { z } from "zod";
import { isPrintable } from "@/lib/pdf/compose";
import { asUser, pgErrorCode, type Tx } from "./db";
import { UserError } from "./errors";
import { rateLimited } from "./http";
import { PEOPLE_BUSY, PEOPLE_FULL, PEOPLE_MAX, PEOPLE_PER_HOUR } from "./limits";
import type { Ctx } from "./profile";

/**
 * People (0046): the contacts a workspace keeps on purpose (spec-people-2026-11-03). A row is made only when a member
 * types one in, keeps a signer from a signature request ("Keep in People", which copies the owner-typed name and email,
 * Security P2), or by the sample seeder. Every member reads them, emails included (Security's ruling); owners, admins and
 * whoever added one change or delete it. Every query runs under the caller's row level security and names this workspace.
 */

export type ContactSource = "typed" | "signer" | "sample";

export interface Person {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  source: ContactSource;
  createdAt: string;
  /** This workspace's signature requests to exactly this email, on documents that aren't archived (Security SHOULD). */
  requests: number;
  /** Whether the viewer may edit or delete it: an owner or admin, or the member who added it (the policies' rule). */
  canChange: boolean;
}

/** A signature request to a person, for their page: each links to its document (active documents only). */
export interface PersonRequest {
  id: string;
  documentId: string;
  title: string;
  status: "pending" | "signed" | "declined" | "revoked";
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
}

/** Shown for an id that isn't a person in this workspace (gone, another workspace's, or not an id). */
export const PERSON_GONE = "That person isn't in People any more.";
/** A member asked to change or delete someone another member added (the update and delete policies refuse it too). */
export const PERSON_NOT_YOURS = "Only owners, admins and the member who added this person can change or delete them.";
/** "Keep in People" with a request id that isn't one of this workspace's: the same words whether it exists elsewhere or not. */
export const KEEP_GONE = "That signature request isn't in this workspace, so nobody was added to People.";

const PersonInput = z.object({
  name: z.string().trim().min(1, "Give the person a name.").max(120, "Keep it to 120 characters.").refine(isPrintable, "Use letters, numbers and common punctuation."),
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("That email address doesn't look right. Check it, or leave the field empty.").max(200)]))
    .optional()
    .transform((s) => s || null),
  company: z
    .string()
    .trim()
    .max(120, "Keep it to 120 characters.")
    .refine((s) => s === "" || isPrintable(s), "Use letters, numbers and common punctuation.")
    .optional()
    .transform((s) => s || null),
});

export type PersonFields = z.output<typeof PersonInput>;

const PersonId = z.uuid();

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  source: ContactSource;
  created_by: string | null;
  created_at: string;
  requests: number;
}

// The count is this workspace's requests to exactly the contact's address (compared without case, as the unique index
// does), on documents that aren't archived; a deleted document's requests are gone with its versions (0003's cascade).
const PEOPLE_SQL = `
  with counts as (
    select lower(r.signer_email) as email, count(*)::int as n
    from app.signature_requests r
    join app.documents d on d.id = r.document_id and d.org_id = r.org_id and d.status = 'active'
    where r.org_id = $1
    group by 1
  )
  select c.id, c.name, c.email, c.company, c.source, c.created_by, c.created_at::text as created_at, coalesce(n.n, 0) as requests
  from app.contacts c
  left join counts n on c.email is not null and n.email = lower(c.email)
  where c.org_id = $1 and ($2::uuid is null or c.id = $2)
  order by lower(c.name), c.id`;

const mayChange = (ctx: Ctx, createdBy: string | null) => ctx.role === "owner" || ctx.role === "admin" || createdBy === ctx.userId;

const toPerson = (ctx: Ctx, r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  company: r.company,
  source: r.source,
  createdAt: r.created_at,
  requests: r.requests,
  canChange: mayChange(ctx, r.created_by),
});

/** This workspace's people, A to Z, each with its signature request count. */
export async function listPeople(ctx: Ctx): Promise<Person[]> {
  const rows = await asUser(ctx.userId, (tx) => tx.query<PersonRow>(PEOPLE_SQL, [ctx.orgId, null]));
  return rows.map((r) => toPerson(ctx, r));
}

/** One person of this workspace with their signature requests (newest first, active documents only), or null. */
export async function getPerson(ctx: Ctx, id: string): Promise<{ person: Person; requests: PersonRequest[] } | null> {
  if (!PersonId.safeParse(id).success) return null;
  return asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<PersonRow>(PEOPLE_SQL, [ctx.orgId, id]);
    if (!row) return null;
    const requests = row.email
      ? await tx.query<PersonRequest>(
          `select r.id, r.document_id as "documentId", d.title, r.status, r.created_at::text as "createdAt", r.expires_at::text as "expiresAt", r.signed_at::text as "signedAt"
           from app.signature_requests r
           join app.documents d on d.id = r.document_id and d.org_id = r.org_id and d.status = 'active'
           where r.org_id = $1 and lower(r.signer_email) = lower($2)
           order by r.created_at desc, r.id`,
          [ctx.orgId, row.email],
        )
      : [];
    return { person: toPerson(ctx, row), requests };
  });
}

/** The name and email to fill a signature request with, for "Ask to sign" from a person's page; null without an email. */
export async function signerFor(ctx: Ctx, id: string): Promise<{ name: string; email: string } | null> {
  if (!PersonId.safeParse(id).success) return null;
  const [row] = await asUser(ctx.userId, (tx) =>
    tx.query<{ name: string; email: string | null }>("select name, email from app.contacts where id = $1 and org_id = $2", [id, ctx.orgId]),
  );
  return row?.email ? { name: row.name, email: row.email } : null;
}

/** How many documents "Ask to sign" on a person's page offers at once. */
export const ASK_TO_SIGN_MAX = 50;

/**
 * The documents "Ask to sign" offers: this workspace's active documents with a file (the ones whose page has the signature
 * request form), of the given kinds when `kinds` is set, A to Z.
 */
export async function documentsToSign(ctx: Ctx, kinds: readonly string[] | null): Promise<{ id: string; title: string; kind: string }[]> {
  return asUser(ctx.userId, (tx) =>
    tx.query<{ id: string; title: string; kind: string }>(
      `select d.id, d.title, d.kind from app.documents d
       where d.org_id = $1 and d.status = 'active' and ($2::text[] is null or d.kind = any($2::text[]))
         and exists (select 1 from app.document_versions v where v.document_id = d.id)
       order by lower(d.title), d.id
       limit $3`,
      [ctx.orgId, kinds, ASK_TO_SIGN_MAX],
    ),
  );
}

/** Which of these addresses are already in People (lowercased), for the document page's "Keep in People" / "In People". */
export async function keptEmails(ctx: Ctx, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query<{ email: string }>("select lower(email) as email from app.contacts where org_id = $1 and lower(email) = any($2::text[])", [
      ctx.orgId,
      emails.map((e) => e.toLowerCase()),
    ]),
  );
  return new Set(rows.map((r) => r.email));
}

/** Who already has this address in the workspace, if anyone. */
async function holderOf(tx: Tx, ctx: Ctx, email: string, except: string | null = null): Promise<{ id: string; name: string } | undefined> {
  const [row] = await tx.query<{ id: string; name: string }>(
    "select id, name from app.contacts where org_id = $1 and lower(email) = lower($2) and ($3::uuid is null or id <> $3)",
    [ctx.orgId, email, except],
  );
  return row;
}

/** The cap, asked before an insert so the person gets words; 0046's trigger refuses the 501st on its own (Security P4). */
async function assertRoom(tx: Tx, ctx: Ctx) {
  const [row] = await tx.query<{ n: number }>("select count(*)::int as n from app.contacts where org_id = $1", [ctx.orgId]);
  if (row.n >= PEOPLE_MAX) throw new UserError(PEOPLE_FULL);
}

/** Runs an insert or update, turning the database's own refusals (a race past the checks above) into words. */
async function refusalsAsWords<T>(run: () => Promise<T>, email: string | null): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (pgErrorCode(e) === "SS002") throw new UserError(PEOPLE_FULL);
    if (pgErrorCode(e) === "23505" && email) throw new UserError("That email is already in People. Nothing was saved.");
    throw e;
  }
}

/** Adds a person typed on People. Returns their id. */
export async function addPerson(ctx: Ctx, input: unknown): Promise<string> {
  const p = PersonInput.parse(input);
  if (await rateLimited("people", ctx.userId, PEOPLE_PER_HOUR, 3600)) throw new UserError(PEOPLE_BUSY);
  return refusalsAsWords(
    () =>
      asUser(ctx.userId, async (tx) => {
        await assertRoom(tx, ctx);
        const holder = p.email ? await holderOf(tx, ctx, p.email) : undefined;
        if (holder) throw new UserError(`That email is already in People, as ${holder.name}. Nothing was added.`);
        const [row] = await tx.query<{ id: string }>(
          "insert into app.contacts (org_id, name, email, company, source, created_by) values ($1, $2, $3, $4, 'typed', $5) returning id",
          [ctx.orgId, p.name, p.email, p.company, ctx.userId],
        );
        return row.id;
      }),
    p.email,
  );
}

/** The row as the caller may change it: PERSON_GONE when it isn't in this workspace, PERSON_NOT_YOURS when it's someone else's. */
async function assertMayChange(tx: Tx, ctx: Ctx, id: string) {
  const [row] = await tx.query<{ created_by: string | null }>("select created_by from app.contacts where id = $1 and org_id = $2", [id, ctx.orgId]);
  if (!row) throw new UserError(PERSON_GONE);
  if (!mayChange(ctx, row.created_by)) throw new UserError(PERSON_NOT_YOURS);
}

/** Changes a person's name, email and company. */
export async function editPerson(ctx: Ctx, id: string, input: unknown): Promise<void> {
  if (!PersonId.safeParse(id).success) throw new UserError(PERSON_GONE);
  const p = PersonInput.parse(input);
  await refusalsAsWords(
    () =>
      asUser(ctx.userId, async (tx) => {
        await assertMayChange(tx, ctx, id);
        const holder = p.email ? await holderOf(tx, ctx, p.email, id) : undefined;
        if (holder) throw new UserError(`That email is already in People, as ${holder.name}. Nothing was saved.`);
        const rows = await tx.query("update app.contacts set name = $3, email = $4, company = $5 where id = $1 and org_id = $2 returning 1", [
          id,
          ctx.orgId,
          p.name,
          p.email,
          p.company,
        ]);
        if (!rows.length) throw new UserError(PERSON_NOT_YOURS);
      }),
    p.email,
  );
}

/** Deletes a person from People (the row goes; signature requests keep their own name and email). */
export async function deletePerson(ctx: Ctx, id: string): Promise<void> {
  if (!PersonId.safeParse(id).success) throw new UserError(PERSON_GONE);
  await asUser(ctx.userId, async (tx) => {
    await assertMayChange(tx, ctx, id);
    const rows = await tx.query("delete from app.contacts where id = $1 and org_id = $2 returning 1", [id, ctx.orgId]);
    if (!rows.length) throw new UserError(PERSON_NOT_YOURS);
  });
}

/** What "Keep in People" did: the person (new, or the one already holding the address) and the request's document, to go back to. */
export type KeepResult = { kept: "added" | "already"; id: string; name: string; documentId: string };

/**
 * "Keep in People" beside a signer (Security P2): the form sends only the request's id. The name and email come from the
 * request itself, read under the caller's row level security in this workspace: the ones the owner typed when asking for
 * the signature, never anything the signer typed. Another workspace's request, or none, adds nothing (KEEP_GONE).
 * An address already in People adds nothing and says who has it.
 */
export async function keepSigner(ctx: Ctx, requestId: unknown): Promise<KeepResult> {
  const id = PersonId.safeParse(requestId);
  if (!id.success) throw new UserError(KEEP_GONE);
  const signer = await asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<{ signer_name: string; signer_email: string; document_id: string }>(
      "select signer_name, signer_email, document_id from app.signature_requests where id = $1 and org_id = $2",
      [id.data, ctx.orgId],
    );
    if (!row) return null;
    const holder = await holderOf(tx, ctx, row.signer_email);
    return { name: row.signer_name, email: row.signer_email, documentId: row.document_id, holder };
  });
  if (!signer) throw new UserError(KEEP_GONE);
  const { documentId } = signer;
  if (signer.holder) return { kept: "already", ...signer.holder, documentId };
  if (await rateLimited("people", ctx.userId, PEOPLE_PER_HOUR, 3600)) throw new UserError(PEOPLE_BUSY);
  return refusalsAsWords(
    () =>
      asUser(ctx.userId, async (tx): Promise<KeepResult> => {
        await assertRoom(tx, ctx);
        const holder = await holderOf(tx, ctx, signer.email);
        if (holder) return { kept: "already", ...holder, documentId };
        const [row] = await tx.query<{ id: string }>(
          "insert into app.contacts (org_id, name, email, source, created_by) values ($1, $2, $3, 'signer', $4) returning id",
          [ctx.orgId, signer.name, signer.email, ctx.userId],
        );
        return { kept: "added", id: row.id, name: signer.name, documentId };
      }),
    signer.email,
  );
}

/** What ⌘K shows for a person: their page, name and company. Never the email (spec §8). */
export interface PersonHit {
  id: string;
  name: string;
  company: string | null;
}

/** ⌘K lists at most this many people. */
export const PEOPLE_SEARCH_MAX = 6;

/**
 * ⌘K's people (spec §8, Security S6): this workspace's contacts whose name or company holds the words, under row level
 * security. Never by email, and never a visitor. No words, no rows; LIKE's own wildcards in the words match themselves.
 */
export async function searchPeople(ctx: Ctx, q: string): Promise<PersonHit[]> {
  const words = Array.from(q, (c) => ((c.codePointAt(0) ?? 0) < 0x20 || c === "\u007f" ? " " : c))
    .join("")
    .trim()
    .slice(0, 100);
  if (words === "") return [];
  const pattern = `%${words.replace(/[\\%_]/g, "\\$&")}%`;
  return asUser(ctx.userId, (tx) =>
    tx.query<PersonHit>(
      "select id, name, company from app.contacts where org_id = $1 and (name ilike $2 or company ilike $2) order by lower(name), id limit $3",
      [ctx.orgId, pattern, PEOPLE_SEARCH_MAX],
    ),
  );
}

/** The sample workspace's people: made up, marked "(sample)", with .example addresses only (spec §2.3). */
const SAMPLE_PEOPLE: readonly { name: string; company: string; email: string }[] = [
  { name: "Jordan Lee (sample)", company: "Northwind Builders (sample)", email: "jordan.lee@northwind.example" },
  { name: "Dana Kim (sample)", company: "Bayside Drywall (sample)", email: "dana.kim@bayside.example" },
  { name: "Priya Shah (sample)", company: "Summit Supply Co. (sample)", email: "priya.shah@summit.example" },
];

/** Runs inside seedSampleWorkspace's transaction, as the sample's owner. */
export async function seedSamplePeople(tx: Tx, ctx: Ctx) {
  for (const p of SAMPLE_PEOPLE) {
    await tx.query("insert into app.contacts (org_id, name, email, company, source, created_by) values ($1, $2, $3, $4, 'sample', $5)", [
      ctx.orgId,
      p.name,
      p.email,
      p.company,
      ctx.userId,
    ]);
  }
}
