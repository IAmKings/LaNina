import type { FetchDependency, RawSnapshotStore, SourceErrorCode } from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { parseCanonicalUtc } from "../ingestion/time";
import {
  CLIMATOLOGY_SOURCE_CONFIGS,
  collectNasaPowerClimatology,
  type ClimatologySourceConfig,
} from "../adapters/sources/nasa-power-climatology";

/**
 * 月气候态刷新：评估 cron 在派生重算之前执行。气候态缓变，已有 12 个月且最新
 * fetched_at 落在 27 日以内则跳过网络。单区失败（网络、结构、覆盖不足、快照）
 * 记入结果并继续下一区，不挡住 USDA 派生；D1 故障向上抛出，当日评估 fail-closed。
 *
 * 观测挂在父源的固定槽位 source_run（scheduled_at = 1991-01-01），不改 sources
 * 健康计数。日采集继续独占来源健康。
 */

export const CLIMATOLOGY_REFRESH_INTERVAL_MS = 27 * 24 * 60 * 60 * 1000;

export interface ClimatologyFreshness {
  readonly monthCount: number;
  readonly newestFetchedAt: string | null;
}

export interface ClimatologyObservationWrite {
  readonly indicatorId: string;
  readonly observedAt: string;
  readonly periodStart: string;
  readonly value: number;
  readonly unit: string;
  readonly fetchedAt: string;
  readonly citationUrl: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ClimatologyPersistRequest {
  readonly sourceId: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly snapshotKey: string;
  readonly observations: readonly ClimatologyObservationWrite[];
}

export interface ClimatologyRefreshRepository {
  loadFreshness(indicatorId: string, cutoff: string): Promise<ClimatologyFreshness>;
  persist(request: ClimatologyPersistRequest): Promise<"written" | "unchanged">;
}

export type ClimatologyRegionStatus = "skipped_fresh" | "written" | "unchanged" | "failed";

export interface ClimatologyRegionOutcome {
  readonly sourceId: string;
  readonly indicatorId: string;
  readonly status: ClimatologyRegionStatus;
  readonly errorCode: SourceErrorCode | null;
}

export interface ClimatologyRefreshRequest {
  readonly scheduledAt: string;
}

export interface ClimatologyRefreshResult {
  readonly scheduledAt: string;
  readonly outcomes: readonly ClimatologyRegionOutcome[];
}

export class ClimatologyRefreshJob {
  constructor(
    private readonly repository: ClimatologyRefreshRepository,
    private readonly fetch: FetchDependency,
    private readonly snapshots: RawSnapshotStore,
    private readonly configs: readonly ClimatologySourceConfig[] = CLIMATOLOGY_SOURCE_CONFIGS,
  ) {}

  async run(request: ClimatologyRefreshRequest): Promise<ClimatologyRefreshResult> {
    const scheduledAt = parseCanonicalUtc(request.scheduledAt, "scheduledAt").toISOString();
    const outcomes: ClimatologyRegionOutcome[] = [];
    for (const config of this.configs) {
      outcomes.push(await this.refreshOne(config, scheduledAt));
    }
    return { scheduledAt, outcomes };
  }

  private async refreshOne(
    config: ClimatologySourceConfig,
    scheduledAt: string,
  ): Promise<ClimatologyRegionOutcome> {
    const freshness = await this.repository.loadFreshness(config.indicatorId, scheduledAt);
    if (freshness.monthCount > 12) {
      throw new SourceCollectionError("VALIDATION", "月气候态观测期超过 12 个月");
    }
    if (isFresh(freshness, scheduledAt)) {
      return outcome(config, "skipped_fresh", null);
    }
    let collected;
    try {
      collected = await collectNasaPowerClimatology(config, this.fetch, scheduledAt);
    } catch (error) {
      if (!(error instanceof SourceCollectionError) || error.code === "DATABASE") throw error;
      return outcome(config, "failed", error.code);
    }
    try {
      const snapshotKey = await this.snapshots.put({
        sourceId: collected.sourceId,
        scheduledAt: collected.fetchedAt,
        fetchedAt: collected.fetchedAt,
        contentHash: collected.contentHash,
        contentType: collected.contentType,
        body: collected.rawBody,
      });
      const persisted = await this.repository.persist({
        sourceId: collected.sourceId,
        fetchedAt: collected.fetchedAt,
        contentHash: collected.contentHash,
        snapshotKey,
        observations: collected.observations.map((observation) => {
          if (typeof observation.value !== "number" || observation.periodStart === null) {
            throw new SourceCollectionError("VALIDATION", "气候态观测缺少数值或观测期");
          }
          return {
            indicatorId: observation.indicatorId,
            observedAt: observation.observedAt,
            periodStart: observation.periodStart,
            value: observation.value,
            unit: observation.unit,
            fetchedAt: observation.fetchedAt,
            citationUrl: observation.citationUrl,
            metadata: observation.metadata,
          };
        }),
      });
      return outcome(config, persisted, null);
    } catch (error) {
      if (!(error instanceof SourceCollectionError) || error.code === "DATABASE" || error.code === "VALIDATION") {
        throw error;
      }
      return outcome(config, "failed", error.code);
    }
  }
}

function isFresh(freshness: ClimatologyFreshness, cutoff: string): boolean {
  if (freshness.monthCount !== 12 || freshness.newestFetchedAt === null) return false;
  const newest = parseCanonicalUtc(freshness.newestFetchedAt, "气候态 fetched_at").getTime();
  const cutoffMs = parseCanonicalUtc(cutoff, "scheduledAt").getTime();
  return cutoffMs >= newest && cutoffMs - newest < CLIMATOLOGY_REFRESH_INTERVAL_MS;
}

function outcome(
  config: ClimatologySourceConfig,
  status: ClimatologyRegionStatus,
  errorCode: SourceErrorCode | null,
): ClimatologyRegionOutcome {
  return {
    sourceId: config.sourceId,
    indicatorId: config.indicatorId,
    status,
    errorCode,
  };
}
