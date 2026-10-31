import { describe, expect, it } from "vitest";
import { PROFILE_FIELDS } from "@/lib/profile-fields";
import { TEMPLATES } from "@/lib/templates/catalog";

const max = (key: string) => PROFILE_FIELDS.find((f) => f.key === key)?.max ?? 0;

/** A fact at its longest still fits every form field it prefills (review #13): nobody gets "Up to N characters" on a value they never typed. */
describe("business facts", () => {
  it("are never longer than the template fields they fill", () => {
    const longest: Record<string, number> = {
      address: max("address_line1") + ", ".length + max("address_line2"),
      city_state_zip: max("city") + ", ".length + max("state") + " ".length + max("postal_code"),
      entity_type: 0,
      ein: "••-•••1234".length,
    };
    const checked: string[] = [];
    for (const t of TEMPLATES) {
      for (const f of t.fields) {
        if (!f.fact || !f.max) continue;
        const need = f.fact in longest ? longest[f.fact] : max(f.fact);
        expect(need, `${t.id}.${f.key} (${f.fact})`).toBeLessThanOrEqual(f.max);
        checked.push(`${t.id}.${f.key}`);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });
});
