import "server-only";
import { z } from "zod";
import { ENTITY_TYPES, PROFILE_FIELDS, type EntityType, type ProfileKey } from "@/lib/profile-fields";
import { isPrintable } from "@/lib/pdf/compose";
import { decryptField, encryptField } from "./crypto";
import { asUser } from "./db";
import { UserError } from "./errors";
import { assertRealData } from "./flags";
import type { Session, Viewer, Workspace } from "./session";
import { recentEnough } from "./session";

export type Ctx = Session & Workspace & Viewer;

export interface Profile {
  values: Record<ProfileKey, string>;
  einLast4: string | null;
  /** fact key -> ISO time it was last confirmed */
  confirmed: Record<string, string>;
  updatedAt: string;
}

const COLUMNS = PROFILE_FIELDS.map((f) => f.key);
// Parameter order of the update in saveProfile ($2…$15).
const SAVE_ORDER: ProfileKey[] = ["legal_name", "dba", "entity_type", "address_line1", "address_line2", "city", "state", "postal_code", "phone", "email", "website", "state_of_formation", "signer_name", "signer_title"];

export async function loadProfile(ctx: Ctx): Promise<Profile> {
  return asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<Record<string, string | null>>(
      "select legal_name, dba, entity_type, address_line1, address_line2, city, state, postal_code, phone, email, website, state_of_formation, signer_name, signer_title, ein_last4, updated_at::text as updated_at from app.profiles where org_id = $1",
      [ctx.orgId],
    );
    const facts = await tx.query<{ key: string; confirmed_at: string }>(
      "select key, confirmed_at::text as confirmed_at from app.profile_facts where org_id = $1",
      [ctx.orgId],
    );
    const values = Object.fromEntries([...COLUMNS, "entity_type"].map((k) => [k, row?.[k] ?? ""])) as Record<ProfileKey, string>;
    return {
      values,
      einLast4: row?.ein_last4 ?? null,
      confirmed: Object.fromEntries(facts.map((f) => [f.key, f.confirmed_at])),
      updatedAt: row?.updated_at ?? "",
    };
  });
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(isPrintable, "Use letters, numbers and common punctuation (the PDF fonts can't print some characters).");

// Every profile text field is validated the same way.
const textShape = {} as Record<Exclude<ProfileKey, "entity_type">, z.ZodString>;
for (const f of PROFILE_FIELDS) textShape[f.key as Exclude<ProfileKey, "entity_type">] = text(f.max);

export const ProfileInput = z.object({
  ...textShape,
  entity_type: z.union([z.literal(""), z.enum(Object.keys(ENTITY_TYPES) as [EntityType, ...EntityType[]])]),
});

/** Saves the profile and marks every saved fact as confirmed now, by this person. */
export async function saveProfile(ctx: Ctx, input: Record<ProfileKey, string>) {
  assertRealData(ctx);
  const values = ProfileInput.parse(input);
  const keys = SAVE_ORDER;
  await asUser(ctx.userId, async (tx) => {
    await tx.query(
      "update app.profiles set legal_name = $2, dba = $3, entity_type = $4, address_line1 = $5, address_line2 = $6, city = $7, state = $8, postal_code = $9, phone = $10, email = $11, website = $12, state_of_formation = $13, signer_name = $14, signer_title = $15 where org_id = $1",
      [ctx.orgId, ...SAVE_ORDER.map((k) => values[k] || null)],
    );
    await tx.query("select app.confirm_facts($1, $2)", [ctx.orgId, keys.filter((k) => values[k])]);
  });
}

// Pages people outside the workspace open show its name under ShipShape's own (Security RN-2, RN-3):
// it can't claim to be ShipShape or carry a web or email address.
// ShipShape at a word edge ("ShipShapes", "MyShipShape"), or CamelCased into others ("ShipShapeHQ") (RN-4).
const POSES_AS_SHIPSHAPE = [
  /(?:^|[^a-z])ship[\s._-]*shape|ship[\s._-]*shape(?:$|[^a-z])/i,
  /(?:^|[a-z0-9])Ship[\s._-]*Shape/,
  /Ship[\s._-]*Shape(?=[A-Z0-9]|$)/,
];
const WorkspaceName = z
  .string()
  .trim()
  .min(1, "Give your workspace a name.")
  .max(120, "Use 120 characters or fewer.")
  .refine(isPrintable, "Use letters, numbers and common punctuation.")
  .refine((s) => !POSES_AS_SHIPSHAPE.some((re) => re.test(s)), "Use your own business's name; it can't include ShipShape.")
  .refine((s) => !s.includes("://") && !s.includes("@"), "Leave web and email addresses out of the name.");

/**
 * Renames the workspace: the name people outside it see on its passport links, signature requests
 * and Collect pages. Owners and admins; the rename goes into the workspace history (0024).
 */
export async function renameWorkspace(ctx: Ctx, raw: unknown): Promise<string> {
  assertRealData(ctx);
  const parsed = WorkspaceName.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const rows = await asUser(ctx.userId, (tx) => tx.query("update app.organizations set name = $2 where id = $1 returning 1", [ctx.orgId, parsed.data]));
  if (!rows.length) throw new UserError("Only owners and admins can rename the workspace.");
  return parsed.data;
}

/** EIN: 9 digits, saved encrypted; only the last 4 are kept in clear for display. */
export const EinInput = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^[0-9]{9}$/.test(s), "An EIN has 9 digits, like 12-3456789.");

export async function saveEin(ctx: Ctx, raw: string) {
  assertRealData(ctx);
  const digits = EinInput.parse(raw);
  const ein = `${digits.slice(0, 2)}-${digits.slice(2)}`;
  await asUser(ctx.userId, async (tx) => {
    await tx.query("select app.set_tax_id($1, 'ein', $2, $3)", [ctx.orgId, encryptField(ein, ctx.orgId, "ein"), digits.slice(-4)]);
    await tx.query("select app.confirm_facts($1, array['ein'])", [ctx.orgId]);
  });
}

export class NeedsRecentSignIn extends Error {}

/** Shows the full EIN: a deliberate, audited action that needs a recent sign-in (Security R4, R8). */
export async function revealEin(ctx: Ctx): Promise<string | null> {
  if (!recentEnough(ctx)) throw new NeedsRecentSignIn("For your security, sign in again to see the full EIN.");
  return asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<{ ein_cipher: string | null }>("select ein_cipher from app.profiles where org_id = $1", [ctx.orgId]);
    if (!row?.ein_cipher) return null;
    await tx.query("select app.audit_append($1, 'profile.tax_id_revealed', $1)", [ctx.orgId]);
    return decryptField(row.ein_cipher, ctx.orgId, "ein");
  });
}

/** Server-only: the full facts a template needs, including the decrypted EIN. Never sent to the browser. */
export async function factsForFill(ctx: Ctx): Promise<Profile & { ein: string | null }> {
  const profile = await loadProfile(ctx);
  const ein = await asUser(ctx.userId, async (tx) => {
    const [row] = await tx.query<{ ein_cipher: string | null }>("select ein_cipher from app.profiles where org_id = $1", [ctx.orgId]);
    return row?.ein_cipher ? decryptField(row.ein_cipher, ctx.orgId, "ein") : null;
  });
  return { ...profile, ein };
}
