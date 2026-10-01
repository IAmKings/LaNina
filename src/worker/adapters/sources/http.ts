import type { FetchDependency } from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";

/** 外部抓取的默认时限：来源无响应时不得占住 dispatch 名额。 */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface FetchTimeoutOptions {
  readonly timeoutMs?: number;
}

/**
 * 外部抓取统一走此封装：到时限后把等待归类为可重试的 NETWORK 错误（与
 * `errorForResponse` 的 408/5xx 语义一致），由适配器既有的 catch 收口。
 *
 * 双保险设计：
 * - `AbortSignal.timeout(timeoutMs)` 负责真正中断底层连接（真实网络路径）；
 * - 追加一个 `setTimeout` 竞速，保证即使底层实现忽略 abort 信号（例如测试替身、
 *   或实现未及时响应），调用方也在时限内得到确定性的失败。
 */
export async function fetchWithinTimeout(
  fetch: FetchDependency,
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = init?.signal;
  const signal = callerSignal === undefined || callerSignal === null
    ? timeoutSignal
    : AbortSignal.any([callerSignal, timeoutSignal]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SourceCollectionError("NETWORK", "来源请求超时", { retryable: true }));
    }, timeoutMs);
  });

  try {
    const request = fetch(input, { ...init, signal });
    // 竞速先到 deadline 时，底层后续的 rejection 不得变成 unhandled。
    void request.catch(() => {});
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error instanceof SourceCollectionError) throw error;
    if (timeoutSignal.aborted || isTimeoutRejection(error)) {
      throw new SourceCollectionError("NETWORK", "来源请求超时", { retryable: true, cause: error });
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isTimeoutRejection(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new SourceCollectionError("VALIDATION", "来源响应超过允许大小");
  }

  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new SourceCollectionError("VALIDATION", "来源响应超过允许大小");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function sha256Hex(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(body).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function errorForResponse(response: Response): SourceCollectionError {
  const options = { httpStatus: response.status };
  if (response.status === 408) {
    return new SourceCollectionError("NETWORK", "来源请求超时", {
      ...options,
      retryable: true,
    });
  }
  if (response.status === 429) {
    return new SourceCollectionError("RATE_LIMIT", "来源请求受到速率限制", {
      ...options,
      retryable: true,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new SourceCollectionError("AUTH", "来源拒绝访问", options);
  }
  if (response.status === 404) {
    return new SourceCollectionError("NOT_FOUND", "来源地址不存在", options);
  }
  if (response.status >= 500) {
    return new SourceCollectionError("NETWORK", "来源服务暂时不可用", {
      ...options,
      retryable: true,
    });
  }
  return new SourceCollectionError("VALIDATION", "来源返回不可接受的 HTTP 状态", options);
}

/**
 * 子请求缓存旁路（时效敏感观测来源统一使用）：显式要求 Cloudflare 边缘不做缓存。
 * 2026-09-29 实测 NOAA RONI 页在子请求路径被边缘缓存约 7 个月；注意不可与
 * cache: "no-store" 组合（workerd 拒绝该组合）。
 */
export const SOURCE_FETCH_CACHE_BYPASS = {
  cf: { cacheTtl: 0, cacheEverything: false },
} as const;
