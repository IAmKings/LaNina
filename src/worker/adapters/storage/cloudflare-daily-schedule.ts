import { reportStorageFailure } from "./storage-logging";
import { THESIS_STAGES, type ThesisStage } from "../../../domain/contracts";
import {
  REQUIRED_DAILY_THESIS_IDS,
  type RequiredDailyThesisId,
} from "../../../domain/daily-brief";
import type { EvaluationEvidenceInput, SourceTier } from "../../../domain/evaluation";
import { SOURCE_ERROR_CODES, type ObservationQuality, type SourceErrorCode } from "../../../domain/ingestion";
import type { ThesisSeed } from "../../../domain/thesis-seeds";
import { calculateSourceHealth, lastRunIsPartialExpression } from "../../ingestion/source-health";
import {
  DailyScheduleError,
  type DailyEvaluationInput,
  type DailyEvaluationRepository,
  type DailyPublicationCandidate,
  type DailyPublicationCandidateRepository,
} from "../../modules/daily-schedule";

interface ObservationRow {
  readonly id: string;
  readonly indicator_id: string;
  readonly observed_at: string;
  readonly value_num: number | null;
  readonly value_text: string | null;
  readonly unit: string;
  readonly published_at: string | null;
  readonly fetched_at: string;
  readonly revision: number;
  readonly supersedes_id: string | null;
  readonly quality: string;
  readonly source_run_id: string;
  readonly citation_url: string;
  readonly source_id: string;
}

interface SourceStateRow {
  readonly source_id: string;
  readonly source_tier: string;
  readonly last_success_at: string | null;
  readonly late_after_minutes: number;
  readonly stale_after_minutes: number;
  readonly consecutive_failures: number;
  readonly last_error_code: string | null;
  readonly last_run_is_partial: number;
  readonly ambiguous_retry_rewrites: number;
}

interface PreviousVersionRow {
  readonly thesis_id: string;
  readonly stage: string;
  readonly based_on_cutoff: string;
  readonly created_at: string;
}

/**
 * 评估输入的行数结构护栏。远超当前规模；命中说明 selector 集合或观测历史膨胀，
 * 宁可让当日判定失败也不拖垮 cron（fail-closed，见 evaluationInputsQuery 注释）。
 */
const MAX_EVALUATION_INPUT_ROWS = 50000;

export class D1DailyScheduleRepository
  implements DailyEvaluationRepository, DailyPublicationCandidateRepository
{
  constructor(private readonly database: D1Database) {}

  async loadEvaluationInputs(
    seeds: readonly ThesisSeed[],
    cutoff: string,
  ): Promise<readonly DailyEvaluationInput[]> {
    if (seeds.length === 0) return [];
    const indicatorIds = [...new Set(seeds.flatMap((seed) =>
      seed.indicatorSelectors.map((selector) => selector.indicatorId)
    ))].sort();
    const thesisIds = seeds.map((seed) => seed.id);
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(evaluationInputsQuery(indicatorIds.length))
          .bind(...indicatorIds, cutoff),
        this.database.prepare(
          `SELECT version.thesis_id, version.stage, version.based_on_cutoff, version.created_at
             FROM thesis_versions version
            WHERE version.thesis_id IN (${placeholders(thesisIds)})
              AND version.version = (
                SELECT MAX(latest.version)
                  FROM thesis_versions latest
                 WHERE latest.thesis_id = version.thesis_id
                   AND latest.based_on_cutoff < ?
                   AND latest.created_at < ?
              )
            ORDER BY version.thesis_id`,
        ).bind(...thesisIds, cutoff, cutoff),
        this.database.prepare(
          `SELECT source.id AS source_id, source.tier AS source_tier,
                  source.late_after_minutes, source.stale_after_minutes,
                  (
                    SELECT successful.finished_at
                      FROM source_runs successful
                     WHERE successful.source_id = source.id
                       AND successful.finished_at IS NOT NULL
                       AND successful.finished_at <= ?
                       AND successful.status IN ('success', 'unchanged', 'partial')
                     ORDER BY successful.finished_at DESC, successful.started_at DESC,
                              successful.id DESC
                     LIMIT 1
                  ) AS last_success_at,
                  (
                    SELECT COALESCE(SUM(failed.retry_count + 1), 0)
                      FROM source_runs failed
                     WHERE failed.source_id = source.id
                       AND failed.finished_at IS NOT NULL
                       AND failed.finished_at <= ?
                       AND failed.status = 'failed'
                       AND failed.finished_at > COALESCE((
                         SELECT successful.finished_at
                           FROM source_runs successful
                          WHERE successful.source_id = source.id
                            AND successful.finished_at IS NOT NULL
                            AND successful.finished_at <= ?
                            AND successful.status IN ('success', 'unchanged')
                          ORDER BY successful.finished_at DESC, successful.started_at DESC,
                                   successful.id DESC
                          LIMIT 1
                       ), '')
                  ) AS consecutive_failures,
                  (
                    SELECT CASE WHEN latest.status = 'failed' THEN latest.error_code ELSE NULL END
                      FROM source_runs latest
                     WHERE latest.source_id = source.id
                       AND latest.finished_at IS NOT NULL
                       AND latest.finished_at <= ?
                       AND latest.status <> 'partial'
                     ORDER BY latest.finished_at DESC, latest.started_at DESC, latest.id DESC
                     LIMIT 1
                  ) AS last_error_code,
                  ${lastRunIsPartialExpression("source", true)} AS last_run_is_partial,
                  (
                    SELECT COUNT(*)
                      FROM source_runs rewritten
                     WHERE rewritten.source_id = source.id
                       AND rewritten.retry_count > 0
                       AND rewritten.scheduled_at <= ?
                       AND rewritten.finished_at > ?
                  ) AS ambiguous_retry_rewrites
             FROM sources source
            WHERE source.id IN (
              SELECT DISTINCT indicator.source_id
                FROM indicators indicator
               WHERE indicator.id IN (${placeholders(indicatorIds)})
            )
            ORDER BY source.id`,
        ).bind(cutoff, cutoff, cutoff, cutoff, cutoff, cutoff, cutoff, cutoff, ...indicatorIds),
      ]);
      if (!Array.isArray(results) || results.length !== 3) throw databaseError();
      const rawObservationRows = queryRows(results[0]);
      // LIMIT 恰好返回上限行数时无法区分「恰好 50000」与「已被截断」，按 fail-closed 处理。
      if (rawObservationRows.length >= MAX_EVALUATION_INPUT_ROWS) throw databaseError();
      const observationRows = rawObservationRows.map(decodeObservationRow);
      const previousRows = queryRows(results[1]).map(decodePreviousVersionRow);
      const sourceRows = queryRows(results[2]).map(decodeSourceStateRow);
      const previousByThesis = new Map(previousRows.map((row) => [row.thesis_id, row] as const));
      const sourceById = new Map(sourceRows.map((row) => [row.source_id, row] as const));
      if (
        sourceById.size !== sourceRows.length
        || sourceRows.some((row) => row.ambiguous_retry_rewrites > 0)
      ) throw databaseError();
      return seeds.map((seed) => {
        const selectors = new Map<string, ThesisSeed["indicatorSelectors"][number]>(
          seed.indicatorSelectors.map((selector) => [selector.indicatorId, selector]),
        );
        const evidence = observationRows.flatMap((row): EvaluationEvidenceInput[] => {
          const selector = selectors.get(row.indicator_id);
          if (selector === undefined) return [];
          const source = sourceById.get(row.source_id);
          if (source === undefined) throw databaseError();
          const health = calculateSourceHealth({
            sourceId: row.source_id,
            checkedAt: cutoff,
            lastSuccessAt: source.last_success_at,
            lateAfterMinutes: source.late_after_minutes,
            staleAfterMinutes: source.stale_after_minutes,
            consecutiveFailures: source.consecutive_failures,
            lastErrorCode: sourceErrorCode(source.last_error_code),
            lastRunIsPartial: source.last_run_is_partial === 1,
          });
          return [{
            evidenceId: row.id,
            observationId: row.id,
            sourceRunId: row.source_run_id,
            revision: row.revision,
            supersedesId: row.supersedes_id,
            indicatorId: selector.indicatorId,
            sourceId: row.source_id,
            layer: selector.layer,
            stance: selector.defaultStance,
            weight: selector.weight,
            observedAt: row.observed_at,
            publishedAt: row.published_at,
            fetchedAt: row.fetched_at,
            value: observationValue(row),
            unit: row.unit,
            quality: observationQuality(row.quality),
            citationUrl: row.citation_url,
            sourceTier: sourceTier(source.source_tier),
            sourceHealth: health.status,
            freshness: "unknown",
          }];
        });
        const previous = previousByThesis.get(seed.id);
        return {
          thesisId: seed.id,
          previousStage: previous === undefined ? "watch" : thesisStage(previous.stage),
          hasPreviousVersion: previous !== undefined,
          evidence,
        };
      });
    } catch (error) {
      if (error instanceof DailyScheduleError) throw error;
      reportStorageFailure("daily-schedule.loadEvaluationInputs", error);
      throw databaseError();
    }
  }

  async findEvaluationCandidates(
    evaluationCutoff: string,
  ): Promise<readonly DailyPublicationCandidate[]> {
    try {
      const result = await this.database.prepare(
        `SELECT version.thesis_id, version.id AS thesis_version_id, version.status
           FROM thesis_versions version
          WHERE version.based_on_cutoff = ?
            AND version.created_by = 'system:daily-evaluation'
            AND version.thesis_id IN (${placeholders(REQUIRED_DAILY_THESIS_IDS)})
          ORDER BY version.thesis_id, version.version`,
      ).bind(evaluationCutoff).all<Record<string, unknown>>();
      if (result.success !== true || !Array.isArray(result.results)) throw databaseError();
      return result.results.map(decodePublicationCandidate);
    } catch (error) {
      if (error instanceof DailyScheduleError) throw error;
      reportStorageFailure("daily-schedule.findEvaluationCandidates", error);
      throw databaseError();
    }
  }
}

/**
 * 评估输入的观测查询（固定查询串供 cloudflare-read-models-query-plan.test.mjs 回归）。
 *
 * - revision 去重下推到 SQL：同一 (indicator_id, observed_at) 只保留 MAX(revision) 一行，
 *   历史修订不再整批返回。indicator_id IN 条件必须留在去重子查询内部，
 *   GROUP BY 才能走 idx_observations_indicator_observed 的前缀，避免全表分组。
 * - 语义红线：不新增 observed_at 下界——NOAA（1950 起）、World Bank 年度序列等
 *   多年历史观测是合法评估输入，加窗口会改变评估结果。
 * - LIMIT MAX_EVALUATION_INPUT_ROWS 为结构护栏；命中上限行数时调用方 fail-closed。
 */
function evaluationInputsQuery(selectorCount: number): string {
  return `SELECT observation.id, observation.indicator_id, observation.observed_at,
          observation.value_num, observation.value_text, observation.unit,
          observation.published_at, observation.fetched_at, observation.revision,
          observation.supersedes_id, observation.quality, observation.source_run_id,
          observation.citation_url, source.id AS source_id
     FROM observations observation
     JOIN (
           SELECT latest_rows.indicator_id, latest_rows.observed_at,
                  MAX(latest_rows.revision) AS max_revision
             FROM observations latest_rows
            WHERE latest_rows.indicator_id IN (${placeholders(Array.from({ length: selectorCount }, () => "?"))})
            GROUP BY latest_rows.indicator_id, latest_rows.observed_at
       ) latest
       ON latest.indicator_id = observation.indicator_id
      AND latest.observed_at = observation.observed_at
      AND observation.revision = latest.max_revision
     JOIN indicators indicator ON indicator.id = observation.indicator_id
     JOIN sources source ON source.id = indicator.source_id
     JOIN source_runs run
       ON run.id = observation.source_run_id AND run.source_id = source.id
    WHERE observation.fetched_at <= ?
    ORDER BY observation.indicator_id, observation.observed_at, observation.revision,
             observation.id
    LIMIT ${MAX_EVALUATION_INPUT_ROWS}`;
}

/** 查询计划回归入口：与 evaluationInputsQuery 返回完全一致的 SQL 文本。 */
export function evaluationInputsQueryForPlan(selectorCount: number): string {
  return evaluationInputsQuery(selectorCount);
}

function decodeObservationRow(value: Record<string, unknown>): ObservationRow {
  const row = exactRecord(value, [
    "id", "indicator_id", "observed_at", "value_num", "value_text", "unit", "published_at",
    "fetched_at", "revision", "supersedes_id", "quality", "source_run_id", "citation_url",
    "source_id",
  ]);
  return {
    id: nonEmptyString(row.id),
    indicator_id: nonEmptyString(row.indicator_id),
    observed_at: stringValue(row.observed_at),
    value_num: nullableFiniteNumber(row.value_num),
    value_text: nullableString(row.value_text),
    unit: nonEmptyString(row.unit),
    published_at: nullableString(row.published_at),
    fetched_at: stringValue(row.fetched_at),
    revision: nonNegativeInteger(row.revision),
    supersedes_id: nullableString(row.supersedes_id),
    quality: stringValue(row.quality),
    source_run_id: nonEmptyString(row.source_run_id),
    citation_url: stringValue(row.citation_url),
    source_id: nonEmptyString(row.source_id),
  };
}

function decodeSourceStateRow(value: Record<string, unknown>): SourceStateRow {
  const row = exactRecord(value, [
    "source_id", "source_tier", "last_success_at", "late_after_minutes", "stale_after_minutes",
    "consecutive_failures", "last_error_code", "last_run_is_partial", "ambiguous_retry_rewrites",
  ]);
  return {
    source_id: nonEmptyString(row.source_id),
    source_tier: stringValue(row.source_tier),
    last_success_at: nullableString(row.last_success_at),
    late_after_minutes: nonNegativeInteger(row.late_after_minutes),
    stale_after_minutes: nonNegativeInteger(row.stale_after_minutes),
    consecutive_failures: nonNegativeInteger(row.consecutive_failures),
    last_error_code: nullableString(row.last_error_code),
    last_run_is_partial: nonNegativeInteger(row.last_run_is_partial),
    ambiguous_retry_rewrites: nonNegativeInteger(row.ambiguous_retry_rewrites),
  };
}

function decodePreviousVersionRow(value: Record<string, unknown>): PreviousVersionRow {
  const row = exactRecord(value, ["thesis_id", "stage", "based_on_cutoff", "created_at"]);
  return {
    thesis_id: nonEmptyString(row.thesis_id),
    stage: stringValue(row.stage),
    based_on_cutoff: canonicalUtcString(row.based_on_cutoff),
    created_at: canonicalUtcString(row.created_at),
  };
}

function decodePublicationCandidate(value: Record<string, unknown>): DailyPublicationCandidate {
  const row = exactRecord(value, ["thesis_id", "thesis_version_id", "status"]);
  if (!REQUIRED_DAILY_THESIS_IDS.includes(row.thesis_id as RequiredDailyThesisId)) {
    throw databaseError();
  }
  if (typeof row.thesis_version_id !== "string" || row.thesis_version_id.trim().length === 0) {
    throw databaseError();
  }
  if (row.status !== "draft" && row.status !== "published" && row.status !== "withdrawn") {
    throw databaseError();
  }
  return {
    thesisId: row.thesis_id as RequiredDailyThesisId,
    thesisVersionId: row.thesis_version_id,
    status: row.status,
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw databaseError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !(key in row))) {
    throw databaseError();
  }
  return row;
}

function queryRows(result: D1Result<Record<string, unknown>> | undefined): Record<string, unknown>[] {
  if (result === undefined || result.success !== true || !Array.isArray(result.results)) {
    throw databaseError();
  }
  return result.results;
}

function observationValue(row: ObservationRow): number | string {
  if (typeof row.value_num === "number" && Number.isFinite(row.value_num) && row.value_text === null) {
    return row.value_num;
  }
  if (row.value_num === null && typeof row.value_text === "string") return row.value_text;
  throw databaseError();
}

function observationQuality(value: string): ObservationQuality {
  const values: readonly ObservationQuality[] = ["verified", "provisional", "estimated", "manual", "invalid"];
  const quality = values.find((candidate) => candidate === value);
  if (quality === undefined) throw databaseError();
  return quality;
}

function sourceTier(value: string): SourceTier {
  if (value === "A" || value === "B" || value === "C") return value;
  throw databaseError();
}

function sourceErrorCode(value: string | null): SourceErrorCode | null {
  if (value === null) return null;
  const result = SOURCE_ERROR_CODES.find((candidate) => candidate === value);
  if (result === undefined) throw databaseError();
  return result;
}

function thesisStage(value: string): ThesisStage {
  const stage = THESIS_STAGES.find((candidate) => candidate === value);
  if (stage === undefined) throw databaseError();
  return stage;
}

function placeholders(values: readonly unknown[]): string {
  if (values.length === 0) throw new DailyScheduleError("VALIDATION", "SQL 参数集合不能为空");
  return values.map(() => "?").join(", ");
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw databaseError();
  return value;
}

function nonEmptyString(value: unknown): string {
  const result = stringValue(value);
  if (result.trim().length === 0) throw databaseError();
  return result;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw databaseError();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw databaseError();
  return value as number;
}

function canonicalUtcString(value: unknown): string {
  const result = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)) throw databaseError();
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== result) throw databaseError();
  return result;
}

function databaseError(): DailyScheduleError {
  return new DailyScheduleError("DATABASE", "D1 无法读取每日调度输入");
}
