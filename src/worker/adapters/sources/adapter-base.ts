import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import {
  errorForResponse,
  fetchWithinTimeout,
  readBodyWithinLimit,
  sha256Hex,
} from "./http";

/**
 * 单请求来源适配器的公共基座。noaa/eia/usda/world-bank 四个适配器的
 * fetch→304→媒体类型→有界读→解码→回显检查→哈希→unchanged→解析流水线
 * 完全同构（原先五份 unchangedResult、三份 decodeUtf8 逐字重复），这里收敛为
 * 一个 `createHttpSourceAdapter`；适配器只保留自己的允许列表校验、请求 URL
 * 推导与解析逻辑。
 *
 * 行为不变约束：错误类别/retryable、304 元数据回填、哈希分支的 etag 口径、
 * 正文与观测的逐字节输出都由既有契约测试守护（断言零修改）。
 */

/** 与 nasa/eia/usda/noaa/jpx 一致：非 UTF-8 字节按 SCHEMA_DRIFT fail-closed，不做有损替换。 */
export function decodeUtf8(bytes: Uint8Array, driftMessage: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SourceCollectionError("SCHEMA_DRIFT", driftMessage);
  }
}

export interface UnchangedMetadata {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentType: string | null;
  readonly contentHash: string | null;
}

/**
 * 全部适配器共同的 unchanged 收口：不落观测、不留正文，仅回指既有游标哈希。
 * （原先在 noaa/eia/usda/world-bank/nasa/jpx 各有一份逐字或近逐字副本。）
 */
export function unchangedResult(
  context: CollectContext,
  metadata: UnchangedMetadata,
): CollectResult {
  return {
    sourceId: context.sourceId,
    fetchedAt: context.fetchedAt,
    sourcePublishedAt: null,
    etag: metadata.etag,
    lastModified: metadata.lastModified,
    contentType: metadata.contentType,
    contentHash: metadata.contentHash,
    rawBody: null,
    observations: [],
    warnings: [],
    status: "unchanged",
  };
}

/** 归一化 Content-Type：取分号前的媒体类型并小写（无头时 null）。 */
export function mediaTypeOf(contentType: string | null): string | null {
  return contentType?.split(";", 1)[0].trim().toLowerCase() ?? null;
}

export type MediaTypePolicy =
  /** 归一化媒体类型必须精确等于（eia/usda 的 JSON 契约）。 */
  | { readonly kind: "equals"; readonly value: string; readonly driftMessage: string }
  /** 头必须存在且包含子串（大小写不敏感）（noaa 的 text/html 契约）。 */
  | { readonly kind: "includes"; readonly value: string; readonly driftMessage: string }
  /** 头包含子串即漂移，缺失放行（world-bank 对整页移动的防御）。 */
  | { readonly kind: "excludes"; readonly value: string; readonly driftMessage: string };

function enforceMediaType(policy: MediaTypePolicy, contentType: string | null): void {
  switch (policy.kind) {
    case "equals":
      if (mediaTypeOf(contentType) !== policy.value) {
        throw new SourceCollectionError("SCHEMA_DRIFT", policy.driftMessage);
      }
      return;
    case "includes":
      if (contentType === null || !contentType.toLowerCase().includes(policy.value)) {
        throw new SourceCollectionError("SCHEMA_DRIFT", policy.driftMessage);
      }
      return;
    case "excludes":
      if (contentType !== null && contentType.includes(policy.value)) {
        throw new SourceCollectionError("SCHEMA_DRIFT", policy.driftMessage);
      }
      return;
  }
}

/** prepare 钩子的产物：请求目标（允许列表内）与额外头（如 X-Api-Key）。 */
export interface HttpSourceRequestPlan {
  readonly url: string | URL;
  readonly headers?: Record<string, string>;
}

/** parse 钩子的产物；warnings/status 缺省为 []/"changed"。 */
export interface SourceParseOutcome {
  readonly observations: readonly ObservationInput[];
  readonly warnings?: readonly string[];
  readonly status?: "changed" | "partial";
}

/** 正文形态：utf8 → 基座 fatal UTF-8 解码；bytes → 原始字节直交 parse（如 xlsx）。 */
export type HttpBodyPolicy =
  | { readonly kind: "utf8"; readonly driftMessage: string }
  | { readonly kind: "bytes" };

export interface HttpSourceAdapterConfig<TBody = string> {
  /** registry 适配器键。 */
  readonly key: string;
  /** 来源显示名：默认网络错误文案 `无法连接 {sourceKey}` 使用。 */
  readonly sourceKey: string;
  /** 响应字节上限（readBodyWithinLimit）。 */
  readonly maxBytes: number;
  /** 抓取时限；缺省沿用 http.ts 的 DEFAULT_FETCH_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** Accept 头值。 */
  readonly accept: string;
  /** 条件请求头策略；缺省 etag+last-modified（world-bank 仅 last-modified）。 */
  readonly conditional?: "etag-and-last-modified" | "last-modified-only";
  /** 重定向语义（noaa/world-bank follow，eia/usda manual）。 */
  readonly redirect: RequestRedirect;
  /** 媒体类型契约与漂移文案。 */
  readonly mediaType: MediaTypePolicy;
  /** 正文形态（决定基座是否做 fatal UTF-8 解码）。 */
  readonly body: HttpBodyPolicy;
  /** 允许列表校验 + 请求 URL 推导（+ 额外头）。在一切 fetch 之前执行。 */
  prepare(context: CollectContext): HttpSourceRequestPlan;
  /** 可选：正文含密钥即 SCHEMA_DRIFT（eia/usda 的 apiKey 回显检查，仅 utf8 正文有意义）。 */
  readonly secret?: { readonly value: string; readonly driftMessage: string };
  /** 网络失败归类；缺省 `无法连接 {sourceKey}` + cause，retryable。 */
  readonly networkError?: (error: unknown) => SourceCollectionError;
  /** 内容哈希；缺省对原始字节做 sha256。 */
  readonly hash?: (rawBody: Uint8Array) => string | Promise<string>;
  /** 解析正文为观测（基座随后组装 changed/partial 结果）。 */
  parse(body: TBody, context: CollectContext): SourceParseOutcome | Promise<SourceParseOutcome>;
}

export function createHttpSourceAdapter<TBody = string>(
  config: HttpSourceAdapterConfig<TBody>,
): SourceAdapter {
  const conditionalEtag = (config.conditional ?? "etag-and-last-modified") === "etag-and-last-modified";
  const networkError =
    config.networkError ??
    ((error: unknown) =>
      new SourceCollectionError("NETWORK", `无法连接 ${config.sourceKey}`, {
        retryable: true,
        cause: error,
      }));
  const hash = config.hash ?? sha256Hex;

  return {
    key: config.key,

    async collect(context: CollectContext): Promise<CollectResult> {
      const plan = config.prepare(context);
      const headers = new Headers({ Accept: config.accept, ...plan.headers });
      if (conditionalEtag && context.previousEtag !== null) {
        headers.set("If-None-Match", context.previousEtag);
      }
      if (context.previousLastModified !== null) {
        headers.set("If-Modified-Since", context.previousLastModified);
      }

      let response: Response;
      try {
        response = await fetchWithinTimeout(
          context.fetch,
          plan.url,
          { headers, redirect: config.redirect },
          { timeoutMs: config.timeoutMs },
        );
      } catch (error) {
        throw networkError(error);
      }

      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      const contentType = response.headers.get("content-type");

      // 上游缓存语义下的 304（含未发条件请求却被返回 304 的防御分支）一律视为
      // unchanged：复用既有游标哈希，不写快照、不落观测。
      if (response.status === 304) {
        return unchangedResult(context, {
          etag: conditionalEtag ? etag ?? context.previousEtag : null,
          lastModified: lastModified ?? context.previousLastModified,
          contentType,
          contentHash: context.previousContentHash,
        });
      }
      if (!response.ok) throw errorForResponse(response);
      enforceMediaType(config.mediaType, contentType);

      const rawBody = await readBodyWithinLimit(response, config.maxBytes);
      const body = decodeBody<TBody>(config.body, rawBody);
      if (
        config.secret !== undefined &&
        config.secret.value.length > 0 &&
        typeof body === "string" &&
        body.includes(config.secret.value)
      ) {
        throw new SourceCollectionError("SCHEMA_DRIFT", config.secret.driftMessage);
      }

      const contentHash = await hash(rawBody);
      if (contentHash === context.previousContentHash) {
        return unchangedResult(context, {
          etag: conditionalEtag ? etag : null,
          lastModified,
          contentType,
          contentHash,
        });
      }

      const outcome = await config.parse(body, context);
      return {
        sourceId: context.sourceId,
        fetchedAt: context.fetchedAt,
        sourcePublishedAt: null,
        etag: conditionalEtag ? etag : null,
        lastModified,
        contentType,
        contentHash,
        rawBody,
        observations: [...outcome.observations],
        warnings: [...(outcome.warnings ?? [])],
        status: outcome.status ?? "changed",
      };
    },
  };
}

function decodeBody<TBody>(policy: HttpBodyPolicy, rawBody: Uint8Array): TBody {
  if (policy.kind === "bytes") return rawBody as TBody;
  return decodeUtf8(rawBody, policy.driftMessage) as TBody;
}
