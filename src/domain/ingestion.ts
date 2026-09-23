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
export type SourceHealthStatus = "healthy" | "delayed" | "stale" | "broken";
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
    options: { retryable?: boolean; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = "SourceCollectionError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
  }
}
