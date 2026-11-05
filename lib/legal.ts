/** Version of /terms and /privacy recorded with every agreement; change it whenever either text changes. */
export const TERMS_VERSION = "2026-11-04.5";

/**
 * How long deleted data can stay in backups, as every deletion promise says it (Privacy, Delete for good). 14, not the
 * 7 the backups are set to (storage.yaml NoncurrentDays, database.yaml BackupRetentionPeriod): S3 removes expired
 * versions asynchronously with no stated bound, and RDS's last snapshot outlives a deletion by up to about a day
 * (aws-plan BOSS rule 1; Security 2026-11-04 #33).
 */
export const BACKUP_DAYS = 14;

/** Shown with a required, unticked checkbox before a filled document is created (legal-risk-playbook §2, §6). */
export const ACK_VERSION = "ack-2026-10-30";
export const ACK_TEXT =
  "I understand ShipShape fills in forms and is not a law firm or a tax adviser, and doesn't give legal or tax advice. I've reviewed every field, I'm responsible for what this document says, and I'll get professional advice if I need it.";
