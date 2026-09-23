import type { ThesisStage } from "../../domain/contracts";
import {
  REQUIRED_DAILY_THESIS_IDS,
  shanghaiBriefDate,
  type RequiredDailyThesisId,
} from "../../domain/daily-brief";
import { evaluateDirectionAndConfidence } from "../../domain/direction-confidence";
import type { EvaluationEvidenceInput } from "../../domain/evaluation";
import { selectEvidence } from "../../domain/evidence-selector";
import { INITIAL_THESIS_SEEDS } from "../../domain/initial-thesis-seeds";
import { evaluateStageGates } from "../../domain/stage-gate";
import type { PersistedThesisDraft } from "../../domain/thesis-draft";
import type { ThesisSeed } from "../../domain/thesis-seeds";
import type { ThesisDraftModule } from "./thesis-drafts";

export type DailyScheduleErrorCode = "VALIDATION" | "DATABASE";

export class DailyScheduleError extends Error {
  constructor(readonly code: DailyScheduleErrorCode, message: string) {
    super(message);
    this.name = "DailyScheduleError";
  }
}

export interface DailyEvaluationInput {
  readonly thesisId: string;
  readonly previousStage: ThesisStage;
  readonly hasPreviousVersion: boolean;
  readonly evidence: readonly EvaluationEvidenceInput[];
}

export interface DailyEvaluationRepository {
  loadEvaluationInputs(
    seeds: readonly ThesisSeed[],
    cutoff: string,
  ): Promise<readonly DailyEvaluationInput[]>;
}

export type DailyEvaluationBlockCode =
  | "PENDING_RESEARCH_APPROVAL"
  | "PRODUCTION_EVALUATION_DISABLED"
  | "MISSING_EVALUATION_INPUT"
  | "DIRECTION_UNAVAILABLE"
  | "CONFIDENCE_UNAVAILABLE"
  | "NO_SELECTED_EVIDENCE";

export type DailyEvaluationThesisResult =
  | {
      readonly thesisId: string;
      readonly status: "drafted";
      readonly versionId: string;
      readonly version: number;
    }
  | {
      readonly thesisId: string;
      readonly status: "blocked";
      readonly reasonCode: DailyEvaluationBlockCode;
    };

export interface DailyEvaluationRunResult {
  readonly briefDate: string;
  readonly cutoff: string;
  readonly outcome: "completed" | "partial" | "blocked";
  /** Number of idempotent draft results available after the run, including retry reuse. */
  readonly draftsReady: number;
  readonly blockedCount: number;
  readonly theses: readonly DailyEvaluationThesisResult[];
}

export interface DailyEvaluationRequest {
  readonly scheduledAt: string;
}

export class DailyEvaluationJob {
  constructor(
    private readonly repository: DailyEvaluationRepository,
    private readonly drafts: Pick<ThesisDraftModule, "create">,
    private readonly seeds: readonly ThesisSeed[] = INITIAL_THESIS_SEEDS,
  ) {}

  async run(request: DailyEvaluationRequest): Promise<DailyEvaluationRunResult> {
    const cutoff = canonicalUtc(request.scheduledAt, "scheduledAt");
    assertUtcClockTime(cutoff, 22, 30, "scheduledAt");
    const stableSeeds = [...this.seeds];
    assertUniqueSeeds(stableSeeds);
    const eligibleSeeds = stableSeeds.filter(isEvaluationEnabled);
    const loaded = eligibleSeeds.length === 0
      ? []
      : await this.repository.loadEvaluationInputs(eligibleSeeds, cutoff);
    const inputsByThesis = new Map(loaded.map((input) => [input.thesisId, input] as const));
    const eligibleIds = new Set(eligibleSeeds.map((seed) => seed.id));
    if (
      inputsByThesis.size !== loaded.length
      || loaded.some((input) => !eligibleIds.has(input.thesisId))
    ) {
      throw new DailyScheduleError("DATABASE", "日评估输入包含重复论点");
    }

    const theses: DailyEvaluationThesisResult[] = [];
    for (const seed of stableSeeds) {
      theses.push(await evaluateSeedAtCutoff(
        seed,
        cutoff,
        inputsByThesis.get(seed.id),
        this.drafts,
        { createdBy: "system:daily-evaluation", changeReason: "每日定时评估" },
      ));
    }

    const draftsReady = theses.filter((item) => item.status === "drafted").length;
    const blockedCount = theses.length - draftsReady;
    const outcome = draftsReady === 0
      ? "blocked"
      : blockedCount === 0
        ? "completed"
        : "partial";
    return deepFreeze({
      briefDate: shanghaiBriefDate(cutoff),
      cutoff,
      outcome,
      draftsReady,
      blockedCount,
      theses,
    });
  }
}

export interface DailyPublicationCandidate {
  readonly thesisId: RequiredDailyThesisId;
  readonly thesisVersionId: string;
  readonly status: "draft" | "published" | "withdrawn";
}

export interface DailyPublicationCandidateRepository {
  findEvaluationCandidates(
    evaluationCutoff: string,
  ): Promise<readonly DailyPublicationCandidate[]>;
}

export type DailyPublicationDelayCode =
  | "AUTOMATIC_PUBLICATION_DISABLED"
  | "AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE"
  | `EVALUATION_OUTPUT_MISSING:${RequiredDailyThesisId}`
  | `EVALUATION_OUTPUT_DUPLICATE:${RequiredDailyThesisId}`
  | `THESIS_VERSION_NOT_PUBLISHED:${RequiredDailyThesisId}`;

export interface DailyPublicationRunResult {
  readonly briefDate: string;
  readonly scheduledAt: string;
  readonly evaluationCutoff: string;
  readonly outcome: "delayed";
  /** Null means candidate storage was intentionally not consulted. */
  readonly candidateCount: number | null;
  readonly delayCodes: readonly DailyPublicationDelayCode[];
}

export interface DailyPublicationRequest {
  readonly scheduledAt: string;
}

export class DailyPublicationJob {
  constructor(private readonly repository: DailyPublicationCandidateRepository) {}

  async run(request: DailyPublicationRequest): Promise<DailyPublicationRunResult> {
    const schedule = publicationSchedule(request);
    const { scheduledAt, evaluationCutoff, briefDate } = schedule;
    const candidates = await this.repository.findEvaluationCandidates(evaluationCutoff);
    const candidatesByThesis = new Map<RequiredDailyThesisId, DailyPublicationCandidate[]>();
    for (const candidate of candidates) {
      const current = candidatesByThesis.get(candidate.thesisId) ?? [];
      current.push(candidate);
      candidatesByThesis.set(candidate.thesisId, current);
    }
    const delayCodes: DailyPublicationDelayCode[] = [];
    for (const thesisId of REQUIRED_DAILY_THESIS_IDS) {
      const matches = candidatesByThesis.get(thesisId) ?? [];
      if (matches.length === 0) {
        delayCodes.push(`EVALUATION_OUTPUT_MISSING:${thesisId}`);
      } else if (matches.length > 1) {
        delayCodes.push(`EVALUATION_OUTPUT_DUPLICATE:${thesisId}`);
      } else if (matches[0]!.status !== "published") {
        delayCodes.push(`THESIS_VERSION_NOT_PUBLISHED:${thesisId}`);
      }
    }
    // The scheduled seam cannot safely construct DailyBriefFreezeCommand copy, review or lifecycle
    // inputs yet. Publishing thesis drafts one by one here could expose a partial day, so a complete
    // candidate set still fails closed until that lifecycle is designed as one atomic command.
    if (delayCodes.length === 0) {
      delayCodes.push("AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE");
    }
    return deepFreeze({
      briefDate,
      scheduledAt,
      evaluationCutoff,
      outcome: "delayed",
      candidateCount: candidates.length,
      delayCodes,
    });
  }
}

export function automaticPublicationDisabledResult(
  request: DailyPublicationRequest,
): DailyPublicationRunResult {
  const { scheduledAt, evaluationCutoff, briefDate } = publicationSchedule(request);
  return deepFreeze({
    briefDate,
    scheduledAt,
    evaluationCutoff,
    outcome: "delayed",
    candidateCount: null,
    delayCodes: ["AUTOMATIC_PUBLICATION_DISABLED"],
  });
}

export function precedingEvaluationCutoff(publicationScheduledAt: string): string {
  const scheduledAt = canonicalUtc(publicationScheduledAt, "publicationScheduledAt");
  assertUtcClockTime(scheduledAt, 23, 0, "publicationScheduledAt");
  return new Date(Date.parse(scheduledAt) - 30 * 60 * 1_000).toISOString();
}

function publicationSchedule(request: DailyPublicationRequest): Readonly<{
  scheduledAt: string;
  evaluationCutoff: string;
  briefDate: string;
}> {
  const scheduledAt = canonicalUtc(request.scheduledAt, "scheduledAt");
  assertUtcClockTime(scheduledAt, 23, 0, "scheduledAt");
  const evaluationCutoff = precedingEvaluationCutoff(scheduledAt);
  return {
    scheduledAt,
    evaluationCutoff,
    briefDate: shanghaiBriefDate(evaluationCutoff),
  };
}

function isEvaluationEnabled(seed: ThesisSeed): boolean {
  return seed.readiness.reviewStatus === "approved" && seed.readiness.productionEvaluation;
}

/**
 * The single owner of per-thesis evaluation order: seed readiness, evidence selection, stage gates,
 * direction/confidence, then an idempotent draft. Both the scheduled day boundary and the manual
 * re-evaluation endpoint call this, so a manual run can never apply different rules.
 */
export async function evaluateSeedAtCutoff(
  seed: ThesisSeed,
  cutoff: string,
  input: DailyEvaluationInput | undefined,
  drafts: Pick<ThesisDraftModule, "create">,
  attribution: { readonly createdBy: string; readonly changeReason: string },
): Promise<DailyEvaluationThesisResult> {
  if (seed.readiness.reviewStatus !== "approved") {
    return blocked(seed.id, "PENDING_RESEARCH_APPROVAL");
  }
  if (!seed.readiness.productionEvaluation) {
    return blocked(seed.id, "PRODUCTION_EVALUATION_DISABLED");
  }
  if (input === undefined) {
    return blocked(seed.id, "MISSING_EVALUATION_INPUT");
  }
  const selection = selectEvidence(seed, cutoff, input.evidence);
  const stageResult = evaluateStageGates(seed, selection, { previousStage: input.previousStage });
  const evaluation = evaluateDirectionAndConfidence(seed, selection, stageResult);
  if (evaluation.direction.status !== "available") {
    return blocked(seed.id, "DIRECTION_UNAVAILABLE");
  }
  if (evaluation.confidence.status !== "available") {
    return blocked(seed.id, "CONFIDENCE_UNAVAILABLE");
  }
  if (selection.selectedEvidence.length === 0) {
    return blocked(seed.id, "NO_SELECTED_EVIDENCE");
  }
  const draft = await drafts.create({
    seed,
    previousStage: input.previousStage,
    selection,
    stageResult,
    evaluation,
    summary: seed.templateCopy.summary,
    invalidation: seed.templateCopy.invalidation,
    changeReason: input.hasPreviousVersion ? attribution.changeReason : null,
    createdBy: attribution.createdBy,
    createdAt: cutoff,
    evidence: selection.selectedEvidence.map((item) => ({
      evidenceId: item.evidenceId,
      summary: `${item.indicatorId} ${item.observedAt} revision ${item.revision}`,
    })),
  });
  return drafted(draft);
}

function blocked(thesisId: string, reasonCode: DailyEvaluationBlockCode): DailyEvaluationThesisResult {
  return { thesisId, status: "blocked", reasonCode };
}

function drafted(draft: PersistedThesisDraft): DailyEvaluationThesisResult {
  return {
    thesisId: draft.thesisId,
    status: "drafted",
    versionId: draft.id,
    version: draft.version,
  };
}

function assertUniqueSeeds(seeds: readonly ThesisSeed[]): void {
  const ids = new Set<string>();
  for (const seed of seeds) {
    if (ids.has(seed.id)) throw new DailyScheduleError("VALIDATION", "日评估论点 ID 重复");
    ids.add(seed.id);
  }
}

function canonicalUtc(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new DailyScheduleError("VALIDATION", `${field} 必须是规范 UTC 时间`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new DailyScheduleError("VALIDATION", `${field} 必须是规范 UTC 时间`);
  }
  return value;
}

function assertUtcClockTime(value: string, hour: number, minute: number, field: string): void {
  const instant = new Date(value);
  if (
    instant.getUTCHours() !== hour
    || instant.getUTCMinutes() !== minute
    || instant.getUTCSeconds() !== 0
    || instant.getUTCMilliseconds() !== 0
  ) {
    throw new DailyScheduleError(
      "VALIDATION",
      `${field} 必须对应 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
