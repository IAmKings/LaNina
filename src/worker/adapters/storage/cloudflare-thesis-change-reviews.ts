import {
  ThesisChangeReviewError,
  type ThesisChangeReviewRecord,
  type ThesisChangeReviewRepository,
} from "../../modules/thesis-change-reviews";

interface VersionRow {
  status: "draft" | "published" | "withdrawn";
}

interface PreviousVersionRow {
  version_id: string;
}

interface ReviewRow {
  thesis_id: string;
  after_version_id: string;
  before_version_id: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  reason: string | null;
}

/**
 * D1 persistence for high-risk transition reviews.
 *
 * Reads mirror the publication gate exactly: the "previous" version is the one frozen in the most
 * recent published daily brief, so a stored approval can actually clear `HIGH_RISK_REVIEW`. Writes
 * are insert-only; the primary key on `after_version_id` makes a concurrent duplicate fail, which is
 * resolved by re-reading the stored decision instead of overwriting it.
 */
export class D1ThesisChangeReviewRepository implements ThesisChangeReviewRepository {
  constructor(private readonly database: D1Database) {}

  async findPreviousFrozenVersion(thesisId: string): Promise<string | null> {
    try {
      const row = await this.database.prepare(
        `WITH previous_brief AS (
           SELECT MAX(brief_date) AS brief_date
             FROM daily_briefs
            WHERE status = 'published'
         )
         SELECT links.thesis_version_id AS version_id
           FROM daily_brief_theses links
           JOIN previous_brief ON previous_brief.brief_date = links.brief_date
          WHERE links.thesis_id = ?
          LIMIT 1`,
      ).bind(thesisId).first<PreviousVersionRow>();
      if (row === null) return null;
      if (typeof row.version_id !== "string" || row.version_id.length === 0) throw databaseError();
      return row.version_id;
    } catch (error) {
      throw storageError(error);
    }
  }

  async findReviewableVersionStatus(
    thesisId: string,
    versionId: string,
  ): Promise<"draft" | "published" | null> {
    try {
      const row = await this.database.prepare(
        "SELECT status FROM thesis_versions WHERE id = ? AND thesis_id = ? LIMIT 1",
      ).bind(versionId, thesisId).first<VersionRow>();
      if (row === null) return null;
      const status = row.status;
      if (status !== "draft" && status !== "published" && status !== "withdrawn") {
        throw databaseError();
      }
      return status === "withdrawn" ? null : status;
    } catch (error) {
      throw storageError(error);
    }
  }

  async find(afterVersionId: string): Promise<ThesisChangeReviewRecord | null> {
    try {
      const row = await this.database.prepare(
        `SELECT thesis_id, after_version_id, before_version_id, status, reviewed_by, reviewed_at, reason
           FROM thesis_change_reviews
          WHERE after_version_id = ?
          LIMIT 1`,
      ).bind(afterVersionId).first<ReviewRow>();
      return row === null ? null : decodeReview(row);
    } catch (error) {
      throw storageError(error);
    }
  }

  async insert(record: ThesisChangeReviewRecord): Promise<ThesisChangeReviewRecord> {
    try {
      await this.database.prepare(
        `INSERT INTO thesis_change_reviews (
           after_version_id, thesis_id, before_version_id, status, reviewed_by, reviewed_at, reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        record.afterVersionId,
        record.thesisId,
        record.beforeVersionId,
        record.decision,
        record.reviewedBy,
        record.reviewedAt,
        record.reason,
      ).run();
      return record;
    } catch (error) {
      // The primary key on `after_version_id` turns a concurrent duplicate into a storage error.
      // Re-reading lets the module decide between an identical retry and a real conflict, and never
      // overwrites the stored decision.
      if (error instanceof ThesisChangeReviewError) throw error;
      const existing = await this.findAfterWriteFailure(record.afterVersionId);
      if (existing !== null) return existing;
      throw databaseError();
    }
  }

  private async findAfterWriteFailure(afterVersionId: string): Promise<ThesisChangeReviewRecord | null> {
    try {
      return await this.find(afterVersionId);
    } catch {
      return null;
    }
  }
}

function decodeReview(row: ReviewRow): ThesisChangeReviewRecord {
  const decision = row.status === "pending" ? null : row.status;
  if (
    decision === null
    || typeof row.thesis_id !== "string"
    || typeof row.after_version_id !== "string"
    || typeof row.before_version_id !== "string"
    || typeof row.reviewed_by !== "string"
    || typeof row.reviewed_at !== "string"
    || typeof row.reason !== "string"
  ) {
    throw databaseError();
  }
  return Object.freeze({
    thesisId: row.thesis_id,
    afterVersionId: row.after_version_id,
    beforeVersionId: row.before_version_id,
    decision,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reason: row.reason,
  });
}

function storageError(error: unknown): ThesisChangeReviewError {
  return error instanceof ThesisChangeReviewError
    ? error
    : new ThesisChangeReviewError("DATABASE", "审核记录暂不可用，请稍后重试");
}

function databaseError(): ThesisChangeReviewError {
  return new ThesisChangeReviewError("DATABASE", "审核记录格式无效");
}
