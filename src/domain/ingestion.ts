export const SOURCE_ERROR_CODES = [
  "NETWORK",
  "RATE_LIMIT",
  "AUTH",
  "NOT_FOUND",
  "SCHEMA_DRIFT",
  "VALIDATION",
  "STORAGE",
  "DATABASE",
] as const;

export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];
export type CollectionStatus = "changed" | "unchanged" | "partial";
export type ObservationQuality = "verified" | "provisional" | "estimated" | "manual" | "invalid";

export interface ObservationInput {
  indicatorId: string;
  observedAt: string;
  periodStart: string | null;
  value: number | string;
  unit: string;
  publishedAt: string | null;
  fetchedAt: string;
  quality: ObservationQuality;
  citationUrl: string;
  metadata: Record<string, string | number | boolean | null>;
}

export type FetchDependency = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CollectContext {
  sourceId: string;
  sourceUrl: string;
  scheduledAt: string;
  fetchedAt: string;
  previousEtag: string | null;
  previousLastModified: string | null;
  previousContentHash: string | null;
  fetch: FetchDependency;
}

export interface CollectResult {
  sourceId: string;
  fetchedAt: string;
  sourcePublishedAt: string | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentHash: string | null;
  rawBody: Uint8Array | null;
  observations: ObservationInput[];
  warnings: string[];
  status: CollectionStatus;
}

export interface SourceAdapter {
  readonly key: string;
  collect(context: CollectContext): Promise<CollectResult>;
}

export type PersistedRunStatus = "success" | "unchanged" | "partial" | "failed";
/**
 * degraded（D4:B，2026-09-26）：partial 采集的独立健康态——数据确实在到达
 * （last_success_at 被刷新），但最近一次完结采集覆盖不足/部分成功。介于 healthy 与
 * stale 之间，与「真没数据」的 delayed/stale 区分。
 */
export type SourceHealthStatus = "healthy" | "delayed" | "degraded" | "stale" | "broken";
export type DispatchKind = "retry" | "scheduled";
export type DispatchGroup = "quarter_hourly" | "hourly";

export interface SourceCursor {
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
}

export interface PersistedSourceRun {
  id: string;
  sourceId: string;
  scheduledAt: string;
  status: PersistedRunStatus;
  snapshotKey: string | null;
  observationsInserted: number;
  observationsRevised: number;
  errorCode: SourceErrorCode | null;
  retryCount: number;
  nextRetryAt: string | null;
  recovered: boolean;
}

export interface PersistCollectedRunInput {
  runId: string;
  sourceId: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string;
  result: CollectResult;
  snapshotKey: string | null;
  retryCount: number;
  expectedRetryCount: number | null;
  retryClaimToken: string | null;
  nextDueAt: string | null;
}

export interface PersistFailedRunInput {
  runId: string;
  sourceId: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string;
  errorCode: SourceErrorCode;
  errorMessage: string;
  httpStatus: number | null;
  retryable: boolean;
  retryCount: number;
  expectedRetryCount: number | null;
  retryClaimToken: string | null;
  nextRetryAt: string | null;
  nextDueAt: string | null;
}

export interface IngestionRepository {
  findRun(sourceId: string, scheduledAt: string): Promise<PersistedSourceRun | null>;
  /**
   * 首采租约：以一条原子 INSERT 在外部抓取前占用 (source_id, scheduled_at) 槽位，
   * 依赖 UNIQUE 约束使并发/重放的第二个调用返回 false（视为他人已领取）。占位行
   * 以 'failed' 状态 + 租约令牌落库（status CHECK 不允许自定义状态），其后完成走
   * 既有 guarded 更新路径；领取成功到完成之间其它调用被令牌挡住，worker 崩溃时
   * 由 retry_claim_expires_at 过期后的重试路径接管（自愈）。
   */
  claimScheduledRun(
    sourceId: string,
    scheduledAt: string,
    runId: string,
    claimToken: string,
    claimedAt: string,
    claimExpiresAt: string,
  ): Promise<boolean>;
  claimRetryAttempt(
    sourceId: string,
    scheduledAt: string,
    expectedRetryCount: number,
    claimToken: string,
    claimedAt: string,
    claimExpiresAt: string,
  ): Promise<boolean>;
  findSourceCursor(sourceId: string): Promise<SourceCursor>;
  persistCollected(input: PersistCollectedRunInput): Promise<PersistedSourceRun>;
  persistFailed(input: PersistFailedRunInput): Promise<PersistedSourceRun>;
}

export interface RawSnapshotInput {
  sourceId: string;
  scheduledAt: string;
  fetchedAt: string;
  contentHash: string;
  contentType: string | null;
  body: Uint8Array;
}

export interface RawSnapshotStore {
  put(input: RawSnapshotInput): Promise<string>;
}

export interface DispatchCandidate {
  kind: DispatchKind;
  sourceId: string;
  sourceUrl: string;
  adapterKey: string;
  scheduledAt: string;
  cadenceMinutes: number;
  retryCount: number;
}

export interface SourceScheduleRepository {
  listDispatchCandidates(
    cutoff: string,
    limit: number,
    group: DispatchGroup,
  ): Promise<DispatchCandidate[]>;
}

export interface SourceHealthInput {
  sourceId: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  lateAfterMinutes: number;
  staleAfterMinutes: number;
  consecutiveFailures: number;
  lastErrorCode: SourceErrorCode | null;
}

export interface SourceHealth {
  sourceId: string;
  status: SourceHealthStatus;
  checkedAt: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface SourceHealthRepository {
  getSourceHealth(sourceId: string, checkedAt: string): Promise<SourceHealth | null>;
}

export class SourceCollectionError extends Error {
  readonly code: SourceErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(
    code: SourceErrorCode,
    message: string,
    options: { retryable?: boolean; httpStatus?: number | null; cause?: unknown } = {},
  ) {
    // `cause` 只用于诊断日志（run-source.ts 的 logFailureDiagnostic），不进入持久层。
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SourceCollectionError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
  }
}
