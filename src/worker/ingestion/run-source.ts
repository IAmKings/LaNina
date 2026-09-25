import type {
  CollectContext,
  IngestionRepository,
  PersistedSourceRun,
  RawSnapshotStore,
  SourceAdapter,
  SourceErrorCode,
} from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { addMinutes, parseCanonicalUtc } from "./time";

export const RETRY_DELAYS_MINUTES = [1, 5, 20] as const;
const RETRY_CLAIM_MINUTES = 30;

export interface RunSourceRequest {
  sourceId: string;
  sourceUrl: string;
  scheduledAt: string;
  nextDueAt?: string | null;
}

export interface RunSourceDependencies {
  adapter: SourceAdapter;
  repository: IngestionRepository;
  snapshots: RawSnapshotStore;
  fetch: CollectContext["fetch"];
  now?: () => string;
  createId?: () => string;
}

export interface RunSourceOutcome {
  collectionStatus:
    | "changed"
    | "unchanged"
    | "partial"
    | "failed"
    | "already_processed"
    | "retry_not_due";
  run: PersistedSourceRun;
}

export async function runSourceIngestion(
  request: RunSourceRequest,
  dependencies: RunSourceDependencies,
): Promise<RunSourceOutcome> {
  parseCanonicalUtc(request.scheduledAt, "scheduledAt");
  if (request.nextDueAt !== undefined && request.nextDueAt !== null) {
    parseCanonicalUtc(request.nextDueAt, "nextDueAt");
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const existing = await dependencies.repository.findRun(request.sourceId, request.scheduledAt);
  const attemptStartedAt = now();
  parseCanonicalUtc(attemptStartedAt, "startedAt");
  if (existing !== null && existing.status !== "failed") {
    return { collectionStatus: "already_processed", run: existing };
  }
  if (existing !== null) {
    if (existing.nextRetryAt === null || existing.retryCount >= RETRY_DELAYS_MINUTES.length) {
      return { collectionStatus: "already_processed", run: existing };
    }
    if (parseCanonicalUtc(existing.nextRetryAt, "nextRetryAt") > parseCanonicalUtc(attemptStartedAt, "startedAt")) {
      return { collectionStatus: "retry_not_due", run: existing };
    }
  }

  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const runId = existing?.id ?? createId();
  const retryCount = existing === null ? 0 : existing.retryCount + 1;
  const expectedRetryCount = existing?.retryCount ?? null;
  const retryClaimToken = existing === null ? null : createId();
  if (existing !== null && retryClaimToken !== null) {
    const claimed = await dependencies.repository.claimRetryAttempt(
      request.sourceId,
      request.scheduledAt,
      existing.retryCount,
      retryClaimToken,
      attemptStartedAt,
      addMinutes(attemptStartedAt, RETRY_CLAIM_MINUTES),
    );
    if (!claimed) {
      const current = await dependencies.repository.findRun(request.sourceId, request.scheduledAt);
      return {
        collectionStatus: "already_processed",
        run: current ?? existing,
      };
    }
  }

  try {
    const cursor = await dependencies.repository.findSourceCursor(request.sourceId);
    const fetchedAt = now();
    const result = await dependencies.adapter.collect({
      ...request,
      fetchedAt,
      previousEtag: cursor.etag,
      previousLastModified: cursor.lastModified,
      previousContentHash: cursor.contentHash,
      fetch: dependencies.fetch,
    });

    if (result.sourceId !== request.sourceId) {
      throw new SourceCollectionError("VALIDATION", "采集结果的来源标识不匹配");
    }

    let snapshotKey: string | null = null;
    if (result.status !== "unchanged") {
      if (result.rawBody === null || result.contentHash === null) {
        throw new SourceCollectionError("VALIDATION", "变化的采集结果缺少原始正文或内容哈希");
      }
      snapshotKey = await putSnapshot(dependencies.snapshots, {
        sourceId: request.sourceId,
        scheduledAt: request.scheduledAt,
        fetchedAt: result.fetchedAt,
        contentHash: result.contentHash,
        contentType: result.contentType,
        body: result.rawBody,
      });
    }

    const run = await dependencies.repository.persistCollected({
      runId,
      sourceId: request.sourceId,
      scheduledAt: request.scheduledAt,
      startedAt: attemptStartedAt,
      finishedAt: now(),
      result,
      snapshotKey,
      retryCount,
      expectedRetryCount,
      retryClaimToken,
      nextDueAt: request.nextDueAt ?? null,
    });
    return { collectionStatus: result.status, run };
  } catch (error) {
    const failure = normalizedFailure(error);
    const finishedAt = now();
    parseCanonicalUtc(finishedAt, "finishedAt");
    const nextRetryAt =
      failure.retryable && retryCount < RETRY_DELAYS_MINUTES.length
        ? addMinutes(finishedAt, RETRY_DELAYS_MINUTES[retryCount])
        : null;
    const run = await dependencies.repository.persistFailed({
      runId,
      sourceId: request.sourceId,
      scheduledAt: request.scheduledAt,
      startedAt: attemptStartedAt,
      finishedAt,
      ...failure,
      retryCount,
      expectedRetryCount,
      retryClaimToken,
      nextRetryAt,
      nextDueAt: request.nextDueAt ?? null,
    });
    return {
      collectionStatus: run.id === runId && run.status === "failed" ? "failed" : "already_processed",
      run,
    };
  }
}

async function putSnapshot(
  snapshots: RawSnapshotStore,
  input: Parameters<RawSnapshotStore["put"]>[0],
): Promise<string> {
  try {
    return await snapshots.put(input);
  } catch (error) {
    if (error instanceof SourceCollectionError) throw error;
    // 透传 cause：R2 的具体拒绝原因（条件写冲突、体积、元数据）只在日志里可见。
    throw new SourceCollectionError("STORAGE", "无法保存来源原始快照", { retryable: true, cause: error });
  }
}

function normalizedFailure(error: unknown): {
  errorCode: SourceErrorCode;
  errorMessage: string;
  httpStatus: number | null;
  retryable: boolean;
} {
  if (error instanceof SourceCollectionError) {
    logFailureDiagnostic(error);
    return {
      errorCode: error.code,
      errorMessage: SAFE_FAILURE_MESSAGES[error.code],
      httpStatus: error.httpStatus,
      retryable: error.retryable && error.code !== "SCHEMA_DRIFT",
    };
  }
  return {
    errorCode: "VALIDATION",
    errorMessage: "采集运行出现未分类错误",
    httpStatus: null,
    retryable: false,
  };
}


/**
 * 失败诊断只进 Workers Logs，绝不写入 D1：`source_runs.error_message` 保持既定的
 * 安全文案契约（不得落原始异常文本，避免上游响应或凭据片段持久化）。
 */
function logFailureDiagnostic(error: SourceCollectionError): void {
  // 逐层展开 cause 链（workerd 的 fetch 失败通常是 TypeError: fetch failed，真正原因在其下一层）。
  const chain: string[] = [];
  let current: unknown = error.cause;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    chain.push(`${current.name}: ${current.message}`);
    current = current.cause;
  }
  const detail = [error.message, ...chain]
    .filter((part) => part.length > 0)
    .join(" ← ")
    .replace(/\?[^\s]*/g, "?<redacted>")
    .replace(/(api[_-]?key|key|token|secret|client_?secret)=[^&\s]*/gi, "$1=<redacted>")
    .slice(0, 200);
  console.log(JSON.stringify({
    scope: "ingestion.failure",
    errorCode: error.code,
    httpStatus: error.httpStatus,
    detail,
  }));
}

const SAFE_FAILURE_MESSAGES: Record<SourceErrorCode, string> = {
  NETWORK: "来源网络请求失败",
  RATE_LIMIT: "来源请求受到速率限制",
  AUTH: "来源拒绝访问",
  NOT_FOUND: "来源地址不存在",
  SCHEMA_DRIFT: "来源结构发生变化",
  VALIDATION: "来源数据未通过校验",
  STORAGE: "来源快照保存失败",
  DATABASE: "采集结果持久化失败",
};
