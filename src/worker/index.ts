import type { ApiEnvelope, ApiErrorEnvelope, AppEnvironment, HealthStatus } from "../domain/contracts";
import {
  PUBLIC_MARKET_CATEGORIES,
  PUBLIC_THESIS_CATEGORIES,
  type CategoryPageModel,
  type ChangesPageModel,
  type DataHealthPageModel,
  type DailyBriefPageModel,
  type IndicatorSeriesModel,
  type MethodologyPageModel,
  type AdminDraftPageModel,
  type AdminDailyTargetModel,
  type AdminRole,
  type AdminRunsPageModel,
  type OverviewPageModel,
  type PublicMarketCategory,
  type PublicThesisCategory,
  type ThesisCardModel,
  type ThesisPageModel,
} from "../domain/page-models";
import type { DispatchGroup, SourceErrorCode } from "../domain/ingestion";
import { SourceCollectionError } from "../domain/ingestion";
import { createSourceAdapterRegistry } from "./adapters/sources/registry";
import { D1DailyScheduleRepository } from "./adapters/storage/cloudflare-daily-schedule";
import { D1ThesisDraftRepository } from "./adapters/storage/cloudflare-thesis-drafts";
import { D1ThesisPublicationRepository } from "./adapters/storage/cloudflare-thesis-publications";
import { D1ThesisChangeReviewRepository } from "./adapters/storage/cloudflare-thesis-change-reviews";
import {
  D1IngestionRepository,
  R2RawSnapshotStore,
} from "./adapters/storage/cloudflare-ingestion";
import { D1SourceSchedulingRepository } from "./adapters/storage/cloudflare-scheduling";
import {
  D1AtomFeedRepository,
  D1PublicDailyBriefRepository,
  D1PublicReadModelRepository,
} from "./adapters/storage/cloudflare-read-models";
import { D1AdminReadModelRepository } from "./adapters/storage/cloudflare-admin-read-models";
import { D1ManualSourceRunRepository } from "./adapters/storage/cloudflare-manual-source-runs";
import {
  dispatchDueSources,
  type DispatchSourceResult,
  type DispatchSourcesRequest,
} from "./ingestion/dispatch-sources";
import {
  DailyEvaluationJob,
  DailyPublicationJob,
  DailyScheduleError,
  automaticPublicationDisabledResult,
  type DailyEvaluationBlockCode,
  type DailyEvaluationRequest,
  type DailyEvaluationRunResult,
  type DailyPublicationRequest,
  type DailyPublicationDelayCode,
  type DailyPublicationRunResult,
} from "./modules/daily-schedule";
import {
  ThesisDraftError,
  ThesisDraftModule,
  type AdministrativeDraftEditCommand,
  type AdministrativeDraftEditResult,
} from "./modules/thesis-drafts";
import {
  ThesisPublicationError,
  ThesisPublicationModule,
} from "./modules/thesis-publications";
import {
  MANUAL_CHANGE_REASON,
  ThesisEvaluationError,
  ThesisEvaluationModule,
  type ThesisEvaluationCommand,
  type ThesisEvaluationResult,
} from "./modules/thesis-evaluation";
import {
  ThesisChangeReviewError,
  ThesisChangeReviewModule,
  type ThesisChangeReviewCommand,
  type ThesisChangeReviewDecision,
  type ThesisChangeReviewRecord,
} from "./modules/thesis-change-reviews";
import { INITIAL_THESIS_SEEDS } from "../domain/initial-thesis-seeds";
import type {
  ThesisPublicationAction,
  ThesisPublicationCommand,
  ThesisPublicationTransition,
} from "../domain/thesis-publication";
import {
  parseChangesCursor,
  parsePublicChangesQuery,
  parsePublicIndicatorSeriesQuery,
  PublicIndicatorSeriesRangeError,
  PublicReadModelModule,
  type ChangesCursor,
  type PublicChangesQuery,
  type PublicIndicatorSeriesQuery,
} from "./modules/read-models";
import {
  isPublicDailyBriefDate,
  PublicDailyBriefModule,
} from "./modules/public-daily-briefs";
import {
  DailyBriefError,
  DailyBriefModule,
} from "./modules/daily-briefs";
import { D1DailyBriefRepository } from "./adapters/storage/cloudflare-daily-briefs";
import {
  DailyPublicationTargetError,
  DailyPublicationTargetModule,
  type DailyPublicationTargetResolution,
} from "./modules/daily-publication";
import { D1DailyPublicationTargetRepository } from "./adapters/storage/cloudflare-daily-publication";
import {
  shanghaiBriefDate,
  type DailyBriefFreezeCommand,
  type DailyBriefResult,
} from "../domain/daily-brief";
import { AtomFeedModule } from "./modules/atom-feed";
import { robotsResponse, sitemapResponse } from "./modules/site-discovery";
import {
  AdminReadModelModule,
  isAdminThesisId,
  parseAdminRunsCursor,
  type AdminRunsCursor,
} from "./modules/admin-read-models";
import {
  AccessJwtError,
  authorizeAccessRequest,
  type AccessActor,
} from "./modules/access-auth";
import {
  ManualSourceRunError,
  ManualSourceRunModule,
  type ManualSourceRunInput,
  type ManualSourceRunResult,
} from "./modules/manual-source-runs";
import { codeOwnedSourceTarget } from "./ingestion/live-smoke-targets";
import { runSourceIngestion } from "./ingestion/run-source";
import { withSecurityHeaders } from "./security-headers";

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

type CronJob =
  | "quarter_hour_ingestion"
  | "hourly_ingestion"
  | "evaluation"
  | "publication"
  | "unknown";

export interface ScheduledHandlerOutcome {
  job: CronJob;
  scheduledAt: string;
  outcome: "completed" | "partial" | "blocked" | "delayed" | "noop";
  sourcesDispatched: number;
  briefDate?: string;
  thesesAddressed?: number;
  draftsReady?: number;
  blockedTheses?: number;
  evaluationBlockCodes?: readonly DailyEvaluationBlockCode[];
  publicationCandidates?: number | null;
  publicationDelayCodes?: readonly DailyPublicationDelayCode[];
  automaticPublicationEnabled?: boolean;
}

type DispatchFromBindings = (
  request: DispatchSourcesRequest,
  env: Env,
) => Promise<DispatchSourceResult[]>;

type EvaluateFromBindings = (
  request: DailyEvaluationRequest,
  env: Env,
) => Promise<DailyEvaluationRunResult>;

type PublishDailyFromBindings = (
  request: DailyPublicationRequest,
  env: Env,
) => Promise<DailyPublicationRunResult>;

type OverviewFromBindings = (generatedAt: string, env: Env) => Promise<OverviewPageModel>;
type IndicatorSeriesFromBindings = (query: PublicIndicatorSeriesQuery, env: Env) => Promise<IndicatorSeriesModel | null>;
type ThesesFromBindings = (
  category: PublicThesisCategory | null,
  generatedAt: string,
  env: Env,
) => Promise<readonly ThesisCardModel[]>;
type ThesisFromBindings = (slug: string, generatedAt: string, env: Env) => Promise<ThesisPageModel | null>;
type CategoryFromBindings = (
  category: PublicMarketCategory,
  generatedAt: string,
  env: Env,
) => Promise<CategoryPageModel | null>;
type ChangesFromBindings = (
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
  generatedAt: string,
  env: Env,
) => Promise<ChangesPageModel>;
type DataHealthFromBindings = (generatedAt: string, env: Env) => Promise<DataHealthPageModel>;
type MethodologyFromBindings = (generatedAt: string, env: Env) => Promise<MethodologyPageModel>;
type DailyBriefFromBindings = (briefDate: string, env: Env) => Promise<DailyBriefPageModel | null>;
type AtomFeedFromBindings = (generatedAt: string, origin: string, env: Env) => Promise<string>;
type AdminRunsFromBindings = (
  actor: AdminRunsPageModel["actor"],
  cursor: AdminRunsCursor | null,
  env: Env,
) => Promise<AdminRunsPageModel>;
type AdminDraftFromBindings = (
  actor: AdminDraftPageModel["actor"],
  thesisId: string,
  env: Env,
) => Promise<AdminDraftPageModel | null>;
type AuthorizeAdminFromBindings = (request: Request, minimumRole: AdminRole, env: Env) => Promise<AccessActor>;
type ManualSourceRunFromBindings = (input: ManualSourceRunInput, env: Env) => Promise<ManualSourceRunResult>;
type AdministrativeDraftEditFromBindings = (
  input: AdministrativeDraftEditCommand,
  env: Env,
) => Promise<AdministrativeDraftEditResult>;
type ThesisPublicationFromBindings = (
  action: ThesisPublicationAction,
  input: ThesisPublicationCommand,
  env: Env,
) => Promise<ThesisPublicationTransition>;
type ThesisChangeReviewFromBindings = (
  input: ThesisChangeReviewCommand,
  env: Env,
) => Promise<ThesisChangeReviewRecord>;
type ThesisEvaluationFromBindings = (
  input: ThesisEvaluationCommand,
  env: Env,
) => Promise<ThesisEvaluationResult>;
type DailyPublicationTargetsFromBindings = (
  cutoff: string,
  env: Env,
) => Promise<DailyPublicationTargetResolution>;
type DailyBriefFreezeFromBindings = (
  command: DailyBriefFreezeCommand,
  env: Env,
) => Promise<DailyBriefResult>;
interface AdminDailyBriefRead {
  readonly briefDate: string;
  readonly cutoff: string;
  readonly published: boolean;
  readonly publishedAt: string | null;
  readonly currentFreezeKey: string | null;
  readonly targets: readonly AdminDailyTargetModel[];
  readonly blockers: readonly string[];
}
type AdminDailyBriefReadFromBindings = (
  briefDate: string,
  env: Env,
) => Promise<AdminDailyBriefRead>;

interface SafeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ScheduledHandlerDependencies {
  dispatch?: DispatchFromBindings;
  evaluate?: EvaluateFromBindings;
  publishDaily?: PublishDailyFromBindings;
  logger?: SafeLogger;
  nowMs?: () => number;
}

export interface RequestHandlerDependencies {
  overview?: OverviewFromBindings;
  indicatorSeries?: IndicatorSeriesFromBindings;
  theses?: ThesesFromBindings;
  thesis?: ThesisFromBindings;
  category?: CategoryFromBindings;
  changes?: ChangesFromBindings;
  dataHealth?: DataHealthFromBindings;
  methodology?: MethodologyFromBindings;
  dailyBrief?: DailyBriefFromBindings;
  atomFeed?: AtomFeedFromBindings;
  adminRuns?: AdminRunsFromBindings;
  adminDraft?: AdminDraftFromBindings;
  authorizeAdmin?: AuthorizeAdminFromBindings;
  manualSourceRun?: ManualSourceRunFromBindings;
  administrativeDraftEdit?: AdministrativeDraftEditFromBindings;
  thesisPublication?: ThesisPublicationFromBindings;
  thesisChangeReview?: ThesisChangeReviewFromBindings;
  thesisEvaluation?: ThesisEvaluationFromBindings;
  dailyPublicationTargets?: DailyPublicationTargetsFromBindings;
  dailyBriefFreeze?: DailyBriefFreezeFromBindings;
  adminDailyBrief?: AdminDailyBriefReadFromBindings;
  now?: () => Date;
  createId?: () => string;
}

function json<T>(
  body: ApiEnvelope<T> | ApiErrorEnvelope,
  status = 200,
  cacheControl = "no-store",
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": cacheControl,
    },
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: RequestHandlerDependencies = {},
): Promise<Response> {
  return withSecurityHeaders(await handleRequestWithoutSecurityHeaders(request, env, dependencies));
}

async function handleRequestWithoutSecurityHeaders(
  request: Request,
  env: Env,
  dependencies: RequestHandlerDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  if (request.method === "GET" && url.pathname === "/sitemap.xml") {
    return sitemapResponse(url.origin);
  }

  if (request.method === "GET" && url.pathname === "/robots.txt") {
    return robotsResponse(url.origin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/healthz") {
    const now = new Date().toISOString();
    return json<HealthStatus>({
      data: {
        status: "ok",
        version: env.APP_VERSION,
        environment: env.APP_ENV,
      },
      meta: {
        generatedAt: now,
        dataCutoff: now,
        methodologyVersion: "1.0.0",
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/feed.xml") {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const feed = await (dependencies.atomFeed ?? atomFeedFromCloudflareBindings)(generatedAt, url.origin, env);
      return new Response(feed, {
        headers: {
          "cache-control": "public, max-age=300, stale-while-revalidate=300",
          "content-type": "application/atom+xml; charset=utf-8",
        },
      });
    } catch {
      return new Response("订阅源暂不可用，请稍后重试", {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/overview") {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const overview = await (dependencies.overview ?? overviewFromCloudflareBindings)(generatedAt, env);
      return json<OverviewPageModel>({
        data: overview,
        meta: {
          generatedAt,
          dataCutoff: overview.dailyBrief?.dataCutoff ?? generatedAt,
          methodologyVersion: overview.methodologyVersion,
        },
      }, 200, "public, max-age=60, stale-while-revalidate=300");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开判定暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/theses") {
    const category = publicThesisCategoryFilter(url.searchParams);
    if (category === undefined) {
      return json({
        error: {
          code: "VALIDATION",
          message: "论点分类参数无效",
          requestId,
        },
      }, 400);
    }
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const theses = await (dependencies.theses ?? thesesFromCloudflareBindings)(category, generatedAt, env);
      return json<readonly ThesisCardModel[]>({
        data: theses,
        meta: {
          generatedAt,
          dataCutoff: latestThesisCutoff(theses) ?? generatedAt,
          methodologyVersion: "unavailable",
        },
      }, 200, "public, max-age=60, stale-while-revalidate=60");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开论点列表暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  const publicIndicatorId = publicIndicatorIdFromPath(url.pathname);
  if (request.method === "GET" && publicIndicatorId !== null) {
    const query = parsePublicIndicatorSeriesQuery(publicIndicatorId, url.searchParams);
    if (query === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "指标序列参数无效",
          requestId,
        },
      }, 400);
    }
    try {
      const series = await (dependencies.indicatorSeries ?? indicatorSeriesFromCloudflareBindings)(query, env);
      if (series === null) {
        return json({
          error: {
            code: "NOT_FOUND",
            message: "未找到可公开的指标序列",
            requestId,
          },
        }, 404);
      }
      return json<IndicatorSeriesModel>({
        data: series,
        meta: {
          generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
          dataCutoff: series.points.at(-1)?.observedAt ?? query.to,
          methodologyVersion: "unavailable",
        },
      }, 200, "public, max-age=300, stale-while-revalidate=300");
    } catch (error) {
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
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/changes") {
    const rawCursor = url.searchParams.get("cursor");
    const cursor = parseChangesCursor(rawCursor);
    const query = parsePublicChangesQuery(url.searchParams);
    if ((rawCursor !== null && cursor === null) || query === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "变化筛选或分页参数无效",
          requestId,
        },
      }, 400);
    }
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const changes = await (dependencies.changes ?? changesFromCloudflareBindings)(cursor, query, generatedAt, env);
      return json<ChangesPageModel>({
        data: changes,
        meta: { generatedAt, dataCutoff: generatedAt, methodologyVersion: "unavailable" },
      }, 200, "public, max-age=60, stale-while-revalidate=60");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开变化暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/data-health") {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const health = await (dependencies.dataHealth ?? dataHealthFromCloudflareBindings)(generatedAt, env);
      return json<DataHealthPageModel>({
        data: health,
        meta: { generatedAt, dataCutoff: health.generatedAt, methodologyVersion: "unavailable" },
      }, 200, "public, max-age=60, stale-while-revalidate=60");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开数据健康暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/methodology") {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const methodology = await (dependencies.methodology ?? methodologyFromCloudflareBindings)(generatedAt, env);
      return json<MethodologyPageModel>({
        data: methodology,
        meta: {
          generatedAt,
          dataCutoff: methodology.lastUpdatedAt,
          methodologyVersion: methodology.methodologyVersion,
        },
      }, 200, "public, max-age=86400, stale-while-revalidate=86400");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开方法论暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  const dailyBriefDate = publicDailyBriefDate(url.pathname);
  if (request.method === "GET" && dailyBriefDate !== null) {
    if (!isPublicDailyBriefDate(dailyBriefDate)) {
      return json({
        error: {
          code: "VALIDATION",
          message: "每日判定日期无效",
          requestId,
        },
      }, 400);
    }
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const dailyBrief = await (dependencies.dailyBrief ?? dailyBriefFromCloudflareBindings)(dailyBriefDate, env);
      if (dailyBrief === null) {
        return json({
          error: {
            code: "NOT_FOUND",
            message: "未找到已发布每日判定",
            requestId,
          },
        }, 404);
      }
      return json<DailyBriefPageModel>({
        data: dailyBrief,
        meta: {
          generatedAt,
          dataCutoff: dailyBrief.dataCutoff,
          methodologyVersion: dailyBrief.methodologyVersion,
        },
      }, 200, "public, max-age=3600, stale-while-revalidate=3600");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开每日判定暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/admin/runs") {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "viewer", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }

    const rawCursor = url.searchParams.get("cursor");
    const cursor = parseAdminRunsCursor(rawCursor);
    if (rawCursor !== null && cursor === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "后台运行分页参数无效",
          requestId,
        },
      }, 400);
    }

    try {
      const runs = await (dependencies.adminRuns ?? adminRunsFromCloudflareBindings)(adminActor(actor), cursor, env);
      const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
      return json<AdminRunsPageModel>({
        data: runs,
        meta: { generatedAt, dataCutoff: generatedAt, methodologyVersion: "unavailable" },
      });
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "后台运行记录暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  const adminDraftThesisId = adminDraftThesisIdFromPath(url.pathname);
  if (request.method === "GET" && isAdminDraftPath(url.pathname)) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "viewer", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }

    if (adminDraftThesisId === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可审核的论点", requestId },
      }, 404);
    }

    try {
      const draft = await (dependencies.adminDraft ?? adminDraftFromCloudflareBindings)(
        adminActor(actor),
        adminDraftThesisId,
        env,
      );
      if (draft === null) {
        return json({
          error: { code: "NOT_FOUND", message: "未找到可审核的论点", requestId },
        }, 404);
      }
      const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
      const dataCutoff = draft.draft?.basedOnCutoff ?? draft.published?.basedOnCutoff ?? generatedAt;
      return json<AdminDraftPageModel>({
        data: draft,
        meta: { generatedAt, dataCutoff, methodologyVersion: "unavailable" },
      });
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "后台草稿审核暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  const administrativeDraftVersionId = administrativeDraftVersionIdFromPath(url.pathname);
  if (request.method === "PUT" && isAdministrativeDraftEditPath(url.pathname)) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "editor", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (administrativeDraftVersionId === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可编辑论点草稿", requestId },
      }, 404);
    }

    const body = await parseAdministrativeDraftEditBody(request);
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "草稿编辑请求无效", requestId },
      }, 400);
    }

    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    let writer: string;
    try {
      writer = administrativeActor(actor);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    try {
      const result = await (dependencies.administrativeDraftEdit ?? administrativeDraftEditFromCloudflareBindings)({
        versionId: administrativeDraftVersionId,
        thesisId: body.thesisId,
        expectedVersion: body.expectedVersion,
        summary: body.summary,
        invalidation: body.invalidation,
        reason: body.reason,
        actor: writer,
        occurredAt,
      }, env);
      return json({
        data: result,
        meta: { generatedAt: occurredAt, dataCutoff: occurredAt, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return administrativeDraftEditError(error, requestId);
    }
  }

  const thesisPublication = administrativeThesisPublicationFromPath(url.pathname);
  if (request.method === "POST" && isAdministrativeThesisPublicationPath(url.pathname)) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "publisher", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (thesisPublication === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可发布的论点版本", requestId },
      }, 404);
    }

    const body = await parseAdministrativeThesisPublicationBody(request);
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "发布或撤回请求无效", requestId },
      }, 400);
    }

    let writer: string;
    try {
      writer = administrativeActor(actor);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const transition = await (dependencies.thesisPublication ?? thesisPublicationFromCloudflareBindings)(
        thesisPublication.action,
        {
          versionId: thesisPublication.versionId,
          thesisId: body.thesisId,
          expectedVersion: body.expectedVersion,
          actor: writer,
          reason: body.reason,
          occurredAt,
        },
        env,
      );
      return json({
        data: publicationResponse(transition),
        meta: { generatedAt: occurredAt, dataCutoff: occurredAt, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return thesisPublicationError(error, requestId);
    }
  }

  const thesisEvaluateId = adminThesisEvaluateIdFromPath(url.pathname);
  if (request.method === "POST" && isAdminThesisEvaluatePath(url.pathname)) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "editor", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (thesisEvaluateId === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到该影响论点", requestId },
      }, 404);
    }

    const body = await parseAdministrativeThesisEvaluateBody(request);
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "重新评估请求无效", requestId },
      }, 400);
    }

    let evaluator: string;
    try {
      evaluator = administrativeActor(actor);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    const cutoff = body.cutoff ?? now;
    if (cutoff > now) {
      return json({
        error: { code: "VALIDATION", message: "评估截止时间不能晚于当前时间", requestId },
      }, 422);
    }
    try {
      const result = await (dependencies.thesisEvaluation ?? thesisEvaluationFromCloudflareBindings)({
        thesisId: thesisEvaluateId,
        cutoff,
        actor: evaluator,
        reason: body.reason,
      }, env);
      if (result.status === "blocked") {
        return json({
          error: {
            code: result.reasonCode,
            message: evaluationBlockedMessage(result.reasonCode),
            requestId,
          },
        }, 409);
      }
      return json({
        data: {
          thesisId: result.thesisId,
          status: result.status,
          version: result.version,
          cutoff: result.cutoff,
          changeReason: MANUAL_CHANGE_REASON,
        },
        meta: { generatedAt: now, dataCutoff: result.cutoff, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return thesisEvaluationError(error, requestId);
    }
  }

  const thesisReview = administrativeThesisReviewFromPath(url.pathname);
  if (request.method === "POST" && isAdministrativeThesisReviewPath(url.pathname)) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "publisher", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (thesisReview === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可审核的论点版本", requestId },
      }, 404);
    }

    const body = await parseAdministrativeThesisReviewBody(request);
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "审核请求无效", requestId },
      }, 400);
    }

    let reviewer: string;
    try {
      reviewer = administrativeActor(actor);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const review = await (dependencies.thesisChangeReview ?? thesisChangeReviewFromCloudflareBindings)({
        thesisId: body.thesisId,
        afterVersionId: thesisReview.versionId,
        beforeVersionId: body.beforeVersionId,
        decision: body.decision,
        reason: body.reason,
        actor: reviewer,
        occurredAt,
      }, env);
      return json({
        data: thesisChangeReviewResponse(review),
        meta: { generatedAt: occurredAt, dataCutoff: occurredAt, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return thesisChangeReviewError(error, requestId);
    }
  }

  const adminDailyBriefPublishDate = adminDailyBriefPublishDateFromPath(url.pathname);
  if (request.method === "POST" && adminDailyBriefPublishDate !== null) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "publisher", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (!isPublicDailyBriefDate(adminDailyBriefPublishDate)) {
      return json({
        error: { code: "VALIDATION", message: "每日判定日期必须是有效日历日期", requestId },
      }, 400);
    }

    const body = await parseAdministrativeDailyPublicationBody(request);
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "每日判定发布请求无效", requestId },
      }, 400);
    }
    if (shanghaiBriefDate(body.cutoff) !== adminDailyBriefPublishDate) {
      return json({
        error: {
          code: "VALIDATION",
          message: "截止时间与发布日期的北京时间日切不一致",
          requestId,
        },
      }, 422);
    }

    let publisher: string;
    try {
      publisher = administrativeActor(actor);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }

    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const resolution = await (dependencies.dailyPublicationTargets ?? dailyPublicationTargetsFromCloudflareBindings)(
        body.cutoff,
        env,
      );
      if (resolution.targets === null) {
        return json({
          error: {
            code: "TARGETS_UNAVAILABLE",
            message: "六条论点尚未全部具备该截止时间的已发布版本，请先完成论点发布",
            requestId,
          },
        }, 409);
      }
      const result = await (dependencies.dailyBriefFreeze ?? dailyBriefFreezeFromCloudflareBindings)({
        cutoff: body.cutoff,
        targets: resolution.targets,
        headline: body.headline,
        summary: body.summary,
        topChanges: [...body.topChanges],
        actor: publisher,
        reason: body.reason,
        occurredAt,
        expectedFreezeKey: body.expectedFreezeKey,
      }, env);
      if (result.status !== "published") {
        const failed = result.gates
          .filter((gate) => gate.status !== "passed")
          .map((gate) => gate.code)
          .join(", ");
        return json({
          error: {
            code: "GATES_FAILED",
            message: failed.length === 0
              ? "发布门禁未通过，未发布每日判定"
              : `发布门禁未通过：${failed}`,
            requestId,
          },
        }, 409);
      }
      return json({
        data: dailyBriefPublicationResponse(result),
        meta: { generatedAt: occurredAt, dataCutoff: result.cutoff, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return dailyBriefPublicationError(error, requestId);
    }
  }

  const adminDailyBriefDate = adminDailyBriefDateFromPath(url.pathname);
  if (request.method === "GET" && adminDailyBriefDate !== null) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "viewer", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }
    if (!isPublicDailyBriefDate(adminDailyBriefDate)) {
      return json({
        error: { code: "VALIDATION", message: "每日判定日期必须是有效日历日期", requestId },
      }, 400);
    }
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const read = await (dependencies.adminDailyBrief ?? adminDailyBriefFromCloudflareBindings)(
        adminDailyBriefDate,
        env,
      );
      return json({
        data: { actor: adminActor(actor), ...read },
        meta: { generatedAt, dataCutoff: read.cutoff, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return dailyBriefPublicationError(error, requestId);
    }
  }

  const manualSourceId = adminManualSourceId(url.pathname);
  if (request.method === "POST" && manualSourceId !== null) {
    let actor: AccessActor;
    try {
      actor = await (dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(request, "editor", env);
    } catch (error) {
      return adminAuthorizationError(error, requestId);
    }

    const body = await parseManualSourceRunBody(request);
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    if (body === null || idempotencyKey === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "手动运行需要填写原因和有效的幂等键",
          requestId,
        },
      }, 400);
    }

    const occurredAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const result = await (dependencies.manualSourceRun ?? manualSourceRunFromCloudflareBindings)({
        sourceId: manualSourceId,
        reason: body.reason,
        idempotencyKey,
        actor,
        occurredAt,
        operationId: dependencies.createId?.() ?? crypto.randomUUID(),
      }, env);
      return json({
        data: result,
        meta: { generatedAt: occurredAt, dataCutoff: occurredAt, methodologyVersion: "unavailable" },
      });
    } catch (error) {
      return manualSourceRunError(error, requestId);
    }
  }

  const category = publicCategory(url.pathname);
  if (request.method === "GET" && category !== null) {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const page = await (dependencies.category ?? categoryFromCloudflareBindings)(category, generatedAt, env);
      if (page === null) {
        return json({
          error: {
            code: "NOT_FOUND",
            message: "未找到已发布分类内容",
            requestId,
          },
        }, 404);
      }
      return json<CategoryPageModel>({
        data: page,
        meta: {
          generatedAt,
          dataCutoff: latestCategoryCutoff(page) ?? generatedAt,
          methodologyVersion: "unavailable",
        },
      }, 200, "public, max-age=60, stale-while-revalidate=60");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开分类内容暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  const thesisSlug = publicThesisSlug(url.pathname);
  if (request.method === "GET" && thesisSlug !== null) {
    const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    try {
      const thesis = await (dependencies.thesis ?? thesisFromCloudflareBindings)(thesisSlug, generatedAt, env);
      if (thesis === null) {
        return json({
          error: {
            code: "NOT_FOUND",
            message: "未找到已发布论点",
            requestId,
          },
        }, 404);
      }
      return json<ThesisPageModel>({
        data: thesis,
        meta: {
          generatedAt,
          dataCutoff: thesis.thesis.basedOnCutoff,
          methodologyVersion: "unavailable",
        },
      }, 200, "public, max-age=60, stale-while-revalidate=60");
    } catch {
      return json({
        error: {
          code: "DATABASE",
          message: "公开论点暂不可用，请稍后重试",
          requestId,
        },
      }, 503);
    }
  }

  return json(
    {
      error: {
        code: "NOT_FOUND",
        message: "未找到该接口",
        requestId,
      },
    },
    404,
  );
}

async function overviewFromCloudflareBindings(generatedAt: string, env: Env): Promise<OverviewPageModel> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).overview(generatedAt);
}

async function indicatorSeriesFromCloudflareBindings(
  query: PublicIndicatorSeriesQuery,
  env: Env,
): Promise<IndicatorSeriesModel | null> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).indicatorSeries(query);
}

async function thesesFromCloudflareBindings(
  category: PublicThesisCategory | null,
  generatedAt: string,
  env: Env,
): Promise<readonly ThesisCardModel[]> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).theses(category, generatedAt);
}

async function thesisFromCloudflareBindings(
  slug: string,
  generatedAt: string,
  env: Env,
): Promise<ThesisPageModel | null> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).thesis(slug, generatedAt);
}

async function categoryFromCloudflareBindings(
  category: PublicMarketCategory,
  generatedAt: string,
  env: Env,
): Promise<CategoryPageModel | null> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).category(category, generatedAt);
}

async function changesFromCloudflareBindings(
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
  generatedAt: string,
  env: Env,
): Promise<ChangesPageModel> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).changes(cursor, query, generatedAt);
}

async function dataHealthFromCloudflareBindings(generatedAt: string, env: Env): Promise<DataHealthPageModel> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).dataHealth(generatedAt);
}

async function methodologyFromCloudflareBindings(generatedAt: string, env: Env): Promise<MethodologyPageModel> {
  return new PublicReadModelModule(new D1PublicReadModelRepository(env.DB)).methodology(generatedAt);
}

async function dailyBriefFromCloudflareBindings(
  briefDate: string,
  env: Env,
): Promise<DailyBriefPageModel | null> {
  return new PublicDailyBriefModule(new D1PublicDailyBriefRepository(env.DB)).findPublished(briefDate);
}

async function atomFeedFromCloudflareBindings(generatedAt: string, origin: string, env: Env): Promise<string> {
  return new AtomFeedModule(new D1AtomFeedRepository(env.DB)).render(origin, generatedAt);
}

async function adminRunsFromCloudflareBindings(
  actor: AdminRunsPageModel["actor"],
  cursor: AdminRunsCursor | null,
  env: Env,
): Promise<AdminRunsPageModel> {
  return new AdminReadModelModule(new D1AdminReadModelRepository(env.DB)).runs(actor, cursor);
}

async function adminDraftFromCloudflareBindings(
  actor: AdminDraftPageModel["actor"],
  thesisId: string,
  env: Env,
): Promise<AdminDraftPageModel | null> {
  return new AdminReadModelModule(new D1AdminReadModelRepository(env.DB)).draft(actor, thesisId);
}

async function manualSourceRunFromCloudflareBindings(
  input: ManualSourceRunInput,
  env: Env,
): Promise<ManualSourceRunResult> {
  const registry = createSourceAdapterRegistry({
    usdaFasApiKey: env.USDA_FAS_API_KEY,
    eiaApiKey: env.EIA_API_KEY,
    censusApiKey: env.CENSUS_API_KEY,
  });
  return new ManualSourceRunModule(
    new D1ManualSourceRunRepository(env.DB),
    codeOwnedSourceTarget,
    registry,
    (request, adapter) => runSourceIngestion(request, {
      adapter,
      repository: new D1IngestionRepository(env.DB),
      snapshots: new R2RawSnapshotStore(env.RAW),
      fetch: globalThis.fetch,
    }),
  ).run(input);
}

async function administrativeDraftEditFromCloudflareBindings(
  input: AdministrativeDraftEditCommand,
  env: Env,
): Promise<AdministrativeDraftEditResult> {
  return new ThesisDraftModule(new D1ThesisDraftRepository(env.DB)).editAdministrative(input);
}

async function thesisPublicationFromCloudflareBindings(
  action: ThesisPublicationAction,
  input: ThesisPublicationCommand,
  env: Env,
): Promise<ThesisPublicationTransition> {
  const publication = new ThesisPublicationModule(
    new D1ThesisPublicationRepository(env.DB),
    (thesisId) => INITIAL_THESIS_SEEDS.find((seed) => seed.id === thesisId) ?? null,
  );
  return action === "publish" ? publication.publish(input) : publication.withdraw(input);
}

async function thesisChangeReviewFromCloudflareBindings(
  input: ThesisChangeReviewCommand,
  env: Env,
): Promise<ThesisChangeReviewRecord> {
  return new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(env.DB)).record(input);
}

async function thesisEvaluationFromCloudflareBindings(
  input: ThesisEvaluationCommand,
  env: Env,
): Promise<ThesisEvaluationResult> {
  return new ThesisEvaluationModule(
    new D1DailyScheduleRepository(env.DB),
    {
      create: (candidate) =>
        new ThesisDraftModule(new D1ThesisDraftRepository(env.DB)).create(candidate),
    },
  ).evaluate(input);
}

async function dailyPublicationTargetsFromCloudflareBindings(
  cutoff: string,
  env: Env,
): Promise<DailyPublicationTargetResolution> {
  return new DailyPublicationTargetModule(new D1DailyPublicationTargetRepository(env.DB)).resolve(cutoff);
}

async function dailyBriefFreezeFromCloudflareBindings(
  command: DailyBriefFreezeCommand,
  env: Env,
): Promise<DailyBriefResult> {
  return new DailyBriefModule(new D1DailyBriefRepository(env.DB)).freezeAndPublish(command);
}

async function adminDailyBriefFromCloudflareBindings(
  briefDate: string,
  env: Env,
): Promise<AdminDailyBriefRead> {
  const cutoff = evaluationCutoffForBriefDate(briefDate);
  const briefs = new DailyBriefModule(new D1DailyBriefRepository(env.DB));
  const [published, currentFreezeKey, targets] = await Promise.all([
    briefs.findPublished(briefDate),
    briefs.currentFreezeKey(briefDate),
    dailyPublicationTargetsFromCloudflareBindings(cutoff, env),
  ]);
  return {
    briefDate,
    cutoff,
    published: published !== null,
    publishedAt: published?.publishedAt ?? null,
    currentFreezeKey,
    targets: targets.targets ?? [],
    blockers: targets.blockers,
  };
}

/**
 * The 06:30 Asia/Shanghai evaluation runs at 22:30 UTC of the previous day. Deriving the cutoff
 * from the brief date keeps the administrative read and the publication command aligned, and the
 * round-trip check refuses any date the frozen date helper would not reproduce.
 */
function evaluationCutoffForBriefDate(briefDate: string): string {
  const cutoff = new Date(`${briefDate}T22:30:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  const value = cutoff.toISOString();
  if (shanghaiBriefDate(value) !== briefDate) {
    throw new DailyBriefError("VALIDATION", "无法为该日期确定评估截止时间");
  }
  return value;
}

function authorizeAdminFromAccess(request: Request, minimumRole: AdminRole, env: Env): Promise<AccessActor> {
  return authorizeAccessRequest(request, env, minimumRole);
}

function adminActor(actor: AccessActor): AdminRunsPageModel["actor"] {
  return {
    email: actor.email ?? "已验证成员",
    roles: actor.roles,
  };
}

/**
 * Read-only views may show a generic verified-member label, but an append-only
 * audit entry must identify the actual Access member who initiated a write.
 */
function administrativeActor(actor: AccessActor): string {
  if (actor.email === null) throw new AccessJwtError("AUTH_FORBIDDEN");
  return actor.email;
}

function adminAuthorizationError(error: unknown, requestId: string): Response {
  if (error instanceof AccessJwtError) {
    return json({
      error: { code: error.code, message: error.message, requestId },
    }, error.status);
  }
  return json({
    error: {
      code: "AUTH_IDENTITY_PROVIDER",
      message: "身份验证服务暂不可用",
      requestId,
    },
  }, 503);
}

function manualSourceRunError(error: unknown, requestId: string): Response {
  if (error instanceof ManualSourceRunError) {
    if (error.code === "SOURCE_UNAVAILABLE") {
      return json({
        error: { code: error.code, message: "来源不存在、已停用或不允许手动运行", requestId },
      }, 404);
    }
    if (error.code === "SOURCE_CONFIGURATION") {
      return json({
        error: { code: error.code, message: "来源运行配置暂不可用", requestId },
      }, 503);
    }
  }
  return json({
    error: { code: "DATABASE", message: "手动来源运行暂不可用，请稍后重试", requestId },
  }, 503);
}

function administrativeDraftEditError(error: unknown, requestId: string): Response {
  if (error instanceof ThesisDraftError) {
    if (error.code === "VALIDATION") {
      return json({ error: { code: error.code, message: "草稿编辑请求无效", requestId } }, 400);
    }
    if (error.code === "NOT_FOUND") {
      return json({ error: { code: error.code, message: "未找到可编辑论点草稿", requestId } }, 404);
    }
    if (error.code === "VERSION_CONFLICT" || error.code === "NON_DRAFT") {
      return json({ error: { code: error.code, message: "草稿版本已变化，请刷新后重试", requestId } }, 409);
    }
  }
  return json({
    error: { code: "DATABASE", message: "草稿编辑暂不可用，请稍后重试", requestId },
  }, 503);
}

function thesisPublicationError(error: unknown, requestId: string): Response {
  if (error instanceof ThesisPublicationError) {
    if (error.code === "VALIDATION") {
      return json({ error: { code: error.code, message: "发布或撤回请求无效", requestId } }, 400);
    }
    if (error.code === "NOT_FOUND") {
      return json({ error: { code: error.code, message: "未找到可发布的论点版本", requestId } }, 404);
    }
    if (["VERSION_CONFLICT", "NON_DRAFT", "NOT_PUBLISHED", "PUBLICATION_DISABLED"].includes(error.code)) {
      return json({ error: { code: error.code, message: "论点版本已变化或当前不可发布，请刷新后重试", requestId } }, 409);
    }
  }
  return json({
    error: { code: "DATABASE", message: "发布操作暂不可用，请稍后重试", requestId },
  }, 503);
}

function thesisChangeReviewError(error: unknown, requestId: string): Response {
  if (error instanceof ThesisChangeReviewError) {
    if (error.code === "VALIDATION") {
      return json({ error: { code: error.code, message: "审核请求无效", requestId } }, 400);
    }
    if (error.code === "NOT_FOUND") {
      return json({ error: { code: error.code, message: "未找到可审核的论点版本", requestId } }, 404);
    }
    if (error.code === "NO_PREVIOUS_BRIEF") {
      return json({ error: { code: error.code, message: error.message, requestId } }, 409);
    }
    if (error.code === "VERSION_CONFLICT") {
      return json({
        error: { code: error.code, message: "审核身份已变化或有不同决定，请刷新后重试", requestId },
      }, 409);
    }
  }
  return json({
    error: { code: "DATABASE", message: "审核操作暂不可用，请稍后重试", requestId },
  }, 503);
}

/** Only the frozen outcome and its gate verdicts leave the Worker; identities stay private. */
function dailyBriefPublicationResponse(result: DailyBriefResult): {
  readonly briefDate: string;
  readonly status: "published" | "delayed";
  readonly publishedAt: string | null;
  readonly gates: readonly { readonly code: string; readonly status: string }[];
} {
  return {
    briefDate: result.briefDate,
    status: result.status,
    publishedAt: result.publishedAt,
    gates: result.gates.map((gate) => ({ code: gate.code, status: gate.status })),
  };
}

function thesisEvaluationError(error: unknown, requestId: string): Response {
  if (error instanceof ThesisEvaluationError) {
    if (error.code === "VALIDATION") {
      return json({ error: { code: error.code, message: "重新评估请求无效", requestId } }, 400);
    }
    if (error.code === "NOT_FOUND") {
      return json({ error: { code: error.code, message: "未找到该影响论点", requestId } }, 404);
    }
  }
  return json({
    error: { code: "DATABASE", message: "重新评估暂不可用，请稍后重试", requestId },
  }, 503);
}

function dailyBriefPublicationError(error: unknown, requestId: string): Response {
  if (error instanceof DailyBriefError) {
    if (error.code === "VALIDATION") {
      return json({ error: { code: error.code, message: "每日判定请求无效", requestId } }, 400);
    }
    if (error.code === "NOT_FOUND") {
      return json({ error: { code: error.code, message: "未找到该日期的每日判定", requestId } }, 404);
    }
    if (error.code === "VERSION_CONFLICT" || error.code === "IMMUTABLE") {
      return json({
        error: {
          code: error.code,
          message: error.code === "IMMUTABLE"
            ? "该日期的每日判定已发布且不可替换"
            : "每日判定内容或版本已变化，请刷新后重试",
          requestId,
        },
      }, 409);
    }
  }
  if (error instanceof DailyPublicationTargetError && error.code === "VALIDATION") {
    return json({ error: { code: error.code, message: "每日判定截止时间无效", requestId } }, 400);
  }
  return json({
    error: { code: "DATABASE", message: "每日判定操作暂不可用，请稍后重试", requestId },
  }, 503);
}

function adminManualSourceId(pathname: string): string | null {
  const matched = /^\/api\/admin\/sources\/([a-z][a-z0-9_-]{0,127})\/run$/.exec(pathname);
  return matched?.[1] ?? null;
}

function adminDraftThesisIdFromPath(pathname: string): string | null {
  const matched = /^\/api\/admin\/theses\/([^/]+)\/draft$/.exec(pathname);
  return matched !== null && isAdminThesisId(matched[1]) ? matched[1] : null;
}

function isAdminDraftPath(pathname: string): boolean {
  return /^\/api\/admin\/theses\/[^/]+\/draft$/.test(pathname);
}

function administrativeDraftVersionIdFromPath(pathname: string): string | null {
  const matched = /^\/api\/admin\/thesis-versions\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
  return matched?.[1] ?? null;
}

function isAdministrativeDraftEditPath(pathname: string): boolean {
  return /^\/api\/admin\/thesis-versions\/[^/]+$/.test(pathname);
}

function administrativeThesisPublicationFromPath(
  pathname: string,
): { readonly versionId: string; readonly action: ThesisPublicationAction } | null {
  const matched = /^\/api\/admin\/thesis-versions\/([A-Za-z0-9_-]{1,128})\/(publish|withdraw)$/.exec(pathname);
  return matched === null ? null : { versionId: matched[1]!, action: matched[2] as ThesisPublicationAction };
}

function isAdministrativeThesisPublicationPath(pathname: string): boolean {
  return /^\/api\/admin\/thesis-versions\/[^/]+\/(?:publish|withdraw)$/.test(pathname);
}

function administrativeThesisReviewFromPath(
  pathname: string,
): { readonly versionId: string } | null {
  const matched = /^\/api\/admin\/thesis-versions\/([A-Za-z0-9_-]{1,128})\/review$/.exec(pathname);
  return matched === null ? null : { versionId: matched[1]! };
}

function isAdministrativeThesisReviewPath(pathname: string): boolean {
  return /^\/api\/admin\/thesis-versions\/[^/]+\/review$/.test(pathname);
}

function adminThesisEvaluateIdFromPath(pathname: string): string | null {
  const matched = /^\/api\/admin\/theses\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/evaluate$/.exec(pathname);
  return matched?.[1] ?? null;
}

function isAdminThesisEvaluatePath(pathname: string): boolean {
  return /^\/api\/admin\/theses\/[^/]+\/evaluate$/.test(pathname);
}

function adminDailyBriefDateFromPath(pathname: string): string | null {
  const matched = /^\/api\/admin\/daily\/([^/]+)$/.exec(pathname);
  return matched?.[1] ?? null;
}

function adminDailyBriefPublishDateFromPath(pathname: string): string | null {
  const matched = /^\/api\/admin\/daily\/([^/]+)\/publish$/.exec(pathname);
  return matched?.[1] ?? null;
}

interface AdministrativeThesisEvaluateBody {
  readonly reason: string;
  readonly cutoff: string | null;
}

/**
 * A manual re-evaluation carries only the audit reason and an optional cutoff. It cannot supply
 * evidence, weights or a stage, because those are rebuilt by the shared evaluation core.
 */
async function parseAdministrativeThesisEvaluateBody(
  request: Request,
): Promise<AdministrativeThesisEvaluateBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["reason", "cutoff", "confirm"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (record.confirm !== true) return null;
    const reason = boundedText(record.reason, 500);
    if (reason === null) return null;
    if (record.cutoff === undefined || record.cutoff === null) return { reason, cutoff: null };
    if (typeof record.cutoff !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.cutoff)) return null;
    if (new Date(record.cutoff).toISOString() !== record.cutoff) return null;
    return { reason, cutoff: record.cutoff };
  } catch {
    return null;
  }
}

function evaluationBlockedMessage(reasonCode: string): string {
  if (reasonCode === "PENDING_RESEARCH_APPROVAL") return "该论点尚未通过研究审核，不生成草稿";
  if (reasonCode === "PRODUCTION_EVALUATION_DISABLED") return "该论点的生产评估已关闭";
  if (reasonCode === "MISSING_EVALUATION_INPUT") return "缺少该截止时间的评估输入";
  if (reasonCode === "DIRECTION_UNAVAILABLE") return "方向不可用，未生成草稿";
  if (reasonCode === "CONFIDENCE_UNAVAILABLE") return "置信度不可用，未生成草稿";
  if (reasonCode === "NO_SELECTED_EVIDENCE") return "该截止时间没有可用证据";
  return "当前无法生成草稿";
}

interface AdministrativeDailyPublicationBody {
  readonly cutoff: string;
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly reason: string;
  readonly expectedFreezeKey: string | null;
}

/**
 * Accepts only editorial copy plus the concurrency token. Targets are resolved server-side from the
 * cutoff so a caller cannot choose which public content a daily brief freezes.
 */
async function parseAdministrativeDailyPublicationBody(
  request: Request,
): Promise<AdministrativeDailyPublicationBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set([
      "cutoff", "headline", "summary", "topChanges", "reason", "expectedFreezeKey", "confirm",
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (record.confirm !== true || typeof record.cutoff !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.cutoff)) return null;
    if (new Date(record.cutoff).toISOString() !== record.cutoff) return null;
    const headline = boundedText(record.headline, 200);
    const summary = boundedText(record.summary, 2_000);
    const reason = boundedText(record.reason, 500);
    if (headline === null || summary === null || reason === null) return null;

    const rawChanges = record.topChanges;
    if (!Array.isArray(rawChanges) || rawChanges.length > 3) return null;
    const topChanges: string[] = [];
    for (const item of rawChanges) {
      const changeId = boundedText(item, 128);
      if (changeId === null || topChanges.includes(changeId)) return null;
      topChanges.push(changeId);
    }

    const expectedFreezeKey = record.expectedFreezeKey === undefined || record.expectedFreezeKey === null
      ? null
      : boundedText(record.expectedFreezeKey, 160);
    if (record.expectedFreezeKey !== undefined && record.expectedFreezeKey !== null && expectedFreezeKey === null) {
      return null;
    }

    return { cutoff: record.cutoff, headline, summary, topChanges, reason, expectedFreezeKey };
  } catch {
    return null;
  }
}

interface AdministrativeThesisReviewBody {
  readonly thesisId: string;
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
  readonly reason: string;
}

/**
 * Accepts only the reviewed transition identity, the decision and a reason. Evidence, calculation
 * and weight fields stay out of the administrative boundary because they are rebuildable through
 * the evaluation workflow.
 */
async function parseAdministrativeThesisReviewBody(
  request: Request,
): Promise<AdministrativeThesisReviewBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "beforeVersionId", "decision", "reason", "confirm"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (
      record.confirm !== true
      || typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || (record.decision !== "approved" && record.decision !== "rejected")
    ) return null;
    const beforeVersionId = boundedText(record.beforeVersionId, 128);
    const reason = boundedText(record.reason, 500);
    if (beforeVersionId === null || reason === null) return null;
    return {
      thesisId: record.thesisId,
      beforeVersionId,
      decision: record.decision,
      reason,
    };
  } catch {
    return null;
  }
}

/** Reviews are audit records: only the reviewed identity and the decision leave the Worker. */
function thesisChangeReviewResponse(review: ThesisChangeReviewRecord): {
  readonly thesisId: string;
  readonly afterVersionId: string;
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
} {
  return {
    thesisId: review.thesisId,
    afterVersionId: review.afterVersionId,
    beforeVersionId: review.beforeVersionId,
    decision: review.decision,
  };
}

async function parseManualSourceRunBody(request: Request): Promise<{ readonly reason: string } | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.reason !== "string") return null;
    const reason = record.reason.trim();
    return reason.length >= 1 && reason.length <= 500 ? { reason } : null;
  } catch {
    return null;
  }
}

interface AdministrativeDraftEditBody {
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly summary: string | undefined;
  readonly invalidation: string | undefined;
  readonly reason: string;
}

async function parseAdministrativeDraftEditBody(request: Request): Promise<AdministrativeDraftEditBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "expectedVersion", "summary", "invalidation", "reason"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (
      typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || !Number.isInteger(record.expectedVersion)
      || (record.expectedVersion as number) < 1
      || typeof record.reason !== "string"
    ) return null;
    const summary = editableText(record.summary, 500);
    const invalidation = editableText(record.invalidation, 2_000);
    const reason = boundedText(record.reason, 500);
    if (
      reason === null
      || summary === null
      || invalidation === null
      || (summary === undefined && invalidation === undefined)
    ) return null;
    return {
      thesisId: record.thesisId,
      expectedVersion: record.expectedVersion as number,
      summary: summary ?? undefined,
      invalidation: invalidation ?? undefined,
      reason,
    };
  } catch {
    return null;
  }
}

interface AdministrativeThesisPublicationBody {
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

async function parseAdministrativeThesisPublicationBody(
  request: Request,
): Promise<AdministrativeThesisPublicationBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "expectedVersion", "reason", "confirm"]);
    if (
      Object.keys(record).some((key) => !allowed.has(key))
      || record.confirm !== true
      || typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || !Number.isInteger(record.expectedVersion)
      || (record.expectedVersion as number) < 1
    ) return null;
    const reason = boundedText(record.reason, 500);
    return reason === null ? null : {
      thesisId: record.thesisId,
      expectedVersion: record.expectedVersion as number,
      reason,
    };
  } catch {
    return null;
  }
}

function publicationResponse(transition: ThesisPublicationTransition): {
  readonly action: ThesisPublicationAction;
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly currentPublished: Omit<NonNullable<ThesisPublicationTransition["currentPublished"]>, "publishedBy"> | null;
} {
  const current = transition.currentPublished;
  return {
    action: transition.action,
    thesisId: transition.thesisId,
    expectedVersion: transition.expectedVersion,
    currentPublished: current === null ? null : {
      id: current.id,
      thesisId: current.thesisId,
      version: current.version,
      status: current.status,
      direction: current.direction,
      stage: current.stage,
      confidence: current.confidence,
      summary: current.summary,
      invalidation: current.invalidation,
      basedOnCutoff: current.basedOnCutoff,
      publishedAt: current.publishedAt,
    },
  };
}

function editableText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, maximumLength);
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && [...normalized].length <= maximumLength ? normalized : null;
}

function parseIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  const key = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key) ? key : null;
}

function publicThesisSlug(pathname: string): string | null {
  const matched = /^\/api\/v1\/theses\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  return matched?.[1] ?? null;
}

function publicIndicatorIdFromPath(pathname: string): string | null {
  const matched = /^\/api\/v1\/indicators\/([^/]+)\/series$/.exec(pathname);
  return matched?.[1] ?? null;
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

function publicDailyBriefDate(pathname: string): string | null {
  const matched = /^\/api\/v1\/daily\/([^/]+)$/.exec(pathname);
  return matched?.[1] ?? null;
}

function publicCategory(pathname: string): PublicMarketCategory | null {
  const matched = /^\/api\/v1\/categories\/([a-z]+)$/.exec(pathname);
  if (matched === null) return null;
  const category = matched[1];
  return PUBLIC_MARKET_CATEGORIES.includes(category as PublicMarketCategory)
    ? category as PublicMarketCategory
    : null;
}

function latestCategoryCutoff(page: CategoryPageModel): string | null {
  return latestThesisCutoff(page.theses);
}

function latestThesisCutoff(theses: readonly ThesisCardModel[]): string | null {
  return theses.reduce<string | null>((latest, thesis) => (
    latest === null || thesis.basedOnCutoff > latest ? thesis.basedOnCutoff : latest
  ), null);
}

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  dependencies: ScheduledHandlerDependencies = {},
): Promise<ScheduledHandlerOutcome> {
  const logger = dependencies.logger ?? console;
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  const job = cronJob(controller.cron);
  const automaticPublicationEnabled = env.ENABLE_AUTO_PUBLICATION === "true";

  if (env.ENABLE_CRON !== "true") {
    log(logger, "info", {
      handler: "cron",
      scheduledAt,
      cron: controller.cron,
      environment: env.APP_ENV,
      job,
      enabled: false,
      automaticPublicationEnabled,
      outcome: "noop",
    });
    return { job, scheduledAt, outcome: "noop", sourcesDispatched: 0 };
  }

  if (job === "unknown") {
    log(logger, "info", {
      handler: "cron",
      scheduledAt,
      cron: controller.cron,
      environment: env.APP_ENV,
      job,
      enabled: true,
      automaticPublicationEnabled,
      outcome: "noop",
    });
    return { job, scheduledAt, outcome: "noop", sourcesDispatched: 0 };
  }

  const nowMs = dependencies.nowMs ?? Date.now;
  const startedAt = nowMs();
  try {
    if (job === "evaluation") {
      const evaluate = dependencies.evaluate ?? evaluateFromCloudflareBindings;
      const result = await evaluate({ scheduledAt }, env);
      const blockCodes = uniqueEvaluationBlockCodes(result);
      log(logger, result.outcome === "completed" ? "info" : "warn", {
        handler: "cron",
        scheduledAt,
        cron: controller.cron,
        environment: env.APP_ENV,
        job,
        enabled: true,
        automaticPublicationEnabled,
        outcome: result.outcome,
        briefDate: result.briefDate,
        thesesAddressed: result.theses.length,
        draftsReady: result.draftsReady,
        blockedTheses: result.blockedCount,
        errorCode: blockCodes[0] ?? null,
        reasonCodes: blockCodes,
        durationMs: Math.max(0, nowMs() - startedAt),
      });
      return {
        job,
        scheduledAt,
        outcome: result.outcome,
        sourcesDispatched: 0,
        briefDate: result.briefDate,
        thesesAddressed: result.theses.length,
        draftsReady: result.draftsReady,
        blockedTheses: result.blockedCount,
        evaluationBlockCodes: blockCodes,
      };
    }
    if (job === "publication") {
      const result = automaticPublicationEnabled
        ? await (dependencies.publishDaily ?? publishDailyFromCloudflareBindings)({ scheduledAt }, env)
        : automaticPublicationDisabledResult({ scheduledAt });
      log(logger, "warn", {
        handler: "cron",
        scheduledAt,
        cron: controller.cron,
        environment: env.APP_ENV,
        job,
        enabled: true,
        automaticPublicationEnabled,
        outcome: result.outcome,
        briefDate: result.briefDate,
        publicationCandidates: result.candidateCount,
        errorCode: result.delayCodes[0] ?? "EVALUATION_INCOMPLETE",
        reasonCodes: result.delayCodes,
        durationMs: Math.max(0, nowMs() - startedAt),
      });
      return {
        job,
        scheduledAt,
        outcome: result.outcome,
        sourcesDispatched: 0,
        briefDate: result.briefDate,
        publicationCandidates: result.candidateCount,
        publicationDelayCodes: result.delayCodes,
        automaticPublicationEnabled,
      };
    }

    const group = dispatchGroup(job);
    if (group === null) throw new DailyScheduleError("VALIDATION", "Cron 分派状态无效");
    const dispatch = dependencies.dispatch ?? dispatchFromCloudflareBindings;
    const results = await dispatch({ cutoff: scheduledAt, limit: 20, group }, env);
    for (const result of results) logSourceResult(logger, env, job, scheduledAt, result);
    log(logger, "info", {
      handler: "cron",
      scheduledAt,
      cron: controller.cron,
      environment: env.APP_ENV,
      job,
      enabled: true,
      automaticPublicationEnabled,
      outcome: "completed",
      sourcesDispatched: results.length,
      durationMs: Math.max(0, nowMs() - startedAt),
    });
    return { job, scheduledAt, outcome: "completed", sourcesDispatched: results.length };
  } catch (error) {
    log(logger, "error", {
      handler: "cron",
      scheduledAt,
      cron: controller.cron,
      environment: env.APP_ENV,
      job,
      enabled: true,
      automaticPublicationEnabled,
      outcome: "failed",
      errorCode: safeErrorCode(error),
      durationMs: Math.max(0, nowMs() - startedAt),
    });
    throw error;
  }
}

async function evaluateFromCloudflareBindings(
  request: DailyEvaluationRequest,
  env: Env,
): Promise<DailyEvaluationRunResult> {
  return new DailyEvaluationJob(
    {
      loadEvaluationInputs: (seeds, cutoff) =>
        new D1DailyScheduleRepository(env.DB).loadEvaluationInputs(seeds, cutoff),
    },
    {
      create: (candidate) =>
        new ThesisDraftModule(new D1ThesisDraftRepository(env.DB)).create(candidate),
    },
  ).run(request);
}

async function publishDailyFromCloudflareBindings(
  request: DailyPublicationRequest,
  env: Env,
): Promise<DailyPublicationRunResult> {
  return new DailyPublicationJob(new D1DailyScheduleRepository(env.DB)).run(request);
}

async function dispatchFromCloudflareBindings(
  request: DispatchSourcesRequest,
  env: Env,
): Promise<DispatchSourceResult[]> {
  const schedules = new D1SourceSchedulingRepository(env.DB);
  return dispatchDueSources(request, {
    schedules,
    ingestion: new D1IngestionRepository(env.DB),
    snapshots: new R2RawSnapshotStore(env.RAW),
    adapters: createSourceAdapterRegistry({
      usdaFasApiKey: env.USDA_FAS_API_KEY,
      eiaApiKey: env.EIA_API_KEY,
      censusApiKey: env.CENSUS_API_KEY,
      unctadClientId: env.UNCTAD_CLIENT_ID,
      unctadApiKey: env.UNCTAD_API_KEY,
    }),
    fetch: globalThis.fetch.bind(globalThis),
  });
}

function cronJob(cron: string): CronJob {
  if (cron === QUARTER_HOURLY_CRON) return "quarter_hour_ingestion";
  if (cron === HOURLY_CRON) return "hourly_ingestion";
  if (cron === EVALUATION_CRON) return "evaluation";
  if (cron === PUBLICATION_CRON) return "publication";
  return "unknown";
}

function dispatchGroup(job: CronJob): DispatchGroup | null {
  if (job === "quarter_hour_ingestion") return "quarter_hourly";
  if (job === "hourly_ingestion") return "hourly";
  return null;
}

function uniqueEvaluationBlockCodes(
  result: DailyEvaluationRunResult,
): readonly DailyEvaluationBlockCode[] {
  return [...new Set(result.theses.flatMap((thesis) =>
    thesis.status === "blocked" ? [thesis.reasonCode] : []
  ))];
}

function logSourceResult(
  logger: SafeLogger,
  env: Env,
  job: CronJob,
  scheduledAt: string,
  result: DispatchSourceResult,
): void {
  const outcome = result.outcome?.collectionStatus ?? "dispatcher_failed";
  const errorCode = result.dispatcherErrorCode ?? result.outcome?.run.errorCode ?? null;
  const level =
    errorCode === "DATABASE" || errorCode === "STORAGE"
      ? "error"
      : outcome === "failed" || outcome === "partial" || outcome === "dispatcher_failed"
        ? "warn"
        : "info";
  log(logger, level, {
    handler: "cron.source",
    scheduledAt,
    environment: env.APP_ENV,
    job,
    sourceId: result.sourceId,
    runId: result.outcome?.run.id ?? null,
    outcome,
    errorCode,
  });
}

function safeErrorCode(error: unknown): SourceErrorCode {
  if (error instanceof SourceCollectionError || error instanceof DailyScheduleError) return error.code;
  return "DATABASE";
}

function log(
  logger: SafeLogger,
  level: "info" | "warn" | "error",
  fields: Record<string, unknown>,
): void {
  logger[level](JSON.stringify(fields));
}

const worker = {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  scheduled(controller, env, context) {
    const completion = handleScheduled(controller, env).then(() => undefined);
    context.waitUntil(completion);
    return completion;
  },
} satisfies ExportedHandler<Env>;

export default worker;
