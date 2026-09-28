import { describe, expect, it } from "vitest";

import { AppContext } from "./context";
import { compileRoutePattern, Router } from "./http/router";
import { handleRequest, type Env } from "./index";

/**
 * 405 + Allow 是本次重构唯一声明的新行为：路由表按路径命中收集 Allow 列表，
 * 方法不匹配时先于鉴权与任何模块调用直接返回 405。
 */
const REQUEST_ENV = {
  APP_ENV: "local",
  APP_VERSION: "0.1.0-test",
  ENABLE_CRON: "true",
  ENABLE_AUTO_PUBLICATION: "false",
} as Env;

describe("route table 405 semantics", () => {
  it("answers 405 with an Allow header when a GET-only route receives POST", async () => {
    const response = await handleRequest(
      new Request("https://example.test/api/v1/overview", { method: "POST" }),
      REQUEST_ENV,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("answers 405 on a POST-only admin route receiving GET without authenticating first", async () => {
    // 无任何 Access JWT / authorizeAdmin 注入：若 405 之前走了鉴权，这里会变成 401/503。
    const response = await handleRequest(
      new Request("https://example.test/api/admin/theses/ENSO-CORE-01/evaluate"),
      REQUEST_ENV,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it.each([
    ["/api/v1/healthz", "DELETE", "GET"],
    ["/feed.xml", "POST", "GET"],
    ["/sitemap.xml", "POST", "GET"],
    ["/robots.txt", "POST", "GET"],
    ["/api/v1/theses/enso-overview", "PUT", "GET"],
    ["/api/admin/runs", "POST", "GET"],
    ["/api/admin/daily/2026-09-10/publish", "GET", "POST"],
    ["/api/admin/thesis-versions/version-1", "GET", "PUT"],
    ["/api/admin/thesis-versions/version-1/review", "GET", "POST"],
    ["/api/admin/sources/noaa_cpc_roni/run", "GET", "POST"],
  ])("answers 405 Allow %s for %s %s", async (path, method, allow) => {
    const response = await handleRequest(
      new Request(`https://example.test${path}`, { method }),
      REQUEST_ENV,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
  });
});

describe("route table hit matrix", () => {
  it("serves registered routes with their own method", async () => {
    const healthz = await handleRequest(new Request("https://example.test/api/v1/healthz"), REQUEST_ENV);
    expect(healthz.status).toBe(200);

    const sitemap = await handleRequest(new Request("https://example.test/sitemap.xml"), REQUEST_ENV);
    expect(sitemap.status).toBe(200);

    const robots = await handleRequest(new Request("https://example.test/robots.txt"), REQUEST_ENV);
    expect(robots.status).toBe(200);
  });

  it("keeps unknown paths on the 404 fallback", async () => {
    const response = await handleRequest(
      new Request("https://example.test/api/v1/not-a-route"),
      REQUEST_ENV,
    );

    expect(response.status).toBe(404);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("未找到该接口");
  });

  it("keeps a 404 fallback when a param fails its named-group shape", async () => {
    // 论点 slug 只接受小写字母数字与连字符；不匹配形状时路由不命中，落回 404 而非 405。
    const invalidSlug = await handleRequest(
      new Request("https://example.test/api/v1/theses/Invalid_Slug"),
      REQUEST_ENV,
    );
    expect(invalidSlug.status).toBe(404);

    // 来源 ID 形如 [a-z][a-z0-9_-]{0,127}；大写开头的 POST 同样不命中路由表。
    const invalidSource = await handleRequest(
      new Request("https://example.test/api/admin/sources/NOAA/run", { method: "POST" }),
      REQUEST_ENV,
    );
    expect(invalidSource.status).toBe(404);
  });
});

describe("compileRoutePattern", () => {
  it("compiles named groups with the default [^/]+ source", () => {
    const regex = compileRoutePattern("/api/admin/theses/:thesisId/draft");
    const matched = regex.exec("/api/admin/theses/ENSO-CORE-01/draft");
    expect(matched?.groups).toEqual({ thesisId: "ENSO-CORE-01" });
    expect(regex.exec("/api/admin/theses/ENSO-CORE-01/extra/draft")).toBeNull();
  });

  it("honours an explicit charset override", () => {
    const regex = compileRoutePattern("/api/v1/theses/:slug<[a-z0-9]+(?:-[a-z0-9]+)*>");
    expect(regex.exec("/api/v1/theses/enso-overview")?.groups).toEqual({ slug: "enso-overview" });
    expect(regex.exec("/api/v1/theses/ENSO")).toBeNull();
  });
});

describe("AppContext", () => {
  it("memoizes one instance per env object", () => {
    const first = AppContext.from(REQUEST_ENV);
    expect(AppContext.from(REQUEST_ENV)).toBe(first);

    const otherEnv = { ...REQUEST_ENV };
    expect(AppContext.from(otherEnv)).not.toBe(first);
  });
});

describe("Router", () => {
  it("collects an Allow list across entries sharing a path shape", () => {
    const router = new Router();
    router.add({ method: "GET", pattern: "/dual", handler: () => new Response(null) });
    router.add({ method: "POST", pattern: "/dual", handler: () => new Response(null) });

    const matched = router.match("GET", "/dual");
    expect(matched).toMatchObject({ kind: "match" });

    const mismatch = router.match("DELETE", "/dual");
    expect(mismatch).toMatchObject({ kind: "method-not-allowed", allow: ["GET", "POST"] });
    expect(router.match("GET", "/other")).toBeNull();
  });
});
