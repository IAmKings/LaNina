import type { AppEnvironment } from "../domain/contracts";
import { AppContext, type RequestHandlerDependencies } from "./context";
import { edgeCacheLookup, edgeCacheStore, type FetchWaitUntilContext } from "./edge-cache";
import { json, methodNotAllowedResponse, notFoundResponse } from "./http/envelope";
import { createWorkerRouter } from "./routes";
import { withSecurityHeaders } from "./security-headers";
import { handleScheduled } from "./scheduled";

export interface Env {
  DB: D1Database;
  RAW: R2Bucket;
  APP_ENV: AppEnvironment;
  APP_VERSION: string;
  ENABLE_CRON: string;
  ENABLE_AUTO_PUBLICATION: string;
  USDA_FAS_API_KEY?: string;
  EIA_API_KEY?: string;
  CENSUS_API_KEY?: string;
  UNCTAD_CLIENT_ID?: string;
  UNCTAD_API_KEY?: string;
  ACCESS_JWT_ISSUER?: string;
  ACCESS_JWT_AUDIENCE?: string;
  ACCESS_JWKS_URL?: string;
  ACCESS_EMAIL_ROLE_MAP?: string;
  ACCESS_GROUP_ROLE_MAP?: string;
}

export const QUARTER_HOURLY_CRON = "*/15 * * * *";
export const HOURLY_CRON = "17 * * * *";
export const EVALUATION_CRON = "30 22 * * *";
export const PUBLICATION_CRON = "0 23 * * *";

/** 路由表在模块加载时编译一次；worker isolate 内复用同一份编译产物。 */
const router = createWorkerRouter();

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: RequestHandlerDependencies = {},
  executionContext?: FetchWaitUntilContext,
): Promise<Response> {
  if (request.method !== "HEAD") {
    return withSecurityHeaders(await dispatchRequest(request, env, dependencies, executionContext));
  }
  // HEAD 归一为 GET 走完整路由后剥 body：只影响 run_worker_first 交给 Worker 的路径
  // （/api/*、/feed.xml、/sitemap.xml、/robots.txt）；页面路径由 assets 层处理，不经此处。
  // 响应头（含 security headers、缓存语义与 X-ENSO-Cache 命中标记）与 GET 完全一致，仅 body 为空。
  const response = await dispatchRequest(
    new Request(request.url, { method: "GET", headers: request.headers }),
    env,
    dependencies,
    executionContext,
  );
  return withSecurityHeaders(new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }));
}

async function dispatchRequest(
  request: Request,
  env: Env,
  dependencies: RequestHandlerDependencies,
  executionContext?: FetchWaitUntilContext,
): Promise<Response> {
  const url = new URL(request.url);
  // 边缘缓存缝：仅无参数的 GET /api/v1/overview 与 /api/v1/data-health 进入（判定与头语义见 edge-cache.ts）。
  const cached = await edgeCacheLookup(request, url, dependencies);
  if (cached !== null) return cached;
  const response = await routeRequest(request, env, dependencies, url);
  edgeCacheStore(request, url, response, dependencies, executionContext);
  return response;
}

async function routeRequest(
  request: Request,
  env: Env,
  dependencies: RequestHandlerDependencies,
  url: URL,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const match = router.match(request.method, url.pathname);
  if (match === null) return notFoundResponse(requestId);
  if (match.kind === "method-not-allowed") return methodNotAllowedResponse(match.allow);
  return match.handler(request, {
    request,
    url,
    requestId,
    params: match.params,
    env,
    app: AppContext.from(env),
    dependencies,
    nowIso: () => (dependencies.now ?? (() => new Date()))().toISOString(),
  });
}

const worker = {
  // request 显式标注为宽泛的 Request：ExportedHandler 上下文推导出的是带 IncomingRequestCfProperties
  // 的窄类型，会让测试里普通的 new Request(...) 不兼容；宽类型在 satisfies 下依然保证部署形状。
  // ctx 同理只取 waitUntil 的最小结构面（FetchWaitUntilContext），完整 ExecutionContext 可结构化赋给它。
  async fetch(request: Request, env: Env, ctx?: FetchWaitUntilContext) {
    try {
      return await handleRequest(request, env, {}, ctx);
    } catch (error) {
      return escapedRequestResponse(request, error);
    }
  },
  scheduled(controller, env, context) {
    const completion = handleScheduled(controller, env).then(() => undefined);
    context.waitUntil(completion);
    return completion;
  },
} satisfies ExportedHandler<Env>;

export default worker;

/**
 * 顶层兜底：路由层各自 catch 之后仍逃逸的异常在这里转成统一 500 JSON envelope。
 * 响应体不含异常细节（公共响应与内部诊断日志分离，细节只进日志）；requestId 在此
 * 重新生成，因为路由内部生成的 requestId 只存在于它自己产出的响应里，逃逸时拿不到。
 * 导出仅为测试可直接断言 envelope 形状。
 */
export function escapedRequestResponse(request: Request, error: unknown): Response {
  console.error(JSON.stringify({
    handler: "worker.fetch",
    path: new URL(request.url).pathname,
    error: String(error),
  }));
  return json({
    error: {
      code: "INTERNAL",
      message: "服务暂时不可用，请稍后重试",
      requestId: crypto.randomUUID(),
    },
  }, 500);
}

export { handleScheduled } from "./scheduled";
export type { ScheduledHandlerDependencies, ScheduledHandlerOutcome } from "./scheduled";
export type { RequestHandlerDependencies };
