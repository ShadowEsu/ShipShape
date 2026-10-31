import type { ProfileKey } from "@/lib/profile-fields";

/** Client-safe description of a fillable template (no rendering code). */
export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  kind: "text" | "textarea" | "date" | "number" | "radio" | "checkbox" | "secret";
  options?: { value: string; label: string }[];
  required?: boolean;
  max?: number;
  /** Prefilled from this business fact (shown with a source chip). */
  fact?: ProfileKey | "ein" | "city_state_zip" | "address";
  /** Only shown when another field has this value. */
  when?: { key: string; equals: string };
  section: string;
}

export interface TemplateInfo {
  id: string;
  title: string;
  short: string;
  kind: "w9" | "nda";
  summary: string;
  source: { name: string; url: string; license: string; version: string; instructions?: string };
  fields: FieldDef[];
  /** What signing or finishing this document means, shown before the acknowledgment. */
  finishNote: string;
}

export interface Facts {
  values: Record<ProfileKey, string>;
  ein: string | null;
  einLast4: string | null;
}

export interface Rendered {
  bytes: Uint8Array;
  title: string;
  counterparty: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
}
