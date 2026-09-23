/**
 * Records human decisions about high-risk thesis transitions.
 *
 * The daily-brief publication gate only clears a high-risk transition (direction change, a stage
 * jump of two or more, or an absolute confidence delta of 20 or more) when an approved review is
 * bound to the exact previous/target version identity it compares. This module owns that write
 * path: it resolves the "previous" version from the most recent published daily brief, refuses to
 * invent a comparison when no brief has ever been published, and is idempotent for an identical
 * retry.
 */
export const THESIS_CHANGE_REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type ThesisChangeReviewDecision = (typeof THESIS_CHANGE_REVIEW_DECISIONS)[number];

export const THESIS_CHANGE_REVIEW_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "NO_PREVIOUS_BRIEF",
  "VERSION_CONFLICT",
  "DATABASE",
] as const;
export type ThesisChangeReviewErrorCode = (typeof THESIS_CHANGE_REVIEW_ERROR_CODES)[number];

export class ThesisChangeReviewError extends Error {
  constructor(readonly code: ThesisChangeReviewErrorCode, message: string) {
    super(message);
    this.name = "ThesisChangeReviewError";
  }
}

export interface ThesisChangeReviewCommand {
  readonly thesisId: string;
  /** The version being reviewed. */
  readonly afterVersionId: string;
  /** Must equal the version frozen in the most recent published daily brief for this thesis. */
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface ThesisChangeReviewRecord {
  readonly thesisId: string;
  readonly afterVersionId: string;
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reason: string;
}

export interface ThesisChangeReviewRepository {
  /**
   * Version frozen for the thesis in the most recent published daily brief, or null when no daily
   * brief has ever been published. This is exactly the version the publication gate compares
   * against, because the gate resolves its "previous brief" the same way.
   */
  findPreviousFrozenVersion(thesisId: string): Promise<string | null>;
  /** Draft/published status of the version, or null when it does not belong to the thesis. */
  findReviewableVersionStatus(
    thesisId: string,
    versionId: string,
  ): Promise<"draft" | "published" | null>;
  find(afterVersionId: string): Promise<ThesisChangeReviewRecord | null>;
  /** Inserts the decision; a concurrent identical insert returns the stored row instead. */
  insert(record: ThesisChangeReviewRecord): Promise<ThesisChangeReviewRecord>;
}

export class ThesisChangeReviewModule {
  constructor(private readonly repository: ThesisChangeReviewRepository) {}

  async record(command: ThesisChangeReviewCommand): Promise<ThesisChangeReviewRecord> {
    const validated = validateCommand(command);
    const status = await this.repository.findReviewableVersionStatus(
      validated.thesisId,
      validated.afterVersionId,
    );
    if (status === null) {
      throw new ThesisChangeReviewError("NOT_FOUND", "未找到该论点下可审核的版本");
    }

    const previous = await this.repository.findPreviousFrozenVersion(validated.thesisId);
    if (previous === null) {
      throw new ThesisChangeReviewError(
        "NO_PREVIOUS_BRIEF",
        "尚无可比较的上一期已发布日报，首次发布无需转场审核",
      );
    }
    if (previous !== validated.beforeVersionId) {
      throw new ThesisChangeReviewError(
        "VERSION_CONFLICT",
        "审核必须精确绑定上一期已发布日报冻结的版本，请刷新后重试",
      );
    }

    const existing = await this.repository.find(validated.afterVersionId);
    if (existing !== null) return identicalOrConflict(existing, validated);

    const inserted = await this.repository.insert({
      thesisId: validated.thesisId,
      afterVersionId: validated.afterVersionId,
      beforeVersionId: validated.beforeVersionId,
      decision: validated.decision,
      reviewedBy: validated.actor,
      reviewedAt: validated.occurredAt,
      reason: validated.reason,
    });
    return identicalOrConflict(inserted, validated);
  }
}

function identicalOrConflict(
  stored: ThesisChangeReviewRecord,
  command: ThesisChangeReviewCommand,
): ThesisChangeReviewRecord {
  const identical = stored.thesisId === command.thesisId
    && stored.afterVersionId === command.afterVersionId
    && stored.beforeVersionId === command.beforeVersionId
    && stored.decision === command.decision
    && stored.reviewedBy === command.actor
    && stored.reason === command.reason;
  if (!identical) {
    throw new ThesisChangeReviewError(
      "VERSION_CONFLICT",
      "该版本已有不同的审核决定，请先核对现有记录",
    );
  }
  return deepFreeze({
    thesisId: stored.thesisId,
    afterVersionId: stored.afterVersionId,
    beforeVersionId: stored.beforeVersionId,
    decision: stored.decision,
    reviewedBy: stored.reviewedBy,
    reviewedAt: stored.reviewedAt,
    reason: stored.reason,
  });
}

function validateCommand(command: ThesisChangeReviewCommand): ThesisChangeReviewCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new ThesisChangeReviewError("VALIDATION", "审核命令必须是对象");
  }
  const thesisId = boundedText(command.thesisId, 128);
  const afterVersionId = boundedText(command.afterVersionId, 128);
  const beforeVersionId = boundedText(command.beforeVersionId, 128);
  const actor = boundedText(command.actor, 320);
  const reason = boundedText(command.reason, 500);
  if (thesisId === null || afterVersionId === null || beforeVersionId === null) {
    throw new ThesisChangeReviewError("VALIDATION", "论点或版本身份无效");
  }
  if (afterVersionId === beforeVersionId) {
    throw new ThesisChangeReviewError("VALIDATION", "上一版与待审核版本不能相同");
  }
  if (actor === null || reason === null) {
    throw new ThesisChangeReviewError("VALIDATION", "审核人和审核理由不能为空");
  }
  if (!THESIS_CHANGE_REVIEW_DECISIONS.includes(command.decision)) {
    throw new ThesisChangeReviewError("VALIDATION", "审核决定必须是 approved 或 rejected");
  }
  const occurredAt = canonicalUtc(command.occurredAt);
  if (occurredAt === null) {
    throw new ThesisChangeReviewError("VALIDATION", "审核时间必须是规范 UTC 时间");
  }
  return {
    thesisId,
    afterVersionId,
    beforeVersionId,
    decision: command.decision,
    reason,
    actor,
    occurredAt,
  };
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

function deepFreeze<T>(value: T): T {
  return Object.freeze(value);
}
