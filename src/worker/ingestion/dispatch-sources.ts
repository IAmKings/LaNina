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
import { addMinutes, advanceDuePastCutoff, parseCanonicalUtc } from "./time";

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

/** 有界并发：一轮 dispatch 最多同时处理的来源数（其余在共享队列中等待）。 */
export const DISPATCH_CONCURRENCY = 4;

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
  // 结果槽位按候选下标预分配：无论完成顺序如何，results 的顺序与串行版一致。
  const results: DispatchSourceResult[] = new Array(candidates.length);

  // 简单 worker-pool：每个 worker 从共享游标取下一个候选。JS 单线程下游标的读取与
  // 前进之间没有 await，不会重复领取；除游标外，各源的处理之间不共享可变状态
  //（runSourceIngestion 的仓储/快照依赖各自独立，结果只写入自己的槽位）。
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(DISPATCH_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await collectCandidate(candidates[index]!, request, dependencies);
      }
    },
  );
  await Promise.all(workers);

  return results;
}

async function collectCandidate(
  candidate: DispatchCandidate,
  request: DispatchSourcesRequest,
  dependencies: DispatchSourcesDependencies,
): Promise<DispatchSourceResult> {
  let nextDueAt: string | null = null;
  try {
    nextDueAt =
      candidate.kind === "scheduled"
        ? advanceDuePastCutoff(
            candidate.scheduledAt,
            request.cutoff,
            candidate.cadenceMinutes,
          )
        : null;
    const adapter = dependencies.adapters.get(candidate.adapterKey) ?? missingAdapter(candidate);
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
    return {
      sourceId: candidate.sourceId,
      scheduledAt: candidate.scheduledAt,
      kind: candidate.kind,
      outcome,
      dispatcherErrorCode: null,
    };
  } catch (error) {
    // 病态候选退避（M7）：走到这里的异常（坏 cadence、持久层故障等）没有经过
    // runSourceIngestion 的失败落库路径，next_due_at 不会推进，候选会在每个调度
    // tick 重复失败并占住批次名额。这里 best-effort 补记一次失败并推进回退。
    await recordPathologicalBackoff(candidate, request, dependencies, nextDueAt, error);
    return {
      sourceId: candidate.sourceId,
      scheduledAt: candidate.scheduledAt,
      kind: candidate.kind,
      outcome: null,
      dispatcherErrorCode: error instanceof SourceCollectionError ? error.code : "VALIDATION",
    };
  }
}

/**
 * 病态候选退避：复用 runSourceIngestion 的失败路径落一条 failed 运行并推进
 * next_due_at（scheduled 类按源 cadence 对齐；cadence 本身病态时固定 +1h，保证
 * 下个 tick 不再入选且不产生漂移）。重试类候选的退避由 source_runs 重试状态机
 * 负责（claim/persist 已消耗重试名额），此处不推进。任何退避失败都不得改变本轮
 * 结果聚合/日志语义。
 */
async function recordPathologicalBackoff(
  candidate: DispatchCandidate,
  request: DispatchSourcesRequest,
  dependencies: DispatchSourcesDependencies,
  nextDueAt: string | null,
  error: unknown,
): Promise<void> {
  if (candidate.kind !== "scheduled") return;
  try {
    await runSourceIngestion(
      {
        sourceId: candidate.sourceId,
        sourceUrl: candidate.sourceUrl,
        scheduledAt: candidate.scheduledAt,
        nextDueAt: nextDueAt ?? fallbackBackoffDue(candidate, request),
      },
      {
        adapter: backoffAdapter(error),
        repository: dependencies.ingestion,
        snapshots: dependencies.snapshots,
        fetch: dependencies.fetch,
        now: dependencies.now,
        createId: dependencies.createId,
      },
    );
  } catch {
    // best-effort：退避补记失败时保持既有聚合/日志语义，不掩盖原始 dispatcher 错误。
  }
}

function fallbackBackoffDue(
  candidate: DispatchCandidate,
  request: DispatchSourcesRequest,
): string {
  try {
    return advanceDuePastCutoff(candidate.scheduledAt, request.cutoff, candidate.cadenceMinutes);
  } catch {
    // cadence 非正整数等病态：固定 +1h 退避，让下轮调度跳过该候选。
    return addMinutes(request.cutoff, 60);
  }
}

function backoffAdapter(error: unknown): SourceAdapter {
  return {
    key: "dispatch-backoff",
    collect: async () => {
      throw error instanceof SourceCollectionError
        ? error
        : new SourceCollectionError("VALIDATION", "来源调度出现未分类错误", { cause: error });
    },
  };
}

function missingAdapter(candidate: DispatchCandidate): SourceAdapter {
  return {
    key: candidate.adapterKey,
    collect: async () => {
      throw new SourceCollectionError("VALIDATION", "来源适配器未注册");
    },
  };
}
