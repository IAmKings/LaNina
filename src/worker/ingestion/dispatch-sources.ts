import type {
  CollectContext,
  DispatchCandidate,
  IngestionRepository,
  RawSnapshotStore,
  SourceAdapter,
  DispatchGroup,
  SourceErrorCode,
  SourceScheduleRepository,
} from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { runSourceIngestion, type RunSourceOutcome } from "./run-source";
import { advanceDuePastCutoff, parseCanonicalUtc } from "./time";

export interface DispatchSourcesRequest {
  cutoff: string;
  limit: number;
  group: DispatchGroup;
}

export interface DispatchSourceResult {
  sourceId: string;
  scheduledAt: string;
  kind: DispatchCandidate["kind"];
  outcome: RunSourceOutcome | null;
  dispatcherErrorCode: SourceErrorCode | null;
}

export interface DispatchSourcesDependencies {
  schedules: SourceScheduleRepository;
  ingestion: IngestionRepository;
  snapshots: RawSnapshotStore;
  adapters: ReadonlyMap<string, SourceAdapter>;
  fetch: CollectContext["fetch"];
  now?: () => string;
  createId?: () => string;
}

export async function dispatchDueSources(
  request: DispatchSourcesRequest,
  dependencies: DispatchSourcesDependencies,
): Promise<DispatchSourceResult[]> {
  parseCanonicalUtc(request.cutoff, "dispatch cutoff");
  const candidates = await dependencies.schedules.listDispatchCandidates(
    request.cutoff,
    request.limit,
    request.group,
  );
  const results: DispatchSourceResult[] = [];

  for (const candidate of candidates) {
    try {
      const adapter = dependencies.adapters.get(candidate.adapterKey) ?? missingAdapter(candidate);
      const nextDueAt =
        candidate.kind === "scheduled"
          ? advanceDuePastCutoff(
              candidate.scheduledAt,
              request.cutoff,
              candidate.cadenceMinutes,
            )
          : null;
      const outcome = await runSourceIngestion(
        {
          sourceId: candidate.sourceId,
          sourceUrl: candidate.sourceUrl,
          scheduledAt: candidate.scheduledAt,
          nextDueAt,
        },
        {
          adapter,
          repository: dependencies.ingestion,
          snapshots: dependencies.snapshots,
          fetch: dependencies.fetch,
          now: dependencies.now,
          createId: dependencies.createId,
        },
      );
      results.push({
        sourceId: candidate.sourceId,
        scheduledAt: candidate.scheduledAt,
        kind: candidate.kind,
        outcome,
        dispatcherErrorCode: null,
      });
    } catch (error) {
      results.push({
        sourceId: candidate.sourceId,
        scheduledAt: candidate.scheduledAt,
        kind: candidate.kind,
        outcome: null,
        dispatcherErrorCode: error instanceof SourceCollectionError ? error.code : "VALIDATION",
      });
    }
  }

  return results;
}

function missingAdapter(candidate: DispatchCandidate): SourceAdapter {
  return {
    key: candidate.adapterKey,
    collect: async () => {
      throw new SourceCollectionError("VALIDATION", "来源适配器未注册");
    },
  };
}
