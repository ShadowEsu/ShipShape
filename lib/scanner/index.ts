import { randomUUID } from "node:crypto";
import { RULES, RULES_AS_OF, SEVERITY_ORDER } from "../rules";
import type { Finding, ScanResult, Signals } from "../types";

export function matchRules(signals: Signals): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const evidence = rule.test(signals);
    if (!evidence) continue;
    const { id, title, area, severity, summary, source, effective } = rule;
    findings.push({ ruleId: id, title, area, severity, summary, source, effective, evidence });
  }
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** A rough readiness score for the dashboard. It ranks work to do; it is not a compliance rating. */
export function score(findings: Finding[]) {
  const cost = { blocker: 20, "missing-document": 8, warning: 4 } as const;
  return Math.max(0, 100 - findings.reduce((n, f) => n + cost[f.severity], 0));
}

export function buildResult(target: string, kind: ScanResult["kind"], signals: Signals): ScanResult {
  const findings = matchRules(signals);
  return {
    id: randomUUID(),
    target,
    kind,
    createdAt: new Date().toISOString(),
    rulesAsOf: RULES_AS_OF,
    signals: Object.fromEntries(signals),
    findings,
    score: score(findings),
  };
}
