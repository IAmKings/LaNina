import type {
  CollectionStatus,
  CollectContext,
  SourceAdapter,
  SourceErrorCode,
} from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { parseCanonicalUtc } from "./time";

export interface LiveSmokeTarget {
  sourceId: string;
  sourceUrl: string;
  adapter: SourceAdapter;
}

export interface LiveSmokeLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface LiveSmokeSourceResult {
  sourceId: string;
  outcome: "ok" | "warning";
  collectionStatus: CollectionStatus | null;
  errorCode: SourceErrorCode | null;
}

export interface LiveSmokeReport {
  outcome: "completed" | "noop";
  sourcesChecked: number;
  results: LiveSmokeSourceResult[];
}

export interface RunLiveSmokeRequest {
  targets: readonly LiveSmokeTarget[];
  scheduledAt: string;
  fetchedAt: string;
  fetch: CollectContext["fetch"];
  logger?: LiveSmokeLogger;
}

const defaultLogger: LiveSmokeLogger = console;

/**
 * Runs adapter contracts without persistence. Target selection is composed
 * separately so this module never discovers arbitrary URLs or touches D1/R2.
 */
export async function runLiveSmoke(request: RunLiveSmokeRequest): Promise<LiveSmokeReport> {
  parseCanonicalUtc(request.scheduledAt, "live smoke scheduledAt");
  parseCanonicalUtc(request.fetchedAt, "live smoke fetchedAt");
  assertUniqueTargets(request.targets);

  const logger = request.logger ?? defaultLogger;
  if (request.targets.length === 0) {
    logger.info(JSON.stringify({
      handler: "live_smoke",
      outcome: "noop",
      sourcesChecked: 0,
    }));
    return { outcome: "noop", sourcesChecked: 0, results: [] };
  }

  const results: LiveSmokeSourceResult[] = [];
  for (const target of request.targets) {
    let sourceResult: LiveSmokeSourceResult;
    try {
      const collected = await target.adapter.collect({
        sourceId: target.sourceId,
        sourceUrl: target.sourceUrl,
        scheduledAt: request.scheduledAt,
        fetchedAt: request.fetchedAt,
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch: request.fetch,
      });
      if (collected.sourceId !== target.sourceId || collected.fetchedAt !== request.fetchedAt) {
        throw new SourceCollectionError("VALIDATION", "live smoke 采集结果身份不匹配");
      }
      sourceResult = {
        sourceId: target.sourceId,
        outcome:
          collected.status === "partial" || collected.warnings.length > 0 ? "warning" : "ok",
        collectionStatus: collected.status,
        errorCode: null,
      };
    } catch (error) {
      sourceResult = {
        sourceId: target.sourceId,
        outcome: "warning",
        collectionStatus: null,
        errorCode: safeSourceErrorCode(error),
      };
    }

    results.push(sourceResult);
    logger[sourceResult.outcome === "ok" ? "info" : "warn"](JSON.stringify({
      handler: "live_smoke.source",
      sourceId: sourceResult.sourceId,
      outcome: sourceResult.outcome,
      errorCode: sourceResult.errorCode,
    }));
  }

  return { outcome: "completed", sourcesChecked: results.length, results };
}

function assertUniqueTargets(targets: readonly LiveSmokeTarget[]): void {
  const sourceIds = new Set<string>();
  for (const target of targets) {
    if (sourceIds.has(target.sourceId)) {
      throw new SourceCollectionError("VALIDATION", "live smoke 来源不能重复");
    }
    sourceIds.add(target.sourceId);
  }
}

function safeSourceErrorCode(error: unknown): SourceErrorCode {
  return error instanceof SourceCollectionError ? error.code : "VALIDATION";
}
