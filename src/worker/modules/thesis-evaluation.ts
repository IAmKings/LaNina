import type { ThesisSeed } from "../../domain/thesis-seeds";
import { INITIAL_THESIS_SEEDS } from "../../domain/initial-thesis-seeds";
import type { ThesisDraftModule } from "./thesis-drafts";
import {
  evaluateSeedAtCutoff,
  type DailyEvaluationBlockCode,
  type DailyEvaluationInput,
  type DailyEvaluationRepository,
} from "./daily-schedule";

export const THESIS_EVALUATION_ERROR_CODES = ["VALIDATION", "NOT_FOUND", "DATABASE"] as const;
export type ThesisEvaluationErrorCode = (typeof THESIS_EVALUATION_ERROR_CODES)[number];

export class ThesisEvaluationError extends Error {
  constructor(readonly code: ThesisEvaluationErrorCode, message: string) {
    super(message);
    this.name = "ThesisEvaluationError";
  }
}

export interface ThesisEvaluationCommand {
  readonly thesisId: string;
  readonly cutoff: string;
  readonly actor: string;
  readonly reason: string;
}

export type ThesisEvaluationResult =
  | {
      readonly thesisId: string;
      readonly cutoff: string;
      readonly status: "drafted";
      readonly versionId: string;
      readonly version: number;
    }
  | {
      readonly thesisId: string;
      readonly cutoff: string;
      readonly status: "blocked";
      readonly reasonCode: DailyEvaluationBlockCode;
    };

/**
 * Manual re-evaluation of one thesis at an explicit cutoff.
 *
 * It reuses `evaluateSeedAtCutoff`, which is also the scheduled path's only evaluation order, so a
 * manual run cannot apply different gates or confidence caps. A pending or evaluation-disabled seed
 * is reported as blocked without touching D1, and an unchanged rerun returns the stored draft
 * because the draft key covers the calculation and evidence but not the trigger.
 */
export class ThesisEvaluationModule {
  constructor(
    private readonly repository: DailyEvaluationRepository,
    private readonly drafts: Pick<ThesisDraftModule, "create">,
    private readonly seeds: readonly ThesisSeed[] = INITIAL_THESIS_SEEDS,
  ) {}

  async evaluate(command: ThesisEvaluationCommand): Promise<ThesisEvaluationResult> {
    const validated = validateCommand(command);
    const seed = this.seeds.find((candidate) => candidate.id === validated.thesisId);
    if (seed === undefined) {
      throw new ThesisEvaluationError("NOT_FOUND", "未找到该影响论点");
    }

    if (seed.readiness.reviewStatus !== "approved" || !seed.readiness.productionEvaluation) {
      const outcome = await evaluateSeedAtCutoff(seed, validated.cutoff, undefined, this.drafts, {
        createdBy: validated.actor,
        changeReason: MANUAL_CHANGE_REASON,
      });
      if (outcome.status !== "blocked") throw new ThesisEvaluationError("DATABASE", "论点就绪状态判定异常");
      return Object.freeze({
        thesisId: seed.id,
        cutoff: validated.cutoff,
        status: "blocked" as const,
        reasonCode: outcome.reasonCode,
      });
    }

    const loaded = await this.repository.loadEvaluationInputs([seed], validated.cutoff);
    if (loaded.length > 1 || loaded.some((input) => input.thesisId !== seed.id)) {
      throw new ThesisEvaluationError("DATABASE", "论点评估输入包含重复论点");
    }
    const outcome = await evaluateSeedAtCutoff(
      seed,
      validated.cutoff,
      loaded[0] as DailyEvaluationInput | undefined,
      this.drafts,
      { createdBy: validated.actor, changeReason: MANUAL_CHANGE_REASON },
    );
    if (outcome.status === "blocked") {
      return Object.freeze({
        thesisId: seed.id,
        cutoff: validated.cutoff,
        status: "blocked" as const,
        reasonCode: outcome.reasonCode,
      });
    }
    return Object.freeze({
      thesisId: seed.id,
      cutoff: validated.cutoff,
      status: "drafted" as const,
      versionId: outcome.versionId,
      version: outcome.version,
    });
  }
}

/** Recorded on every manual draft so an operator-triggered version stays distinguishable. */
export const MANUAL_CHANGE_REASON = "人工重新评估";

function validateCommand(command: ThesisEvaluationCommand): ThesisEvaluationCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new ThesisEvaluationError("VALIDATION", "评估命令必须是对象");
  }
  const thesisId = boundedText(command.thesisId, 128);
  const actor = boundedText(command.actor, 320);
  const reason = boundedText(command.reason, 500);
  if (thesisId === null) throw new ThesisEvaluationError("VALIDATION", "论点标识无效");
  if (actor === null || reason === null) {
    throw new ThesisEvaluationError("VALIDATION", "操作者与变更原因不能为空");
  }
  const cutoff = canonicalUtc(command.cutoff);
  if (cutoff === null) throw new ThesisEvaluationError("VALIDATION", "cutoff 必须是规范 UTC 时间");
  return { thesisId, cutoff, actor, reason };
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && [...normalized].length <= maximumLength ? normalized : null;
}

function canonicalUtc(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value;
}
