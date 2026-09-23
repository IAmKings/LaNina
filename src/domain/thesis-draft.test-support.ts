import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type { EvaluationEvidenceInput } from "./evaluation";
import { selectEvidence } from "./evidence-selector";
import { evaluateStageGates } from "./stage-gate";
import type { ThesisDraftCandidate } from "./thesis-draft";
import { decodeThesisSeed } from "./thesis-seeds";
import type { ThesisSeed } from "./thesis-seeds";

export const DRAFT_TEST_CUTOFF = "2026-09-08T12:00:00.000Z";

export function approvedDraftSeed(): ThesisSeed {
  return decodeThesisSeed({
    id: "TEST-THESIS-01",
    slug: "test-thesis",
    title: "测试论点",
    category: "agriculture",
    region: "test-region",
    marketScope: "test-market",
    methodologyVersion: "test-method-v1",
    regionDefinitionVersion: "test-region-v1",
    target: "test-target",
    timeHorizon: "1-3 months",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "market"],
    indicatorSelectors: [
      {
        id: "weather-support",
        indicatorId: "enso_roni_ersstv6",
        layer: "weather",
        defaultStance: "supports",
        weight: 60,
        reviewStatus: "approved",
        active: true,
        notes: "test weather",
      },
      {
        id: "market-support",
        indicatorId: "eia_europe_brent_spot_usd_per_bbl_daily",
        layer: "market",
        defaultStance: "supports",
        weight: 40,
        reviewStatus: "approved",
        active: true,
        notes: "test market",
      },
      {
        id: "weather-relief",
        indicatorId: "regional_rainfall_southern_africa_maize_v1",
        layer: "weather",
        defaultStance: "refutes",
        weight: 20,
        reviewStatus: "approved",
        active: true,
        notes: "test relief",
      },
    ],
    freshnessSlos: ["weather-support", "market-support", "weather-relief"].map((selectorId) => ({
      selectorId,
      maxAgeMinutes: 180,
      reviewStatus: "approved",
      active: true,
    })),
    supportRules: [{
      id: "support-present",
      label: "support present",
      reviewStatus: "approved",
      active: true,
      predicate: { kind: "selector_present", selectorIds: ["weather-support"], minimumMatches: 1 },
    }],
    refuteRules: [{
      id: "refute-high",
      label: "refute high",
      reviewStatus: "approved",
      active: true,
      predicate: {
        kind: "numeric_compare",
        selectorId: "weather-relief",
        operator: "gte",
        threshold: 999,
        unit: "test-unit",
      },
    }],
    invalidationRules: [{
      id: "invalidation-high",
      label: "invalidation high",
      reviewStatus: "approved",
      active: true,
      predicate: {
        kind: "numeric_compare",
        selectorId: "weather-relief",
        operator: "gte",
        threshold: 1000,
        unit: "test-unit",
      },
    }],
    reliefRules: [{
      id: "relief-high",
      label: "relief high",
      reviewStatus: "approved",
      active: true,
      predicate: {
        kind: "numeric_compare",
        selectorId: "weather-relief",
        operator: "gte",
        threshold: 999,
        unit: "test-unit",
      },
    }],
    stageGates: [
      gate("weather_realized", ["weather"], ["support-present"]),
      gate("physical_pressure", ["weather"], ["support-present"]),
      gate("balance_tightening", ["weather"], ["support-present"]),
      gate("market_confirmed", ["weather", "market"], ["support-present"]),
      gate("easing", ["weather"], ["relief-high"]),
    ],
    directionPolicy: {
      version: "test-direction-v1",
      reviewStatus: "approved",
      active: true,
      mappings: [
        { ruleId: "support-present", direction: "bullish" },
        { ruleId: "refute-high", direction: "bearish" },
        { ruleId: "invalidation-high", direction: "bearish" },
        { ruleId: "relief-high", direction: "bearish" },
      ],
    },
    confidencePolicy: {
      version: "test-confidence-v1",
      reviewStatus: "approved",
      active: true,
      lateFreshnessScore: 50,
      sourceTierScores: { A: 100, B: 75, C: 50 },
      missingRequiredLayerCap: null,
      coverageGapCap: null,
    },
    materialChangeThresholds: {
      reviewStatus: "approved",
      active: true,
      confidenceDeltaPoints: 10,
      observationRevisionDelta: 1,
    },
    templateCopy: {
      summary: "测试摘要",
      invalidation: "测试失效条件",
      coverageGap: "测试缺口",
    },
    coverageGaps: [],
    readiness: {
      reviewStatus: "approved",
      productionEvaluation: true,
      publication: false,
      marketEvidenceReady: true,
      blockingGapIds: [],
    },
  });
}

export function approvedPublicationSeed(): ThesisSeed {
  const seed = approvedDraftSeed();
  return decodeThesisSeed({
    ...seed,
    readiness: {
      ...seed.readiness,
      publication: true,
    },
  });
}

export function makeDraftCandidate(
  overrides: Partial<Pick<
    ThesisDraftCandidate,
    "summary" | "invalidation" | "changeReason" | "createdBy" | "createdAt"
  >> & {
    readonly seed?: ThesisSeed;
    readonly cutoff?: string;
    readonly inputs?: readonly EvaluationEvidenceInput[];
  } = {},
): ThesisDraftCandidate {
  const seed = overrides.seed ?? approvedDraftSeed();
  const cutoff = overrides.cutoff ?? DRAFT_TEST_CUTOFF;
  const inputs = overrides.inputs ?? [evidence(seed, "weather-support"), evidence(seed, "market-support")];
  const selection = selectEvidence(seed, cutoff, inputs);
  const stageResult = evaluateStageGates(seed, selection, { previousStage: "watch" });
  const evaluation = evaluateDirectionAndConfidence(seed, selection, stageResult);
  return {
    seed,
    previousStage: "watch",
    selection,
    stageResult,
    evaluation,
    summary: overrides.summary ?? "天气与市场证据形成首轮可审计草稿。",
    invalidation: overrides.invalidation ?? "区域天气或市场证据不再满足审核规则。",
    changeReason: overrides.changeReason ?? null,
    createdBy: overrides.createdBy ?? "evaluation-job",
    createdAt: overrides.createdAt ?? "2026-09-08T12:01:00.000Z",
    evidence: [...selection.selectedEvidence].reverse().map((item) => ({
      evidenceId: item.evidenceId,
      summary: `${item.selectorId} 的已选证据摘要`,
    })),
  };
}

function evidence(seed: ThesisSeed, selectorId: string): EvaluationEvidenceInput {
  const selector = seed.indicatorSelectors.find(({ id }) => id === selectorId);
  if (selector === undefined) throw new TypeError(`missing selector ${selectorId}`);
  return {
    evidenceId: `evidence-${selectorId}`,
    observationId: `observation-${selectorId}`,
    sourceRunId: `run-${selectorId}`,
    revision: 0,
    supersedesId: null,
    indicatorId: selector.indicatorId,
    sourceId: `source-${selectorId}`,
    layer: selector.layer,
    stance: selector.defaultStance,
    weight: selector.weight,
    observedAt: "2026-09-08T11:30:00.000Z",
    publishedAt: "2026-09-08T11:40:00.000Z",
    fetchedAt: "2026-09-08T11:55:00.000Z",
    value: 1,
    unit: "test-unit",
    quality: "verified",
    citationUrl: `https://fixtures.invalid/${selectorId}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "unknown",
  };
}

function gate(
  targetStage: "weather_realized" | "physical_pressure" | "balance_tightening" | "market_confirmed" | "easing",
  requiredLayers: readonly ("weather" | "market")[],
  ruleIds: readonly string[],
) {
  return {
    targetStage,
    requiredLayers,
    ruleIds,
    minimumRuleMatches: 1,
    reviewStatus: "approved" as const,
    active: true,
  };
}
