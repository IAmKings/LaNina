import type { SelectedEvidence } from "./evaluation";
import type { RulePredicate } from "./thesis-seeds";

export function evaluateRulePredicate(
  predicate: RulePredicate,
  evidence: readonly SelectedEvidence[],
): readonly string[] {
  switch (predicate.kind) {
    case "selector_present": {
      const matches = predicate.selectorIds
        .map((selectorId) => ({
          selectorId,
          evidenceIds: evidence
            .filter((item) => item.selectorId === selectorId)
            .map(({ evidenceId }) => evidenceId)
            .sort(compareText),
        }))
        .filter(({ evidenceIds }) => evidenceIds.length > 0);
      if (matches.length < predicate.minimumMatches) return [];
      return [...new Set(matches.flatMap(({ evidenceIds }) => evidenceIds))].sort(compareText);
    }
    case "numeric_compare": {
      const latest = evidence
        .filter((item) => item.selectorId === predicate.selectorId)
        .sort((left, right) =>
          compareText(right.observedAt, left.observedAt)
            || right.revision - left.revision
            || compareText(left.evidenceId, right.evidenceId),
        )[0];
      if (
        latest === undefined
        || typeof latest.value !== "number"
        || latest.unit !== predicate.unit
        || !compareNumber(latest.value, predicate.operator, predicate.threshold)
      ) return [];
      return [latest.evidenceId];
    }
    case "manual_review_required":
      return [];
  }
}

function compareNumber(
  value: number,
  operator: Extract<RulePredicate, { kind: "numeric_compare" }>["operator"],
  threshold: number,
): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
