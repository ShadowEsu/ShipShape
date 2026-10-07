export type Severity = "blocker" | "warning" | "missing-document";

/** Where a signal was seen: a file and line in the repo, or a live URL. */
export interface Evidence {
  file: string;
  line?: number;
  snippet?: string;
}

/** Something the scanner noticed, e.g. "sdk:facebook" or "feature:signup". */
export type Signals = Map<string, Evidence[]>;

export interface Rule {
  id: string;
  title: string;
  area: "App store" | "Privacy" | "New laws" | "Accessibility" | "Licenses" | "Security" | "Documents";
  severity: Severity;
  /** Where the rule comes from: guideline, statute or regulator page. */
  source: { name: string; url: string };
  /** ISO date the rule took or takes effect, or "in force" for long standing rules. */
  effective: string;
  /** Plain English summary. States facts, never promises compliance. */
  summary: string;
  /** False until a licensed lawyer has reviewed this rule. */
  reviewed: boolean;
  /** Returns the evidence that triggers this rule, or null when it does not apply. */
  test: (s: Signals) => Evidence[] | null;
}

export interface Finding {
  ruleId: string;
  title: string;
  area: Rule["area"];
  severity: Severity;
  summary: string;
  source: Rule["source"];
  effective: string;
  evidence: Evidence[];
}

export interface ScanResult {
  id: string;
  target: string;
  kind: "repo" | "live";
  createdAt: string;
  rulesAsOf: string;
  signals: Record<string, Evidence[]>;
  findings: Finding[];
  score: number;
}
