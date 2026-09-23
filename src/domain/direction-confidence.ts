import { THESIS_DIRECTIONS, THESIS_STAGES } from "./contracts";
import type { ThesisDirection } from "./contracts";
import type {
  ConfidenceCap,
  ConfidenceComponentExplanations,
  ConfidenceComponents,
  DirectionConfidenceEvaluation,
  EvaluationConfidence,
  EvidenceLayer,
  EvidenceSelectionResult,
  RuleHit,
  RuleRejection,
  ScopedDirectionEvaluation,
  SelectedEvidence,
  StageGateResult,
} from "./evaluation";
import { evaluateRulePredicate } from "./rule-predicate";
import { evaluateStageGates, validateEvidenceSelection } from "./stage-gate";
import type { RuleDescriptor, ThesisSeed } from "./thesis-seeds";

const CONFIDENCE_WEIGHTS = {
  coverage: 30,
  freshness: 25,
  sourceQuality: 25,
  agreement: 20,
} as const;

export function evaluateDirectionAndConfidence(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  stageResult: StageGateResult,
): DirectionConfidenceEvaluation {
  const invalidSelection = validateEvidenceSelection(seed, selection);
  const mismatch = invalidSelection?.reason ?? validateEvaluationBoundary(seed, selection, stageResult);
  const currentEvidence = invalidSelection === null
    ? latestSelectedBySelector(selection.selectedEvidence)
    : [];
  const requiredLayers = requiredLayersForStage(seed, stageResult);
  const explanationSelection = invalidSelection === null
    ? selection
    : { ...selection, selectedEvidence: [], rejectedEvidence: [] };
  const explanations = buildExplanations(seed, explanationSelection, currentEvidence, requiredLayers);
  const boundaryReasons = mismatch === null ? [] : [mismatch];

  return deepFreeze({
    thesisId: seed.id,
    methodologyVersion: seed.methodologyVersion,
    regionDefinitionVersion: seed.regionDefinitionVersion,
    cutoff: selection.cutoff,
    target: seed.target,
    marketScope: seed.marketScope,
    timeHorizon: seed.timeHorizon,
    stage: mismatch === null ? stageResult.stage : "watch",
    direction: evaluateDirection(seed, currentEvidence, boundaryReasons),
    confidence: evaluateConfidence(seed, selection, currentEvidence, explanations, boundaryReasons),
  });
}

function evaluateDirection(
  seed: ThesisSeed,
  currentEvidence: readonly SelectedEvidence[],
  boundaryReasons: readonly string[],
): ScopedDirectionEvaluation {
  const policy = seed.directionPolicy;
  const reasons = [...boundaryReasons];
  const ruleHits: RuleHit[] = [];
  const ruleRejections: RuleRejection[] = [];
  const matchedDirections: ThesisDirection[] = [];
  const mappings = new Map(policy.mappings.map((mapping) => [mapping.ruleId, mapping.direction] as const));
  const rules = categorizedRules(seed).sort((left, right) => compareText(left.rule.id, right.rule.id));
  const policyAvailable = policy.reviewStatus === "approved" && policy.active;
  let unresolvedMatchedRule = false;

  if (!policyAvailable) reasons.push("方向策略尚未通过研究审核或未启用，返回 seed 的有范围默认方向");
  if (boundaryReasons.length === 0 && policyAvailable) {
    for (const { rule, requiredStance } of rules) {
      const mapping = mappings.get(rule.id) ?? null;
      if (rule.reviewStatus !== "approved") {
        ruleRejections.push(rejection(rule.id, "PENDING_REVIEW", `规则 ${rule.id} 尚未通过研究审核`));
        continue;
      }
      if (!rule.active) {
        ruleRejections.push(rejection(rule.id, "INACTIVE", `规则 ${rule.id} 未启用`));
        continue;
      }
      const matchedEvidenceIds = evaluateRulePredicate(rule.predicate, currentEvidence);
      if (matchedEvidenceIds.length === 0) {
        ruleRejections.push(rejection(rule.id, "NOT_MATCHED", `规则 ${rule.id} 未匹配当前证据`));
        continue;
      }
      const directionalEvidence = currentEvidence.filter(
        (evidence) => evidence.layer !== "control"
          && evidence.stance === requiredStance
          && evidence.weight > 0,
      );
      const directionalEvidenceIds = evaluateRulePredicate(rule.predicate, directionalEvidence);
      if (directionalEvidenceIds.length === 0) {
        ruleRejections.push(rejection(
          rule.id,
          "CONTEXT_ONLY",
          `规则 ${rule.id} 未命中其 ${requiredStance} 语义所需的正权重非 control 证据，不能产生市场方向`,
        ));
        continue;
      }
      if (mapping === null) {
        unresolvedMatchedRule = true;
        ruleRejections.push(rejection(
          rule.id,
          "UNRESOLVED_DIRECTION",
          `规则 ${rule.id} 已按 ${requiredStance} stance 命中，但尚无审核后的方向映射`,
        ));
        continue;
      }
      const evidenceIds = [...directionalEvidenceIds].sort(compareText);
      ruleHits.push({
        ruleId: rule.id,
        evidenceIds,
        reason: `规则 ${rule.id} 以 ${requiredStance} stance 命中，并由审核策略显式映射为 ${mapping}`,
      });
      matchedDirections.push(mapping);
    }
  } else if (boundaryReasons.length === 0) {
    for (const { rule } of rules) {
      ruleRejections.push(rejection(rule.id, "PENDING_REVIEW", `方向策略未审核，规则 ${rule.id} 不参与方向计算`));
    }
  }

  const distinctDirections = [...new Set(matchedDirections)].sort(compareDirection);
  const direction = unresolvedMatchedRule
    ? seed.defaultDirection
    : distinctDirections.length === 1
    ? distinctDirections[0] ?? seed.defaultDirection
    : distinctDirections.length > 1
      ? "mixed"
      : seed.defaultDirection;
  if (distinctDirections.length > 1) {
    reasons.push(`命中多个不同方向 ${distinctDirections.join("/")}，按固定冲突规则解析为 mixed`);
  } else if (unresolvedMatchedRule) {
    reasons.push("至少一条已命中规则没有审核后的方向映射，方向结果关闭并保留有范围默认方向");
  } else if (distinctDirections.length === 0 && policyAvailable && boundaryReasons.length === 0) {
    reasons.push("没有具备方向性证据的已审核规则命中，保留 seed 的有范围默认方向但标记为不可用");
  }

  return {
    status: boundaryReasons.length === 0
      && policyAvailable
      && !unresolvedMatchedRule
      && distinctDirections.length > 0
      ? "available"
      : "unavailable",
    policyVersion: policy.version,
    thesisId: seed.id,
    methodologyVersion: seed.methodologyVersion,
    regionDefinitionVersion: seed.regionDefinitionVersion,
    target: seed.target,
    marketScope: seed.marketScope,
    timeHorizon: seed.timeHorizon,
    direction,
    matchedDirections: distinctDirections,
    ruleHits: ruleHits.sort((left, right) => compareText(left.ruleId, right.ruleId)),
    ruleRejections: ruleRejections.sort((left, right) => compareText(left.ruleId, right.ruleId)),
    reasons: reasons.sort(compareText),
  };
}

function evaluateConfidence(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  currentEvidence: readonly SelectedEvidence[],
  explanations: ConfidenceComponentExplanations,
  boundaryReasons: readonly string[],
): EvaluationConfidence {
  const policy = seed.confidencePolicy;
  const policyAvailable = policy.reviewStatus === "approved"
    && policy.active
    && policy.lateFreshnessScore !== null
    && Object.values(policy.sourceTierScores).every((score) => score !== null);
  if (boundaryReasons.length > 0 || !policyAvailable) {
    return unavailableConfidence(
      policy.version,
      explanations,
      boundaryReasons.length > 0
        ? boundaryReasons
        : ["置信度策略尚未通过研究审核或缺少 late/source-tier 分值，返回零安全结果"],
    );
  }

  const coverage = ratioScore(
    explanations.coverage.presentLayers.length,
    explanations.coverage.requiredLayers.length,
  );
  const relevantSelectors = seed.indicatorSelectors.filter(
    (selector) => selector.reviewStatus === "approved"
      && selector.active
      && explanations.coverage.requiredLayers.includes(selector.layer),
  );
  const evidenceBySelector = new Map(currentEvidence.map((evidence) => [evidence.selectorId, evidence] as const));
  const freshnessScores = relevantSelectors.map((selector) => {
    const evidence = evidenceBySelector.get(selector.id);
    if (evidence?.freshness === "fresh") return 100;
    if (evidence?.freshness === "late") return policy.lateFreshnessScore as number;
    return 0;
  });
  const freshness = averageScore(freshnessScores);
  const sourceQualityEvidenceIds = new Set(explanations.sourceQuality.currentEvidenceIds);
  const sourceScores = currentEvidence
    .filter(({ evidenceId }) => sourceQualityEvidenceIds.has(evidenceId))
    .map((evidence) => policy.sourceTierScores[evidence.sourceTier] as number);
  const sourceQuality = averageScore(sourceScores);
  const { supportWeight, refuteWeight } = explanations.agreement;
  const agreement = supportWeight + refuteWeight === 0
    ? 0
    : roundHalfUp((Math.abs(supportWeight - refuteWeight) / (supportWeight + refuteWeight)) * 100);
  const components: ConfidenceComponents = { coverage, freshness, sourceQuality, agreement };
  const weightedScore = roundHalfUp(
    (coverage * CONFIDENCE_WEIGHTS.coverage
      + freshness * CONFIDENCE_WEIGHTS.freshness
      + sourceQuality * CONFIDENCE_WEIGHTS.sourceQuality
      + agreement * CONFIDENCE_WEIGHTS.agreement) / 100,
  );
  const appliedCaps = confidenceCaps(seed, selection, currentEvidence, explanations);
  const finalScore = appliedCaps.reduce(
    (score, cap) => Math.min(score, cap.maximum),
    weightedScore,
  );
  const reasons = [
    "固定公式：coverage×30% + freshness×25% + sourceQuality×25% + agreement×20%",
    "所有分项和加权总分均使用非负数 round-half-up（0.5 向上）",
    supportWeight + refuteWeight === 0
      ? "没有正权重的支持或反向证据，agreement=0"
      : supportWeight === refuteWeight
        ? "支持与反向权重完全平衡，agreement=0"
        : `agreement 使用对称净一致度 |support-refute|/(support+refute)，当前为 ${agreement}`,
    ...appliedCaps.map(({ reason }) => reason),
  ].sort(compareText);

  return {
    status: "available",
    policyVersion: policy.version,
    components,
    weightedScore,
    appliedCaps,
    finalScore,
    roundingRule: "round_half_up_after_weighted_sum",
    explanations,
    reasons,
  };
}

function confidenceCaps(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  currentEvidence: readonly SelectedEvidence[],
  explanations: ConfidenceComponentExplanations,
): readonly ConfidenceCap[] {
  const caps: ConfidenceCap[] = [];
  const layers = new Set(currentEvidence.map(({ layer }) => layer));
  const forecastOnly = layers.has("forecast")
    && !["weather", "physical", "balance", "market"].some((layer) => layers.has(layer as EvidenceLayer));
  if (forecastOnly) {
    caps.push({
      code: "FORECAST_ONLY",
      maximum: 49,
      reason: "只有气候预测、没有区域天气或后续传导观测，按 PRD 将置信度上限设为 49",
    });
  }
  const staleRequiredLayers = whollyStaleRequiredLayers(seed, selection, currentEvidence);
  if (staleRequiredLayers.length > 0) {
    caps.push({
      code: "REQUIRED_LAYER_STALE",
      maximum: 59,
      reason: `必需证据层全部过期：${staleRequiredLayers.join("、")}，按 PRD 将上限设为 59`,
    });
  }
  const supportEvidence = currentEvidence.filter(
    ({ stance, layer, weight }) => stance === "supports" && layer !== "control" && weight > 0,
  );
  const refuteEvidence = currentEvidence.filter(
    ({ stance, layer, weight }) => stance === "refutes" && layer !== "control" && weight > 0,
  );
  const unexplainedSourceConflict = supportEvidence.length > 0 && refuteEvidence.length > 0;
  if (unexplainedSourceConflict) {
    caps.push({
      code: "UNEXPLAINED_CONFLICT",
      maximum: 69,
      reason: "当前同时存在支持与反向证据（包括同一来源内的矛盾），且本版策略未定义可审计的冲突解释，按 PRD 将上限设为 69",
    });
  }
  if (
    explanations.coverage.missingLayers.length > 0
    && seed.confidencePolicy.missingRequiredLayerCap !== null
  ) {
    caps.push({
      code: "MISSING_REQUIRED_LAYER",
      maximum: seed.confidencePolicy.missingRequiredLayerCap,
      reason: `已审核策略对缺少必需层 ${explanations.coverage.missingLayers.join("、")} 应用上限 ${seed.confidencePolicy.missingRequiredLayerCap}`,
    });
  }
  const confidenceGapIds = seed.coverageGaps
    .filter((gap) => selection.coverageGapIds.includes(gap.id) && gap.blocks.includes("confidence"))
    .map(({ id }) => id)
    .sort(compareText);
  if (confidenceGapIds.length > 0 && seed.confidencePolicy.coverageGapCap !== null) {
    caps.push({
      code: "COVERAGE_GAP",
      maximum: seed.confidencePolicy.coverageGapCap,
      reason: `已审核策略对覆盖缺口 ${confidenceGapIds.join("、")} 应用上限 ${seed.confidencePolicy.coverageGapCap}`,
    });
  }
  return caps.sort((left, right) => left.maximum - right.maximum || compareText(left.code, right.code));
}

function whollyStaleRequiredLayers(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  currentEvidence: readonly SelectedEvidence[],
): readonly EvidenceLayer[] {
  const presentLayers = new Set(currentEvidence.map(({ layer }) => layer));
  const staleSelectorIds = new Set(
    selection.rejectedEvidence
      .filter(({ code, selectorId }) => code === "STALE_FOR_RULE" && selectorId !== null)
      .map(({ selectorId }) => selectorId as string),
  );
  const staleLayers = new Set(
    seed.indicatorSelectors.filter(({ id }) => staleSelectorIds.has(id)).map(({ layer }) => layer),
  );
  return sortedLayers(seed.requiredEvidenceLayers.filter(
    (layer) => !presentLayers.has(layer) && staleLayers.has(layer),
  ));
}

function buildExplanations(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  currentEvidence: readonly SelectedEvidence[],
  requiredLayers: readonly EvidenceLayer[],
): ConfidenceComponentExplanations {
  const presentLayerSet = new Set(currentEvidence.map(({ layer }) => layer));
  const staleSelectorIds = new Set(
    selection.rejectedEvidence
      .filter(({ code, selectorId }) => code === "STALE_FOR_RULE" && selectorId !== null)
      .map(({ selectorId }) => selectorId as string),
  );
  const staleLayerSet = new Set(
    seed.indicatorSelectors
      .filter(({ id }) => staleSelectorIds.has(id))
      .map(({ layer }) => layer),
  );
  const presentLayers = requiredLayers.filter((layer) => presentLayerSet.has(layer));
  const staleLayers = requiredLayers.filter((layer) => !presentLayerSet.has(layer) && staleLayerSet.has(layer));
  const missingLayers = requiredLayers.filter(
    (layer) => !presentLayerSet.has(layer) && !staleLayerSet.has(layer),
  );
  const relevantSelectors = seed.indicatorSelectors.filter(
    (selector) => selector.reviewStatus === "approved"
      && selector.active
      && requiredLayers.includes(selector.layer),
  );
  const relevantSelectorIds = new Set(relevantSelectors.map(({ id }) => id));
  const relevantEvidence = currentEvidence.filter(({ selectorId }) => relevantSelectorIds.has(selectorId));
  const relevantStaleSelectorIds = [...staleSelectorIds].filter((selectorId) =>
    relevantSelectorIds.has(selectorId),
  );
  const evidenceBySelector = new Map(currentEvidence.map((evidence) => [evidence.selectorId, evidence] as const));
  const missingSelectorIds = relevantSelectors
    .filter(({ id }) => !evidenceBySelector.has(id) && !staleSelectorIds.has(id))
    .map(({ id }) => id)
    .sort(compareText);
  const support = currentEvidence.filter(
    ({ stance, layer, weight }) => stance === "supports" && layer !== "control" && weight > 0,
  );
  const refute = currentEvidence.filter(
    ({ stance, layer, weight }) => stance === "refutes" && layer !== "control" && weight > 0,
  );
  const context = currentEvidence.filter(({ stance, layer, weight }) => stance === "context" || layer === "control" || weight <= 0);
  return {
    coverage: {
      requiredLayers: sortedLayers(requiredLayers),
      presentLayers: sortedLayers(presentLayers),
      missingLayers: sortedLayers(missingLayers),
      staleLayers: sortedLayers(staleLayers),
    },
    freshness: {
      currentEvidenceIds: relevantEvidence.map(({ evidenceId }) => evidenceId).sort(compareText),
      freshSelectorIds: relevantEvidence.filter(({ freshness }) => freshness === "fresh").map(({ selectorId }) => selectorId).sort(compareText),
      lateSelectorIds: relevantEvidence.filter(({ freshness }) => freshness === "late").map(({ selectorId }) => selectorId).sort(compareText),
      staleSelectorIds: relevantStaleSelectorIds.sort(compareText),
      missingSelectorIds,
    },
    sourceQuality: {
      currentEvidenceIds: relevantEvidence.map(({ evidenceId }) => evidenceId).sort(compareText),
      tierScores: { ...seed.confidencePolicy.sourceTierScores },
    },
    agreement: {
      supportEvidenceIds: support.map(({ evidenceId }) => evidenceId).sort(compareText),
      refuteEvidenceIds: refute.map(({ evidenceId }) => evidenceId).sort(compareText),
      ignoredContextEvidenceIds: context.map(({ evidenceId }) => evidenceId).sort(compareText),
      supportWeight: support.reduce((total, { weight }) => total + weight, 0),
      refuteWeight: refute.reduce((total, { weight }) => total + weight, 0),
    },
  };
}

function requiredLayersForStage(seed: ThesisSeed, stageResult: StageGateResult): readonly EvidenceLayer[] {
  if (stageResult.stage === "watch") return sortedLayers(seed.requiredEvidenceLayers);
  const gate = seed.stageGates.find(({ targetStage }) => targetStage === stageResult.stage);
  return sortedLayers(gate?.requiredLayers ?? seed.requiredEvidenceLayers);
}

function validateEvaluationBoundary(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  stageResult: StageGateResult,
): string | null {
  const invalidSelection = validateEvidenceSelection(seed, selection);
  if (invalidSelection !== null) return invalidSelection.reason;
  const invalidStageResult = validateStageResult(seed, selection, stageResult);
  if (invalidStageResult !== null) return invalidStageResult;
  const currentLayers = new Set(latestSelectedBySelector(selection.selectedEvidence).map(({ layer }) => layer));
  const priceOnly = currentLayers.has("market")
    && !["forecast", "weather", "physical", "balance"].some((layer) => currentLayers.has(layer as EvidenceLayer));
  if (priceOnly && stageResult.stage !== "watch") {
    return "只有市场价格证据时阶段必须保持 watch";
  }
  return null;
}

function validateStageResult(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  stageResult: StageGateResult,
): string | null {
  if (
    stageResult.thesisId !== seed.id
    || stageResult.cutoff !== selection.cutoff
    || !THESIS_STAGES.includes(stageResult.previousStage)
    || !THESIS_STAGES.includes(stageResult.highestEligibleStage)
    || !THESIS_STAGES.includes(stageResult.stage)
    || stageResult.transition === "invalid"
  ) {
    return "阶段结果与 seed/证据选择的身份、cutoff 或状态不一致";
  }
  if (stageResult.manualConfirmationApplied) {
    return "阶段结果只携带可伪造的 manualConfirmationApplied 布尔值，缺少可校验的具名人工确认契约";
  }
  const expected = evaluateStageGates(seed, selection, {
    previousStage: stageResult.previousStage,
  });
  if (
    expected.highestEligibleStage !== stageResult.highestEligibleStage
    || expected.stage !== stageResult.stage
    || expected.transition !== stageResult.transition
    || expected.manualConfirmationApplied !== stageResult.manualConfirmationApplied
    || !sameJson(expected.checks, stageResult.checks)
    || !sameJson(expected.reasons, stageResult.reasons)
  ) {
    return "阶段结果无法由 seed、证据选择和 previousStage 重建，方向与置信度计算已关闭";
  }
  return null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function latestSelectedBySelector(evidence: readonly SelectedEvidence[]): readonly SelectedEvidence[] {
  const latest = new Map<string, SelectedEvidence>();
  for (const item of [...evidence].sort(compareSelectedLatestFirst)) {
    if (!latest.has(item.selectorId)) latest.set(item.selectorId, item);
  }
  return [...latest.values()].sort((left, right) => compareText(left.selectorId, right.selectorId));
}

function compareSelectedLatestFirst(left: SelectedEvidence, right: SelectedEvidence): number {
  return compareText(left.selectorId, right.selectorId)
    || compareText(right.observedAt, left.observedAt)
    || right.revision - left.revision
    || compareText(left.evidenceId, right.evidenceId);
}

function categorizedRules(seed: ThesisSeed): Array<{
  readonly rule: RuleDescriptor;
  readonly requiredStance: "supports" | "refutes";
}> {
  return [
    ...seed.supportRules.map((rule) => ({ rule, requiredStance: "supports" as const })),
    ...seed.refuteRules.map((rule) => ({ rule, requiredStance: "refutes" as const })),
    ...seed.invalidationRules.map((rule) => ({ rule, requiredStance: "refutes" as const })),
    ...seed.reliefRules.map((rule) => ({ rule, requiredStance: "refutes" as const })),
  ];
}

function unavailableConfidence(
  policyVersion: string,
  explanations: ConfidenceComponentExplanations,
  reasons: readonly string[],
): EvaluationConfidence {
  return {
    status: "unavailable",
    policyVersion,
    components: { coverage: 0, freshness: 0, sourceQuality: 0, agreement: 0 },
    weightedScore: 0,
    appliedCaps: [],
    finalScore: 0,
    roundingRule: "round_half_up_after_weighted_sum",
    explanations,
    reasons: [...reasons].sort(compareText),
  };
}

function rejection(ruleId: string, code: RuleRejection["code"], reason: string): RuleRejection {
  return { ruleId, code, reason };
}

function ratioScore(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : roundHalfUp((numerator / denominator) * 100);
}

function averageScore(scores: readonly number[]): number {
  return scores.length === 0 ? 0 : roundHalfUp(scores.reduce((total, score) => total + score, 0) / scores.length);
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function sortedLayers(layers: readonly EvidenceLayer[]): readonly EvidenceLayer[] {
  const order = ["forecast", "weather", "physical", "balance", "market", "control"] as const;
  return [...new Set(layers)].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function compareDirection(left: ThesisDirection, right: ThesisDirection): number {
  return THESIS_DIRECTIONS.indexOf(left) - THESIS_DIRECTIONS.indexOf(right);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
