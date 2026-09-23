import type {
  AdminDraftPageModel,
  AdminDraftReviewVersionModel,
  AdminRunModel,
  AdminRunsPageModel,
} from "../../../domain/page-models";
import { THESIS_DIRECTIONS, THESIS_STAGES } from "../../../domain/contracts";
import { SOURCE_ERROR_CODES, type SourceErrorCode } from "../../../domain/ingestion";
import type { AdminRunsCursor, AdminReadModelRepository } from "../../modules/admin-read-models";

const ADMIN_RUNS_PAGE_SIZE = 25;

export const ADMIN_DRAFT_REVIEW_QUERY = `SELECT thesis.id AS thesis_id, thesis.title AS thesis_title,
                  publication.current_version_id AS current_published_version_id,
                  draft.id AS draft_id, draft.version AS draft_version, draft.direction AS draft_direction,
                  draft.stage AS draft_stage, draft.confidence AS draft_confidence,
                  draft.summary AS draft_summary, draft.invalidation AS draft_invalidation,
                  draft.based_on_cutoff AS draft_based_on_cutoff, draft.created_at AS draft_created_at,
                  draft.change_reason AS draft_change_reason,
                  published.id AS published_id, published.version AS published_version, published.direction AS published_direction,
                  published.stage AS published_stage, published.confidence AS published_confidence,
                  published.summary AS published_summary, published.invalidation AS published_invalidation,
                  published.based_on_cutoff AS published_based_on_cutoff,
                  published.created_at AS published_created_at, published.change_reason AS published_change_reason
             FROM theses thesis
             LEFT JOIN thesis_publications publication ON publication.thesis_id = thesis.id
             LEFT JOIN thesis_versions published
               ON published.id = publication.current_version_id
              AND published.thesis_id = thesis.id
              AND published.status = 'published'
             LEFT JOIN thesis_versions draft
               ON draft.thesis_id = thesis.id
              AND draft.status = 'draft'
              AND draft.version = (
                SELECT MAX(candidate.version)
                  FROM thesis_versions candidate
                 WHERE candidate.thesis_id = thesis.id AND candidate.status = 'draft'
              )
            WHERE thesis.id = ?
            LIMIT 1`;

export class AdminReadModelStorageError extends Error {
  constructor() {
    super("后台运行读取模型数据无效");
    this.name = "AdminReadModelStorageError";
  }
}

export class D1AdminReadModelRepository implements AdminReadModelRepository {
  constructor(private readonly database: D1Database) {}

  async runs(
    actor: AdminRunsPageModel["actor"],
    cursor: AdminRunsCursor | null,
  ): Promise<AdminRunsPageModel> {
    if (cursor !== null) assertCursor(cursor);
    try {
      const result = await adminRunsStatement(this.database, cursor).all<Record<string, unknown>>();
      const decoded = rows(result).map(decodeRun);
      if (decoded.length > ADMIN_RUNS_PAGE_SIZE + 1) throw new AdminReadModelStorageError();
      const page = decoded.slice(0, ADMIN_RUNS_PAGE_SIZE);
      return deepFreeze({
        actor: {
          email: nonEmptyString(actor.email),
          roles: actor.roles,
        },
        runs: page,
        nextCursor: decoded.length > ADMIN_RUNS_PAGE_SIZE ? encodeCursor(page.at(-1)!) : null,
      });
    } catch (error) {
      if (error instanceof AdminReadModelStorageError) throw error;
      throw new AdminReadModelStorageError();
    }
  }

  async draft(
    actor: AdminDraftPageModel["actor"],
    thesisId: string,
  ): Promise<AdminDraftPageModel | null> {
    try {
      const result = await this.database.prepare(ADMIN_DRAFT_REVIEW_QUERY).bind(thesisId).all<Record<string, unknown>>();
      const resultRows = rows(result);
      if (resultRows.length > 1) throw new AdminReadModelStorageError();
      if (resultRows.length === 0) return null;
      const review = decodeDraftReview(resultRows[0], actor);
      return deepFreeze(review);
    } catch (error) {
      if (error instanceof AdminReadModelStorageError) throw error;
      throw new AdminReadModelStorageError();
    }
  }
}

function adminRunsStatement(database: D1Database, cursor: AdminRunsCursor | null): D1PreparedStatement {
  const statement = database.prepare(adminRunsQuery(cursor));
  return cursor === null
    ? statement.bind(ADMIN_RUNS_PAGE_SIZE + 1)
    : statement.bind(cursor.scheduledAt, cursor.scheduledAt, cursor.id, ADMIN_RUNS_PAGE_SIZE + 1);
}

export function adminRunsQueryForPlan(): string {
  return adminRunsQuery(null).replace("LIMIT ?", "LIMIT 26");
}

export function adminDraftReviewQueryForPlan(): string {
  return ADMIN_DRAFT_REVIEW_QUERY.replace("?", "'RUBBER-TH-01'");
}

function adminRunsQuery(cursor: AdminRunsCursor | null): string {
  const cursorClause = cursor === null
    ? ""
    : "WHERE (run.scheduled_at < ? OR (run.scheduled_at = ? AND run.id < ?))";
  return `SELECT run.id, run.source_id, source.name AS source_name, run.scheduled_at,
                 run.finished_at, run.status, run.observations_inserted,
                 run.observations_revised, run.error_code
            FROM source_runs run
            JOIN sources source ON source.id = run.source_id
            ${cursorClause}
           ORDER BY run.scheduled_at DESC, run.id DESC
           LIMIT ?`;
}

function decodeRun(row: Record<string, unknown>): AdminRunModel {
  const item = exactRecord(row, [
    "id", "source_id", "source_name", "scheduled_at", "finished_at", "status",
    "observations_inserted", "observations_revised", "error_code",
  ]);
  return {
    id: nonEmptyString(item.id),
    sourceId: nonEmptyString(item.source_id),
    sourceName: nonEmptyString(item.source_name),
    scheduledAt: canonicalUtc(item.scheduled_at),
    finishedAt: nullableCanonicalUtc(item.finished_at),
    status: enumValue(item.status, ["success", "unchanged", "partial", "failed"]),
    observationsInserted: nonNegativeInteger(item.observations_inserted),
    observationsRevised: nonNegativeInteger(item.observations_revised),
    safeErrorCode: nullableSourceErrorCode(item.error_code),
  };
}

function decodeDraftReview(
  row: Record<string, unknown>,
  actor: AdminDraftPageModel["actor"],
): AdminDraftPageModel {
  const item = exactRecord(row, [
    "thesis_id", "thesis_title", "current_published_version_id",
    "draft_id", "draft_version", "draft_direction", "draft_stage", "draft_confidence", "draft_summary",
    "draft_invalidation", "draft_based_on_cutoff", "draft_created_at", "draft_change_reason",
    "published_id", "published_version", "published_direction", "published_stage", "published_confidence", "published_summary",
    "published_invalidation", "published_based_on_cutoff", "published_created_at", "published_change_reason",
  ]);
  const published = nullableReviewVersion(item, "published");
  const currentPublishedVersionId = nullableString(item.current_published_version_id);
  if ((currentPublishedVersionId === null) !== (published === null)) throw new AdminReadModelStorageError();
  return {
    actor: { email: nonEmptyString(actor.email), roles: actor.roles },
    thesis: {
      id: nonEmptyString(item.thesis_id),
      title: nonEmptyString(item.thesis_title),
      currentPublishedVersion: published?.version ?? null,
    },
    draft: nullableReviewVersion(item, "draft"),
    published,
  };
}

function nullableReviewVersion(
  item: Record<string, unknown>,
  prefix: "draft" | "published",
): AdminDraftReviewVersionModel | null {
  const values = [
    item[`${prefix}_id`], item[`${prefix}_version`], item[`${prefix}_direction`], item[`${prefix}_stage`],
    item[`${prefix}_confidence`], item[`${prefix}_summary`], item[`${prefix}_invalidation`],
    item[`${prefix}_based_on_cutoff`], item[`${prefix}_created_at`], item[`${prefix}_change_reason`],
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null) && item[`${prefix}_change_reason`] !== null) {
    throw new AdminReadModelStorageError();
  }
  if (values.slice(0, -1).some((value) => value === null)) throw new AdminReadModelStorageError();
  return {
    id: boundedString(item[`${prefix}_id`], 128),
    version: positiveInteger(item[`${prefix}_version`]),
    direction: enumValue(item[`${prefix}_direction`], THESIS_DIRECTIONS),
    stage: enumValue(item[`${prefix}_stage`], THESIS_STAGES),
    confidence: confidence(item[`${prefix}_confidence`]),
    summary: boundedString(item[`${prefix}_summary`], 500),
    invalidation: nonEmptyString(item[`${prefix}_invalidation`]),
    basedOnCutoff: canonicalUtc(item[`${prefix}_based_on_cutoff`]),
    createdAt: canonicalUtc(item[`${prefix}_created_at`]),
    changeReason: nullableBoundedString(item[`${prefix}_change_reason`], 500),
  };
}

function rows(result: D1Result<Record<string, unknown>>): readonly Record<string, unknown>[] {
  if (result.success !== true || !Array.isArray(result.results)) throw new AdminReadModelStorageError();
  return result.results;
}

function exactRecord(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new AdminReadModelStorageError();
  }
  return value;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new AdminReadModelStorageError();
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value);
}

function boundedString(value: unknown, maximum: number): string {
  const result = nonEmptyString(value);
  if (result.length > maximum) throw new AdminReadModelStorageError();
  return result;
}

function nullableBoundedString(value: unknown, maximum: number): string | null {
  return value === null ? null : boundedString(value, maximum);
}

function canonicalUtc(value: unknown): string {
  const utc = nonEmptyString(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(utc) || new Date(utc).toISOString() !== utc) {
    throw new AdminReadModelStorageError();
  }
  return utc;
}

function nullableCanonicalUtc(value: unknown): string | null {
  return value === null ? null : canonicalUtc(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new AdminReadModelStorageError();
  return value;
}

function positiveInteger(value: unknown): number {
  const result = nonNegativeInteger(value);
  if (result === 0) throw new AdminReadModelStorageError();
  return result;
}

function confidence(value: unknown): number {
  const result = nonNegativeInteger(value);
  if (result > 100) throw new AdminReadModelStorageError();
  return result;
}

function enumValue<T extends string>(value: unknown, candidates: readonly T[]): T {
  if (typeof value !== "string" || !candidates.includes(value as T)) throw new AdminReadModelStorageError();
  return value as T;
}

function nullableSourceErrorCode(value: unknown): SourceErrorCode | null {
  if (value === null) return null;
  return enumValue(value, SOURCE_ERROR_CODES);
}

function assertCursor(cursor: AdminRunsCursor): void {
  canonicalUtc(cursor.scheduledAt);
  if (cursor.id.trim().length === 0 || cursor.id.length > 256) throw new AdminReadModelStorageError();
}

function encodeCursor(run: AdminRunModel): string {
  return JSON.stringify({ scheduledAt: run.scheduledAt, id: run.id });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
