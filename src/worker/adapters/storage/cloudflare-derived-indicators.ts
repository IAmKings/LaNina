import { canonicalJson } from "../../../domain/canonical-json";
import { parseCanonicalUtc } from "../../ingestion/time";
import type {
  ClimatologyBaseObservation,
  DerivedIndicatorRepository,
  DerivedObservationWrite,
  MarketYearBaseObservation,
  PersistedDerivedObservation,
  RainfallBaseObservation,
} from "../../modules/derived-indicators";
import { DerivedIndicatorError } from "../../modules/derived-indicators";
import { reportStorageFailure } from "./storage-logging";

/**
 * 派生观测的 D1 读写路径。与采集写路径（cloudflare-ingestion）对齐：
 * - 读：按 (indicator_id, observed_at) 取最新 revision，显式排除 quality='invalid'；
 *   序列按 observed_at 降序取最新若干观测期（ROW_NUMBER 去重 + 结构 LIMIT 护栏，
 *   不加 observed_at 下界——USDA marketing-year 全历史与 400 日降水窗口都是合法派生输入）。
 * - 写：同批次内 (indicator_id, observed_at) 不重复；revision 由写入语句内的子查询
 *   在执行时求值（批次二内联同款），supersedes_id 指向计划期读到的最新行。派生值未变
 *   → skip（设计口径「值未变 → skip」：比较 value_num/unit/period_start；metadata_json
 *   记录计算溯源但不参与比较——基准行换 revision 而派生值不变时不产生派生修订）。
 * 派生观测不创建 source_runs 行：source_run_id 沿用当期基准观测的 run（同父源），
 * 不触碰 sources 健康计数，也不进入来源运行列表。
 */

/** 单指标派生序列的观测期护栏（marketing-year 每年一行，30 年远超 5 年窗口需要）。 */
const MAX_SERIES_PERIODS = 30;
/**
 * 降水日值基准序列的观测期护栏：最大距平窗口 400 天（domain MAX_RAIN_WINDOW_DAYS）
 * + 发布滞后缓冲，与 worker 模块的 MAX_DAILY_RAIN_SERIES_PERIODS 同口径。
 */
const MAX_DAILY_SERIES_PERIODS = 410;
/**
 * 月气候态指标的结构护栏：恰好 12 个月序观测。读到第 13 行即结构破坏，fail-closed。
 */
const MAX_CLIMATOLOGY_PERIODS = 12;
/** 单次重算的派生写入护栏（当前 5 个定义；与采集路径的单次 D1 安全预算同量级）。 */
const MAX_WRITES_PER_RUN = 50;

interface BaseSeriesRow {
  readonly id: string;
  readonly observed_at: string;
  readonly period_start: string | null;
  readonly value_num: number | null;
  readonly unit: string;
  readonly revision: number;
  readonly source_run_id: string;
  readonly citation_url: string;
  readonly indicator_source_id: string;
  readonly run_source_id: string;
}

interface LatestObservationRow {
  readonly id: string;
  readonly value_num: number | null;
  readonly value_text: string | null;
  readonly unit: string;
  readonly period_start: string | null;
}

/** 固定查询串供回归断言（与 evaluationInputsQuery 的固定查询串做法一致）。 */
export const DERIVED_BASE_SERIES_QUERY = `
  SELECT ordered.id, ordered.observed_at, ordered.period_start, ordered.value_num,
         ordered.unit, ordered.revision, ordered.source_run_id, ordered.citation_url,
         indicator.source_id AS indicator_source_id, run.source_id AS run_source_id
    FROM (
           SELECT latest.id, latest.observed_at, latest.period_start, latest.value_num,
                  latest.unit, latest.quality, latest.revision, latest.source_run_id,
                  latest.citation_url, latest.indicator_id
             FROM (
                    SELECT observation.id, observation.indicator_id, observation.observed_at,
                           observation.period_start, observation.value_num, observation.unit,
                           observation.quality, observation.revision, observation.source_run_id,
                           observation.citation_url,
                           ROW_NUMBER() OVER (
                             PARTITION BY observation.indicator_id, observation.observed_at
                             ORDER BY observation.revision DESC
                           ) AS revision_rank
                      FROM observations observation
                     WHERE observation.indicator_id = ?
                       AND observation.fetched_at <= ?
                       AND observation.value_num IS NOT NULL
                  ) latest
            WHERE latest.revision_rank = 1
              AND latest.quality <> 'invalid'
            ORDER BY latest.observed_at DESC
            LIMIT ${MAX_SERIES_PERIODS}
         ) ordered
    JOIN indicators indicator ON indicator.id = ordered.indicator_id
    JOIN source_runs run ON run.id = ordered.source_run_id
   ORDER BY ordered.observed_at ASC`;

/**
 * 降水日值基准序列：与 marketing-year 查询同一形态，仅观测期护栏取日值口径
 * （MAX_DAILY_SERIES_PERIODS = 410 ≥ 任何合法距平窗口）。observed_at 降序取最近
 * 观测期后升序返回，窗口末端 = 序列末点 = 最新观测日。
 */
export const DERIVED_DAILY_RAIN_SERIES_QUERY = DERIVED_BASE_SERIES_QUERY.replace(
  `LIMIT ${MAX_SERIES_PERIODS}`,
  `LIMIT ${MAX_DAILY_SERIES_PERIODS}`,
);

/** 月气候态基准序列（月序 12 观测）：读到第 13 行即结构破坏。 */
export const DERIVED_CLIMATOLOGY_SERIES_QUERY = DERIVED_BASE_SERIES_QUERY.replace(
  `LIMIT ${MAX_SERIES_PERIODS}`,
  `LIMIT ${MAX_CLIMATOLOGY_PERIODS + 1}`,
);

export class D1DerivedIndicatorRepository implements DerivedIndicatorRepository {
  constructor(
    private readonly database: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async loadMarketYearBaseSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly MarketYearBaseObservation[]> {
    const rows = await this.loadBaseSeries(DERIVED_BASE_SERIES_QUERY, baseIndicatorId, cutoff);
    return rows.map(decodeBaseSeriesRow);
  }

  async loadRecentRainfallSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly RainfallBaseObservation[]> {
    const rows = await this.loadBaseSeries(DERIVED_DAILY_RAIN_SERIES_QUERY, baseIndicatorId, cutoff);
    return rows.map(decodeBaseSeriesRow);
  }

  async loadClimatologySeries(
    climatologyIndicatorId: string,
    cutoff: string,
  ): Promise<readonly ClimatologyBaseObservation[]> {
    const rows = await this.loadBaseSeries(
      DERIVED_CLIMATOLOGY_SERIES_QUERY,
      climatologyIndicatorId,
      cutoff,
    );
    if (rows.length > MAX_CLIMATOLOGY_PERIODS) {
      throw new DerivedIndicatorError(
        "VALIDATION",
        "月气候态指标观测期超过 12 个月，结构破坏",
      );
    }
    return rows.map(decodeClimatologyRow);
  }

  private async loadBaseSeries(
    query: string,
    indicatorId: string,
    cutoff: string,
  ): Promise<readonly BaseSeriesRow[]> {
    try {
      const result = await this.database
        .prepare(query)
        .bind(indicatorId, cutoff)
        .all<BaseSeriesRow>();
      if (result.success !== true || !Array.isArray(result.results)) {
        throw databaseError("派生基准序列读取失败");
      }
      return result.results;
    } catch (error) {
      if (error instanceof DerivedIndicatorError) throw error;
      reportStorageFailure("derived-indicators.loadBaseSeries", error);
      throw databaseError("派生基准序列读取失败");
    }
  }

  async persistDerivedObservations(
    writes: readonly DerivedObservationWrite[],
  ): Promise<readonly PersistedDerivedObservation[]> {
    if (writes.length === 0) return [];
    if (writes.length > MAX_WRITES_PER_RUN) {
      throw new DerivedIndicatorError("VALIDATION", "派生写入数量超过单次 D1 安全预算");
    }
    const validated = writes.map(validateWrite);
    const keys = new Set(
      validated.map((write) => `${write.derivedIndicatorId}\u0000${write.observedAt}`),
    );
    if (keys.size !== validated.length) {
      throw new DerivedIndicatorError("VALIDATION", "一次重算包含重复派生观测期");
    }

    let latestResults: D1Result<LatestObservationRow>[];
    try {
      latestResults = await this.database.batch<LatestObservationRow>(
        validated.map((write) =>
          this.database
            .prepare(
              `SELECT id, value_num, value_text, unit, period_start
                 FROM observations
                WHERE indicator_id = ? AND observed_at = ?
                ORDER BY revision DESC
                LIMIT 1`,
            )
            .bind(write.derivedIndicatorId, write.observedAt),
        ),
      );
    } catch (error) {
      reportStorageFailure("derived-indicators.persistDerivedObservations", error);
      throw databaseError("派生观测最新值读取失败");
    }

    const planned: { write: DerivedObservationWrite; supersedesId: string | null }[] = [];
    const statuses: PersistedDerivedObservation[] = [];
    validated.forEach((write, index) => {
      const latest = extractLatestRow(latestResults[index]);
      if (latest !== null && sameDerivedObservation(latest, write)) {
        statuses.push("skipped_unchanged");
        return;
      }
      planned.push({ write, supersedesId: latest?.id ?? null });
      statuses.push("written");
    });
    if (planned.length === 0) return statuses;

    try {
      await this.database.batch(
        planned.map(({ write, supersedesId }) => this.insertStatement(write, supersedesId)),
      );
    } catch (error) {
      // UNIQUE(indicator_id, observed_at, revision) 冲突 = 并发重算抢先落库：整批回滚，
      // 下轮重算按幂等口径收敛，本轮按 DATABASE fail-closed。
      reportStorageFailure("derived-indicators.persistDerivedObservations", error);
      throw databaseError("派生观测写入失败");
    }
    return statuses;
  }

  private insertStatement(
    write: DerivedObservationWrite,
    supersedesId: string | null,
  ): D1PreparedStatement {
    // revision 内联子查询在同一条写入语句内求值（批次二同款）：batch 原子性下读到的
    // 必然是本事务可见的最新 revision，消除「JS 先读再写 +1」的读-改-写竞态。
    const revisionSubquery = `(
              SELECT COALESCE(MAX(revision), -1) + 1 FROM observations
               WHERE indicator_id = ? AND observed_at = ?
            )`;
    return this.database
      .prepare(
        `INSERT INTO observations (
           id, indicator_id, observed_at, period_start, value_num, value_text,
           unit, published_at, fetched_at, revision, supersedes_id, quality,
           source_run_id, citation_url, metadata_json
         ) SELECT ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ${revisionSubquery}, ?, 'verified', ?, ?, ?`,
      )
      .bind(
        this.createId(),
        write.derivedIndicatorId,
        write.observedAt,
        write.periodStart,
        write.value,
        write.unit,
        write.fetchedAt,
        write.derivedIndicatorId,
        write.observedAt,
        supersedesId,
        write.sourceRunId,
        write.citationUrl,
        canonicalJson(write.metadata),
      );
  }
}

function validateWrite(write: DerivedObservationWrite): DerivedObservationWrite {
  return {
    ...write,
    observedAt: parseCanonicalUtc(write.observedAt, "派生观测 observedAt").toISOString(),
    periodStart: parseCanonicalUtc(write.periodStart, "派生观测 periodStart").toISOString(),
    fetchedAt: parseCanonicalUtc(write.fetchedAt, "派生观测 fetchedAt").toISOString(),
    value: finiteNumber(write.value, "派生观测值"),
  };
}

function sameDerivedObservation(latest: LatestObservationRow, write: DerivedObservationWrite): boolean {
  return (
    latest.value_num === write.value &&
    latest.value_text === null &&
    latest.unit === write.unit &&
    latest.period_start === write.periodStart
  );
}

function extractLatestRow(
  result: D1Result<LatestObservationRow> | undefined,
): LatestObservationRow | null {
  if (result === undefined || result.success !== true || !Array.isArray(result.results)) {
    throw databaseError("派生观测最新值读取失败");
  }
  const row = result.results[0];
  return row === undefined ? null : row;
}

function decodeBaseSeriesRow(row: BaseSeriesRow): MarketYearBaseObservation {
  return {
    observationId: nonEmptyString(row.id, "observation id"),
    observedAt: canonicalUtcOrThrow(row.observed_at, "派生基准 observed_at"),
    periodStart: row.period_start === null
      ? databaseFail("派生基准观测缺少 period_start")
      : canonicalUtcOrThrow(row.period_start, "派生基准 period_start"),
    value: finiteNumber(row.value_num, "派生基准观测值"),
    unit: nonEmptyString(row.unit, "派生基准单位"),
    revision: revisionOrThrow(row.revision),
    sourceRunId: nonEmptyString(row.source_run_id, "派生基准 source_run_id"),
    sourceId: nonEmptyString(row.indicator_source_id, "派生基准指标来源"),
    runSourceId: nonEmptyString(row.run_source_id, "派生基准 run 来源"),
    citationUrl: nonEmptyString(row.citation_url, "派生基准引用地址"),
  };
}

/**
 * 气候态行解码：月序 = observed_at 的 UTC 月份（采集端固定为 2020-MM-15，月序语义，
 * 不得当作时间序列读取）。observed_at 非规范时间戳、月份越界或非正值观测都 fail-closed。
 */
function decodeClimatologyRow(row: BaseSeriesRow): ClimatologyBaseObservation {
  const observedAt = canonicalUtcOrThrow(row.observed_at, "气候态 observed_at");
  const month = Number(observedAt.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return databaseFail("气候态观测 observed_at 的月份越界");
  }
  return {
    observationId: nonEmptyString(row.id, "observation id"),
    month,
    value: finiteNumber(row.value_num, "气候态观测值"),
    revision: revisionOrThrow(row.revision),
    sourceRunId: nonEmptyString(row.source_run_id, "气候态 source_run_id"),
    sourceId: nonEmptyString(row.indicator_source_id, "气候态指标来源"),
    runSourceId: nonEmptyString(row.run_source_id, "气候态 run 来源"),
    citationUrl: nonEmptyString(row.citation_url, "气候态引用地址"),
  };
}

function revisionOrThrow(revision: number): number {
  return Number.isInteger(revision) && revision >= 0
    ? revision
    : databaseFail("派生基准观测 revision 非法");
}

function canonicalUtcOrThrow(value: string, field: string): string {
  const parsed = parseCanonicalUtc(nonEmptyString(value, field), field);
  return parsed.toISOString();
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return databaseFail(`派生基准序列 ${field} 缺失`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return databaseFail(`派生基准序列 ${field} 非有限数值`);
  }
  return value;
}

function databaseFail(message: string): never {
  throw databaseError(message);
}

function databaseError(message: string): DerivedIndicatorError {
  return new DerivedIndicatorError("DATABASE", message);
}
