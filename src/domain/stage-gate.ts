import { THESIS_STAGES } from "./contracts";
import type { ThesisStage } from "./contracts";
import type {
  EvidenceLayer,
  EvidenceSelectionResult,
  SelectedEvidence,
  StageGateCheck,
  StageGateManualConfirmation,
  StageGateReason,
  StageGateResult,
} from "./evaluation";
import type {
  RuleDescriptor,
  StageGateDescriptor,
  ThesisSeed,
} from "./thesis-seeds";
import { selectEvidence } from "./evidence-selector";
import { evaluateRulePredicate } from "./rule-predicate";

export interface StageGateOptions {
  readonly previousStage: ThesisStage;
  readonly manualConfirmation?: StageGateManualConfirmation;
}

const PRESSURE_STAGES = [
  "weather_realized",
  "physical_pressure",
  "balance_tightening",
  "market_confirmed",
] as const;

export function evaluateStageGates(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  options: StageGateOptions,
): StageGateResult {
  const invalidOptionsReason = validateOptions(options);
  if (invalidOptionsReason !== null) {
    return result(seed, selection, "watch", "watch", "watch", "invalid", false, [], [invalidOptionsReason]);
  }
  const invalidReason = validateEvidenceSelection(seed, selection);
  if (invalidReason !== null) {
    return result(seed, selection, options.previousStage, "watch", "watch", "invalid", false, [], [invalidReason]);
  }

  const rulesById = new Map(
    [
      ...seed.supportRules,
      ...seed.refuteRules,
      ...seed.invalidationRules,
      ...seed.reliefRules,
    ].map((rule) => [rule.id, rule] as const),
  );
  const checks = seed.stageGates.map((gate) => evaluateGate(seed, gate, rulesById, selection));
  const checksByStage = new Map(checks.map((check) => [check.targetStage, check] as const));

  let highestPressureStage: ThesisStage = "watch";
  for (const stage of PRESSURE_STAGES) {
    const check = checksByStage.get(stage);
    if (check?.status !== "passed") break;
    highestPressureStage = stage;
  }
  let highestEligibleStage: ThesisStage = highestPressureStage;

  const easing = checksByStage.get("easing");
  if (easing?.status === "passed") {
    if (options.previousStage === "watch") {
      replaceCheck(checks, {
        ...easing,
        status: "blocked",
        reasons: sortReasons([
          ...easing.reasons,
          reason(
            "EASING_REQUIRES_PRIOR_IMPACT",
            "easing",
            "缓解必须基于此前已经发生的影响阶段，观察阶段不能直接进入缓解",
          ),
        ]),
      });
    } else {
      highestEligibleStage = "easing";
    }
  }

  addPrerequisiteReasons(checks);
  const previousIndex = stageIndex(options.previousStage);
  const eligibleIndex = stageIndex(highestEligibleStage);
  const manualConfirmation = validManualConfirmation(options.manualConfirmation);
  let stage: ThesisStage = highestEligibleStage;
  let transition: StageGateResult["transition"] = "unchanged";
  let manualConfirmationApplied = false;
  const transitionReasons: StageGateReason[] = [];

  if (eligibleIndex > previousIndex + 1) {
    if (manualConfirmation !== null) {
      transition = "manual_forward_skip";
      manualConfirmationApplied = true;
      transitionReasons.push(reason(
        "MANUAL_FORWARD_SKIP_CONFIRMED",
        highestEligibleStage,
        `由 ${manualConfirmation.confirmedBy} 明确确认跨级：${manualConfirmation.reason}`,
      ));
    } else {
      stage = highestEligibleStage === "easing"
        ? highestPressureStage
        : THESIS_STAGES[previousIndex + 1] ?? options.previousStage;
      const stageIsDowngrade = stageIndex(stage) < previousIndex;
      transition = stageIsDowngrade ? "downgraded" : "blocked";
      transitionReasons.push(reason(
        "FORWARD_SKIP_REQUIRES_CONFIRMATION",
        highestEligibleStage,
        `从 ${options.previousStage} 到 ${highestEligibleStage} 超过一级；本次只能停留或回到已通过的 ${stage}`,
      ));
      if (stageIsDowngrade) {
        transitionReasons.push(reason(
          "DOWNGRADE",
          stage,
          `中间 gate 未通过且缓解跨级未确认，阶段从 ${options.previousStage} 跳回 ${stage}`,
        ));
      }
    }
  } else if (eligibleIndex === previousIndex + 1) {
    transition = "promoted";
  } else if (eligibleIndex < previousIndex) {
    transition = "downgraded";
    transitionReasons.push(reason(
      "DOWNGRADE",
      highestEligibleStage,
      `必要 gate 不再满足，阶段从 ${options.previousStage} 跳回 ${highestEligibleStage}`,
    ));
  }

  const allReasons = sortReasons([
    ...checks.flatMap((check) => check.reasons),
    ...transitionReasons,
  ]);
  return result(
    seed,
    selection,
    options.previousStage,
    highestEligibleStage,
    stage,
    transition,
    manualConfirmationApplied,
    checks,
    allReasons,
  );
}

function evaluateGate(
  seed: ThesisSeed,
  gate: StageGateDescriptor,
  rulesById: ReadonlyMap<string, RuleDescriptor>,
  selection: EvidenceSelectionResult,
): StageGateCheck {
  const requiredLayers = sortedLayers(gate.requiredLayers);
  const presentLayerSet = new Set(selection.selectedEvidence.map(({ layer }) => layer));
  const staleLayerSet = new Set(
    selection.rejectedEvidence
      .filter(({ code }) => code === "STALE_FOR_RULE")
      .flatMap(({ selectorId }) => {
        const selector = seed.indicatorSelectors.find(({ id }) => id === selectorId);
        return selector === undefined ? [] : [selector.layer];
      }),
  );
  const presentLayers = requiredLayers.filter((layer) => presentLayerSet.has(layer));
  const staleLayers = requiredLayers.filter((layer) => !presentLayerSet.has(layer) && staleLayerSet.has(layer));
  const missingLayers = requiredLayers.filter(
    (layer) => !presentLayerSet.has(layer) && !staleLayerSet.has(layer),
  );
  const selectedGapIds = new Set(selection.coverageGapIds);
  const blockingCoverageGapIds = seed.coverageGaps
    .filter(
      (gap) => selectedGapIds.has(gap.id)
        && gap.blocks.includes("stage")
        && requiredLayers.includes(gap.layer),
    )
    .map(({ id }) => id)
    .sort(compareText);
  const reasons: StageGateReason[] = [];

  for (const layer of staleLayers) {
    reasons.push(reason("STALE_REQUIRED_LAYER", gate.targetStage, `必需证据层 ${layer} 仅有过期证据`, { layer }));
  }
  for (const layer of missingLayers) {
    reasons.push(reason("MISSING_REQUIRED_LAYER", gate.targetStage, `缺少必需证据层 ${layer}`, { layer }));
  }
  for (const gapId of blockingCoverageGapIds) {
    reasons.push(reason("COVERAGE_GAP", gate.targetStage, `覆盖缺口 ${gapId} 阻止阶段提升`, {
      coverageGapId: gapId,
    }));
  }

  if (gate.reviewStatus !== "approved" || !gate.active || gate.minimumRuleMatches === null) {
    reasons.push(reason("PENDING_GATE", gate.targetStage, "阶段 gate 尚未通过研究审核或未启用"));
    for (const ruleId of gate.ruleIds) {
      const rule = rulesById.get(ruleId);
      if (rule?.reviewStatus !== "approved" || !rule.active) {
        reasons.push(reason("PENDING_RULE", gate.targetStage, `规则 ${ruleId} 尚未通过研究审核或未启用`, {
          ruleId,
        }));
      }
    }
    return gateCheck(gate, "pending", presentLayers, missingLayers, staleLayers, blockingCoverageGapIds, [], [], gate.ruleIds, reasons);
  }

  const evaluations = gate.ruleIds.map((ruleId) => {
    const rule = rulesById.get(ruleId);
    if (rule === undefined || rule.reviewStatus !== "approved" || !rule.active) {
      reasons.push(reason("PENDING_RULE", gate.targetStage, `规则 ${ruleId} 尚未通过研究审核或未启用`, {
        ruleId,
      }));
      return { ruleId, matched: false, evidenceIds: [] as readonly string[] };
    }
    const evidenceIds = evaluateRulePredicate(rule.predicate, selection.selectedEvidence);
    if (evidenceIds.length === 0) {
      reasons.push(reason("RULE_NOT_MATCHED", gate.targetStage, `规则 ${ruleId} 未匹配`, { ruleId }));
      return { ruleId, matched: false, evidenceIds };
    }
    return { ruleId, matched: true, evidenceIds };
  });
  const matched = evaluations.filter(({ matched }) => matched);
  const matchedRuleIds = matched.map(({ ruleId }) => ruleId).sort(compareText);
  const matchedEvidenceIds = [...new Set(matched.flatMap(({ evidenceIds }) => evidenceIds))].sort(compareText);
  const rejectedRuleIds = evaluations.filter(({ matched }) => !matched).map(({ ruleId }) => ruleId).sort(compareText);

  if (gate.targetStage === "market_confirmed") {
    const hasMarket = selection.selectedEvidence.some(({ layer }) => layer === "market");
    const hasAttributionChain = selection.selectedEvidence.some(
      ({ layer }) => layer === "weather" || layer === "physical" || layer === "balance",
    );
    if (hasMarket && !hasAttributionChain) {
      reasons.push(reason("PRICE_ONLY", gate.targetStage, "只有市场价格证据、没有可归因的非市场传导链条"));
    }
  }
  if (gate.targetStage !== "easing") {
    const hasForecast = selection.selectedEvidence.some(({ layer }) => layer === "forecast");
    const hasRealized = selection.selectedEvidence.some(
      ({ layer }) => layer === "weather" || layer === "physical" || layer === "balance",
    );
    if (hasForecast && !hasRealized) {
      reasons.push(reason("FORECAST_ONLY", gate.targetStage, "只有预测证据，不能证明区域天气或后续传导已经兑现"));
    }
  } else {
    const hasNonMarketBasis = matchedEvidenceIds.some((evidenceId) => {
      const evidence = selection.selectedEvidence.find((item) => item.evidenceId === evidenceId);
      return evidence !== undefined && evidence.layer !== "market";
    });
    if (!hasNonMarketBasis) {
      reasons.push(reason("RELIEF_BASIS_REQUIRED", gate.targetStage, "缓解需要已审核的 relief/invalidation 非市场依据，不能只凭价格反转"));
    }
  }

  const blocked = missingLayers.length > 0
    || staleLayers.length > 0
    || blockingCoverageGapIds.length > 0
    || matched.length < gate.minimumRuleMatches
    || reasons.some(({ code }) => code === "PENDING_RULE" || code === "PRICE_ONLY" || code === "FORECAST_ONLY" || code === "RELIEF_BASIS_REQUIRED");
  return gateCheck(
    gate,
    blocked ? "blocked" : "passed",
    presentLayers,
    missingLayers,
    staleLayers,
    blockingCoverageGapIds,
    matchedRuleIds,
    matchedEvidenceIds,
    rejectedRuleIds,
    reasons,
  );
}

export function validateEvidenceSelection(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
): StageGateReason | null {
  if (selection.thesisId !== seed.id) {
    return reason("THESIS_MISMATCH", null, `证据选择属于 ${selection.thesisId}，不能用于 ${seed.id}`);
  }
  const cutoffMs = parseCanonicalUtc(selection.cutoff);
  if (cutoffMs === null) {
    return reason("INVALID_SELECTION", null, "证据选择的 cutoff 必须是毫秒精度 UTC ISO-8601");
  }
  const expectedGapIds = [...seed.readiness.blockingGapIds].sort(compareText);
  const actualGapIds = [...selection.coverageGapIds].sort(compareText);
  if (
    new Set(actualGapIds).size !== actualGapIds.length
    || expectedGapIds.length !== actualGapIds.length
    || expectedGapIds.some((gapId, index) => gapId !== actualGapIds[index])
  ) {
    return reason("INVALID_SELECTION", null, "证据选择的 coverageGapIds 与 seed readiness 不一致");
  }
  const selectors = new Map(seed.indicatorSelectors.map((selector) => [selector.id, selector] as const));
  const inputEvidenceIds = new Set<string>();
  for (const input of selection.inputs) {
    if (inputEvidenceIds.has(input.evidenceId)) {
      return reason("INVALID_SELECTION", null, `输入证据 identity ${input.evidenceId} 重复`);
    }
    inputEvidenceIds.add(input.evidenceId);
  }
  const selectedEvidenceIds = new Set<string>();
  const selectedPeriods = new Set<string>();
  for (const evidence of selection.selectedEvidence) {
    const selector = selectors.get(evidence.selectorId);
    const slo = seed.freshnessSlos.find(({ selectorId }) => selectorId === evidence.selectorId);
    const periodKey = `${evidence.selectorId}\u0000${evidence.observedAt}`;
    if (selectedEvidenceIds.has(evidence.evidenceId) || selectedPeriods.has(periodKey)) {
      return reason("INVALID_SELECTION", null, `已选证据 ${evidence.evidenceId} 的 identity 或 selector 观测期重复`);
    }
    selectedEvidenceIds.add(evidence.evidenceId);
    selectedPeriods.add(periodKey);
    const observedAtMs = parseCanonicalUtc(evidence.observedAt);
    const fetchedAtMs = parseCanonicalUtc(evidence.fetchedAt);
    const publishedAtMs = evidence.publishedAt === null ? 0 : parseCanonicalUtc(evidence.publishedAt);
    const valueIsJsonSafe = typeof evidence.value === "string"
      || (typeof evidence.value === "number" && Number.isFinite(evidence.value));
    const matchingInputs = selection.inputs.filter((input) => inputMatchesSelected(input, evidence));
    const expectedFreshness = slo === undefined || slo.maxAgeMinutes === null
      ? null
      : selectedFreshness(evidence, cutoffMs, slo.maxAgeMinutes);
    if (
      selector === undefined
      || selector.reviewStatus !== "approved"
      || !selector.active
      || slo === undefined
      || slo.reviewStatus !== "approved"
      || !slo.active
      || slo.maxAgeMinutes === null
      || selector.indicatorId !== evidence.indicatorId
      || selector.layer !== evidence.layer
      || selector.defaultStance !== evidence.stance
      || selector.weight !== evidence.weight
      || evidence.freshness !== expectedFreshness
      || !Number.isInteger(evidence.revision)
      || evidence.revision < 0
      || observedAtMs === null
      || fetchedAtMs === null
      || fetchedAtMs > cutoffMs
      || publishedAtMs === null
      || !valueIsJsonSafe
      || evidence.quality === "invalid"
      || evidence.citationUrl.trim().length === 0
      || matchingInputs.length !== 1
      || !isUniqueLatestRevision(evidence, selection.inputs, cutoffMs)
    ) {
      return reason("INVALID_SELECTION", null, `已选证据 ${evidence.evidenceId} 与 seed selector 契约不一致`);
    }
  }
  let expected: EvidenceSelectionResult;
  try {
    expected = selectEvidence(seed, selection.cutoff, selection.inputs);
  } catch {
    return reason("INVALID_SELECTION", null, "证据选择无法由 seed、cutoff 和原始输入重建");
  }
  if (!sameSelectedEvidence(selection.selectedEvidence, expected.selectedEvidence)) {
    return reason("INVALID_SELECTION", null, "已选证据与 selector 根据原始输入重建的结果不一致");
  }
  if (!sameRejectedEvidence(selection.rejectedEvidence, expected.rejectedEvidence)) {
    return reason("INVALID_SELECTION", null, "拒绝证据与 selector 根据原始输入重建的结果不一致");
  }
  return null;
}

function sameSelectedEvidence(
  actual: readonly SelectedEvidence[],
  expected: readonly SelectedEvidence[],
): boolean {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort(compareSelectedEvidence);
  const sortedExpected = [...expected].sort(compareSelectedEvidence);
  return sortedActual.every((item, index) => {
    const counterpart = sortedExpected[index];
    return counterpart !== undefined
      && inputMatchesSelected(item, counterpart)
      && item.stance === counterpart.stance
      && item.weight === counterpart.weight
      && item.freshness === counterpart.freshness
      && item.selectorId === counterpart.selectorId
      && item.selectionReason === counterpart.selectionReason;
  });
}

function sameRejectedEvidence(
  actual: EvidenceSelectionResult["rejectedEvidence"],
  expected: EvidenceSelectionResult["rejectedEvidence"],
): boolean {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort(compareRejectedEvidence);
  const sortedExpected = [...expected].sort(compareRejectedEvidence);
  return sortedActual.every((item, index) => {
    const counterpart = sortedExpected[index];
    return counterpart !== undefined
      && item.evidenceId === counterpart.evidenceId
      && item.selectorId === counterpart.selectorId
      && item.indicatorId === counterpart.indicatorId
      && item.code === counterpart.code
      && item.reason === counterpart.reason;
  });
}

function selectedFreshness(
  evidence: SelectedEvidence,
  cutoffMs: number,
  maxAgeMinutes: number,
): SelectedEvidence["freshness"] | null {
  if (evidence.sourceHealth === "broken" || evidence.sourceHealth === "stale") return null;
  const freshnessAtMs = parseCanonicalUtc(evidence.publishedAt ?? evidence.fetchedAt);
  if (freshnessAtMs === null) return null;
  const ageMinutes = Math.max(0, cutoffMs - freshnessAtMs) / 60_000;
  if (ageMinutes > maxAgeMinutes) return null;
  return evidence.sourceHealth === "delayed" ? "late" : "fresh";
}

function isUniqueLatestRevision(
  selected: SelectedEvidence,
  inputs: EvidenceSelectionResult["inputs"],
  cutoffMs: number,
): boolean {
  const availablePeriodInputs = inputs.filter((input) => {
    if (input.indicatorId !== selected.indicatorId || input.observedAt !== selected.observedAt) return false;
    if (!Number.isInteger(input.revision) || input.revision < 0) return false;
    const fetchedAtMs = parseCanonicalUtc(input.fetchedAt);
    return fetchedAtMs === null || fetchedAtMs <= cutoffMs;
  });
  const latestRevision = Math.max(...availablePeriodInputs.map(({ revision }) => revision));
  return selected.revision === latestRevision
    && availablePeriodInputs.filter(({ revision }) => revision === latestRevision).length === 1;
}

function validateOptions(options: StageGateOptions): StageGateReason | null {
  if (
    typeof options !== "object"
    || options === null
    || !THESIS_STAGES.includes(options.previousStage)
  ) {
    return reason("INVALID_SELECTION", null, "阶段计算 options.previousStage 无效");
  }
  const confirmation = options.manualConfirmation;
  if (
    confirmation !== undefined
    && (
      typeof confirmation !== "object"
      || confirmation === null
      || typeof confirmation.confirmedBy !== "string"
      || typeof confirmation.reason !== "string"
    )
  ) {
    return reason("INVALID_SELECTION", null, "阶段计算 manualConfirmation 无效");
  }
  return null;
}

function inputMatchesSelected(
  input: EvidenceSelectionResult["inputs"][number],
  selected: SelectedEvidence,
): boolean {
  return input.evidenceId === selected.evidenceId
    && input.observationId === selected.observationId
    && input.sourceRunId === selected.sourceRunId
    && input.revision === selected.revision
    && input.supersedesId === selected.supersedesId
    && input.indicatorId === selected.indicatorId
    && input.sourceId === selected.sourceId
    && input.layer === selected.layer
    && input.observedAt === selected.observedAt
    && input.publishedAt === selected.publishedAt
    && input.fetchedAt === selected.fetchedAt
    && Object.is(input.value, selected.value)
    && input.unit === selected.unit
    && input.quality === selected.quality
    && input.citationUrl === selected.citationUrl
    && input.sourceTier === selected.sourceTier
    && input.sourceHealth === selected.sourceHealth;
}

function compareSelectedEvidence(left: SelectedEvidence, right: SelectedEvidence): number {
  return compareText(left.selectorId, right.selectorId)
    || compareText(left.observedAt, right.observedAt)
    || left.revision - right.revision
    || compareText(left.evidenceId, right.evidenceId);
}

function compareRejectedEvidence(
  left: EvidenceSelectionResult["rejectedEvidence"][number],
  right: EvidenceSelectionResult["rejectedEvidence"][number],
): number {
  return compareText(left.selectorId ?? "", right.selectorId ?? "")
    || compareText(left.indicatorId, right.indicatorId)
    || compareText(left.evidenceId ?? "", right.evidenceId ?? "")
    || compareText(left.code, right.code)
    || compareText(left.reason, right.reason);
}

function addPrerequisiteReasons(checks: StageGateCheck[]): void {
  let prerequisitePassed = true;
  for (const stage of PRESSURE_STAGES) {
    const index = checks.findIndex(({ targetStage }) => targetStage === stage);
    const check = checks[index];
    if (check === undefined) continue;
    if (!prerequisitePassed && check.status === "passed") {
      checks[index] = deepFreeze({
        ...check,
        status: "blocked",
        reasons: sortReasons([
          ...check.reasons,
          reason("PREREQUISITE_STAGE_BLOCKED", stage, "前一传导阶段未通过，禁止向上越级"),
        ]),
      });
    }
    prerequisitePassed = prerequisitePassed && check.status === "passed";
  }
}

function replaceCheck(checks: StageGateCheck[], replacement: StageGateCheck): void {
  const index = checks.findIndex(({ targetStage }) => targetStage === replacement.targetStage);
  if (index >= 0) checks[index] = deepFreeze(replacement);
}

function gateCheck(
  gate: StageGateDescriptor,
  status: StageGateCheck["status"],
  presentLayers: readonly EvidenceLayer[],
  missingLayers: readonly EvidenceLayer[],
  staleLayers: readonly EvidenceLayer[],
  blockingCoverageGapIds: readonly string[],
  matchedRuleIds: readonly string[],
  matchedEvidenceIds: readonly string[],
  rejectedRuleIds: readonly string[],
  reasons: readonly StageGateReason[],
): StageGateCheck {
  return deepFreeze({
    targetStage: gate.targetStage,
    status,
    requiredLayers: sortedLayers(gate.requiredLayers),
    presentLayers: sortedLayers(presentLayers),
    missingLayers: sortedLayers(missingLayers),
    staleLayers: sortedLayers(staleLayers),
    blockingCoverageGapIds: [...blockingCoverageGapIds].sort(compareText),
    matchedRuleIds: [...matchedRuleIds].sort(compareText),
    matchedEvidenceIds: [...matchedEvidenceIds].sort(compareText),
    rejectedRuleIds: [...rejectedRuleIds].sort(compareText),
    reasons: sortReasons(reasons),
  });
}

function result(
  seed: ThesisSeed,
  selection: EvidenceSelectionResult,
  previousStage: ThesisStage,
  highestEligibleStage: ThesisStage,
  stage: ThesisStage,
  transition: StageGateResult["transition"],
  manualConfirmationApplied: boolean,
  checks: readonly StageGateCheck[],
  reasons: readonly StageGateReason[],
): StageGateResult {
  return deepFreeze({
    thesisId: seed.id,
    cutoff: selection.cutoff,
    previousStage,
    highestEligibleStage,
    stage,
    transition,
    manualConfirmationApplied,
    checks: [...checks].sort(
      (left, right) => stageIndex(left.targetStage) - stageIndex(right.targetStage),
    ),
    reasons: sortReasons(reasons),
  });
}

function validManualConfirmation(
  confirmation: StageGateManualConfirmation | undefined,
): StageGateManualConfirmation | null {
  if (
    confirmation === undefined
    || confirmation.confirmedBy.trim().length === 0
    || confirmation.reason.trim().length === 0
  ) return null;
  return confirmation;
}

function reason(
  code: StageGateReason["code"],
  targetStage: ThesisStage | null,
  message: string,
  detail: Partial<Pick<StageGateReason, "layer" | "ruleId" | "coverageGapId">> = {},
): StageGateReason {
  return {
    code,
    targetStage,
    layer: detail.layer ?? null,
    ruleId: detail.ruleId ?? null,
    coverageGapId: detail.coverageGapId ?? null,
    reason: message,
  };
}

function sortReasons(reasons: readonly StageGateReason[]): readonly StageGateReason[] {
  return [...reasons].sort((left, right) =>
    stageIndex(left.targetStage ?? "watch") - stageIndex(right.targetStage ?? "watch")
      || compareText(left.code, right.code)
      || compareText(left.layer ?? "", right.layer ?? "")
      || compareText(left.ruleId ?? "", right.ruleId ?? "")
      || compareText(left.coverageGapId ?? "", right.coverageGapId ?? "")
      || compareText(left.reason, right.reason),
  );
}

function sortedLayers(layers: readonly EvidenceLayer[]): readonly EvidenceLayer[] {
  const order: readonly EvidenceLayer[] = ["forecast", "weather", "physical", "balance", "market", "control"];
  return [...layers].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function stageIndex(stage: ThesisStage): number {
  return THESIS_STAGES.indexOf(stage);
}

function parseCanonicalUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || new Date(parsed).toISOString() !== value ? null : parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
