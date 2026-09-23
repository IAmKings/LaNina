import { THESIS_STAGES } from "./contracts";
import type { ThesisDirection, ThesisStage } from "./contracts";
import { canonicalJson, sha256Hex } from "./canonical-json";
import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type {
  DirectionConfidenceEvaluation,
  EvidenceSelectionResult,
  SelectedEvidence,
} from "./evaluation";
import { evaluateRulePredicate } from "./rule-predicate";
import { evaluateStageGates, validateEvidenceSelection } from "./stage-gate";
import type { RuleDescriptor, ThesisSeed } from "./thesis-seeds";

export const MATERIAL_CHANGE_CLASSES = ["fact", "thesis"] as const;
export const MATERIAL_CHANGE_TYPES = ["threshold", "revision", "thesis"] as const;

export type MaterialChangeClass = (typeof MATERIAL_CHANGE_CLASSES)[number];
export type MaterialChangeType = (typeof MATERIAL_CHANGE_TYPES)[number];

export interface MaterialChangeSnapshot {
  readonly previousStage: ThesisStage;
  readonly selection: EvidenceSelectionResult;
  readonly evaluation: DirectionConfidenceEvaluation;
}

export interface MaterialChangePublishingSemantics {
  readonly reviewPath: "independent_fact_review" | "requires_published_thesis_version";
  readonly automaticPublication: "not_authorized";
}

export interface MaterialChangeNumericEvidence {
  readonly evidenceId: string;
  readonly observationId: string | null;
  readonly selectorId: string;
  readonly indicatorId: string;
  readonly sourceId: string;
  readonly citationUrl: string;
  readonly observedAt: string;
  readonly revision: number;
  readonly value: number;
  readonly unit: string;
}

export type ThesisChangeTrigger =
  | {
      readonly kind: "stage";
      readonly before: ThesisStage;
      readonly after: ThesisStage;
    }
  | {
      readonly kind: "direction";
      readonly before: ThesisDirection;
      readonly after: ThesisDirection;
    }
  | {
      readonly kind: "confidence";
      readonly before: number;
      readonly after: number;
      readonly absoluteDelta: number;
      readonly threshold: number;
    };

export interface MaterialThesisState {
  readonly stage: ThesisStage;
  readonly direction: {
    readonly status: "available" | "unavailable";
    readonly value: ThesisDirection;
  };
  readonly confidence: {
    readonly status: "available" | "unavailable";
    readonly score: number | null;
  };
}

interface MaterialChangeBase {
  readonly idempotencyKey: string;
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly beforeCutoff: string;
  readonly afterCutoff: string;
  readonly changeClass: MaterialChangeClass;
  readonly changeType: MaterialChangeType;
  readonly publishing: MaterialChangePublishingSemantics;
}

export interface ThesisMaterialChange extends MaterialChangeBase {
  readonly changeClass: "thesis";
  readonly changeType: "thesis";
  readonly publishing: {
    readonly reviewPath: "requires_published_thesis_version";
    readonly automaticPublication: "not_authorized";
  };
  readonly triggers: readonly ThesisChangeTrigger[];
  readonly before: MaterialThesisState;
  readonly after: MaterialThesisState;
}

export interface ThresholdMaterialChange extends MaterialChangeBase {
  readonly changeClass: "fact";
  readonly changeType: "threshold";
  readonly publishing: {
    readonly reviewPath: "independent_fact_review";
    readonly automaticPublication: "not_authorized";
  };
  readonly ruleId: string;
  readonly selectorId: string;
  readonly indicatorId: string;
  readonly transition: "entered" | "exited";
  readonly predicate: {
    readonly operator: "gt" | "gte" | "lt" | "lte";
    readonly threshold: number;
    readonly unit: string;
  };
  readonly before: MaterialChangeNumericEvidence;
  readonly after: MaterialChangeNumericEvidence;
}

export interface RevisionMaterialChange extends MaterialChangeBase {
  readonly changeClass: "fact";
  readonly changeType: "revision";
  readonly publishing: {
    readonly reviewPath: "independent_fact_review";
    readonly automaticPublication: "not_authorized";
  };
  readonly selectorId: string;
  readonly indicatorId: string;
  readonly observedAt: string;
  readonly absoluteValueDelta: number;
  readonly requiredValueDelta: number;
  readonly before: MaterialChangeNumericEvidence;
  readonly after: MaterialChangeNumericEvidence;
}

export type MaterialChange =
  | ThesisMaterialChange
  | ThresholdMaterialChange
  | RevisionMaterialChange;

export interface MaterialChangeDetectionResult {
  readonly status: "available" | "unavailable";
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly beforeCutoff: string;
  readonly afterCutoff: string;
  readonly changes: readonly MaterialChange[];
  readonly reasons: readonly string[];
}

type ChangeWithoutKey = Omit<ThesisMaterialChange, "idempotencyKey">
  | Omit<ThresholdMaterialChange, "idempotencyKey">
  | Omit<RevisionMaterialChange, "idempotencyKey">;

const FACT_PUBLISHING = {
  reviewPath: "independent_fact_review",
  automaticPublication: "not_authorized",
} as const;

const THESIS_PUBLISHING = {
  reviewPath: "requires_published_thesis_version",
  automaticPublication: "not_authorized",
} as const;

export async function detectMaterialChanges(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
): Promise<MaterialChangeDetectionResult> {
  const identity = resultIdentity(seed, before, after);
  const policy = seed.materialChangeThresholds;
  if (
    policy.reviewStatus !== "approved"
    || !policy.active
    || policy.confidenceDeltaPoints === null
    || policy.observationRevisionDelta === null
    || seed.readiness.reviewStatus !== "approved"
    || !seed.readiness.productionEvaluation
  ) {
    return unavailable(identity, [
      "重大变化策略尚未通过研究审核、未启用、阈值不完整，或生产评估尚未启用",
    ]);
  }

  const beforeReason = validateSnapshot(seed, before, "before");
  const afterReason = validateSnapshot(seed, after, "after");
  const chronologyReason = beforeReason === null && afterReason === null
    ? validateChronology(before, after)
    : null;
  const invalidReasons = [beforeReason, afterReason, chronologyReason]
    .filter((reason): reason is string => reason !== null)
    .sort(compareText);
  if (invalidReasons.length > 0) return unavailable(identity, invalidReasons);

  const candidates: ChangeWithoutKey[] = [];
  const thesisChange = detectThesisChange(seed, before, after, policy.confidenceDeltaPoints);
  if (thesisChange !== null) candidates.push(thesisChange);
  candidates.push(...detectThresholdChanges(seed, before, after));
  candidates.push(...detectRevisionChanges(seed, before, after, policy.observationRevisionDelta));
  candidates.sort(compareChangesWithoutKey);

  const changes = await Promise.all(candidates.map(async (change) => ({
    ...change,
    idempotencyKey: await materialChangeKey(change),
  } as MaterialChange)));
  const reasons = changes.length === 0
    ? ["前后快照没有达到已审核的重大变化条件"]
    : [`检测到 ${changes.length} 条互不重复的重大变化`];

  return deepFreeze({
    status: "available",
    ...identity,
    changes,
    reasons,
  });
}

function validateSnapshot(
  seed: ThesisSeed,
  snapshot: MaterialChangeSnapshot,
  label: "before" | "after",
): string | null {
  try {
    if (!THESIS_STAGES.includes(snapshot.previousStage)) {
      return `${label}.previousStage 不是有效传导阶段`;
    }
    const invalidSelection = validateEvidenceSelection(seed, snapshot.selection);
    if (invalidSelection !== null) return `${label} 证据选择无效：${invalidSelection.reason}`;
    canonicalJson(snapshot);
    const stage = evaluateStageGates(seed, snapshot.selection, {
      previousStage: snapshot.previousStage,
    });
    const expected = evaluateDirectionAndConfidence(seed, snapshot.selection, stage);
    if (canonicalJson(expected) !== canonicalJson(snapshot.evaluation)) {
      return `${label} evaluation 无法由 seed、selection 与 previousStage 完整重建`;
    }
  } catch (error) {
    return `${label} 快照无法安全重建或进行 canonical 比对：${errorMessage(error)}`;
  }
  return null;
}

function validateChronology(
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
): string | null {
  if (after.selection.cutoff < before.selection.cutoff) {
    return "after cutoff 不得早于 before cutoff";
  }
  if (after.previousStage !== before.evaluation.stage) {
    return "after.previousStage 必须等于 before evaluation 的实际阶段";
  }
  return null;
}

function detectThesisChange(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
  confidenceThreshold: number,
): Omit<ThesisMaterialChange, "idempotencyKey"> | null {
  const triggers: ThesisChangeTrigger[] = [];
  if (before.evaluation.stage !== after.evaluation.stage) {
    triggers.push({
      kind: "stage",
      before: before.evaluation.stage,
      after: after.evaluation.stage,
    });
  }
  if (
    before.evaluation.direction.status === "available"
    && after.evaluation.direction.status === "available"
    && before.evaluation.direction.direction !== after.evaluation.direction.direction
  ) {
    triggers.push({
      kind: "direction",
      before: before.evaluation.direction.direction,
      after: after.evaluation.direction.direction,
    });
  }
  if (
    before.evaluation.confidence.status === "available"
    && after.evaluation.confidence.status === "available"
  ) {
    const absoluteDelta = Math.abs(
      after.evaluation.confidence.finalScore - before.evaluation.confidence.finalScore,
    );
    if (absoluteDelta >= confidenceThreshold) {
      triggers.push({
        kind: "confidence",
        before: before.evaluation.confidence.finalScore,
        after: after.evaluation.confidence.finalScore,
        absoluteDelta,
        threshold: confidenceThreshold,
      });
    }
  }
  if (triggers.length === 0) return null;
  triggers.sort((left, right) => thesisTriggerOrder(left.kind) - thesisTriggerOrder(right.kind));
  return {
    ...changeIdentity(seed, before, after),
    changeClass: "thesis",
    changeType: "thesis",
    publishing: THESIS_PUBLISHING,
    triggers,
    before: thesisState(before.evaluation),
    after: thesisState(after.evaluation),
  };
}

function detectThresholdChanges(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
): Array<Omit<ThresholdMaterialChange, "idempotencyKey">> {
  const beforeBySelector = latestEvidenceBySelector(before.selection.selectedEvidence);
  const afterBySelector = latestEvidenceBySelector(after.selection.selectedEvidence);
  const rules = allRules(seed)
    .filter((rule): rule is RuleDescriptor & { readonly predicate: Extract<RuleDescriptor["predicate"], { kind: "numeric_compare" }> } =>
      rule.reviewStatus === "approved" && rule.active && rule.predicate.kind === "numeric_compare",
    )
    .sort((left, right) => compareText(left.id, right.id));
  const changes: Array<Omit<ThresholdMaterialChange, "idempotencyKey">> = [];

  for (const rule of rules) {
    const selector = seed.indicatorSelectors.find(({ id }) => id === rule.predicate.selectorId);
    if (selector === undefined || selector.reviewStatus !== "approved" || !selector.active) continue;
    const beforeEvidence = beforeBySelector.get(selector.id);
    const afterEvidence = afterBySelector.get(selector.id);
    if (
      beforeEvidence === undefined
      || afterEvidence === undefined
      || !isCanonicalFiniteNumber(beforeEvidence.value)
      || !isCanonicalFiniteNumber(afterEvidence.value)
      || beforeEvidence.unit !== rule.predicate.unit
      || afterEvidence.unit !== rule.predicate.unit
    ) continue;
    const beforeMatched = evaluateRulePredicate(rule.predicate, [beforeEvidence]).length > 0;
    const afterMatched = evaluateRulePredicate(rule.predicate, [afterEvidence]).length > 0;
    if (beforeMatched === afterMatched) continue;
    changes.push({
      ...changeIdentity(seed, before, after),
      changeClass: "fact",
      changeType: "threshold",
      publishing: FACT_PUBLISHING,
      ruleId: rule.id,
      selectorId: selector.id,
      indicatorId: selector.indicatorId,
      transition: afterMatched ? "entered" : "exited",
      predicate: {
        operator: rule.predicate.operator,
        threshold: rule.predicate.threshold,
        unit: rule.predicate.unit,
      },
      before: numericEvidence(beforeEvidence as SelectedEvidence & { readonly value: number }),
      after: numericEvidence(afterEvidence as SelectedEvidence & { readonly value: number }),
    });
  }
  return changes;
}

function detectRevisionChanges(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
  requiredValueDelta: number,
): Array<Omit<RevisionMaterialChange, "idempotencyKey">> {
  const selectors = new Map(seed.indicatorSelectors
    .filter(({ reviewStatus, active }) => reviewStatus === "approved" && active)
    .map((selector) => [selector.id, selector] as const));
  const beforeByPeriod = numericEvidenceByPeriod(before.selection.selectedEvidence, selectors);
  const afterByPeriod = numericEvidenceByPeriod(after.selection.selectedEvidence, selectors);
  const changes: Array<Omit<RevisionMaterialChange, "idempotencyKey">> = [];

  for (const [periodKey, beforeEvidence] of beforeByPeriod) {
    const afterEvidence = afterByPeriod.get(periodKey);
    if (
      afterEvidence === undefined
      || afterEvidence.revision <= beforeEvidence.revision
      || afterEvidence.unit !== beforeEvidence.unit
    ) continue;
    const absoluteValueDelta = Math.abs(afterEvidence.value - beforeEvidence.value);
    if (!meetsInclusiveDelta(absoluteValueDelta, requiredValueDelta, beforeEvidence.value, afterEvidence.value)) {
      continue;
    }
    changes.push({
      ...changeIdentity(seed, before, after),
      changeClass: "fact",
      changeType: "revision",
      publishing: FACT_PUBLISHING,
      selectorId: beforeEvidence.selectorId,
      indicatorId: beforeEvidence.indicatorId,
      observedAt: beforeEvidence.observedAt,
      absoluteValueDelta,
      requiredValueDelta,
      before: beforeEvidence,
      after: afterEvidence,
    });
  }
  return changes;
}

function latestEvidenceBySelector(
  evidence: readonly SelectedEvidence[],
): ReadonlyMap<string, SelectedEvidence> {
  const latest = new Map<string, SelectedEvidence>();
  for (const item of [...evidence].sort(compareSelectedLatestFirst)) {
    if (!latest.has(item.selectorId)) latest.set(item.selectorId, item);
  }
  return latest;
}

function numericEvidenceByPeriod(
  evidence: readonly SelectedEvidence[],
  selectors: ReadonlyMap<string, ThesisSeed["indicatorSelectors"][number]>,
): ReadonlyMap<string, MaterialChangeNumericEvidence> {
  const result = new Map<string, MaterialChangeNumericEvidence>();
  for (const item of evidence) {
    const selector = selectors.get(item.selectorId);
    if (
      selector === undefined
      || selector.indicatorId !== item.indicatorId
      || !isCanonicalFiniteNumber(item.value)
    ) continue;
    const key = canonicalJson([item.selectorId, item.indicatorId, item.observedAt]);
    result.set(key, numericEvidence(item as SelectedEvidence & { readonly value: number }));
  }
  return result;
}

function numericEvidence(
  evidence: SelectedEvidence & { readonly value: number },
): MaterialChangeNumericEvidence {
  return {
    evidenceId: evidence.evidenceId,
    observationId: evidence.observationId,
    selectorId: evidence.selectorId,
    indicatorId: evidence.indicatorId,
    sourceId: evidence.sourceId,
    citationUrl: evidence.citationUrl,
    observedAt: evidence.observedAt,
    revision: evidence.revision,
    value: evidence.value,
    unit: evidence.unit,
  };
}

function thesisState(evaluation: DirectionConfidenceEvaluation): MaterialThesisState {
  return {
    stage: evaluation.stage,
    direction: {
      status: evaluation.direction.status,
      value: evaluation.direction.direction,
    },
    confidence: {
      status: evaluation.confidence.status,
      score: evaluation.confidence.status === "available"
        ? evaluation.confidence.finalScore
        : null,
    },
  };
}

function allRules(seed: ThesisSeed): readonly RuleDescriptor[] {
  return [
    ...seed.supportRules,
    ...seed.refuteRules,
    ...seed.invalidationRules,
    ...seed.reliefRules,
  ];
}

function changeIdentity(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
): Omit<MaterialChangeBase, "idempotencyKey" | "changeClass" | "changeType" | "publishing"> {
  return {
    thesisId: seed.id,
    methodologyVersion: seed.methodologyVersion,
    regionDefinitionVersion: seed.regionDefinitionVersion,
    target: seed.target,
    marketScope: seed.marketScope,
    timeHorizon: seed.timeHorizon,
    beforeCutoff: before.selection.cutoff,
    afterCutoff: after.selection.cutoff,
  };
}

function resultIdentity(
  seed: ThesisSeed,
  before: MaterialChangeSnapshot,
  after: MaterialChangeSnapshot,
): Omit<MaterialChangeDetectionResult, "status" | "changes" | "reasons"> {
  return {
    thesisId: seed.id,
    methodologyVersion: seed.methodologyVersion,
    regionDefinitionVersion: seed.regionDefinitionVersion,
    target: seed.target,
    marketScope: seed.marketScope,
    timeHorizon: seed.timeHorizon,
    beforeCutoff: snapshotCutoff(before),
    afterCutoff: snapshotCutoff(after),
  };
}

function snapshotCutoff(snapshot: unknown): string {
  if (typeof snapshot !== "object" || snapshot === null || !("selection" in snapshot)) return "";
  const selection = snapshot.selection;
  if (typeof selection !== "object" || selection === null || !("cutoff" in selection)) return "";
  return typeof selection.cutoff === "string" ? selection.cutoff : "";
}

function unavailable(
  identity: ReturnType<typeof resultIdentity>,
  reasons: readonly string[],
): MaterialChangeDetectionResult {
  return deepFreeze({
    status: "unavailable",
    ...identity,
    changes: [],
    reasons: [...reasons].sort(compareText),
  });
}

async function materialChangeKey(change: ChangeWithoutKey): Promise<string> {
  const hex = await sha256Hex(canonicalJson({
    keyVersion: "material-change-v1",
    change: materialChangeSemanticIdentity(change),
  }));
  return `material-change-v1:sha256:${hex}`;
}

function materialChangeSemanticIdentity(change: ChangeWithoutKey): object {
  const identity = {
    thesisId: change.thesisId,
    methodologyVersion: change.methodologyVersion,
    regionDefinitionVersion: change.regionDefinitionVersion,
    target: change.target,
    marketScope: change.marketScope,
    timeHorizon: change.timeHorizon,
    changeType: change.changeType,
  };
  switch (change.changeType) {
    case "thesis":
      return { ...identity, triggers: change.triggers, before: change.before, after: change.after };
    case "threshold":
      return {
        ...identity,
        ruleId: change.ruleId,
        selectorId: change.selectorId,
        indicatorId: change.indicatorId,
        transition: change.transition,
        predicate: change.predicate,
        before: numericEvidenceSemanticIdentity(change.before),
        after: numericEvidenceSemanticIdentity(change.after),
      };
    case "revision":
      return {
        ...identity,
        selectorId: change.selectorId,
        indicatorId: change.indicatorId,
        observedAt: change.observedAt,
        absoluteValueDelta: change.absoluteValueDelta,
        requiredValueDelta: change.requiredValueDelta,
        before: numericEvidenceSemanticIdentity(change.before),
        after: numericEvidenceSemanticIdentity(change.after),
      };
  }
}

function numericEvidenceSemanticIdentity(evidence: MaterialChangeNumericEvidence): object {
  return {
    evidenceId: evidence.evidenceId,
    observationId: evidence.observationId,
    selectorId: evidence.selectorId,
    indicatorId: evidence.indicatorId,
    sourceId: evidence.sourceId,
    observedAt: evidence.observedAt,
    revision: evidence.revision,
    value: evidence.value,
    unit: evidence.unit,
  };
}

function compareChangesWithoutKey(left: ChangeWithoutKey, right: ChangeWithoutKey): number {
  return changeTypeOrder(left.changeType) - changeTypeOrder(right.changeType)
    || compareText(canonicalJson(left), canonicalJson(right));
}

function compareSelectedLatestFirst(left: SelectedEvidence, right: SelectedEvidence): number {
  return compareText(left.selectorId, right.selectorId)
    || compareText(right.observedAt, left.observedAt)
    || right.revision - left.revision
    || compareText(left.evidenceId, right.evidenceId);
}

function isCanonicalFiniteNumber(value: number | string): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function meetsInclusiveDelta(
  actual: number,
  required: number,
  before: number,
  after: number,
): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(before), Math.abs(after), required) * 4;
  return actual > required || Math.abs(actual - required) <= tolerance;
}

function thesisTriggerOrder(kind: ThesisChangeTrigger["kind"]): number {
  return kind === "stage" ? 0 : kind === "direction" ? 1 : 2;
}

function changeTypeOrder(type: MaterialChangeType): number {
  return type === "thesis" ? 0 : type === "threshold" ? 1 : 2;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
