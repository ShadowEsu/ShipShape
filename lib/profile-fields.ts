/** Business facts (Memory): the profile fields a business confirms once and reuses everywhere. */

export const ENTITY_TYPES = {
  individual: "Individual",
  sole_prop: "Sole proprietor",
  llc_single: "Single-member LLC",
  llc_partnership: "LLC taxed as a partnership",
  llc_c: "LLC taxed as a C corporation",
  llc_s: "LLC taxed as an S corporation",
  c_corp: "C corporation",
  s_corp: "S corporation",
  partnership: "Partnership",
  trust: "Trust or estate",
  other: "Other",
} as const;

export type EntityType = keyof typeof ENTITY_TYPES;

export interface ProfileField {
  key: ProfileKey;
  label: string;
  hint?: string;
  autoComplete?: string;
  max: number;
}

export type ProfileKey =
  | "legal_name"
  | "dba"
  | "entity_type"
  | "address_line1"
  | "address_line2"
  | "city"
  | "state"
  | "postal_code"
  | "phone"
  | "email"
  | "website"
  | "state_of_formation"
  | "signer_name"
  | "signer_title";

export const PROFILE_FIELDS: ProfileField[] = [
  { key: "legal_name", label: "Legal name", hint: "Exactly as the IRS has it (for a sole proprietor, the owner's name).", autoComplete: "organization", max: 200 },
  { key: "dba", label: "Business name (DBA)", hint: "If different from the legal name.", max: 200 },
  { key: "address_line1", label: "Street address", autoComplete: "address-line1", max: 200 },
  { key: "address_line2", label: "Suite or unit", autoComplete: "address-line2", max: 200 },
  { key: "city", label: "City", autoComplete: "address-level2", max: 100 },
  { key: "state", label: "State", autoComplete: "address-level1", max: 50 },
  { key: "postal_code", label: "ZIP code", autoComplete: "postal-code", max: 20 },
  { key: "phone", label: "Phone", autoComplete: "tel", max: 40 },
  { key: "email", label: "Business email", autoComplete: "email", max: 200 },
  { key: "website", label: "Website", autoComplete: "url", max: 200 },
  { key: "state_of_formation", label: "State of formation", hint: "Where the business was registered.", max: 50 },
  { key: "signer_name", label: "Who signs", hint: "The person who usually signs for the business.", autoComplete: "name", max: 200 },
  { key: "signer_title", label: "Their title", autoComplete: "organization-title", max: 100 },
];

export const FACT_LABELS: Record<string, string> = {
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f.label])),
  entity_type: "Business type",
  ein: "EIN",
};

/** Facts older than this get a "still true?" prompt before they're used. */
export const STALE_AFTER_DAYS = 365;

export const maskEin = (last4: string | null) => (last4 ? `••-•••${last4}` : null);
