import { describe, expect, it, vi } from "vitest";

import type { EdgeCache, RequestHandlerDependencies } from "./context";
import type { DataHealthPageModel, OverviewPageModel } from "../domain/page-models";
import { handleRequest, type Env } from "./index";

/**
 * R4 边缘缓存：仅无查询参数的 `GET /api/v1/overview` 与 `GET /api/v1/data-health` 走
 * `caches.default`。生产默认解析到运行时 caches.default；单测经 dependencies.edgeCache
 * 注入假 cache，默认 no-op 保证既有表征测试行为不变。
 */

const REQUEST_ENV = {
  APP_ENV: "local",
  APP_VERSION: "0.1.0-test",
  ENABLE_CRON: "true",
  ENABLE_AUTO_PUBLICATION: "false",
} as Env;

const OVERVIEW_URL = "https://example.test/api/v1/overview";
const DATA_HEALTH_URL = "https://example.test/api/v1/data-health";

const overviewModel = {
  methodologyVersion: "methodology-v1",
  dailyBrief: null,
} as unknown as OverviewPageModel;

const dataHealthModel = {
  generatedAt: "2026-09-26T00:00:00.000Z",
} as unknown as DataHealthPageModel;

function fakeEdgeCache(seed?: Map<string, Response>) {
  const store = seed ?? new Map<string, Response>();
  const match = vi.fn(async (request: Request) => store.get(request.url));
  const put = vi.fn(async (request: Request, response: Response) => {
    store.set(request.url, response);
  });
  const cache: EdgeCache = { match, put };
  return { cache, store, match, put };
}

function fakeExecutionContext() {
  return { waitUntil: vi.fn() };
}

function dependenciesWith(cache: EdgeCache, overrides: RequestHandlerDependencies = {}): RequestHandlerDependencies {
  return {
    overview: vi.fn(async () => overviewModel),
    dataHealth: vi.fn(async () => dataHealthModel),
    theses: vi.fn(async () => []),
    edgeCache: cache,
    ...overrides,
  };
}

describe("worker edge cache", () => {
  it("serves a seeded overview from the edge cache with X-ENSO-Cache: hit and without running the loader", async () => {
    const edge = fakeEdgeCache(new Map([[OVERVIEW_URL, new Response('{"cached":true}', {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    })]]));
    const overview = vi.fn();
    const ctx = fakeExecutionContext();

    const response = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependenciesWith(edge.cache, { overview }), ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-enso-cache")).toBe("hit");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(await response.text()).toBe('{"cached":true}');
    expect(overview).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    // 命中响应同样穿过 withSecurityHeaders（与未命中路径同一条 handleRequest 出口）。
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("runs the loader and stores the 200 response via waitUntil on a miss, then serves the next request from cache", async () => {
    const edge = fakeEdgeCache();
    const overview = vi.fn(async () => overviewModel);
    const dependencies = dependenciesWith(edge.cache, { overview });
    const ctx = fakeExecutionContext();

    const first = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependencies, ctx);

    expect(first.status).toBe(200);
    // 未命中（首过）响应不带 X-ENSO-Cache 头。
    expect(first.headers.get("x-enso-cache")).toBeNull();
    expect(first.headers.get("x-frame-options")).toBe("DENY");

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    expect(edge.put).toHaveBeenCalledOnce();
    expect(edge.put.mock.calls[0][0].url).toBe(OVERVIEW_URL);
    expect(edge.put.mock.calls[0][1].status).toBe(200);

    // waitUntil 里的 put 完成后，第二个请求应命中缓存且不再执行 loader。
    await ctx.waitUntil.mock.calls[0][0];
    const second = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependencies, fakeExecutionContext());
    expect(second.headers.get("x-enso-cache")).toBe("hit");
    expect(overview).toHaveBeenCalledOnce();
    expect(await second.clone().text()).toBe(await first.clone().text());
  });

  it("serves data-health from the edge cache under the same semantics", async () => {
    const edge = fakeEdgeCache(new Map([[DATA_HEALTH_URL, new Response('{"health":true}', { status: 200 })]]));
    const dataHealth = vi.fn();

    const response = await handleRequest(new Request(DATA_HEALTH_URL), REQUEST_ENV, dependenciesWith(edge.cache, { dataHealth }), fakeExecutionContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-enso-cache")).toBe("hit");
    expect(await response.text()).toBe('{"health":true}');
    expect(dataHealth).not.toHaveBeenCalled();
  });

  it("does not cache a non-200 overview response", async () => {
    const edge = fakeEdgeCache();
    const overview = vi.fn(async () => {
      throw new Error("synthetic database outage");
    });

    const response = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependenciesWith(edge.cache, { overview }), fakeExecutionContext());

    expect(response.status).toBe(503);
    expect(edge.put).not.toHaveBeenCalled();
    expect(edge.store.size).toBe(0);
  });

  it("does not consult or populate the cache when the request carries query parameters", async () => {
    const edge = fakeEdgeCache();
    const ctx = fakeExecutionContext();

    const response = await handleRequest(new Request(`${OVERVIEW_URL}?trace=1`), REQUEST_ENV, dependenciesWith(edge.cache), ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-enso-cache")).toBeNull();
    expect(edge.match).not.toHaveBeenCalled();
    expect(edge.put).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it.each([
    "/api/admin/runs",
    "/api/v1/theses",
    "/api/v1/healthz",
    "/feed.xml",
    "/sitemap.xml",
    "/robots.txt",
  ])("does not cache %s", async (path) => {
    const edge = fakeEdgeCache();

    await handleRequest(new Request(`https://example.test${path}`), REQUEST_ENV, dependenciesWith(edge.cache), fakeExecutionContext());

    expect(edge.match).not.toHaveBeenCalled();
    expect(edge.put).not.toHaveBeenCalled();
    expect(edge.store.size).toBe(0);
  });

  it("skips the put safely when no execution context is passed (direct test invocation)", async () => {
    const edge = fakeEdgeCache();
    const overview = vi.fn(async () => overviewModel);

    const response = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependenciesWith(edge.cache, { overview }));

    expect(response.status).toBe(200);
    expect(overview).toHaveBeenCalledOnce();
    expect(edge.put).not.toHaveBeenCalled();
    expect(response.headers.get("x-enso-cache")).toBeNull();
  });

  it("gives HEAD the same cache semantics as GET (warms on miss, hits with the marker header)", async () => {
    const edge = fakeEdgeCache();
    const ctx = fakeExecutionContext();

    const headMiss = await handleRequest(new Request(OVERVIEW_URL, { method: "HEAD" }), REQUEST_ENV, dependenciesWith(edge.cache), ctx);
    expect(headMiss.status).toBe(200);
    expect(headMiss.headers.get("x-enso-cache")).toBeNull();
    expect(edge.put).toHaveBeenCalledOnce();
    await ctx.waitUntil.mock.calls[0][0];

    const headHit = await handleRequest(new Request(OVERVIEW_URL, { method: "HEAD" }), REQUEST_ENV, dependenciesWith(edge.cache), fakeExecutionContext());
    expect(headHit.headers.get("x-enso-cache")).toBe("hit");
    expect(await headHit.text()).toBe("");

    const getHit = await handleRequest(new Request(OVERVIEW_URL), REQUEST_ENV, dependenciesWith(edge.cache), fakeExecutionContext());
    expect(getHit.headers.get("x-enso-cache")).toBe("hit");
    expect(await getHit.text()).not.toBe("");
  });
});
