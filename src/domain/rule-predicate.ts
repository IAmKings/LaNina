import type { SelectedEvidence } from "./evaluation";
import { compareText, scaledEpsilonTolerance } from "./internal/compare";
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
  // D3 容差签字（threshold-worksheet §5）：|值 − 阈值| ≤ 4×EPSILON×max(1, |值|, |阈值|) 视为
  // 「恰好等于阈值」，等值时 ≥/≤ 命中、>/< 不命中；其余按字面比较。与 material-change 的
  // meetsInclusiveDelta 共用 internal/compare 的同一缩放容差口径，保证方向判定与修订达标
  // 判定在同一边界值上不会给出相反答案。
  if (Math.abs(value - threshold) <= scaledEpsilonTolerance(value, threshold)) {
    return operator === "gte" || operator === "lte";
  }
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
  }
}
