import { describe, expect, it, vi } from "vitest";

import type {
  CollectContext,
  CollectResult,
  DispatchCandidate,
  IngestionRepository,
  PersistCollectedRunInput,
  PersistedSourceRun,
  PersistFailedRunInput,
  SourceAdapter,
  SourceCursor,
} from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { fetchWithinTimeout } from "../adapters/sources/http";
import { D1SourceSchedulingRepository } from "../adapters/storage/cloudflare-scheduling";
import { DISPATCH_CONCURRENCY, dispatchDueSources } from "./dispatch-sources";

const CUTOFF = "2026-09-08T03:17:00.000Z";

describe("source dispatcher", () => {
  it("advances missed due slots past the cutoff and isolates one source failure", async () => {
    const candidates: DispatchCandidate[] = [
      {
        kind: "scheduled",
        sourceId: "source-a",
        sourceUrl: "https://example.test/a",
        adapterKey: "adapter-a",
        scheduledAt: "2026-09-08T00:00:00.000Z",
        cadenceMinutes: 60,
        retryCount: 0,
      },
      {
        kind: "scheduled",
        sourceId: "source-b",
        sourceUrl: "https://example.test/b",
        adapterKey: "adapter-b",
        scheduledAt: "2026-09-08T03:00:00.000Z",
        cadenceMinutes: 60,
        retryCount: 0,
      },
    ];
    const ingestion = new MemoryIngestionRepository();
    const secondCollect = vi.fn(unchangedAdapter("adapter-b").collect);
    const adapters = new Map<string, SourceAdapter>([
      [
        "adapter-a",
        {
          key: "adapter-a",
          collect: async () => {
            throw new SourceCollectionError("NETWORK", "provider detail", { retryable: true });
          },
        },
      ],
      ["adapter-b", { key: "adapter-b", collect: secondCollect }],
    ]);

    const results = await dispatchDueSources(
      { cutoff: CUTOFF, limit: 2, group: "hourly" },
      {
        schedules: { listDispatchCandidates: async () => candidates },
        ingestion,
        snapshots: { put: async () => "unused" },
        adapters,
        fetch: vi.fn<typeof fetch>(),
        now: () => CUTOFF,
        createId: (() => {
          let id = 0;
          return () => `dispatch-run-${++id}`;
        })(),
      },
    );

    expect(results).toMatchObject([
      { sourceId: "source-a", outcome: { collectionStatus: "failed" } },
      { sourceId: "source-b", outcome: { collectionStatus: "unchanged" } },
    ]);
    expect(ingestion.failed[0].nextDueAt).toBe("2026-09-08T04:00:00.000Z");
    expect(ingestion.collected[0].nextDueAt).toBe("2026-09-08T04:00:00.000Z");
    expect(secondCollect).toHaveBeenCalledOnce();
    expect(secondCollect.mock.calls[0][0].sourceId).toBe("source-b");
  });

  it("uses one parameterized retry-first query and blocks new due work behind pending retry", async () => {
    let sql = "";
    let values: unknown[] = [];
    const rows: DispatchCandidate[] = [];
    const database = {
      prepare: (statement: string) => {
        sql = statement;
        return {
          bind: (...bound: unknown[]) => {
            values = bound;
            return {
              all: async () => ({ success: true, results: rows, meta: {} }),
            };
          },
        };
      },
    } as unknown as D1Database;

    await new D1SourceSchedulingRepository(database).listDispatchCandidates(
      CUTOFF,
      4,
      "quarter_hourly",
    );

    expect(sql).toContain("ORDER BY dispatch_priority, dispatch_at, source_id");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("pending.next_retry_at IS NOT NULL");
    expect(sql).toContain("retry_claim_expires_at <= ?");
    expect(sql).toContain("? = 'quarter_hourly'");
    expect(sql).toContain("s.cadence_minutes < 60");
    expect(sql).toContain("s.cadence_minutes >= 60");
    expect(sql).not.toContain(CUTOFF);
    expect(values).toEqual([
      "quarter_hourly",
      CUTOFF,
      CUTOFF,
      CUTOFF,
      "quarter_hourly",
      "quarter_hourly",
      4,
    ]);
  });

  it("uses the hourly group only for cadence >= 60 scheduled work and never retries", async () => {
    let sql = "";
    let values: unknown[] = [];
    const database = {
      prepare: (statement: string) => {
        sql = statement;
        return {
          bind: (...bound: unknown[]) => {
            values = bound;
            return { all: async () => ({ success: true, results: [], meta: {} }) };
          },
        };
      },
    } as unknown as D1Database;

    await new D1SourceSchedulingRepository(database).listDispatchCandidates(CUTOFF, 20, "hourly");

    expect(sql).toContain("? = 'quarter_hourly'");
    expect(sql).toContain("? = 'hourly'");
    expect(values).toEqual(["hourly", CUTOFF, CUTOFF, CUTOFF, "hourly", "hourly", 20]);
  });

  it("rejects a dispatcher batch that can exceed the bounded candidate budget", async () => {
    const repository = new D1SourceSchedulingRepository({} as D1Database);
    await expect(repository.listDispatchCandidates(CUTOFF, 21, "hourly")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("processes 6 candidates with a peak concurrency of 4 and one result per candidate", async () => {
    const total = 6;
    const candidates: DispatchCandidate[] = Array.from({ length: total }, (_, index) => ({
      kind: "scheduled" as const,
      sourceId: `source-${index}`,
      sourceUrl: `https://example.test/${index}`,
      adapterKey: `adapter-${index}`,
      scheduledAt: "2026-09-08T00:00:00.000Z",
      cadenceMinutes: 60,
      retryCount: 0,
    }));

    // 假 fetch 用门闩（未释放的 promise）挂住每个请求，记录活动计数以观察峰值并发。
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const fetch = vi.fn(async (): Promise<Response> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
      active -= 1;
      return new Response("ok", { status: 200, headers: { "content-type": "text/html" } });
    });
    const adapters = new Map<string, SourceAdapter>(
      candidates.map((candidate) => [candidate.adapterKey, gatedAdapter(candidate.adapterKey)]),
    );

    const pending = dispatchDueSources(
      { cutoff: CUTOFF, limit: total, group: "hourly" },
      {
        schedules: { listDispatchCandidates: async () => candidates },
        ingestion: new MemoryIngestionRepository(),
        snapshots: { put: async () => "unused" },
        adapters,
        fetch,
        now: () => CUTOFF,
        createId: () => "concurrency-run",
      },
    );

    await flushTurn();
    // 前 4 个候选立即并发占满，第 5/6 个仍在队列里等待。
    expect(active).toBe(DISPATCH_CONCURRENCY);
    expect(gates).toHaveLength(DISPATCH_CONCURRENCY);

    for (let index = 0; index < total; index += 1) {
      gates.shift()!();
      await flushTurn();
    }
    const results = await pending;

    expect(peak).toBe(DISPATCH_CONCURRENCY);
    expect(fetch).toHaveBeenCalledTimes(total);
    // 结果计数与顺序和串行版一致：每个候选恰好一条结果，按候选顺序排列。
    expect(results.map((result) => result.sourceId)).toEqual(candidates.map((c) => c.sourceId));
    expect(results).toMatchObject(
      candidates.map(() => ({ outcome: { collectionStatus: "unchanged" }, dispatcherErrorCode: null })),
    );
  });

  it("advances next_due_at for pathological candidates so the next tick skips them", async () => {
    const candidates: DispatchCandidate[] = [
      {
        kind: "scheduled",
        sourceId: "pathological-source",
        sourceUrl: "https://example.test/pathological",
        adapterKey: "adapter-pathological",
        scheduledAt: "2026-09-08T00:00:00.000Z",
        cadenceMinutes: 0, // 病态 cadence：advanceDuePastCutoff 每轮都会抛 VALIDATION
        retryCount: 0,
      },
    ];
    const ingestion = new MemoryIngestionRepository();

    const results = await dispatchDueSources(
      { cutoff: CUTOFF, limit: 1, group: "hourly" },
      {
        schedules: { listDispatchCandidates: async () => candidates },
        ingestion,
        snapshots: { put: async () => "unused" },
        adapters: new Map(),
        fetch: vi.fn<typeof fetch>(),
        now: () => CUTOFF,
        createId: () => "pathological-run",
      },
    );

    // 结果聚合语义保持：outcome 为 null + dispatcherErrorCode，不产出伪 outcome。
    expect(results).toMatchObject([
      { sourceId: "pathological-source", outcome: null, dispatcherErrorCode: "VALIDATION" },
    ]);
    // 退避证据：失败落库带 cutoff+1h 的 next_due_at，下个 tick 的候选查询不再命中。
    expect(ingestion.failed[0]).toMatchObject({
      sourceId: "pathological-source",
      errorCode: "VALIDATION",
      nextDueAt: "2026-09-08T04:17:00.000Z",
      nextRetryAt: null,
    });
  });

  it("does not advance next_due_at for retry-kind candidates (retry state machine owns backoff)", async () => {
    const candidates: DispatchCandidate[] = [
      {
        kind: "retry",
        sourceId: "retry-source",
        sourceUrl: "https://example.test/retry",
        adapterKey: "adapter-retry",
        scheduledAt: "2026-09-08T00:00:00.000Z",
        cadenceMinutes: 0,
        retryCount: 1,
      },
    ];
    const ingestion = new MemoryIngestionRepository();
    // 让 try 路径的 runSourceIngestion 自身抛错（如持久层故障），以到达 dispatcher catch。
    ingestion.findRun = async () => {
      throw new SourceCollectionError("DATABASE", "D1 无法持久化采集结果", { retryable: true });
    };

    const results = await dispatchDueSources(
      { cutoff: CUTOFF, limit: 1, group: "hourly" },
      {
        schedules: { listDispatchCandidates: async () => candidates },
        ingestion,
        snapshots: { put: async () => "unused" },
        adapters: new Map(),
        fetch: vi.fn<typeof fetch>(),
        now: () => CUTOFF,
        createId: () => "retry-pathological-run",
      },
    );

    expect(results).toMatchObject([
      { sourceId: "retry-source", outcome: null, dispatcherErrorCode: "DATABASE" },
    ]);
    expect(ingestion.failed).toHaveLength(0);
    expect(ingestion.collected).toHaveLength(0);
  });
});

/** 走真实超时封装的 gating 适配器：fetch 未释放前 collect 一直挂起。 */
function gatedAdapter(key: string): SourceAdapter {
  return {
    key,
    async collect(context: CollectContext): Promise<CollectResult> {
      const response = await fetchWithinTimeout(context.fetch, context.sourceUrl, {
        headers: { Accept: "text/html" },
      });
      if (!response.ok) {
        throw new SourceCollectionError("NETWORK", "gated fetch rejected", { retryable: true });
      }
      return {
        sourceId: context.sourceId,
        fetchedAt: context.fetchedAt,
        sourcePublishedAt: null,
        etag: null,
        lastModified: null,
        contentType: response.headers.get("content-type"),
        contentHash: context.previousContentHash,
        rawBody: null,
        observations: [],
        warnings: [],
        status: "unchanged",
      };
    },
  };
}

/** 让渡一个 macrotask：保证全部微任务链（含下一批 worker 的领取）先行排空。 */
async function flushTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function unchangedAdapter(key: string): SourceAdapter {
  return {
    key,
    collect: async (context): Promise<CollectResult> => ({
      sourceId: context.sourceId,
      fetchedAt: context.fetchedAt,
      sourcePublishedAt: null,
      etag: null,
      lastModified: null,
      contentType: null,
      contentHash: context.previousContentHash,
      rawBody: null,
      observations: [],
      warnings: [],
      status: "unchanged",
    }),
  };
}

class MemoryIngestionRepository implements IngestionRepository {
  readonly collected: PersistCollectedRunInput[] = [];
  readonly failed: PersistFailedRunInput[] = [];

  async findRun(): Promise<PersistedSourceRun | null> {
    return null;
  }

  async claimScheduledRun(): Promise<boolean> {
    return true;
  }

  async claimRetryAttempt(): Promise<boolean> {
    return false;
  }

  async findSourceCursor(): Promise<SourceCursor> {
    return { etag: null, lastModified: null, contentHash: null };
  }

  async persistCollected(input: PersistCollectedRunInput): Promise<PersistedSourceRun> {
    this.collected.push(input);
    return persisted(input, input.result.status === "changed" ? "success" : input.result.status);
  }

  async persistFailed(input: PersistFailedRunInput): Promise<PersistedSourceRun> {
    this.failed.push(input);
    return {
      id: input.runId,
      sourceId: input.sourceId,
      scheduledAt: input.scheduledAt,
      status: "failed",
      snapshotKey: null,
      observationsInserted: 0,
      observationsRevised: 0,
      errorCode: input.errorCode,
      retryCount: input.retryCount,
      nextRetryAt: input.nextRetryAt,
      recovered: false,
    };
  }
}

function persisted(
  input: PersistCollectedRunInput,
  status: PersistedSourceRun["status"],
): PersistedSourceRun {
  return {
    id: input.runId,
    sourceId: input.sourceId,
    scheduledAt: input.scheduledAt,
    status,
    snapshotKey: input.snapshotKey,
    observationsInserted: 0,
    observationsRevised: 0,
    errorCode: null,
    retryCount: input.retryCount,
    nextRetryAt: null,
    recovered: false,
  };
}
