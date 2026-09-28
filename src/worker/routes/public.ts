import {
  PUBLIC_MARKET_CATEGORIES,
  PUBLIC_THESIS_CATEGORIES,
  type CategoryPageModel,
  type ChangesPageModel,
  type DataHealthPageModel,
  type DailyBriefPageModel,
  type IndicatorSeriesModel,
  type MethodologyPageModel,
  type OverviewPageModel,
  type PublicMarketCategory,
  type PublicThesisCategory,
  type ThesisCardModel,
  type ThesisPageModel,
} from "../../domain/page-models";
import { AppContext } from "../context";
import {
  CACHE_CONTROL_DAILY_BRIEF,
  CACHE_CONTROL_INDICATOR_SERIES,
  CACHE_CONTROL_METHODOLOGY,
  CACHE_CONTROL_OVERVIEW,
  CACHE_CONTROL_SHORT_LIVED,
  json,
  notFoundResponse,
  pageMeta,
} from "../http/envelope";
import { logPublicRouteError } from "../http/errors";
import type { RouteContext } from "../http/router";
import { isPublicDailyBriefDate } from "../modules/public-daily-briefs";
import {
  PublicIndicatorSeriesRangeError,
  parseChangesCursor,
  parsePublicChangesQuery,
  parsePublicIndicatorSeriesQuery,
  type ChangesCursor,
  type PublicChangesQuery,
  type PublicIndicatorSeriesQuery,
} from "../modules/read-models";
import type { ApiMeta } from "../../domain/contracts";

/**
 * The nine public GET routes. They all share one skeleton — generatedAt → loader → 200 with a
 * public Cache-Control / catch → log + 503 envelope — which publicRead encodes once; each route
 * shrinks to its loader and its meta derivation.
 */

export interface PublicReadOptions {
  /** Cache-Control applied to the 200 response. */
  readonly cacheControl: string;
  /** 503 envelope copy used when the loader fails with an unclassified error. */
  readonly failMessage: string;
  /** 404 envelope copy used when the loader resolves to null (model not published). */
  readonly notFoundMessage?: string;
  /**
   * Custom catch branch (e.g. the indicator range 400). Returning a Response short-circuits the
   * default log + 503 path.
   */
  readonly onError?: (error: unknown, requestId: string) => Response | undefined;
}

export async function publicRead<T>(
  ctx: RouteContext,
  options: PublicReadOptions,
  run: (generatedAt: string) => Promise<readonly [T, ApiMeta] | null>,
): Promise<Response> {
  const generatedAt = ctx.nowIso();
  try {
    const result = await run(generatedAt);
    if (result === null) {
      return json({
        error: {
          code: "NOT_FOUND",
          message: options.notFoundMessage ?? "未找到该接口",
          requestId: ctx.requestId,
        },
      }, 404);
    }
    const [data, meta] = result;
    return json({ data, meta }, 200, options.cacheControl);
  } catch (error) {
    const handled = options.onError?.(error, ctx.requestId);
    if (handled !== undefined) return handled;
    logPublicRouteError(ctx.requestId, ctx.url.pathname, error);
    return json({
      error: {
        code: "DATABASE",
        message: options.failMessage,
        requestId: ctx.requestId,
      },
    }, 503);
  }
}

async function overviewFromCloudflareBindings(generatedAt: string, env: RouteContext["env"]): Promise<OverviewPageModel> {
  return AppContext.from(env).publicReadModel().overview(generatedAt);
}

async function indicatorSeriesFromCloudflareBindings(
  query: PublicIndicatorSeriesQuery,
  env: RouteContext["env"],
): Promise<IndicatorSeriesModel | null> {
  return AppContext.from(env).publicReadModel().indicatorSeries(query);
}

async function thesesFromCloudflareBindings(
  category: PublicThesisCategory | null,
  generatedAt: string,
  env: RouteContext["env"],
): Promise<readonly ThesisCardModel[]> {
  return AppContext.from(env).publicReadModel().theses(category, generatedAt);
}

async function thesisFromCloudflareBindings(
  slug: string,
  generatedAt: string,
  env: RouteContext["env"],
): Promise<ThesisPageModel | null> {
  return AppContext.from(env).publicReadModel().thesis(slug, generatedAt);
}

async function categoryFromCloudflareBindings(
  category: PublicMarketCategory,
  generatedAt: string,
  env: RouteContext["env"],
): Promise<CategoryPageModel | null> {
  return AppContext.from(env).publicReadModel().category(category, generatedAt);
}

async function changesFromCloudflareBindings(
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
  generatedAt: string,
  env: RouteContext["env"],
): Promise<ChangesPageModel> {
  return AppContext.from(env).publicReadModel().changes(cursor, query, generatedAt);
}

async function dataHealthFromCloudflareBindings(generatedAt: string, env: RouteContext["env"]): Promise<DataHealthPageModel> {
  return AppContext.from(env).publicReadModel().dataHealth(generatedAt);
}

async function methodologyFromCloudflareBindings(generatedAt: string, env: RouteContext["env"]): Promise<MethodologyPageModel> {
  return AppContext.from(env).publicReadModel().methodology(generatedAt);
}

async function dailyBriefFromCloudflareBindings(
  briefDate: string,
  env: RouteContext["env"],
): Promise<DailyBriefPageModel | null> {
  return AppContext.from(env).publicDailyBriefs().findPublished(briefDate);
}

export function overviewRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_OVERVIEW,
    failMessage: "公开判定暂不可用，请稍后重试",
  }, async (generatedAt) => {
    const overview = await (ctx.dependencies.overview ?? overviewFromCloudflareBindings)(generatedAt, ctx.env);
    return [
      overview,
      pageMeta(generatedAt, overview.dailyBrief?.dataCutoff ?? generatedAt, overview.methodologyVersion),
    ] as const;
  });
}

function publicThesisCategoryFilter(searchParams: URLSearchParams): PublicThesisCategory | null | undefined {
  const values = searchParams.getAll("category");
  if (values.length === 0) return null;
  if (values.length !== 1) return undefined;
  const category = values[0];
  return PUBLIC_THESIS_CATEGORIES.includes(category as PublicThesisCategory)
    ? category as PublicThesisCategory
    : undefined;
}

export function thesesRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  const category = publicThesisCategoryFilter(ctx.url.searchParams);
  if (category === undefined) {
    return json({
      error: {
        code: "VALIDATION",
        message: "论点分类参数无效",
        requestId: ctx.requestId,
      },
    }, 400);
  }
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_SHORT_LIVED,
    failMessage: "公开论点列表暂不可用，请稍后重试",
  }, async (generatedAt) => {
    const theses = await (ctx.dependencies.theses ?? thesesFromCloudflareBindings)(category, generatedAt, ctx.env);
    return [
      theses,
      pageMeta(generatedAt, latestThesisCutoff(theses) ?? generatedAt, "unavailable"),
    ] as const;
  });
}

export function indicatorSeriesRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  const query = parsePublicIndicatorSeriesQuery(ctx.params.indicatorId, ctx.url.searchParams);
  if (query === null) {
    return json({
      error: {
        code: "VALIDATION",
        message: "指标序列参数无效",
        requestId: ctx.requestId,
      },
    }, 400);
  }
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_INDICATOR_SERIES,
    failMessage: "公开指标序列暂不可用，请稍后重试",
    notFoundMessage: "未找到可公开的指标序列",
    // 与其余公开路由不同：这里不写公共日志（历史行为），且范围超限要映射为 400。
    onError: (error, requestId) => {
      if (error instanceof PublicIndicatorSeriesRangeError) {
        return json({
          error: {
            code: "VALIDATION",
            message: "指标序列超过单次返回上限，请缩小时间范围",
            requestId,
          },
        }, 400);
      }
      return json({
        error: {
          code: "DATABASE",
          message: "公开指标序列暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    },
  }, async () => {
    const series = await (ctx.dependencies.indicatorSeries ?? indicatorSeriesFromCloudflareBindings)(query, ctx.env);
    if (series === null) return null;
    return [
      series,
      pageMeta(ctx.nowIso(), series.points.at(-1)?.observedAt ?? query.to, "unavailable"),
    ] as const;
  });
}

export function changesRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  const rawCursor = ctx.url.searchParams.get("cursor");
  const cursor = parseChangesCursor(rawCursor);
  const query = parsePublicChangesQuery(ctx.url.searchParams);
  if ((rawCursor !== null && cursor === null) || query === null) {
    return json({
      error: {
        code: "VALIDATION",
        message: "变化筛选或分页参数无效",
        requestId: ctx.requestId,
      },
    }, 400);
  }
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_SHORT_LIVED,
    failMessage: "公开变化暂不可用，请稍后重试",
  }, async (generatedAt) => {
    const changes = await (ctx.dependencies.changes ?? changesFromCloudflareBindings)(cursor, query, generatedAt, ctx.env);
    return [changes, pageMeta(generatedAt, generatedAt, "unavailable")] as const;
  });
}

export function dataHealthRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_SHORT_LIVED,
    failMessage: "公开数据健康暂不可用，请稍后重试",
  }, async (generatedAt) => {
    const health = await (ctx.dependencies.dataHealth ?? dataHealthFromCloudflareBindings)(generatedAt, ctx.env);
    return [health, pageMeta(generatedAt, health.generatedAt, "unavailable")] as const;
  });
}

export function methodologyRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_METHODOLOGY,
    failMessage: "公开方法论暂不可用，请稍后重试",
  }, async (generatedAt) => {
    const methodology = await (ctx.dependencies.methodology ?? methodologyFromCloudflareBindings)(generatedAt, ctx.env);
    return [
      methodology,
      pageMeta(generatedAt, methodology.lastUpdatedAt, methodology.methodologyVersion),
    ] as const;
  });
}

export function publicDailyBriefRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  const briefDate = ctx.params.date;
  if (!isPublicDailyBriefDate(briefDate)) {
    return json({
      error: {
        code: "VALIDATION",
        message: "每日判定日期无效",
        requestId: ctx.requestId,
      },
    }, 400);
  }
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_DAILY_BRIEF,
    failMessage: "公开每日判定暂不可用，请稍后重试",
    notFoundMessage: "未找到已发布每日判定",
  }, async (generatedAt) => {
    const dailyBrief = await (ctx.dependencies.dailyBrief ?? dailyBriefFromCloudflareBindings)(briefDate, ctx.env);
    if (dailyBrief === null) return null;
    return [
      dailyBrief,
      pageMeta(generatedAt, dailyBrief.dataCutoff, dailyBrief.methodologyVersion),
    ] as const;
  });
}

export function categoryRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  const category = ctx.params.category;
  if (!PUBLIC_MARKET_CATEGORIES.includes(category as PublicMarketCategory)) {
    return notFoundResponse(ctx.requestId);
  }
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_SHORT_LIVED,
    failMessage: "公开分类内容暂不可用，请稍后重试",
    notFoundMessage: "未找到已发布分类内容",
  }, async (generatedAt) => {
    const page = await (ctx.dependencies.category ?? categoryFromCloudflareBindings)(category as PublicMarketCategory, generatedAt, ctx.env);
    if (page === null) return null;
    return [
      page,
      pageMeta(generatedAt, latestThesisCutoff(page.theses) ?? generatedAt, "unavailable"),
    ] as const;
  });
}

export function thesisRoute(_request: Request, ctx: RouteContext): Response | Promise<Response> {
  return publicRead(ctx, {
    cacheControl: CACHE_CONTROL_SHORT_LIVED,
    failMessage: "公开论点暂不可用，请稍后重试",
    notFoundMessage: "未找到已发布论点",
  }, async (generatedAt) => {
    const thesis = await (ctx.dependencies.thesis ?? thesisFromCloudflareBindings)(ctx.params.slug, generatedAt, ctx.env);
    if (thesis === null) return null;
    return [
      thesis,
      pageMeta(generatedAt, thesis.thesis.basedOnCutoff, "unavailable"),
    ] as const;
  });
}

function latestThesisCutoff(theses: readonly ThesisCardModel[]): string | null {
  return theses.reduce<string | null>((latest, thesis) => (
    latest === null || thesis.basedOnCutoff > latest ? thesis.basedOnCutoff : latest
  ), null);
}
