import type {
  EvidenceFreshnessState,
  EvidenceSelectionResult,
  EvaluationEvidenceInput,
  RejectedEvidence,
  SelectedEvidence,
} from "./evaluation";
import type { IndicatorSelector, ThesisSeed } from "./thesis-seeds";

interface EligibleCandidate {
  readonly input: EvaluationEvidenceInput;
  readonly selector: IndicatorSelector;
  readonly freshness: EvidenceFreshnessState;
  readonly boundaryRejection: RejectedEvidence | null;
}

export function selectEvidence(
  seed: ThesisSeed,
  cutoff: string,
  evidence: readonly EvaluationEvidenceInput[],
): EvidenceSelectionResult {
  const cutoffMs = parseRequiredCanonicalUtc(cutoff, "cutoff");
  const inputs = evidence.map((input) => ({ ...input })).sort(compareEvidence);
  const selectorsByIndicator = new Map<string, IndicatorSelector>(
    seed.indicatorSelectors.map((selector) => [selector.indicatorId, selector] as const),
  );
  const slosBySelector = new Map(
    seed.freshnessSlos.map((slo) => [slo.selectorId, slo] as const),
  );
  const candidatesByPeriod = new Map<string, EligibleCandidate[]>();
  const selectedEvidence: SelectedEvidence[] = [];
  const rejectedEvidence: RejectedEvidence[] = [];

  for (const input of inputs) {
    const selector = selectorsByIndicator.get(input.indicatorId);
    const identityRejection = validateRevisionIdentity(input, selector);
    if (identityRejection !== null) {
      rejectedEvidence.push(identityRejection);
      continue;
    }
    const boundaryRejection = validateAvailabilityBoundary(input, selector, cutoffMs);
    if (boundaryRejection?.code === "AFTER_CUTOFF") {
      rejectedEvidence.push(boundaryRejection);
      continue;
    }
    if (selector === undefined) {
      rejectedEvidence.push(
        boundaryRejection
        ?? reject(input, null, "SELECTOR_MISMATCH", "指标不属于该影响论点的 selector"),
      );
      continue;
    }
    if (selector.reviewStatus !== "approved" || !selector.active) {
      rejectedEvidence.push(
        boundaryRejection ?? reject(
          input,
          selector.id,
          "PENDING_SELECTOR",
          `selector 尚未通过研究审核或未启用；候选 stance=${input.stance} 未进入规则评估`,
        ),
      );
      continue;
    }
    const slo = slosBySelector.get(selector.id);
    if (slo === undefined || slo.reviewStatus !== "approved" || !slo.active || slo.maxAgeMinutes === null) {
      rejectedEvidence.push(
        boundaryRejection
        ?? reject(input, selector.id, "PENDING_SELECTOR", "selector 的新鲜度 SLO 尚未通过研究审核或未启用"),
      );
      continue;
    }

    const freshness = boundaryRejection === null
      ? classifyFreshness(input, cutoffMs, slo.maxAgeMinutes)
      : "unknown";
    const periodKey = `${input.indicatorId}\u0000${input.observedAt}`;
    const candidates = candidatesByPeriod.get(periodKey) ?? [];
    candidates.push({ input, selector, freshness, boundaryRejection });
    candidatesByPeriod.set(periodKey, candidates);
  }

  for (const candidates of candidatesByPeriod.values()) {
    const latestRevision = Math.max(...candidates.map(({ input }) => input.revision));
    const latest = candidates.filter(({ input }) => input.revision === latestRevision);
    for (const candidate of candidates.filter(({ input }) => input.revision < latestRevision)) {
      rejectedEvidence.push(
        reject(
          candidate.input,
          candidate.selector.id,
          "SUPERSEDED_REVISION",
          `同一指标与观测期已有 revision ${latestRevision}`,
        ),
      );
    }
    if (latest.length !== 1) {
      for (const candidate of latest) {
        rejectedEvidence.push(
          reject(
            candidate.input,
            candidate.selector.id,
            "AMBIGUOUS_REVISION",
            `同一指标、观测期与 revision ${latestRevision} 存在重复候选，已关闭选择`,
          ),
        );
      }
      continue;
    }

    const [{ input, selector, freshness, boundaryRejection }] = latest;
    if (boundaryRejection !== null) {
      rejectedEvidence.push(boundaryRejection);
      continue;
    }
    if (input.layer !== selector.layer) {
      rejectedEvidence.push(
        reject(input, selector.id, "SELECTOR_MISMATCH", "证据层与已审核 selector 不一致"),
      );
      continue;
    }
    if (input.quality === "invalid") {
      rejectedEvidence.push(reject(input, selector.id, "INVALID_QUALITY", "观测质量为 invalid"));
      continue;
    }
    if (input.citationUrl.trim().length === 0) {
      rejectedEvidence.push(
        reject(input, selector.id, "MISSING_CITATION", "证据缺少可追溯 citationUrl"),
      );
      continue;
    }
    if (freshness === "stale") {
      rejectedEvidence.push(
        reject(input, selector.id, "STALE_FOR_RULE", "证据超过已审核 SLO 或来源健康状态不可用"),
      );
      continue;
    }
    selectedEvidence.push({
      ...input,
      layer: selector.layer,
      stance: selector.defaultStance,
      weight: selector.weight,
      freshness,
      selectorId: selector.id,
      selectionReason:
        `fetchedAt 不晚于 cutoff，且为 ${input.indicatorId}/${input.observedAt} 的最新 revision ${input.revision}`,
    });
  }

  const selectedSelectorIds = new Set(selectedEvidence.map(({ selectorId }) => selectorId));
  for (const selector of seed.indicatorSelectors) {
    if (selectedSelectorIds.has(selector.id)) continue;
    rejectedEvidence.push({
      evidenceId: null,
      selectorId: selector.id,
      indicatorId: selector.indicatorId,
      code: "MISSING_EVIDENCE",
      reason:
        selector.reviewStatus === "approved" && selector.active
          ? "cutoff 前没有通过有效性、修订与新鲜度检查的证据"
          : "selector 尚未通过研究审核或未启用，按缺失证据处理",
    });
  }

  selectedEvidence.sort(compareSelected);
  rejectedEvidence.sort(compareRejected);

  return deepFreeze({
    thesisId: seed.id,
    cutoff,
    inputs,
    selectedEvidence,
    rejectedEvidence,
    coverageGapIds: [...seed.readiness.blockingGapIds].sort(compareText),
  });
}

function validateRevisionIdentity(
  input: EvaluationEvidenceInput,
  selector: IndicatorSelector | undefined,
): RejectedEvidence | null {
  const selectorId = selector?.id ?? null;
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    return reject(input, selectorId, "INVALID_REVISION", "revision 必须是从 0 开始的整数");
  }
  const observedAtMs = parseCanonicalUtc(input.observedAt);
  if (observedAtMs === null) {
    return reject(input, selectorId, "INVALID_TIMESTAMP", "证据时间必须是毫秒精度 UTC ISO-8601");
  }
  return null;
}

function validateAvailabilityBoundary(
  input: EvaluationEvidenceInput,
  selector: IndicatorSelector | undefined,
  cutoffMs: number,
): RejectedEvidence | null {
  const selectorId = selector?.id ?? null;
  const fetchedAtMs = parseCanonicalUtc(input.fetchedAt);
  const publishedAtMs = input.publishedAt === null ? 0 : parseCanonicalUtc(input.publishedAt);
  if (fetchedAtMs === null || publishedAtMs === null) {
    return reject(input, selectorId, "INVALID_TIMESTAMP", "证据时间必须是毫秒精度 UTC ISO-8601");
  }
  if (fetchedAtMs > cutoffMs) {
    return reject(input, selectorId, "AFTER_CUTOFF", "本站采集时间 fetchedAt 晚于 cutoff");
  }
  return null;
}

function classifyFreshness(
  input: EvaluationEvidenceInput,
  cutoffMs: number,
  maxAgeMinutes: number,
): EvidenceFreshnessState {
  if (input.sourceHealth === "broken" || input.sourceHealth === "stale") return "stale";
  const freshnessAt = input.publishedAt ?? input.fetchedAt;
  const freshnessAtMs = parseRequiredCanonicalUtc(freshnessAt, "publishedAt/fetchedAt");
  const ageMinutes = Math.max(0, cutoffMs - freshnessAtMs) / 60_000;
  if (ageMinutes > maxAgeMinutes) return "stale";
  return input.sourceHealth === "delayed" ? "late" : "fresh";
}

function reject(
  input: EvaluationEvidenceInput,
  selectorId: string | null,
  code: RejectedEvidence["code"],
  reason: string,
): RejectedEvidence {
  return {
    evidenceId: input.evidenceId,
    selectorId,
    indicatorId: input.indicatorId,
    code,
    reason,
  };
}

function parseRequiredCanonicalUtc(value: string, field: string): number {
  const parsed = parseCanonicalUtc(value);
  if (parsed === null) throw new TypeError(`${field} 必须是有效的毫秒精度 UTC ISO-8601`);
  return parsed;
}

function parseCanonicalUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || new Date(parsed).toISOString() !== value ? null : parsed;
}

function compareEvidence(left: EvaluationEvidenceInput, right: EvaluationEvidenceInput): number {
  return compareText(left.indicatorId, right.indicatorId)
    || compareText(left.observedAt, right.observedAt)
    || left.revision - right.revision
    || compareText(left.evidenceId, right.evidenceId)
    || compareText(evidencePayloadKey(left), evidencePayloadKey(right));
}

function evidencePayloadKey(input: EvaluationEvidenceInput): string {
  const value = typeof input.value === "number" ? `number:${String(input.value)}` : `string:${input.value}`;
  return JSON.stringify([
    input.observationId,
    input.sourceRunId,
    input.supersedesId,
    input.sourceId,
    input.layer,
    input.stance,
    input.weight,
    input.publishedAt,
    input.fetchedAt,
    value,
    input.unit,
    input.quality,
    input.citationUrl,
    input.sourceTier,
    input.sourceHealth,
    input.freshness,
  ]);
}

function compareSelected(left: SelectedEvidence, right: SelectedEvidence): number {
  return compareText(left.selectorId, right.selectorId)
    || compareText(left.observedAt, right.observedAt)
    || left.revision - right.revision
    || compareText(left.evidenceId, right.evidenceId);
}

function compareRejected(left: RejectedEvidence, right: RejectedEvidence): number {
  return compareText(left.selectorId ?? "", right.selectorId ?? "")
    || compareText(left.indicatorId, right.indicatorId)
    || compareText(left.evidenceId ?? "", right.evidenceId ?? "")
    || compareText(left.code, right.code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
