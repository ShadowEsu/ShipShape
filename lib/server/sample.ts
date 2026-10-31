import "server-only";
import type { Tx } from "./db";
import { encryptField } from "./crypto";

/**
 * The sample workspace: a fictional plumbing business. Its EIN starts with 00, a prefix the IRS
 * never assigns, so it can't belong to anyone.
 */
export const SAMPLE_EIN = "00-1234567";

export async function seedSampleWorkspace(tx: Tx, orgId: string, userId: string) {
  await tx.query(
    `update app.profiles set legal_name = 'Harbor Plumbing LLC', dba = 'Harbor Plumbing', entity_type = 'llc_single',
       address_line1 = '100 Example Street', city = 'Springfield', state = 'CA', postal_code = '90000', country = 'US',
       phone = '(555) 010-0100', email = 'office@harbor-plumbing.example', state_of_formation = 'California',
       signer_name = 'Alex Rivera', signer_title = 'Owner'
     where org_id = $1`,
    [orgId],
  );
  await tx.query("select app.set_tax_id($1, 'ein', $2, $3)", [orgId, encryptField(SAMPLE_EIN, orgId, "ein"), SAMPLE_EIN.slice(-4)]);
  void userId;
}
