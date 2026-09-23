import type { ObservationQuality, SourceHealthStatus } from "./ingestion";
import type { ThesisDirection, ThesisStage } from "./contracts";

export const EVIDENCE_LAYERS = [
  "forecast",
  "weather",
  "physical",
  "balance",
  "market",
  "control",
] as const;

export const EVIDENCE_STANCES = ["supports", "refutes", "context"] as const;
export const SOURCE_TIERS = ["A", "B", "C"] as const;
export const EVIDENCE_FRESHNESS_STATES = ["fresh", "late", "stale", "unknown"] as const;

export type EvidenceLayer = (typeof EVIDENCE_LAYERS)[number];
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];
export type SourceTier = (typeof SOURCE_TIERS)[number];
export type EvidenceFreshnessState = (typeof EVIDENCE_FRESHNESS_STATES)[number];

export interface EvaluationSourceState {
  readonly sourceId: string;
  readonly tier: SourceTier;
  readonly health: SourceHealthStatus;
  readonly lastSuccessAt: string | null;
}

export interface EvaluationEvidenceInput {
  readonly evidenceId: string;
  readonly observationId: string | null;
  readonly sourceRunId: string | null;
  readonly revision: number;
  readonly supersedesId: string | null;
  readonly indicatorId: string;
  readonly sourceId: string;
  readonly layer: EvidenceLayer;
  readonly stance: EvidenceStance;
  readonly weight: number;
  readonly observedAt: string;
  readonly publishedAt: string | null;
  readonly fetchedAt: string;
  readonly value: number | string;
  readonly unit: string;
  readonly quality: ObservationQuality;
  readonly citationUrl: string;
  readonly sourceTier: SourceTier;
  readonly sourceHealth: SourceHealthStatus;
  readonly freshness: EvidenceFreshnessState;
}

export interface SelectedEvidence extends EvaluationEvidenceInput {
  readonly selectorId: string;
  readonly selectionReason: string;
}

export type EvidenceRejectionCode =
  | "AFTER_CUTOFF"
  | "INVALID_TIMESTAMP"
  | "INVALID_REVISION"
  | "INVALID_QUALITY"
  | "AMBIGUOUS_REVISION"
  | "SUPERSEDED_REVISION"
  | "STALE_FOR_RULE"
  | "SELECTOR_MISMATCH"
  | "PENDING_SELECTOR"
  | "MISSING_EVIDENCE"
  | "MISSING_CITATION";

export interface RejectedEvidence {
  readonly evidenceId: string | null;
  readonly selectorId: string | null;
  readonly indicatorId: string;
  readonly code: EvidenceRejectionCode;
  readonly reason: string;
}

export interface EvidenceSelectionResult {
  readonly thesisId: string;
  readonly cutoff: string;
  readonly inputs: readonly EvaluationEvidenceInput[];
  readonly selectedEvidence: readonly SelectedEvidence[];
  readonly rejectedEvidence: readonly RejectedEvidence[];
  readonly coverageGapIds: readonly string[];
}

export const STAGE_GATE_REASON_CODES = [
  "PENDING_GATE",
  "PENDING_RULE",
  "MISSING_REQUIRED_LAYER",
  "STALE_REQUIRED_LAYER",
  "COVERAGE_GAP",
  "RULE_NOT_MATCHED",
  "PREREQUISITE_STAGE_BLOCKED",
  "FORECAST_ONLY",
  "PRICE_ONLY",
  "RELIEF_BASIS_REQUIRED",
  "EASING_REQUIRES_PRIOR_IMPACT",
  "FORWARD_SKIP_REQUIRES_CONFIRMATION",
  "MANUAL_FORWARD_SKIP_CONFIRMED",
  "DOWNGRADE",
  "THESIS_MISMATCH",
  "INVALID_SELECTION",
] as const;

export type StageGateReasonCode = (typeof STAGE_GATE_REASON_CODES)[number];

export interface StageGateReason {
  readonly code: StageGateReasonCode;
  readonly targetStage: ThesisStage | null;
  readonly layer: EvidenceLayer | null;
  readonly ruleId: string | null;
  readonly coverageGapId: string | null;
  readonly reason: string;
}

export interface StageGateCheck {
  readonly targetStage: Exclude<ThesisStage, "watch">;
  readonly status: "passed" | "blocked" | "pending";
  readonly requiredLayers: readonly EvidenceLayer[];
  readonly presentLayers: readonly EvidenceLayer[];
  readonly missingLayers: readonly EvidenceLayer[];
  readonly staleLayers: readonly EvidenceLayer[];
  readonly blockingCoverageGapIds: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly matchedEvidenceIds: readonly string[];
  readonly rejectedRuleIds: readonly string[];
  readonly reasons: readonly StageGateReason[];
}

export interface StageGateManualConfirmation {
  readonly confirmedBy: string;
  readonly reason: string;
}

export interface StageGateResult {
  readonly thesisId: string;
  readonly cutoff: string;
  readonly previousStage: ThesisStage;
  readonly highestEligibleStage: ThesisStage;
  readonly stage: ThesisStage;
  readonly transition:
    | "unchanged"
    | "promoted"
    | "manual_forward_skip"
    | "downgraded"
    | "blocked"
    | "invalid";
  readonly manualConfirmationApplied: boolean;
  readonly checks: readonly StageGateCheck[];
  readonly reasons: readonly StageGateReason[];
}

export interface RuleHit {
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export interface RuleRejection {
  readonly ruleId: string;
  readonly code:
    | "INACTIVE"
    | "NOT_MATCHED"
    | "MISSING_EVIDENCE"
    | "PENDING_REVIEW"
    | "UNRESOLVED_DIRECTION"
    | "CONTEXT_ONLY";
  readonly reason: string;
}

export interface ScopedDirectionEvaluation {
  readonly status: "available" | "unavailable";
  readonly policyVersion: string;
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly direction: ThesisDirection;
  readonly matchedDirections: readonly ThesisDirection[];
  readonly ruleHits: readonly RuleHit[];
  readonly ruleRejections: readonly RuleRejection[];
  readonly reasons: readonly string[];
}

export interface ConfidenceComponents {
  readonly coverage: number;
  readonly freshness: number;
  readonly sourceQuality: number;
  readonly agreement: number;
}

export interface ConfidenceCap {
  readonly code:
    | "MISSING_REQUIRED_LAYER"
    | "REQUIRED_LAYER_STALE"
    | "FORECAST_ONLY"
    | "PRICE_ONLY"
    | "UNEXPLAINED_CONFLICT"
    | "COVERAGE_GAP";
  readonly maximum: number;
  readonly reason: string;
}

export interface ConfidenceComponentExplanations {
  readonly coverage: {
    readonly requiredLayers: readonly EvidenceLayer[];
    readonly presentLayers: readonly EvidenceLayer[];
    readonly missingLayers: readonly EvidenceLayer[];
    readonly staleLayers: readonly EvidenceLayer[];
  };
  readonly freshness: {
    readonly currentEvidenceIds: readonly string[];
    readonly freshSelectorIds: readonly string[];
    readonly lateSelectorIds: readonly string[];
    readonly staleSelectorIds: readonly string[];
    readonly missingSelectorIds: readonly string[];
  };
  readonly sourceQuality: {
    readonly currentEvidenceIds: readonly string[];
    readonly tierScores: Readonly<Record<SourceTier, number | null>>;
  };
  readonly agreement: {
    readonly supportEvidenceIds: readonly string[];
    readonly refuteEvidenceIds: readonly string[];
    readonly ignoredContextEvidenceIds: readonly string[];
    readonly supportWeight: number;
    readonly refuteWeight: number;
  };
}

export interface EvaluationConfidence {
  readonly status: "available" | "unavailable";
  readonly policyVersion: string;
  readonly components: ConfidenceComponents;
  readonly weightedScore: number;
  readonly appliedCaps: readonly ConfidenceCap[];
  readonly finalScore: number;
  readonly roundingRule: "round_half_up_after_weighted_sum";
  readonly explanations: ConfidenceComponentExplanations;
  readonly reasons: readonly string[];
}

export interface DirectionConfidenceEvaluation {
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly cutoff: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly stage: ThesisStage;
  readonly direction: ScopedDirectionEvaluation;
  readonly confidence: EvaluationConfidence;
}

export interface EvaluationResult {
  readonly thesisId: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly cutoff: string;
  readonly target: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly stage: ThesisStage;
  readonly direction: ThesisDirection;
  readonly inputs: readonly EvaluationEvidenceInput[];
  readonly sourceStates: readonly EvaluationSourceState[];
  readonly selectedEvidence: readonly SelectedEvidence[];
  readonly rejectedEvidence: readonly RejectedEvidence[];
  readonly ruleHits: readonly RuleHit[];
  readonly ruleRejections: readonly RuleRejection[];
  readonly confidence: EvaluationConfidence;
  readonly coverageGapIds: readonly string[];
}

export function decodeConfidenceComponents(value: unknown): ConfidenceComponents {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("confidence components must be an object");
  }
  const record = value as Record<string, unknown>;
  const keys = ["coverage", "freshness", "sourceQuality", "agreement"] as const;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key as (typeof keys)[number])) {
      throw new TypeError(`confidence.${key}: unknown field`);
    }
  }
  const result = {} as Record<(typeof keys)[number], number>;
  for (const key of keys) {
    const score = record[key];
    if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 100) {
      throw new TypeError(`confidence.${key}: must be an integer from 0 to 100`);
    }
    result[key] = score as number;
  }
  return Object.freeze(result);
}
