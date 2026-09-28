import { canonicalJson } from "../../../domain/canonical-json";
import { SourceCollectionError } from "../../../domain/ingestion";
import { parseCanonicalUtc } from "../../ingestion/time";
import type {
  ClimatologyFreshness,
  ClimatologyObservationWrite,
  ClimatologyPersistRequest,
  ClimatologyRefreshRepository,
} from "../../modules/climatology-refresh";
import { reportStorageFailure } from "./storage-logging";

/**
 * 气候态观测的 D1 读写。每个父源只有一条气候态 source_run，scheduled_at 固定为
 * 基准期起点 1991-01-01，避免和日采集的 (source_id, scheduled_at) 槽位相撞，
 * 也不更新 sources 健康列。
 *
 * 写入沿用派生观测的追加语义：同 (indicator_id, observed_at) 值未变 → skip；
 * 变化 → 新 revision（supersedes）。revision 在写入语句内求值。
 */

/** 气候态 source_run 的固定调度槽。不是采集时刻。 */
export const CLIMATOLOGY_RUN_SCHEDULED_AT = "1991-01-01T00:00:00.000Z";

const MAX_CLIMATOLOGY_MONTHS = 12;

export const CLIMATOLOGY_FRESHNESS_QUERY = `
  SELECT COUNT(*) AS month_count, MAX(latest.fetched_at) AS newest_fetched_at
    FROM (
           SELECT observation.fetched_at
             FROM (
                    SELECT observation.observed_at, observation.fetched_at, observation.quality,
                           ROW_NUMBER() OVER (
                             PARTITION BY observation.observed_at
                             ORDER BY observation.revision DESC
                           ) AS revision_rank
                      FROM observations observation
                     WHERE observation.indicator_id = ?
                       AND observation.fetched_at <= ?
                       AND observation.value_num IS NOT NULL
                  ) observation
            WHERE observation.revision_rank = 1
              AND observation.quality <> 'invalid'
         ) latest`;

interface FreshnessRow {
  readonly month_count: number;
  readonly newest_fetched_at: string | null;
}

interface LatestObservationRow {
  readonly id: string;
  readonly observed_at: string;
  readonly value_num: number | null;
  readonly unit: string;
  readonly period_start: string | null;
}

interface ExistingRunRow {
  readonly id: string;
  readonly content_hash: string | null;
}

export class D1ClimatologyRepository implements ClimatologyRefreshRepository {
  constructor(
    private readonly database: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async loadFreshness(indicatorId: string, cutoff: string): Promise<ClimatologyFreshness> {
    const cutoffIso = parseCanonicalUtc(cutoff, "scheduledAt").toISOString();
    try {
      const row = await this.database
        .prepare(CLIMATOLOGY_FRESHNESS_QUERY)
        .bind(indicatorId, cutoffIso)
        .first<FreshnessRow>();
      const monthCount = row?.month_count ?? 0;
      if (!Number.isInteger(monthCount) || monthCount < 0) {
        throw new SourceCollectionError("DATABASE", "气候态新鲜度读取失败");
      }
      return {
        monthCount,
        newestFetchedAt: row?.newest_fetched_at ?? null,
      };
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      reportStorageFailure("climatology.loadFreshness", error);
      throw new SourceCollectionError("DATABASE", "气候态新鲜度读取失败");
    }
  }

  async persist(request: ClimatologyPersistRequest): Promise<"written" | "unchanged"> {
    if (request.observations.length !== MAX_CLIMATOLOGY_MONTHS) {
      throw new SourceCollectionError("VALIDATION", "气候态写入必须恰好 12 个月");
    }
    const fetchedAt = parseCanonicalUtc(request.fetchedAt, "fetchedAt").toISOString();
    const indicatorIds = new Set(request.observations.map((observation) => observation.indicatorId));
    if (indicatorIds.size !== 1) {
      throw new SourceCollectionError("VALIDATION", "一次气候态写入只能包含一个指标");
    }
    const observedAts = new Set(request.observations.map((observation) => observation.observedAt));
    if (observedAts.size !== request.observations.length) {
      throw new SourceCollectionError("VALIDATION", "气候态月份重复");
    }

    const existing = await this.findRun(request.sourceId);
    const latest = await this.loadLatest(request.observations[0]!.indicatorId);
    const planned = request.observations.flatMap((observation) => {
      const current = latest.get(observation.observedAt);
      if (current !== undefined && sameObservation(current, observation)) return [];
      return [{ observation, supersedesId: current?.id ?? null }];
    });
    if (
      planned.length === 0
      && existing !== null
      && existing.content_hash === request.contentHash
    ) {
      return "unchanged";
    }

    const runId = existing?.id ?? this.createId();
    const inserted = planned.filter((item) => item.supersedesId === null).length;
    const revised = planned.length - inserted;
    try {
      await this.database.batch([
        existing === null
          ? this.insertRun(runId, request, fetchedAt, inserted, revised)
          : this.updateRun(runId, request, fetchedAt, inserted, revised),
        ...planned.map(({ observation, supersedesId }) =>
          this.insertObservation(runId, observation, supersedesId),
        ),
      ]);
    } catch (error) {
      reportStorageFailure("climatology.persist", error);
      throw new SourceCollectionError("DATABASE", "气候态观测写入失败");
    }
    return planned.length === 0 ? "unchanged" : "written";
  }

  private async findRun(sourceId: string): Promise<ExistingRunRow | null> {
    try {
      const row = await this.database
        .prepare(
          `SELECT id, content_hash
             FROM source_runs
            WHERE source_id = ? AND scheduled_at = ?`,
        )
        .bind(sourceId, CLIMATOLOGY_RUN_SCHEDULED_AT)
        .first<ExistingRunRow>();
      return row ?? null;
    } catch (error) {
      reportStorageFailure("climatology.findRun", error);
      throw new SourceCollectionError("DATABASE", "气候态运行读取失败");
    }
  }

  private async loadLatest(indicatorId: string): Promise<Map<string, LatestObservationRow>> {
    try {
      const result = await this.database
        .prepare(
          `SELECT latest.id, latest.observed_at, latest.value_num, latest.unit, latest.period_start
             FROM (
                    SELECT observation.id, observation.observed_at, observation.value_num,
                           observation.unit, observation.period_start,
                           ROW_NUMBER() OVER (
                             PARTITION BY observation.observed_at
                             ORDER BY observation.revision DESC
                           ) AS revision_rank
                      FROM observations observation
                     WHERE observation.indicator_id = ?
                  ) latest
            WHERE latest.revision_rank = 1`,
        )
        .bind(indicatorId)
        .all<LatestObservationRow>();
      if (result.success !== true || !Array.isArray(result.results)) {
        throw new SourceCollectionError("DATABASE", "气候态最新值读取失败");
      }
      return new Map(result.results.map((row) => [row.observed_at, row]));
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      reportStorageFailure("climatology.loadLatest", error);
      throw new SourceCollectionError("DATABASE", "气候态最新值读取失败");
    }
  }

  private insertRun(
    runId: string,
    request: ClimatologyPersistRequest,
    fetchedAt: string,
    inserted: number,
    revised: number,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO source_runs (
           id, source_id, scheduled_at, started_at, finished_at, status,
           http_status, etag, last_modified, snapshot_key, content_hash,
           observations_inserted, observations_revised, error_code, error_message
         ) VALUES (?, ?, ?, ?, ?, 'success', NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        runId,
        request.sourceId,
        CLIMATOLOGY_RUN_SCHEDULED_AT,
        fetchedAt,
        fetchedAt,
        request.snapshotKey,
        request.contentHash,
        inserted,
        revised,
      );
  }

  private updateRun(
    runId: string,
    request: ClimatologyPersistRequest,
    fetchedAt: string,
    inserted: number,
    revised: number,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `UPDATE source_runs
            SET finished_at = ?, status = 'success', snapshot_key = ?, content_hash = ?,
                observations_inserted = ?, observations_revised = ?,
                error_code = NULL, error_message = NULL
          WHERE id = ? AND source_id = ? AND scheduled_at = ?`,
      )
      .bind(
        fetchedAt,
        request.snapshotKey,
        request.contentHash,
        inserted,
        revised,
        runId,
        request.sourceId,
        CLIMATOLOGY_RUN_SCHEDULED_AT,
      );
  }

  private insertObservation(
    runId: string,
    observation: ClimatologyObservationWrite,
    supersedesId: string | null,
  ): D1PreparedStatement {
    const observedAt = parseCanonicalUtc(observation.observedAt, "气候态 observedAt").toISOString();
    const periodStart = parseCanonicalUtc(observation.periodStart, "气候态 periodStart").toISOString();
    const fetchedAt = parseCanonicalUtc(observation.fetchedAt, "气候态 fetchedAt").toISOString();
    if (!Number.isFinite(observation.value)) {
      throw new SourceCollectionError("VALIDATION", "气候态观测值不是有限数值");
    }
    return this.database
      .prepare(
        `INSERT INTO observations (
           id, indicator_id, observed_at, period_start, value_num, value_text,
           unit, published_at, fetched_at, revision, supersedes_id, quality,
           source_run_id, citation_url, metadata_json
         ) SELECT ?, ?, ?, ?, ?, NULL, ?, NULL, ?,
                  (SELECT COALESCE(MAX(revision), -1) + 1 FROM observations
                    WHERE indicator_id = ? AND observed_at = ?),
                  ?, 'verified', ?, ?, ?`,
      )
      .bind(
        this.createId(),
        observation.indicatorId,
        observedAt,
        periodStart,
        observation.value,
        observation.unit,
        fetchedAt,
        observation.indicatorId,
        observedAt,
        supersedesId,
        runId,
        observation.citationUrl,
        canonicalJson(observation.metadata),
      );
  }
}

function sameObservation(latest: LatestObservationRow, observation: ClimatologyObservationWrite): boolean {
  return (
    latest.value_num === observation.value
    && latest.unit === observation.unit
    && latest.period_start === observation.periodStart
  );
}
