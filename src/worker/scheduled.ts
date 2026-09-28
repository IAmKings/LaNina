import type { DispatchGroup, SourceErrorCode } from "../domain/ingestion";
import { SourceCollectionError } from "../domain/ingestion";
import { D1SourceSchedulingRepository } from "./adapters/storage/cloudflare-scheduling";
import { D1ClimatologyRepository } from "./adapters/storage/cloudflare-climatology";
import { D1DerivedIndicatorRepository } from "./adapters/storage/cloudflare-derived-indicators";
import { R2RawSnapshotStore } from "./adapters/storage/cloudflare-ingestion";
import { dispatchDueSources, type DispatchSourceResult, type DispatchSourcesRequest } from "./ingestion/dispatch-sources";
import {
  DailyEvaluationJob,
  DailyPublicationJob,
  DailyScheduleError,
  automaticPublicationDisabledResult,
  type DailyEvaluationBlockCode,
  type DailyEvaluationRequest,
  type DailyEvaluationRunResult,
  type DailyPublicationDelayCode,
  type DailyPublicationRequest,
  type DailyPublicationRunResult,
} from "./modules/daily-schedule";
import {
  ClimatologyRefreshJob,
  type ClimatologyRefreshRequest,
  type ClimatologyRefreshResult,
} from "./modules/climatology-refresh";
import {
  DerivedIndicatorRecalculationJob,
  DerivedIndicatorError,
  type DerivedRecalculationRequest,
  type DerivedRecalculationResult,
} from "./modules/derived-indicators";
import { AppContext } from "./context";
import { HOURLY_CRON, PUBLICATION_CRON, QUARTER_HOURLY_CRON, EVALUATION_CRON, type Env } from "./index";

/**
 * The four Cron Trigger jobs: two ingestion cadences, evaluation and publication. The ENABLE_CRON
 * gate, the structured per-job logs and the aggregated partial/completed outcome all live here so
 * the worker entry (index.ts) stays a thin export.
 */

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

type RefreshClimatologyFromBindings = (
  request: ClimatologyRefreshRequest,
  env: Env,
) => Promise<ClimatologyRefreshResult>;

type RecalculateDerivedFromBindings = (
  request: DerivedRecalculationRequest,
  env: Env,
) => Promise<DerivedRecalculationResult>;

type PublishDailyFromBindings = (
  request: DailyPublicationRequest,
  env: Env,
) => Promise<DailyPublicationRunResult>;

interface SafeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ScheduledHandlerDependencies {
  dispatch?: DispatchFromBindings;
  refreshClimatology?: RefreshClimatologyFromBindings;
  recalculateDerived?: RecalculateDerivedFromBindings;
  evaluate?: EvaluateFromBindings;
  publishDaily?: PublishDailyFromBindings;
  logger?: SafeLogger;
  nowMs?: () => number;
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
      // 气候态刷新先于派生重算：距平需要 12 个月气候态。单区采集失败记入日志后继续，
      // D1 故障向上抛出。派生重算再于逐论点评估之前执行。手动 evaluate 不走这两步。
      const refreshClimatology =
        dependencies.refreshClimatology ?? refreshClimatologyFromCloudflareBindings;
      const climatology = await refreshClimatology({ scheduledAt }, env);
      const climatologyFailures = climatology.outcomes.filter((item) => item.status === "failed");
      log(logger, climatologyFailures.length === 0 ? "info" : "warn", {
        handler: "cron",
        scheduledAt,
        cron: controller.cron,
        environment: env.APP_ENV,
        job,
        step: "climatology_refresh",
        enabled: true,
        outcome: climatologyFailures.length === 0 ? "completed" : "partial",
        regions: climatology.outcomes.length,
        failed: climatologyFailures.length,
        errorCode: climatologyFailures[0]?.errorCode ?? null,
      });
      const recalculateDerived =
        dependencies.recalculateDerived ?? recalculateDerivedFromCloudflareBindings;
      await recalculateDerived({ scheduledAt }, env);
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
    // 聚合 outcome：任一来源未成功（dispatcher 失败、采集 failed/partial）即 partial，
    // 全部成功才是 completed。partial 属于 ScheduledHandlerOutcome 已声明的既有值。
    const outcome = results.some(sourceDispatchFailed) ? "partial" as const : "completed" as const;
    log(logger, outcome === "completed" ? "info" : "warn", {
      handler: "cron",
      scheduledAt,
      cron: controller.cron,
      environment: env.APP_ENV,
      job,
      enabled: true,
      automaticPublicationEnabled,
      outcome,
      sourcesDispatched: results.length,
      durationMs: Math.max(0, nowMs() - startedAt),
    });
    return { job, scheduledAt, outcome, sourcesDispatched: results.length };
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

async function refreshClimatologyFromCloudflareBindings(
  request: ClimatologyRefreshRequest,
  env: Env,
): Promise<ClimatologyRefreshResult> {
  return new ClimatologyRefreshJob(
    new D1ClimatologyRepository(env.DB),
    fetch,
    new R2RawSnapshotStore(env.RAW),
  ).run(request);
}

async function recalculateDerivedFromCloudflareBindings(
  request: DerivedRecalculationRequest,
  env: Env,
): Promise<DerivedRecalculationResult> {
  return new DerivedIndicatorRecalculationJob(new D1DerivedIndicatorRepository(env.DB)).run(request);
}

async function evaluateFromCloudflareBindings(
  request: DailyEvaluationRequest,
  env: Env,
): Promise<DailyEvaluationRunResult> {
  const app = AppContext.from(env);
  return new DailyEvaluationJob(
    {
      loadEvaluationInputs: (seeds, cutoff) =>
        app.dailyScheduleRepository().loadEvaluationInputs(seeds, cutoff),
    },
    {
      create: (candidate) => app.thesisDrafts().create(candidate),
    },
  ).run(request);
}

async function publishDailyFromCloudflareBindings(
  request: DailyPublicationRequest,
  env: Env,
): Promise<DailyPublicationRunResult> {
  return new DailyPublicationJob(AppContext.from(env).dailyScheduleRepository()).run(request);
}

async function dispatchFromCloudflareBindings(
  request: DispatchSourcesRequest,
  env: Env,
): Promise<DispatchSourceResult[]> {
  const app = AppContext.from(env);
  return dispatchDueSources(request, {
    schedules: new D1SourceSchedulingRepository(env.DB),
    ingestion: app.ingestionRepository(),
    snapshots: app.snapshotStore(),
    adapters: app.adapterRegistry(),
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
      : sourceDispatchFailed(result)
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

/**
 * 「该源未成功」的统一判定，与 logSourceResult 的失败分级同一语义：dispatcher 自身失败
 * （无 outcome 或带 dispatcherErrorCode）与采集 failed/partial 都算未成功，供聚合 outcome 用。
 */
function sourceDispatchFailed(result: DispatchSourceResult): boolean {
  return result.dispatcherErrorCode !== null
    || result.outcome === null
    || result.outcome.collectionStatus === "failed"
    || result.outcome.collectionStatus === "partial";
}

function safeErrorCode(error: unknown): SourceErrorCode {
  if (
    error instanceof SourceCollectionError
    || error instanceof DailyScheduleError
    || error instanceof DerivedIndicatorError
  ) {
    return error.code;
  }
  return "DATABASE";
}

function log(
  logger: SafeLogger,
  level: "info" | "warn" | "error",
  fields: Record<string, unknown>,
): void {
  logger[level](JSON.stringify(fields));
}
