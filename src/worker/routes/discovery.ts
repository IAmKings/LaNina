import type { HealthStatus } from "../../domain/contracts";
import { AppContext } from "../context";
import { CACHE_CONTROL_ATOM_FEED, CACHE_CONTROL_NO_STORE, json, pageMeta } from "../http/envelope";
import { logPublicRouteError } from "../http/errors";
import type { RouteContext } from "../http/router";
import { robotsResponse, sitemapResponse } from "../modules/site-discovery";

/**
 * The four zero-dependency discovery routes: sitemap, robots, health and the Atom feed. They
 * keep their bespoke response shapes (plain XML/text; only healthz uses the JSON envelope).
 */

export function sitemapRoute(_request: Request, ctx: RouteContext): Response {
  return sitemapResponse(ctx.url.origin);
}

export function robotsRoute(_request: Request, ctx: RouteContext): Response {
  return robotsResponse(ctx.url.origin);
}

export function healthzRoute(_request: Request, ctx: RouteContext): Response {
  const now = new Date().toISOString();
  return json<HealthStatus>({
    data: {
      status: "ok",
      version: ctx.env.APP_VERSION,
      environment: ctx.env.APP_ENV,
    },
    meta: pageMeta(now, now, "1.0.0"),
  });
}

async function atomFeedFromCloudflareBindings(
  generatedAt: string,
  origin: string,
  env: RouteContext["env"],
): Promise<string> {
  return AppContext.from(env).atomFeed().render(origin, generatedAt);
}

export async function atomFeedRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  const generatedAt = ctx.nowIso();
  try {
    const feed = await (ctx.dependencies.atomFeed ?? atomFeedFromCloudflareBindings)(generatedAt, ctx.url.origin, ctx.env);
    return new Response(feed, {
      headers: {
        "cache-control": CACHE_CONTROL_ATOM_FEED,
        "content-type": "application/atom+xml; charset=utf-8",
      },
    });
  } catch (error) {
    logPublicRouteError(ctx.requestId, ctx.url.pathname, error);
    return new Response("订阅源暂不可用，请稍后重试", {
      status: 503,
      headers: {
        "cache-control": CACHE_CONTROL_NO_STORE,
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}
