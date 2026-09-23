import { describe, expect, it, vi } from "vitest";

import type {
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
import { D1SourceSchedulingRepository } from "../adapters/storage/cloudflare-scheduling";
import { dispatchDueSources } from "./dispatch-sources";

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
});

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
