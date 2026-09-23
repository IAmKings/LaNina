import { describe, expect, it, vi } from "vitest";

import type {
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import {
  D1IngestionRepository,
  R2RawSnapshotStore,
} from "../adapters/storage/cloudflare-ingestion";
import { runSourceIngestion } from "./run-source";

const SOURCE_ID = "noaa_cpc_roni";
const SOURCE_URL = "https://example.test/roni";

function observation(value: number, overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    indicatorId: "enso_roni_ersstv6",
    observedAt: "2026-08-31T00:00:00.000Z",
    periodStart: "2026-06-01T00:00:00.000Z",
    value,
    unit: "°C",
    publishedAt: null,
    fetchedAt: "2026-09-07T00:00:01.000Z",
    quality: "estimated",
    citationUrl: SOURCE_URL,
    metadata: { season: "JJA", datasetVersion: "ERSSTv6" },
    ...overrides,
  };
}

function collected(
  status: CollectResult["status"],
  values: ObservationInput[],
  hash = "a".repeat(64),
): CollectResult {
  return {
    sourceId: SOURCE_ID,
    fetchedAt: "2026-09-07T00:00:01.000Z",
    sourcePublishedAt: null,
    etag: '"current"',
    lastModified: "Sun, 06 Sep 2026 00:00:00 GMT",
    contentType: "text/html",
    contentHash: status === "unchanged" ? hash : hash,
    rawBody: status === "unchanged" ? null : new TextEncoder().encode("fixture"),
    observations: values,
    warnings: [],
    status,
  };
}

function adapter(...results: CollectResult[]): SourceAdapter & { collect: ReturnType<typeof vi.fn> } {
  return {
    key: "fixture-adapter",
    collect: vi.fn(async () => {
      const result = results.shift();
      if (result === undefined) throw new Error("unexpected collection");
      return result;
    }),
  };
}

describe("source ingestion vertical slice", () => {
  it("writes a private snapshot and the first observation, then deduplicates the run", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const sourceAdapter = adapter(collected("changed", [observation(1.4)]));
    const dependencies = dependenciesFor(database, bucket, sourceAdapter);
    const request = requestFor("2026-09-07T00:00:00.000Z");

    const first = await runSourceIngestion(request, dependencies);
    const duplicate = await runSourceIngestion(request, dependencies);

    expect(first).toMatchObject({
      collectionStatus: "changed",
      run: { status: "success", observationsInserted: 1, observationsRevised: 0 },
    });
    expect(duplicate).toMatchObject({ collectionStatus: "already_processed", run: { id: first.run.id } });
    expect(sourceAdapter.collect).toHaveBeenCalledTimes(1);
    expect(bucket.puts).toHaveLength(1);
    expect(bucket.puts[0]).toMatchObject({
      key: `raw/${SOURCE_ID}/2026/09/07/20260907T000001000Z-${"a".repeat(64)}.html`,
      options: {
        httpMetadata: { contentType: "text/html" },
        customMetadata: { sourceId: SOURCE_ID, contentHash: "a".repeat(64) },
        onlyIf: { etagDoesNotMatch: "*" },
      },
    });
    const checksum = bucket.puts[0].options.sha256;
    expect(checksum).toBeInstanceOf(ArrayBuffer);
    expect((checksum as ArrayBuffer).byteLength).toBe(32);
    expect(database.observations).toEqual([
      expect.objectContaining({ revision: 0, supersedes_id: null, value_num: 1.4 }),
    ]);
  });

  it("appends a revision that points to the prior observation without overwriting it", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const sourceAdapter = adapter(
      collected("changed", [observation(1.4)], "a".repeat(64)),
      collected("changed", [observation(1.6)], "b".repeat(64)),
    );
    const dependencies = dependenciesFor(database, bucket, sourceAdapter);

    const first = await runSourceIngestion(requestFor("2026-09-07T00:00:00.000Z"), dependencies);
    const revised = await runSourceIngestion(requestFor("2026-09-08T00:00:00.000Z"), dependencies);

    expect(revised.run).toMatchObject({ observationsInserted: 0, observationsRevised: 1 });
    expect(database.observations).toHaveLength(2);
    expect(database.observations[0]).toMatchObject({ id: expect.any(String), revision: 0, value_num: 1.4 });
    expect(database.observations[1]).toMatchObject({
      revision: 1,
      supersedes_id: database.observations[0].id,
      value_num: 1.6,
    });
    expect(database.observations[0].source_run_id).toBe(first.run.id);
  });

  it("does not duplicate an unchanged historical observation in a changed source body", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const sourceAdapter = adapter(
      collected("changed", [observation(1.4)], "a".repeat(64)),
      collected("changed", [observation(1.4)], "b".repeat(64)),
    );
    const dependencies = dependenciesFor(database, bucket, sourceAdapter);

    await runSourceIngestion(requestFor("2026-09-07T00:00:00.000Z"), dependencies);
    const second = await runSourceIngestion(requestFor("2026-09-08T00:00:00.000Z"), dependencies);

    expect(second.run).toMatchObject({ observationsInserted: 0, observationsRevised: 0 });
    expect(database.observations).toHaveLength(1);
    expect(bucket.puts).toHaveLength(2);
  });

  it("keeps a 24-observation run within the D1 Free per-invocation query limit", async () => {
    const database = new FakeD1();
    const observations = Array.from({ length: 24 }, (_, index) =>
      observation(index / 10, {
        observedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        periodStart: null,
      }),
    );

    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, new FakeR2(), adapter(collected("changed", observations))),
    );

    expect(result.run).toMatchObject({ observationsInserted: 24, observationsRevised: 0 });
    expect(database.writeBatchSizes).toContain(26);
    expect(database.queryCount).toBe(30);
    expect(database.queryCount).toBeLessThanOrEqual(50);
  });

  it("records unchanged without writing R2 or observations", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, bucket, adapter(collected("unchanged", []))),
    );

    expect(result).toMatchObject({ collectionStatus: "unchanged", run: { status: "unchanged" } });
    expect(bucket.puts).toHaveLength(0);
    expect(database.observations).toHaveLength(0);
  });

  it("keeps verified observations from a partial result without marking source health successful", async () => {
    const database = new FakeD1();
    const resultBody = collected("partial", [observation(1.4)]);
    resultBody.warnings = ["ONE_ROW_REJECTED"];
    const sourceAdapter = adapter(
      resultBody,
      collected("changed", [observation(1.4)], "b".repeat(64)),
    );

    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, new FakeR2(), sourceAdapter),
    );
    const partialRunSql = database.executedSql.slice();
    await runSourceIngestion(
      requestFor("2026-09-08T00:00:00.000Z"),
      dependenciesFor(database, new FakeR2(), sourceAdapter),
    );

    expect(result).toMatchObject({
      collectionStatus: "partial",
      run: { status: "partial", observationsInserted: 1 },
    });
    expect(database.observations).toHaveLength(1);
    expect(partialRunSql.some((sql) => sql.includes("UPDATE sources SET next_due_at"))).toBe(true);
    expect(partialRunSql.some((sql) => sql.includes("SET last_success_at"))).toBe(false);
    expect(sourceAdapter.collect.mock.calls[1]?.[0]).toMatchObject({
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: null,
    });
  });

  it("records failed and never inserts an observation when R2 rejects the snapshot", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    bucket.fail = true;

    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, bucket, adapter(collected("changed", [observation(1.4)]))),
    );

    expect(result).toMatchObject({
      collectionStatus: "failed",
      run: { status: "failed", errorCode: "STORAGE", observationsInserted: 0 },
    });
    expect(database.observations).toHaveLength(0);
    expect(database.runs[0]).toMatchObject({ status: "failed", error_code: "STORAGE" });
  });

  it("uses a failed DATABASE run when the atomic result batch rolls back", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    database.failNextWriteBatch = true;

    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, bucket, adapter(collected("changed", [observation(1.4)]))),
    );

    expect(result).toMatchObject({ collectionStatus: "failed", run: { errorCode: "DATABASE" } });
    expect(database.observations).toHaveLength(0);
    expect(database.runs).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it.each([
    ["missing unit", { unit: "" }],
    ["invalid timestamp", { observedAt: "2026-08-31" }],
    ["non-canonical timestamp", { observedAt: "2026-08-31T00:00:00Z" }],
  ] as const)("rejects %s before the success batch", async (_case, invalidFields) => {
    const database = new FakeD1();
    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(
        database,
        new FakeR2(),
        adapter(collected("changed", [observation(1.4, invalidFields)])),
      ),
    );

    expect(result.run).toMatchObject({ status: "failed", errorCode: "VALIDATION" });
    expect(database.observations).toHaveLength(0);
  });

  it("rejects a non-UTC scheduledAt before touching storage", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const action = runSourceIngestion(
      requestFor("2026-09-07T08:00:00+08:00"),
      dependenciesFor(database, bucket, adapter(collected("changed", [observation(1.4)]))),
    );

    await expect(action).rejects.toMatchObject({ code: "VALIDATION" });
    expect(database.runs).toHaveLength(0);
    expect(bucket.puts).toHaveLength(0);
  });

  it("records an invalid fetchedAt as a failed run", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    const resultBody = collected("changed", [observation(1.4)]);
    resultBody.fetchedAt = "2026-09-07 00:00:01";

    const result = await runSourceIngestion(
      requestFor("2026-09-07T00:00:00.000Z"),
      dependenciesFor(database, bucket, adapter(resultBody)),
    );

    expect(result).toMatchObject({ collectionStatus: "failed", run: { errorCode: "VALIDATION" } });
    expect(bucket.puts).toHaveLength(0);
    expect(database.observations).toHaveLength(0);
  });

  it("uses a binary extension and safe metadata for an unapproved content type", async () => {
    const bucket = new FakeR2();
    const store = new R2RawSnapshotStore(bucket.asBucket());

    const key = await store.put({
      sourceId: SOURCE_ID,
      scheduledAt: "2026-09-07T00:00:00.000Z",
      fetchedAt: "2026-09-08T01:02:03.004Z",
      contentHash: "c".repeat(64),
      contentType: "image/png",
      body: new Uint8Array([1, 2, 3]),
    });

    expect(key).toBe(
      `raw/${SOURCE_ID}/2026/09/08/20260908T010203004Z-${"c".repeat(64)}.bin`,
    );
    expect(bucket.puts[0].options.httpMetadata).toEqual({
      contentType: "application/octet-stream",
    });
  });

  it("keeps response content and content-type parameters out of snapshot keys and metadata", async () => {
    const bucket = new FakeR2();
    const store = new R2RawSnapshotStore(bucket.asBucket());
    const bodyMarker = "RAW_RESPONSE_BODY_MUST_NOT_BECOME_METADATA";

    await store.put({
      sourceId: SOURCE_ID,
      scheduledAt: "2026-09-07T00:00:00.000Z",
      fetchedAt: "2026-09-08T01:02:03.004Z",
      contentHash: "d".repeat(64),
      contentType: "application/json; charset=UTF-8; api_key=private-query-value",
      body: new TextEncoder().encode(bodyMarker),
    });

    const put = bucket.puts[0];
    expect(Object.keys(put.options).sort()).toEqual([
      "customMetadata",
      "httpMetadata",
      "onlyIf",
      "sha256",
    ]);
    expect(put.options.httpMetadata).toEqual({ contentType: "application/json" });
    expect(put.options.customMetadata).toEqual({
      sourceId: SOURCE_ID,
      contentHash: "d".repeat(64),
    });
    expect(new TextDecoder().decode(put.value as Uint8Array)).toBe(bodyMarker);
    const serializedKeyAndMetadata = JSON.stringify({ key: put.key, options: put.options });
    expect(serializedKeyAndMetadata).not.toContain(bodyMarker);
    expect(serializedKeyAndMetadata).not.toContain("api_key");
    expect(serializedKeyAndMetadata).not.toContain("private-query-value");
  });

  it("retries the same run identity after 1/5/20 minutes and stops after three retries", async () => {
    const database = new FakeD1();
    const bucket = new FakeR2();
    let currentTime = "2026-09-08T00:00:00.000Z";
    const sourceAdapter: SourceAdapter & { collect: ReturnType<typeof vi.fn> } = {
      key: "retry-fixture",
      collect: vi.fn(async () => {
        throw new SourceCollectionError("NETWORK", "private upstream detail", {
          retryable: true,
          httpStatus: 503,
        });
      }),
    };
    let id = 0;
    const dependencies = {
      adapter: sourceAdapter,
      repository: new D1IngestionRepository(database.asDatabase()),
      snapshots: new R2RawSnapshotStore(bucket.asBucket()),
      fetch: vi.fn<typeof fetch>(),
      createId: () => `retry-id-${++id}`,
      now: () => currentTime,
    };
    const request = requestFor("2026-09-08T00:00:00.000Z");

    const initial = await runSourceIngestion(request, dependencies);
    expect(initial.run).toMatchObject({
      id: "retry-id-1",
      retryCount: 0,
      nextRetryAt: "2026-09-08T00:01:00.000Z",
    });

    currentTime = "2026-09-08T00:00:59.999Z";
    expect(await runSourceIngestion(request, dependencies)).toMatchObject({
      collectionStatus: "retry_not_due",
    });

    currentTime = "2026-09-08T00:01:00.000Z";
    const retryOne = await runSourceIngestion(request, dependencies);
    expect(retryOne.run).toMatchObject({
      id: initial.run.id,
      retryCount: 1,
      nextRetryAt: "2026-09-08T00:06:00.000Z",
    });

    currentTime = "2026-09-08T00:06:00.000Z";
    const retryTwo = await runSourceIngestion(request, dependencies);
    expect(retryTwo.run).toMatchObject({
      id: initial.run.id,
      retryCount: 2,
      nextRetryAt: "2026-09-08T00:26:00.000Z",
    });

    currentTime = "2026-09-08T00:26:00.000Z";
    const retryThree = await runSourceIngestion(request, dependencies);
    expect(retryThree.run).toMatchObject({
      id: initial.run.id,
      retryCount: 3,
      nextRetryAt: null,
    });
    expect(await runSourceIngestion(request, dependencies)).toMatchObject({
      collectionStatus: "already_processed",
    });
    expect(sourceAdapter.collect).toHaveBeenCalledTimes(4);
    expect(database.source.consecutive_failures).toBe(4);
  });

  it("does not retry a normal 4xx failure or persist the raw exception message", async () => {
    const database = new FakeD1();
    const sourceAdapter: SourceAdapter = {
      key: "not-found-fixture",
      collect: async () => {
        throw new SourceCollectionError("NOT_FOUND", "secret provider response", {
          httpStatus: 404,
        });
      },
    };

    const result = await runSourceIngestion(
      requestFor("2026-09-08T00:00:00.000Z"),
      dependenciesFor(database, new FakeR2(), sourceAdapter),
    );

    expect(result.run).toMatchObject({ errorCode: "NOT_FOUND", nextRetryAt: null });
    expect(database.runs[0].error_message).toBe("来源地址不存在");
  });

  it("completes a retry on the same run and records one recovery fact", async () => {
    const database = new FakeD1();
    let currentTime = "2026-09-08T00:00:00.000Z";
    const results: Array<CollectResult | SourceCollectionError> = [
      new SourceCollectionError("NETWORK", "temporary", { retryable: true }),
      collected("unchanged", []),
    ];
    const sourceAdapter: SourceAdapter = {
      key: "recovery-fixture",
      collect: async () => {
        const result = results.shift();
        if (result instanceof SourceCollectionError) throw result;
        if (result === undefined) throw new Error("missing fixture");
        return result;
      },
    };
    let id = 0;
    const dependencies = {
      adapter: sourceAdapter,
      repository: new D1IngestionRepository(database.asDatabase()),
      snapshots: new R2RawSnapshotStore(new FakeR2().asBucket()),
      fetch: vi.fn<typeof fetch>(),
      createId: () => `recovery-id-${++id}`,
      now: () => currentTime,
    };

    const initial = await runSourceIngestion(
      requestFor("2026-09-08T00:00:00.000Z"),
      dependencies,
    );
    currentTime = "2026-09-08T00:01:00.000Z";
    const recovered = await runSourceIngestion(
      requestFor("2026-09-08T00:00:00.000Z"),
      dependencies,
    );

    expect(recovered).toMatchObject({
      collectionStatus: "unchanged",
      run: { id: initial.run.id, status: "unchanged", retryCount: 1, recovered: true },
    });
    expect(database.runs).toHaveLength(1);
    expect(database.source.consecutive_failures).toBe(0);
    expect(database.healthChanges).toBe(1);
    expect(database.healthChangeBefore).toMatchObject({
      status: "stale",
      consecutiveFailures: 1,
      lastErrorCode: "NETWORK",
    });
  });

  it("does not describe the first successful collection as a recovery", async () => {
    const database = new FakeD1();
    database.source.last_success_at = null;

    const result = await runSourceIngestion(
      requestFor("2026-09-08T00:00:00.000Z"),
      dependenciesFor(database, new FakeR2(), adapter(collected("unchanged", []))),
    );

    expect(result.run.recovered).toBe(false);
    expect(database.healthChanges).toBe(0);
  });

  it("allows only one concurrent retry claim to call the adapter", async () => {
    const database = new FakeD1();
    let currentTime = "2026-09-08T00:00:00.000Z";
    const failureAdapter: SourceAdapter = {
      key: "failure",
      collect: async () => {
        throw new SourceCollectionError("NETWORK", "temporary", { retryable: true });
      },
    };
    const initialDependencies = dependenciesFor(database, new FakeR2(), failureAdapter);
    await runSourceIngestion(requestFor("2026-09-08T00:00:00.000Z"), {
      ...initialDependencies,
      now: () => currentTime,
    });

    currentTime = "2026-09-08T00:01:00.000Z";
    const retryAdapter = adapter(collected("unchanged", []));
    let id = 0;
    const shared = {
      adapter: retryAdapter,
      repository: new D1IngestionRepository(database.asDatabase()),
      snapshots: new R2RawSnapshotStore(new FakeR2().asBucket()),
      fetch: vi.fn<typeof fetch>(),
      createId: () => `claim-${++id}`,
      now: () => currentTime,
    };
    const request = requestFor("2026-09-08T00:00:00.000Z");

    const outcomes = await Promise.all([
      runSourceIngestion(request, shared),
      runSourceIngestion(request, shared),
    ]);

    expect(retryAdapter.collect).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((outcome) => outcome.collectionStatus === "unchanged")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.collectionStatus === "already_processed")).toHaveLength(1);
    expect(database.runs).toHaveLength(1);
  });

  it("allows a retry lease to be taken over only after the prior worker expires", async () => {
    const database = new FakeD1();
    const repository = new D1IngestionRepository(database.asDatabase());
    const failureAdapter: SourceAdapter = {
      key: "lease-failure",
      collect: async () => {
        throw new SourceCollectionError("NETWORK", "temporary", { retryable: true });
      },
    };
    await runSourceIngestion(requestFor("2026-09-08T00:00:00.000Z"), {
      adapter: failureAdapter,
      repository,
      snapshots: new R2RawSnapshotStore(new FakeR2().asBucket()),
      fetch: vi.fn<typeof fetch>(),
      createId: () => "lease-run",
      now: () => "2026-09-08T00:00:00.000Z",
    });

    expect(
      await repository.claimRetryAttempt(
        SOURCE_ID,
        "2026-09-08T00:00:00.000Z",
        0,
        "crashed-worker",
        "2026-09-08T00:01:00.000Z",
        "2026-09-08T00:31:00.000Z",
      ),
    ).toBe(true);
    expect(
      await repository.claimRetryAttempt(
        SOURCE_ID,
        "2026-09-08T00:00:00.000Z",
        1,
        "early-worker",
        "2026-09-08T00:30:59.999Z",
        "2026-09-08T01:00:59.999Z",
      ),
    ).toBe(false);
    expect(
      await repository.claimRetryAttempt(
        SOURCE_ID,
        "2026-09-08T00:00:00.000Z",
        1,
        "takeover-worker",
        "2026-09-08T00:31:00.000Z",
        "2026-09-08T01:01:00.000Z",
      ),
    ).toBe(true);
    expect(database.runs[0]).toMatchObject({
      retry_count: 2,
      retry_claim_token: "takeover-worker",
    });
  });
});

function requestFor(scheduledAt: string) {
  return { sourceId: SOURCE_ID, sourceUrl: SOURCE_URL, scheduledAt };
}

function dependenciesFor(database: FakeD1, bucket: FakeR2, sourceAdapter: SourceAdapter) {
  let id = 0;
  let time = 0;
  return {
    adapter: sourceAdapter,
    repository: new D1IngestionRepository(database.asDatabase(), () => `observation-${++id}`),
    snapshots: new R2RawSnapshotStore(bucket.asBucket()),
    fetch: vi.fn<typeof fetch>(),
    createId: () => `run-${++id}`,
    now: () => new Date(Date.UTC(2026, 8, 7, 0, 0, time++)).toISOString(),
  };
}

interface FakeStatementData {
  sql: string;
  values: unknown[];
}

interface FakeRunRow {
  id: string;
  source_id: string;
  scheduled_at: string;
  started_at: string;
  finished_at: string;
  status: string;
  snapshot_key: string | null;
  content_hash: string | null;
  etag: string | null;
  last_modified: string | null;
  observations_inserted: number;
  observations_revised: number;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  next_retry_at: string | null;
  retry_claim_token: string | null;
  retry_claim_expires_at: string | null;
}

interface FakeObservationRow {
  id: string;
  indicator_id: string;
  observed_at: string;
  period_start: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string;
  published_at: string | null;
  revision: number;
  supersedes_id: string | null;
  quality: string;
  source_run_id: string;
  citation_url: string;
  metadata_json: string;
}

class FakeD1 {
  readonly runs: FakeRunRow[] = [];
  readonly observations: FakeObservationRow[] = [];
  readonly writeBatchSizes: number[] = [];
  readonly executedSql: string[] = [];
  queryCount = 0;
  failNextWriteBatch = false;
  healthChanges = 0;
  healthChangeBefore: Record<string, unknown> | null = null;
  readonly source = {
    id: SOURCE_ID,
    consecutive_failures: 0,
    last_error_code: null as string | null,
    last_success_at: "2026-09-07T00:00:00.000Z" as string | null,
    late_after_minutes: 60,
    stale_after_minutes: 120,
    next_due_at: null as string | null,
  };

  asDatabase(): D1Database {
    return {
      prepare: (sql: string) => this.statement({ sql, values: [] }),
      batch: async (statements: D1PreparedStatement[]) => {
        this.queryCount += statements.length;
        const hasWrite = statements.some(
          (statement) =>
            !(statement as unknown as FakeStatementData).sql.trimStart().startsWith("SELECT"),
        );
        if (this.failNextWriteBatch && hasWrite) {
          this.failNextWriteBatch = false;
          throw new Error("atomic batch rejected");
        }
        if (hasWrite) this.writeBatchSizes.push(statements.length);
        return statements.map((statement) => {
          const data = statement as unknown as FakeStatementData;
          this.executedSql.push(data.sql);
          if (data.sql.trimStart().startsWith("SELECT")) {
            return { success: true, results: this.select(data), meta: {} };
          }
          const changes = this.apply(data);
          return { success: true, results: [], meta: { changes } };
        });
      },
    } as unknown as D1Database;
  }

  private statement(data: FakeStatementData): D1PreparedStatement {
    return {
      ...data,
      bind: (...values: unknown[]) => this.statement({ sql: data.sql, values }),
      first: async () => {
        this.queryCount += 1;
        return this.first(data);
      },
      run: async () => {
        this.queryCount += 1;
        const changes = this.apply(data);
        return { success: true, results: [], meta: { changes } };
      },
    } as unknown as D1PreparedStatement;
  }

  private first(data: FakeStatementData): unknown {
    if (data.sql.includes("WHERE source_id = ? AND scheduled_at = ?")) {
      return this.runs.find(
        (run) => run.source_id === data.values[0] && run.scheduled_at === data.values[1],
      ) ?? null;
    }
    if (data.sql.includes("FROM sources WHERE id = ?")) {
      return { ...this.source };
    }
    if (data.sql.includes("FROM source_runs")) {
      return this.runs
        .filter(
          (run) =>
            run.source_id === data.values[0] &&
            (run.status === "success" || run.status === "unchanged"),
        )
        .at(-1) ?? null;
    }
    throw new Error(`unexpected query: ${data.sql}`);
  }

  private select(data: FakeStatementData): unknown[] {
    if (data.sql.includes("FROM observations")) {
      return this.observations
        .filter(
          (entry) =>
            entry.indicator_id === data.values[0] &&
            entry.observed_at >= String(data.values[1]) &&
            entry.observed_at <= String(data.values[2]),
        )
        .sort((left, right) =>
          left.observed_at === right.observed_at
            ? right.revision - left.revision
            : left.observed_at.localeCompare(right.observed_at),
        );
    }
    const row = this.first(data);
    return row === null ? [] : [row];
  }

  private apply(data: FakeStatementData): number {
    if (data.sql.includes("SET retry_count = retry_count + 1")) {
      const run = this.runs.find(
        (entry) =>
          entry.source_id === data.values[2] &&
          entry.scheduled_at === data.values[3] &&
          entry.status === "failed" &&
          entry.retry_count === data.values[4] &&
          entry.next_retry_at !== null &&
          entry.next_retry_at <= String(data.values[5]) &&
          (entry.retry_claim_token === null ||
            (entry.retry_claim_expires_at !== null &&
              entry.retry_claim_expires_at <= String(data.values[6]))),
      );
      if (run === undefined) return 0;
      run.retry_count += 1;
      run.retry_claim_token = String(data.values[0]);
      run.retry_claim_expires_at = String(data.values[1]);
      return 1;
    }
    if (data.sql.includes("UPDATE source_runs") && data.sql.includes("http_status = ?, error_code = ?")) {
      const run = this.runs.find(
        (entry) =>
          entry.id === data.values[7] &&
          entry.source_id === data.values[8] &&
          entry.scheduled_at === data.values[9] &&
          entry.retry_count === data.values[10] &&
          entry.retry_claim_token === data.values[11],
      );
      if (run === undefined) return 0;
      run.started_at = String(data.values[0]);
      run.finished_at = String(data.values[1]);
      run.error_code = String(data.values[3]);
      run.error_message = String(data.values[4]);
      run.next_retry_at = data.values[6] as string | null;
      run.retry_claim_token = null;
      run.retry_claim_expires_at = null;
      return 1;
    }
    if (data.sql.includes("UPDATE source_runs") && data.sql.includes("status = ?")) {
      const run = this.runs.find(
        (entry) =>
          entry.id === data.values[10] &&
          entry.source_id === data.values[11] &&
          entry.scheduled_at === data.values[12] &&
          entry.retry_count === data.values[13] &&
          entry.retry_claim_token === data.values[14],
      );
      if (run === undefined) return 0;
      run.started_at = String(data.values[0]);
      run.finished_at = String(data.values[1]);
      run.status = String(data.values[2]);
      run.etag = data.values[3] as string | null;
      run.last_modified = data.values[4] as string | null;
      run.snapshot_key = data.values[5] as string | null;
      run.content_hash = data.values[6] as string | null;
      run.observations_inserted = Number(data.values[7]);
      run.observations_revised = Number(data.values[8]);
      run.error_code = null;
      run.error_message = null;
      run.next_retry_at = null;
      run.retry_claim_token = null;
      run.retry_claim_expires_at = null;
      return 1;
    }
    if (data.sql.includes("INSERT INTO source_runs") && data.sql.includes("'failed'")) {
      this.runs.push({
        id: String(data.values[0]), source_id: String(data.values[1]), scheduled_at: String(data.values[2]),
        started_at: String(data.values[3]), finished_at: String(data.values[4]), status: "failed",
        snapshot_key: null, content_hash: null, etag: null, last_modified: null,
        observations_inserted: 0, observations_revised: 0, error_code: String(data.values[6]),
        error_message: String(data.values[7]),
        retry_count: Number(data.values[8]), next_retry_at: data.values[9] as string | null,
        retry_claim_token: null, retry_claim_expires_at: null,
      });
      return 1;
    }
    if (data.sql.includes("INSERT INTO source_runs")) {
      this.runs.push({
        id: String(data.values[0]), source_id: String(data.values[1]), scheduled_at: String(data.values[2]),
        started_at: String(data.values[3]), finished_at: String(data.values[4]), status: String(data.values[5]),
        etag: data.values[6] as string | null, last_modified: data.values[7] as string | null,
        snapshot_key: data.values[8] as string | null, content_hash: data.values[9] as string | null,
        observations_inserted: Number(data.values[10]), observations_revised: Number(data.values[11]),
        error_code: null,
        error_message: null,
        retry_count: Number(data.values[12]), next_retry_at: null,
        retry_claim_token: null, retry_claim_expires_at: null,
      });
      return 1;
    }
    if (data.sql.includes("INSERT INTO observations")) {
      const values = data.values;
      this.observations.push({
        id: String(values[0]), indicator_id: String(values[1]), observed_at: String(values[2]),
        period_start: values[3] as string | null, value_num: values[4] as number | null,
        value_text: values[5] as string | null, unit: String(values[6]), published_at: values[7] as string | null,
        revision: Number(values[9]), supersedes_id: values[10] as string | null, quality: String(values[11]),
        source_run_id: String(values[12]), citation_url: String(values[13]), metadata_json: String(values[14]),
      });
      return 1;
    }
    if (data.sql.includes("UPDATE sources") && data.sql.includes("consecutive_failures + 1")) {
      this.source.consecutive_failures += 1;
      this.source.last_error_code = String(data.values[0]);
      this.source.next_due_at = (data.values[1] as string | null) ?? this.source.next_due_at;
      return 1;
    }
    if (data.sql.includes("UPDATE sources") && data.sql.includes("last_success_at")) {
      this.source.last_success_at = String(data.values[0]);
      this.source.consecutive_failures = 0;
      this.source.last_error_code = null;
      this.source.next_due_at = (data.values[1] as string | null) ?? this.source.next_due_at;
      return 1;
    }
    if (data.sql.includes("UPDATE sources")) return 1;
    if (data.sql.includes("INSERT OR IGNORE INTO changes")) {
      this.healthChanges += 1;
      this.healthChangeBefore = JSON.parse(String(data.values[2])) as Record<string, unknown>;
      return 1;
    }
    return 0;
  }
}

class FakeR2 {
  readonly puts: Array<{ key: string; value: unknown; options: R2PutOptions }> = [];
  fail = false;

  asBucket(): R2Bucket {
    return {
      put: async (key: string, value: unknown, options: R2PutOptions) => {
        if (this.fail) throw new Error("R2 unavailable");
        this.puts.push({ key, value, options });
        return {};
      },
    } as unknown as R2Bucket;
  }
}
