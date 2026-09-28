import type {
  IngestionRepository,
  ObservationInput,
  PersistCollectedRunInput,
  PersistedSourceRun,
  PersistFailedRunInput,
  RawSnapshotInput,
  RawSnapshotStore,
  SourceCursor,
  SourceErrorCode,
} from "../../../domain/ingestion";
import { SOURCE_ERROR_CODES, SourceCollectionError } from "../../../domain/ingestion";
import { calculateSourceHealth, lastRunIsPartialExpression } from "../../ingestion/source-health";
import { parseCanonicalUtc } from "../../ingestion/time";
import { reportStorageFailure } from "./storage-logging";

/**
 * 查询计划回归（cloudflare-read-models-query-plan.test.mjs）引用该固定查询串，
 * 防止后续改写悄悄丢掉 idx_source_runs_source_status_finished 的索引访问。
 */
export const SOURCE_CURSOR_QUERY = `SELECT etag, last_modified, content_hash
     FROM source_runs
    WHERE source_id = ?
      AND status IN ('success', 'unchanged')
    ORDER BY finished_at DESC, started_at DESC
    LIMIT 1`;

/** 首采租约占位行的安全文案：只在崩溃且未接管时可见，完成/接管即被覆写。 */
const FIRST_RUN_LEASE_MESSAGE = "采集运行占用中，等待完成或接管";

interface SourceRunRow {
  id: string;
  source_id: string;
  scheduled_at: string;
  status: PersistedSourceRun["status"];
  snapshot_key: string | null;
  observations_inserted: number;
  observations_revised: number;
  error_code: string | null;
  retry_count: number;
  next_retry_at: string | null;
}

interface SourceFailureRow {
  id: string;
  last_success_at: string | null;
  late_after_minutes: number;
  stale_after_minutes: number;
  consecutive_failures: number;
  last_error_code: string | null;
  last_run_is_partial: number;
}

interface CursorRow {
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
}

interface ObservationRow {
  id: string;
  observed_at: string;
  period_start: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string;
  published_at: string | null;
  revision: number;
  quality: ObservationInput["quality"];
  citation_url: string;
  metadata_json: string;
}

interface PlannedObservation {
  input: ObservationInput;
  id: string;
  supersedesId: string | null;
}

export class D1IngestionRepository implements IngestionRepository {
  constructor(
    private readonly database: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async findRun(sourceId: string, scheduledAt: string): Promise<PersistedSourceRun | null> {
    try {
      const row = await this.database
        .prepare(
          `SELECT id, source_id, scheduled_at, status, snapshot_key,
                  observations_inserted, observations_revised, error_code,
                  retry_count, next_retry_at
             FROM source_runs
            WHERE source_id = ? AND scheduled_at = ?`,
        )
        .bind(sourceId, scheduledAt)
        .first<SourceRunRow>();
      return row === null ? null : toPersistedRun(row);
    } catch (error) {
      reportStorageFailure("ingestion.findRun", error);
      throw databaseError();
    }
  }

  async findSourceCursor(sourceId: string): Promise<SourceCursor> {
    try {
      const row = await this.database
        .prepare(SOURCE_CURSOR_QUERY)
        .bind(sourceId)
        .first<CursorRow>();
      return {
        etag: row?.etag ?? null,
        lastModified: row?.last_modified ?? null,
        contentHash: row?.content_hash ?? null,
      };
    } catch (error) {
      reportStorageFailure("ingestion.findSourceCursor", error);
      throw databaseError();
    }
  }

  async claimRetryAttempt(
    sourceId: string,
    scheduledAt: string,
    expectedRetryCount: number,
    claimToken: string,
    claimedAt: string,
    claimExpiresAt: string,
  ): Promise<boolean> {
    try {
      const result = await this.database
        .prepare(
          `UPDATE source_runs
              SET retry_count = retry_count + 1, retry_claim_token = ?,
                  retry_claim_expires_at = ?
            WHERE source_id = ? AND scheduled_at = ? AND status = 'failed'
              AND retry_count = ? AND retry_count < 3
              AND next_retry_at IS NOT NULL AND next_retry_at <= ?
              AND (retry_claim_token IS NULL OR retry_claim_expires_at <= ?)`,
        )
        .bind(
          claimToken,
          claimExpiresAt,
          sourceId,
          scheduledAt,
          expectedRetryCount,
          claimedAt,
          claimedAt,
        )
        .run();
      return changedRows(result) === 1;
    } catch (error) {
      reportStorageFailure("ingestion.claimRetryAttempt", error);
      throw databaseError();
    }
  }

  async claimScheduledRun(
    sourceId: string,
    scheduledAt: string,
    runId: string,
    claimToken: string,
    claimedAt: string,
    claimExpiresAt: string,
  ): Promise<boolean> {
    try {
      // 首采租约占位行：status CHECK 只允许既有四态，因此以 'failed' + 租约令牌表达
      // 「占用中」；完成时由 guarded 更新路径覆写为最终状态并清除令牌，worker 崩溃
      // 则由 retry_claim_expires_at 过期后的重试路径接管。占位行不触碰 sources 健康
      // 计数（与 persistFailed 不同），避免未决运行污染连续失败口径。
      const result = await this.database
        .prepare(
          `INSERT INTO source_runs (
             id, source_id, scheduled_at, started_at, finished_at, status,
             http_status, etag, last_modified, snapshot_key, content_hash,
             observations_inserted, observations_revised, error_code, error_message,
             retry_count, next_retry_at, retry_claim_token, retry_claim_expires_at
           ) VALUES (?, ?, ?, ?, NULL, 'failed', NULL, NULL, NULL, NULL, NULL,
                     0, 0, 'VALIDATION', ?, 0, ?, ?, ?)`,
        )
        .bind(
          runId,
          sourceId,
          scheduledAt,
          claimedAt,
          FIRST_RUN_LEASE_MESSAGE,
          claimedAt,
          claimToken,
          claimExpiresAt,
        )
        .run();
      return changedRows(result) === 1;
    } catch (error) {
      // UNIQUE(source_id, scheduled_at) 冲突 = 槽位已被其他 worker 领取：按契约返回
      // false（不算错误）。数据库真实故障时 findRun 同样失败并向外抛出。
      const raced = await this.findRun(sourceId, scheduledAt);
      if (raced !== null) return false;
      reportStorageFailure("ingestion.claimScheduledRun", error);
      throw databaseError();
    }
  }

  async persistCollected(input: PersistCollectedRunInput): Promise<PersistedSourceRun> {
    try {
      const planned = await this.planObservations(input.result.observations);
      // supersedesId === null ⟺ 该 (indicator, observed_at) 此前无任何行 ⟺ revision 0；
      // 具体 revision 值由写入语句内的子查询在执行时求值，计划期不再携带。
      const inserted = planned.filter((observation) => observation.supersedesId === null).length;
      const revised = planned.length - inserted;
      const status = input.result.status === "changed" ? "success" : input.result.status;
      const previousHealth =
        status === "partial" ? null : await this.findSourceHealthBefore(input.sourceId, input.finishedAt);
      const recovered =
        previousHealth !== null &&
        (previousHealth.consecutiveFailures > 0 ||
          (previousHealth.lastSuccessAt !== null &&
            previousHealth.health.status !== "healthy"));
      const completion = this.completeRunStatement(input, status, inserted, revised);
      const dependentStatements: D1PreparedStatement[] = [
        ...planned.map((observation) => this.insertObservationStatement(input, observation)),
        ...(recovered && previousHealth !== null
          ? [this.recoveryChangeStatement(input, previousHealth)]
          : []),
        this.sourceHealthStatement(input, status),
      ];
      const statements =
        input.expectedRetryCount === null
          ? [completion, ...dependentStatements]
          : [...dependentStatements, completion];
      const completionIndex = input.expectedRetryCount === null ? 0 : statements.length - 1;

      const results = await this.database.batch(statements);
      if (input.expectedRetryCount !== null && changedRows(results[completionIndex]) === 0) {
        const raced = await this.findRun(input.sourceId, input.scheduledAt);
        if (raced !== null) return raced;
        throw databaseError();
      }
      return {
        id: input.runId,
        sourceId: input.sourceId,
        scheduledAt: input.scheduledAt,
        status,
        snapshotKey: input.snapshotKey,
        observationsInserted: inserted,
        observationsRevised: revised,
        errorCode: null,
        retryCount: input.retryCount,
        nextRetryAt: null,
        recovered,
      };
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      throw databaseError();
    }
  }

  async persistFailed(input: PersistFailedRunInput): Promise<PersistedSourceRun> {
    try {
      const runStatement = this.failRunStatement(input);
      const sourceStatement =
        input.expectedRetryCount === null
          ? this.failedSourceStatement(input, false)
          : this.failedSourceStatement(input, true);
      // 重试路径把来源健康语句放在 run 语句之前：failRunStatement 会清掉 retry_claim_token，
      // 之后任何基于「仍持有 claim token」的前置状态检查都不再成立。source_runs 与 sources
      // 相互独立，batch 原子性下先写来源健康与先写 run 等价。
      const statements = input.expectedRetryCount === null
        ? [runStatement, sourceStatement]
        : [sourceStatement, runStatement];
      const runIndex = input.expectedRetryCount === null ? 0 : 1;
      const results = await this.database.batch(statements);
      if (input.expectedRetryCount !== null && changedRows(results[runIndex]) === 0) {
        const raced = await this.findRun(input.sourceId, input.scheduledAt);
        if (raced !== null) return raced;
        throw databaseError();
      }
      return failedRun(input);
    } catch (error) {
      reportStorageFailure("ingestion.persistFailed", error);
      const existing = await this.findRun(input.sourceId, input.scheduledAt);
      if (existing !== null) return existing;
      throw databaseError();
    }
  }

  private completeRunStatement(
    input: PersistCollectedRunInput,
    status: PersistedSourceRun["status"],
    inserted: number,
    revised: number,
  ): D1PreparedStatement {
    if (input.expectedRetryCount === null) {
      return this.database
        .prepare(
          `INSERT INTO source_runs (
             id, source_id, scheduled_at, started_at, finished_at, status,
             http_status, etag, last_modified, snapshot_key, content_hash,
             observations_inserted, observations_revised, error_code, error_message,
             retry_count, next_retry_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .bind(
          input.runId, input.sourceId, input.scheduledAt, input.startedAt, input.finishedAt,
          status, input.result.etag, input.result.lastModified, input.snapshotKey,
          input.result.contentHash, inserted, revised, input.retryCount,
        );
    }
    return this.database
      .prepare(
        `UPDATE source_runs
            SET started_at = ?, finished_at = ?, status = ?, http_status = NULL,
                etag = ?, last_modified = ?, snapshot_key = ?, content_hash = ?,
                observations_inserted = ?, observations_revised = ?,
                error_code = NULL, error_message = NULL, retry_count = ?, next_retry_at = NULL,
                retry_claim_token = NULL, retry_claim_expires_at = NULL
          WHERE id = ? AND source_id = ? AND scheduled_at = ?
            AND status = 'failed' AND retry_count = ? AND retry_claim_token = ?`,
      )
      .bind(
        input.startedAt, input.finishedAt, status, input.result.etag,
        input.result.lastModified, input.snapshotKey, input.result.contentHash,
        inserted, revised, input.retryCount, input.runId, input.sourceId,
        input.scheduledAt, input.retryCount, input.retryClaimToken,
      );
  }

  private failRunStatement(input: PersistFailedRunInput): D1PreparedStatement {
    if (input.expectedRetryCount === null) {
      return this.database
        .prepare(
          `INSERT INTO source_runs (
             id, source_id, scheduled_at, started_at, finished_at, status,
             http_status, etag, last_modified, snapshot_key, content_hash,
             observations_inserted, observations_revised, error_code, error_message,
             retry_count, next_retry_at
           ) VALUES (?, ?, ?, ?, ?, 'failed', ?, NULL, NULL, NULL, NULL, 0, 0, ?, ?, ?, ?)`,
        )
        .bind(
          input.runId, input.sourceId, input.scheduledAt, input.startedAt, input.finishedAt,
          input.httpStatus, input.errorCode, input.errorMessage.slice(0, 500),
          input.retryCount, input.nextRetryAt,
        );
    }
    return this.database
      .prepare(
        `UPDATE source_runs
            SET started_at = ?, finished_at = ?, http_status = ?, error_code = ?,
                error_message = ?, retry_count = ?, next_retry_at = ?,
                retry_claim_token = NULL, retry_claim_expires_at = NULL
          WHERE id = ? AND source_id = ? AND scheduled_at = ?
            AND status = 'failed' AND retry_count = ? AND retry_claim_token = ?`,
      )
      .bind(
        input.startedAt, input.finishedAt, input.httpStatus, input.errorCode,
        input.errorMessage.slice(0, 500), input.retryCount, input.nextRetryAt,
        input.runId, input.sourceId, input.scheduledAt, input.retryCount,
        input.retryClaimToken,
      );
  }

  private failedSourceStatement(
    input: PersistFailedRunInput,
    guardRetryOwnership: boolean,
  ): D1PreparedStatement {
    // 守卫对照重试路径既有模式（recoveryChangeStatement / sourceHealthStatement）：
    // 显式校验本 worker 仍持有该 run 的 retry claim，替代跨语句语义不可靠的 changes()。
    const ownership = guardRetryOwnership
      ? ` AND EXISTS (
            SELECT 1 FROM source_runs owned
             WHERE owned.id = ? AND owned.status = 'failed'
               AND owned.retry_count = ? AND owned.retry_claim_token = ?
          )`
      : "";
    const ownershipValues = guardRetryOwnership
      ? [input.runId, input.retryCount, input.retryClaimToken]
      : [];
    return this.database
      .prepare(
        `UPDATE sources
            SET consecutive_failures = consecutive_failures + 1,
                last_error_code = ?, next_due_at = COALESCE(?, next_due_at), updated_at = ?
          WHERE id = ?${ownership}`,
      )
      .bind(input.errorCode, input.nextDueAt, input.finishedAt, input.sourceId, ...ownershipValues);
  }

  private async findSourceHealthBefore(sourceId: string, checkedAt: string): Promise<{
    health: ReturnType<typeof calculateSourceHealth>;
    consecutiveFailures: number;
    lastErrorCode: SourceErrorCode | null;
    lastSuccessAt: string | null;
  } | null> {
    const row = await this.database
      .prepare(
        `SELECT sources.id, sources.last_success_at, sources.late_after_minutes,
                sources.stale_after_minutes, sources.consecutive_failures,
                sources.last_error_code, ${lastRunIsPartialExpression("sources", false)} AS last_run_is_partial
           FROM sources WHERE sources.id = ?`,
      )
      .bind(sourceId)
      .first<SourceFailureRow>();
    if (row === null) return null;
    const lastErrorCode = sourceErrorCode(row.last_error_code);
    return {
      health: calculateSourceHealth({
        sourceId: row.id,
        checkedAt,
        lastSuccessAt: row.last_success_at,
        lateAfterMinutes: row.late_after_minutes,
        staleAfterMinutes: row.stale_after_minutes,
        consecutiveFailures: row.consecutive_failures,
        lastErrorCode,
        lastRunIsPartial: row.last_run_is_partial === 1,
      }),
      consecutiveFailures: row.consecutive_failures,
      lastErrorCode,
      lastSuccessAt: row.last_success_at,
    };
  }

  private recoveryChangeStatement(
    input: PersistCollectedRunInput,
    previous: {
      health: ReturnType<typeof calculateSourceHealth>;
      consecutiveFailures: number;
      lastErrorCode: SourceErrorCode | null;
      lastSuccessAt: string | null;
    },
  ): D1PreparedStatement {
    const ownership =
      input.expectedRetryCount === null
        ? ""
        : ` WHERE EXISTS (
              SELECT 1 FROM source_runs
               WHERE id = ? AND status = 'failed' AND retry_count = ?
                 AND retry_claim_token = ?
            )`;
    const ownershipValues =
      input.expectedRetryCount === null
        ? []
        : [input.runId, input.retryCount, input.retryClaimToken];
    return this.database
      .prepare(
        `INSERT OR IGNORE INTO changes (
           id, change_type, thesis_id, indicator_id, source_id, before_json,
           after_json, importance, detected_at, published_version_id
         ) SELECT ?, 'source_health', NULL, NULL, ?, ?, ?, 3, ?, NULL${ownership}`,
      )
      .bind(
        `source-recovery:${input.runId}`,
        input.sourceId,
        canonicalJson({
          status: previous.health.status,
          consecutiveFailures: previous.consecutiveFailures,
          lastErrorCode: previous.lastErrorCode,
        }),
        canonicalJson({ status: "healthy", consecutiveFailures: 0 }),
        input.finishedAt,
        ...ownershipValues,
      );
  }

  private async planObservations(inputs: ObservationInput[]): Promise<PlannedObservation[]> {
    const keys = new Set<string>();
    const ranges = new Map<string, { first: string; last: string }>();
    for (const input of inputs) {
      validateObservation(input);
      const key = `${input.indicatorId}\u0000${input.observedAt}`;
      if (keys.has(key)) {
        throw new SourceCollectionError("VALIDATION", "一次采集包含重复观测期");
      }
      keys.add(key);
      const range = ranges.get(input.indicatorId);
      ranges.set(input.indicatorId, {
        first: range === undefined || input.observedAt < range.first ? input.observedAt : range.first,
        last: range === undefined || input.observedAt > range.last ? input.observedAt : range.last,
      });
    }
    if (inputs.length === 0) return [];
    if (inputs.length + ranges.size + 7 > 50) {
      throw new SourceCollectionError("VALIDATION", "采集观测数量超过单次 D1 安全预算");
    }

    const latestResults = await this.database.batch<ObservationRow>(
      Array.from(ranges, ([indicatorId, range]) =>
        this.database
        .prepare(
          `SELECT id, observed_at, period_start, value_num, value_text, unit, published_at,
                  revision, quality, citation_url, metadata_json
             FROM observations
            WHERE indicator_id = ? AND observed_at >= ? AND observed_at <= ?
            ORDER BY observed_at, revision DESC`,
        )
        .bind(indicatorId, range.first, range.last)
      ),
    );

    const latestByObservation = new Map<string, ObservationRow>();
    latestResults.forEach((result, index) => {
      const indicatorId = Array.from(ranges.keys())[index];
      for (const row of result.results) {
        const key = `${indicatorId}\u0000${row.observed_at}`;
        const current = latestByObservation.get(key);
        if (current === undefined || row.revision > current.revision) {
          latestByObservation.set(key, row);
        }
      }
    });

    const planned: PlannedObservation[] = [];
    inputs.forEach((input) => {
      const latest = latestByObservation.get(`${input.indicatorId}\u0000${input.observedAt}`) ?? null;
      if (latest !== null && sameObservation(latest, input)) return;
      planned.push({
        input,
        id: this.createId(),
        supersedesId: latest?.id ?? null,
      });
    });
    return planned;
  }

  private insertObservationStatement(
    run: PersistCollectedRunInput,
    observation: PlannedObservation,
  ): D1PreparedStatement {
    const valueNum = typeof observation.input.value === "number" ? observation.input.value : null;
    const valueText = typeof observation.input.value === "string" ? observation.input.value : null;
    const columns = `INSERT INTO observations (
           id, indicator_id, observed_at, period_start, value_num, value_text,
           unit, published_at, fetched_at, revision, supersedes_id, quality,
           source_run_id, citation_url, metadata_json
         )`;
    // revision 内联子查询在同一条写入语句内求值：batch 原子性下读到的必然是本事务可见的
    // 最新 revision，消除「JS 先读 latest.revision 再写 +1」的读-改-写竞态——并发批次要么
    // 排在本批之后自然递增，要么撞 UNIQUE 整批回滚（fail-closed），不再因计划期读数过期
    // 而回滚。同一批内 (indicator_id, observed_at) 不重复（planObservations 去重），子查询
    // 不受本批前序语句影响。计划期读取此时只为 dedup（sameObservation）与 supersedes_id 服务。
    const revisionSubquery = `(
              SELECT COALESCE(MAX(revision), -1) + 1 FROM observations
               WHERE indicator_id = ? AND observed_at = ?
            )`;
    const values: unknown[] = [
        observation.id,
        observation.input.indicatorId,
        observation.input.observedAt,
        observation.input.periodStart,
        valueNum,
        valueText,
        observation.input.unit,
        observation.input.publishedAt,
        observation.input.fetchedAt,
        observation.input.indicatorId,
        observation.input.observedAt,
        observation.supersedesId,
        observation.input.quality,
        run.runId,
        observation.input.citationUrl,
        canonicalJson(observation.input.metadata),
    ];
    if (run.expectedRetryCount === null) {
      return this.database
        .prepare(`${columns} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ${revisionSubquery}, ?, ?, ?, ?, ?`)
        .bind(...values);
    }
    return this.database
      .prepare(
        `${columns}
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ${revisionSubquery}, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM source_runs
             WHERE id = ? AND status = 'failed' AND retry_count = ?
               AND retry_claim_token = ?
          )`,
      )
      .bind(...values, run.runId, run.retryCount, run.retryClaimToken);
  }

  private sourceHealthStatement(
    input: PersistCollectedRunInput,
    status: PersistedSourceRun["status"],
  ): D1PreparedStatement {
    const ownership =
      input.expectedRetryCount === null
        ? ""
        : ` AND EXISTS (
              SELECT 1 FROM source_runs owned
               WHERE owned.id = ? AND owned.status = 'failed'
                 AND owned.retry_count = ? AND owned.retry_claim_token = ?
            )`;
    const ownershipValues =
      input.expectedRetryCount === null
        ? []
        : [input.runId, input.retryCount, input.retryClaimToken];
    if (status === "partial") {
      // D4:B：partial 确实带来了数据（部分观测已落库），刷新 last_success_at 使源进入
      // degraded 派生态（读取端由「最新完结 run 为 partial」派生），不再长期误报陈旧。
      // consecutive_failures / last_error_code 保持不动：partial 不清零也不累加失败计数，
      // 后续失败按既有逻辑照常累计；next_due_at 推进与 D2 租约/重试路径语义不变。
      return this.database
        .prepare(
          `UPDATE sources
              SET last_success_at = ?, next_due_at = COALESCE(?, next_due_at), updated_at = ?
            WHERE id = ?${ownership}`,
        )
        .bind(input.finishedAt, input.nextDueAt, input.finishedAt, input.sourceId, ...ownershipValues);
    }
    return this.database
      .prepare(
        `UPDATE sources
            SET last_success_at = ?, consecutive_failures = 0, last_error_code = NULL,
                next_due_at = COALESCE(?, next_due_at), updated_at = ?
          WHERE id = ?${ownership}`,
      )
      .bind(
        input.finishedAt,
        input.nextDueAt,
        input.finishedAt,
        input.sourceId,
        ...ownershipValues,
      );
  }
}

export class R2RawSnapshotStore implements RawSnapshotStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(input: RawSnapshotInput): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.sourceId)) {
      throw new SourceCollectionError("VALIDATION", "来源标识不能用于快照路径");
    }
    if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
      throw new SourceCollectionError("VALIDATION", "原始快照缺少有效 SHA-256");
    }
    parseCanonicalUtc(input.scheduledAt, "scheduledAt");
    const fetchedAt = parseCanonicalUtc(input.fetchedAt, "fetchedAt");
    const timestamp = compactUtcTimestamp(fetchedAt);
    const [year, month, day] = fetchedAt.toISOString().slice(0, 10).split("-");
    const media = snapshotMedia(input.contentType);
    const key = `raw/${input.sourceId}/${year}/${month}/${day}/${timestamp}-${input.contentHash}.${media.extension}`;
    try {
      await this.bucket.put(key, input.body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: media.contentType },
        customMetadata: {
          sourceId: input.sourceId,
          contentHash: input.contentHash,
        },
        sha256: hexToArrayBuffer(input.contentHash),
      });
      return key;
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      // 透传 cause：R2 的真实拒绝原因（条件写冲突 / 体积 / 元数据）只在日志可见。
      throw new SourceCollectionError("STORAGE", "无法写入私有原始快照", {
        retryable: true,
        cause: error,
      });
    }
  }
}

function snapshotMedia(contentType: string | null): { contentType: string; extension: string } {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    "text/html": "html",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/csv": "csv",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/pdf": "pdf",
  };
  const extension = known[normalized];
  return extension === undefined
    ? { contentType: "application/octet-stream", extension: "bin" }
    : { contentType: normalized, extension };
}

function compactUtcTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:.]/g, "");
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function validateObservation(input: ObservationInput): void {
  parseCanonicalUtc(input.observedAt, "observedAt");
  parseCanonicalUtc(input.fetchedAt, "fetchedAt");
  if (input.periodStart !== null) parseCanonicalUtc(input.periodStart, "periodStart");
  if (input.publishedAt !== null) parseCanonicalUtc(input.publishedAt, "publishedAt");
  if (input.unit.trim() === "" || input.citationUrl.trim() === "") {
    throw new SourceCollectionError("VALIDATION", "观测缺少单位或引用地址");
  }
  // 防御纵深：适配器层的类型强转（如 `as number`）可能把 null/undefined 当数值送进来，
  // 落库会变成 value_num/value_text 双 NULL 的坏行，这里统一 fail-closed。
  if (input.value === null || input.value === undefined) {
    throw new SourceCollectionError("VALIDATION", "观测缺少数值");
  }
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    throw new SourceCollectionError("VALIDATION", "数值观测必须是有限数");
  }
}

function sameObservation(row: ObservationRow, input: ObservationInput): boolean {
  const valueMatches =
    typeof input.value === "number"
      ? row.value_num === input.value && row.value_text === null
      : row.value_text === input.value && row.value_num === null;
  return (
    valueMatches &&
    row.period_start === input.periodStart &&
    row.unit === input.unit &&
    row.published_at === input.publishedAt &&
    row.quality === input.quality &&
    row.citation_url === input.citationUrl &&
    row.metadata_json === canonicalJson(input.metadata)
  );
}

function canonicalJson(value: Record<string, string | number | boolean | null>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function toPersistedRun(row: SourceRunRow): PersistedSourceRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    snapshotKey: row.snapshot_key,
    observationsInserted: row.observations_inserted,
    observationsRevised: row.observations_revised,
    errorCode: sourceErrorCode(row.error_code),
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    recovered: false,
  };
}

function sourceErrorCode(value: string | null): SourceErrorCode | null {
  return SOURCE_ERROR_CODES.find((candidate) => candidate === value) ?? null;
}

function failedRun(input: PersistFailedRunInput): PersistedSourceRun {
  return {
    id: input.runId,
    sourceId: input.sourceId,
    scheduledAt: input.scheduledAt,
    status: "failed",
    snapshotKey: null,
    observationsInserted: 0,
    observationsRevised: 0,
    errorCode: input.errorCode,
    retryCount: input.retryCount,
    nextRetryAt: input.nextRetryAt,
    recovered: false,
  };
}

function changedRows(result: unknown): number {
  if (typeof result !== "object" || result === null || !("meta" in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== "object" || meta === null || !("changes" in meta)) return 0;
  return typeof meta.changes === "number" ? meta.changes : 0;
}

function databaseError(): SourceCollectionError {
  return new SourceCollectionError("DATABASE", "D1 无法持久化采集结果", { retryable: true });
}
