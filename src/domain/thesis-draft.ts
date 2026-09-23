import { canonicalJson, sha256Hex } from "./canonical-json";
import type { ThesisDirection, ThesisStage } from "./contracts";
import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type {
  DirectionConfidenceEvaluation,
  EvidenceLayer,
  EvidenceSelectionResult,
  EvidenceStance,
  StageGateResult,
} from "./evaluation";
import { selectEvidence } from "./evidence-selector";
import { evaluateStageGates } from "./stage-gate";
import { decodeThesisSeed } from "./thesis-seeds";
import type { ThesisSeed } from "./thesis-seeds";

export const THESIS_DRAFT_CALCULATION_SCHEMA = "thesis-draft-calculation-v1" as const;
export const THESIS_DRAFT_KEY_VERSION = "thesis-draft-v1" as const;

export interface ThesisDraftEvidenceCopy {
  readonly evidenceId: string;
  readonly summary: string;
}

export interface ThesisDraftCandidate {
  readonly seed: ThesisSeed;
  readonly previousStage: ThesisStage;
  readonly selection: EvidenceSelectionResult;
  readonly stageResult: StageGateResult;
  readonly evaluation: DirectionConfidenceEvaluation;
  readonly summary: string;
  readonly invalidation: string;
  readonly changeReason: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly evidence: readonly ThesisDraftEvidenceCopy[];
}

export interface ThesisDraftCalculation {
  readonly schemaVersion: typeof THESIS_DRAFT_CALCULATION_SCHEMA;
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly cutoff: string;
  readonly previousStage: ThesisStage;
  readonly selection: {
    readonly selectedEvidence: readonly ThesisDraftSelectedEvidenceReference[];
    readonly rejectedEvidence: EvidenceSelectionResult["rejectedEvidence"];
    readonly coverageGapIds: readonly string[];
  };
  readonly stage: StageGateResult;
  readonly direction: DirectionConfidenceEvaluation["direction"];
  readonly confidence: DirectionConfidenceEvaluation["confidence"];
}

export interface ThesisDraftSelectedEvidenceReference {
  readonly evidenceId: string;
  readonly selectorId: string;
  readonly observationId: string | null;
  readonly sourceRunId: string | null;
  readonly indicatorId: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly revision: number;
  readonly stance: EvidenceStance;
  readonly layer: EvidenceLayer;
  readonly weight: number;
  readonly summary: string;
  readonly citationUrl: string;
  readonly sortOrder: number;
}

export interface ThesisDraftEvidenceRecord {
  readonly observationId: string | null;
  readonly sourceRunId: string | null;
  readonly stance: EvidenceStance;
  readonly layer: EvidenceLayer;
  readonly weight: number;
  readonly summary: string;
  readonly citationUrl: string;
  readonly sortOrder: number;
}

export interface ThesisDraftStorageRecord {
  readonly thesisId: string;
  readonly status: "draft";
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly invalidation: string;
  readonly calculation: ThesisDraftCalculation;
  readonly basedOnCutoff: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly publishedBy: null;
  readonly publishedAt: null;
  readonly changeReason: string | null;
  readonly draftKey: string;
  readonly evidence: readonly ThesisDraftEvidenceRecord[];
}

export interface PersistedThesisDraft extends ThesisDraftStorageRecord {
  readonly id: string;
  readonly version: number;
}

export type ThesisDraftKeyMaterial = Pick<
  ThesisDraftStorageRecord,
  | "thesisId"
  | "direction"
  | "stage"
  | "confidence"
  | "summary"
  | "invalidation"
  | "calculation"
  | "changeReason"
  | "evidence"
>;

export class ThesisDraftValidationError extends Error {
  readonly code = "VALIDATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "ThesisDraftValidationError";
  }
}

export async function buildThesisDraftStorageRecord(
  candidate: ThesisDraftCandidate,
): Promise<ThesisDraftStorageRecord> {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw validationError("草稿候选必须是对象");
  }
  let seed: ThesisSeed;
  try {
    seed = decodeThesisSeed(candidate.seed);
  } catch {
    throw validationError("论点 seed 未通过运行时校验");
  }
  if (
    seed.readiness.reviewStatus !== "approved"
    || !seed.readiness.productionEvaluation
  ) {
    throw validationError("论点尚未通过生产评估审核，不能写入草稿");
  }
  if (typeof candidate.summary !== "string" || candidate.summary.trim().length === 0) {
    throw validationError("草稿摘要不能为空");
  }
  if (typeof candidate.invalidation !== "string") {
    throw validationError("草稿失效条件必须是字符串");
  }
  if (typeof candidate.createdBy !== "string") {
    throw validationError("草稿创建人必须是字符串");
  }
  if (candidate.changeReason !== null && typeof candidate.changeReason !== "string") {
    throw validationError("变更原因必须是字符串或 null");
  }
  if (!Array.isArray(candidate.evidence)) {
    throw validationError("草稿证据必须是数组");
  }
  if (
    typeof candidate.selection !== "object"
    || candidate.selection === null
    || !Array.isArray(candidate.selection.inputs)
    || typeof candidate.selection.cutoff !== "string"
  ) {
    throw validationError("证据选择结构无效");
  }
  if (
    typeof candidate.evaluation !== "object"
    || candidate.evaluation === null
    || typeof candidate.evaluation.cutoff !== "string"
  ) {
    throw validationError("方向与置信度结构无效");
  }
  assertCanonicalUtc(candidate.selection.cutoff, "basedOnCutoff");
  assertCanonicalUtc(candidate.createdAt, "createdAt");
  if (candidate.selection.cutoff !== candidate.evaluation.cutoff) {
    throw validationError("评估 cutoff 与证据选择不一致");
  }
  if ([...candidate.summary].length > 500) throw validationError("草稿摘要不能超过 500 字符");
  if (candidate.invalidation.trim().length === 0) throw validationError("草稿失效条件不能为空");
  if (candidate.createdBy.trim().length === 0) throw validationError("草稿创建人不能为空");
  if (candidate.changeReason !== null && candidate.changeReason.trim().length === 0) {
    throw validationError("变更原因不能是空白字符串");
  }

  let expectedSelection: EvidenceSelectionResult;
  try {
    expectedSelection = selectEvidence(seed, candidate.selection.cutoff, candidate.selection.inputs);
  } catch {
    throw validationError("证据选择无法从 seed、cutoff 和输入重建");
  }
  if (!sameCanonicalValue(candidate.selection, expectedSelection)) {
    throw validationError("证据选择与可信重建结果不一致");
  }
  let expectedStage: StageGateResult;
  try {
    expectedStage = evaluateStageGates(seed, expectedSelection, {
      previousStage: candidate.previousStage,
    });
  } catch {
    throw validationError("阶段结果无法从 seed、证据选择和前序阶段重建");
  }
  if (expectedStage.transition === "invalid" || expectedStage.manualConfirmationApplied) {
    throw validationError("阶段结果不具备可持久化的可信审计基础");
  }
  if (!sameCanonicalValue(candidate.stageResult, expectedStage)) {
    throw validationError("阶段结果与可信重建结果不一致");
  }
  let expectedEvaluation: DirectionConfidenceEvaluation;
  try {
    expectedEvaluation = evaluateDirectionAndConfidence(seed, expectedSelection, expectedStage);
  } catch {
    throw validationError("方向或置信度无法从可信阶段结果重建");
  }
  if (!sameCanonicalValue(candidate.evaluation, expectedEvaluation)) {
    throw validationError("方向或置信度与可信重建结果不一致");
  }
  if (
    expectedEvaluation.direction.status !== "available"
    || expectedEvaluation.confidence.status !== "available"
  ) {
    throw validationError("方向或置信度不可用，不能写入草稿");
  }
  if (expectedSelection.selectedEvidence.length === 0) {
    throw validationError("草稿至少需要一条已选证据");
  }

  const copies = new Map<string, string>();
  for (const item of candidate.evidence) {
    if (!hasExactKeys(item, ["evidenceId", "summary"])) {
      throw validationError("证据副本字段不完整或包含未知字段");
    }
    if (
      typeof item.evidenceId !== "string"
      || typeof item.summary !== "string"
      || item.evidenceId.trim().length === 0
      || item.summary.trim().length === 0
    ) {
      throw validationError("证据标识和摘要不能为空");
    }
    if (copies.has(item.evidenceId)) throw validationError(`证据 ${item.evidenceId} 重复`);
    copies.set(item.evidenceId, item.summary);
  }
  const selectedIds = new Set(expectedSelection.selectedEvidence.map(({ evidenceId }) => evidenceId));
  if (copies.size !== selectedIds.size || [...copies].some(([id]) => !selectedIds.has(id))) {
    throw validationError("草稿证据必须与已选证据一一对应");
  }
  const selectedById = new Map(
    expectedSelection.selectedEvidence.map((item) => [item.evidenceId, item] as const),
  );
  const selectedEvidence: ThesisDraftSelectedEvidenceReference[] = [];
  const evidence = candidate.evidence.map((copy, sortOrder) => {
    const selected = selectedById.get(copy.evidenceId);
    if (selected === undefined) throw validationError(`证据 ${copy.evidenceId} 未被 selector 选中`);
    if (selected.observationId === null && selected.sourceRunId === null) {
      throw validationError(`证据 ${copy.evidenceId} 缺少观测或来源运行引用`);
    }
    selectedEvidence.push({
      evidenceId: selected.evidenceId,
      selectorId: selected.selectorId,
      observationId: selected.observationId,
      sourceRunId: selected.sourceRunId,
      indicatorId: selected.indicatorId,
      sourceId: selected.sourceId,
      observedAt: selected.observedAt,
      revision: selected.revision,
      stance: selected.stance,
      layer: selected.layer,
      weight: selected.weight,
      summary: copy.summary,
      citationUrl: selected.citationUrl,
      sortOrder,
    });
    return {
      observationId: selected.observationId,
      sourceRunId: selected.sourceRunId,
      stance: selected.stance,
      layer: selected.layer,
      weight: selected.weight,
      summary: copy.summary,
      citationUrl: selected.citationUrl,
      sortOrder,
    } satisfies ThesisDraftEvidenceRecord;
  });
  const calculation: ThesisDraftCalculation = {
    schemaVersion: THESIS_DRAFT_CALCULATION_SCHEMA,
    thesisId: seed.id,
    methodologyVersion: seed.methodologyVersion,
    regionDefinitionVersion: seed.regionDefinitionVersion,
    target: seed.target,
    marketScope: seed.marketScope,
    timeHorizon: seed.timeHorizon,
    cutoff: expectedSelection.cutoff,
    previousStage: candidate.previousStage,
    selection: {
      selectedEvidence,
      rejectedEvidence: expectedSelection.rejectedEvidence,
      coverageGapIds: expectedSelection.coverageGapIds,
    },
    stage: expectedStage,
    direction: expectedEvaluation.direction,
    confidence: expectedEvaluation.confidence,
  };
  const keyMaterial: ThesisDraftKeyMaterial = {
    thesisId: seed.id,
    direction: expectedEvaluation.direction.direction,
    stage: expectedStage.stage,
    confidence: expectedEvaluation.confidence.finalScore,
    summary: candidate.summary,
    invalidation: candidate.invalidation,
    changeReason: candidate.changeReason,
    calculation,
    evidence,
  };
  const draftKey = await computeThesisDraftKey(keyMaterial);
  return deepFreeze({
    thesisId: seed.id,
    status: "draft",
    direction: expectedEvaluation.direction.direction,
    stage: expectedStage.stage,
    confidence: expectedEvaluation.confidence.finalScore,
    summary: candidate.summary,
    invalidation: candidate.invalidation,
    calculation,
    basedOnCutoff: expectedSelection.cutoff,
    createdBy: candidate.createdBy,
    createdAt: candidate.createdAt,
    publishedBy: null,
    publishedAt: null,
    changeReason: candidate.changeReason,
    draftKey,
    evidence,
  });
}

export async function computeThesisDraftKey(material: ThesisDraftKeyMaterial): Promise<string> {
  const semanticIdentity = {
    keyVersion: THESIS_DRAFT_KEY_VERSION,
    thesisId: material.thesisId,
    methodologyVersion: material.calculation.methodologyVersion,
    basedOnCutoff: material.calculation.cutoff,
    direction: material.direction,
    stage: material.stage,
    confidence: material.confidence,
    summary: material.summary,
    invalidation: material.invalidation,
    changeReason: material.changeReason,
    calculation: material.calculation,
    evidence: material.evidence,
  };
  return `${THESIS_DRAFT_KEY_VERSION}:sha256:${await sha256Hex(canonicalJson(semanticIdentity))}`;
}

function assertCanonicalUtc(value: string, field: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw validationError(`${field} 必须是毫秒精度 UTC ISO-8601`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw validationError(`${field} 必须是有效 UTC 时间`);
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function validationError(message: string): ThesisDraftValidationError {
  return new ThesisDraftValidationError(message);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
