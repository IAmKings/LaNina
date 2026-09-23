import { describe, expect, it, vi } from "vitest";

import type { CollectResult, SourceAdapter } from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import {
  runLiveSmoke,
  type LiveSmokeLogger,
  type LiveSmokeTarget,
} from "./live-smoke";

const SCHEDULED_AT = "2026-09-08T01:17:00.000Z";
const FETCHED_AT = "2026-09-08T01:17:01.000Z";

describe("live source smoke orchestration", () => {
  it("reports normal, schema drift, network and ordinary errors with stable safe fields", async () => {
    const logger = memoryLogger();
    const report = await runLiveSmoke({
      targets: [
        target("normal", adapter("normal", collected("normal", "changed"))),
        target("schema", throwingAdapter("schema", new SourceCollectionError(
          "SCHEMA_DRIFT",
          "body=private-schema-payload",
        ))),
        target("network", throwingAdapter("network", new SourceCollectionError(
          "NETWORK",
          "https://provider.test/?api_key=secret",
          { retryable: true },
        ))),
        target("ordinary", throwingAdapter("ordinary", new Error(
          "Authorization: Bearer secret; Cookie: session=private",
        ))),
      ],
      scheduledAt: SCHEDULED_AT,
      fetchedAt: FETCHED_AT,
      fetch: vi.fn<typeof fetch>(),
      logger,
    });

    expect(report).toEqual({
      outcome: "completed",
      sourcesChecked: 4,
      results: [
        { sourceId: "normal", outcome: "ok", collectionStatus: "changed", errorCode: null },
        { sourceId: "schema", outcome: "warning", collectionStatus: null, errorCode: "SCHEMA_DRIFT" },
        { sourceId: "network", outcome: "warning", collectionStatus: null, errorCode: "NETWORK" },
        { sourceId: "ordinary", outcome: "warning", collectionStatus: null, errorCode: "VALIDATION" },
      ],
    });
    const serialized = JSON.stringify({ report, logs: logger.messages() });
    expect(serialized).not.toContain("provider.test");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("Cookie");
    expect(serialized).not.toContain("private-schema-payload");
  });

  it("continues after one source fails and surfaces adapter partial warnings", async () => {
    const secondCollect = vi.fn(async () => collected("second", "partial", ["PRIVATE_BODY"]));
    const report = await runLiveSmoke({
      targets: [
        target("first", throwingAdapter("first", new SourceCollectionError("NETWORK", "down"))),
        target("second", { key: "second", collect: secondCollect }),
      ],
      scheduledAt: SCHEDULED_AT,
      fetchedAt: FETCHED_AT,
      fetch: vi.fn<typeof fetch>(),
      logger: memoryLogger(),
    });

    expect(secondCollect).toHaveBeenCalledTimes(1);
    expect(report.results).toEqual([
      { sourceId: "first", outcome: "warning", collectionStatus: null, errorCode: "NETWORK" },
      { sourceId: "second", outcome: "warning", collectionStatus: "partial", errorCode: null },
    ]);
  });

  it("does not serialize target configuration, raw response data or content hashes", async () => {
    const privateBody = "PRIVATE_RAW_RESPONSE";
    const result = collected("safe_source", "changed");
    result.rawBody = new TextEncoder().encode(privateBody);
    result.contentHash = "f".repeat(64);
    result.observations = [{
      indicatorId: "private_indicator",
      observedAt: FETCHED_AT,
      periodStart: null,
      value: 1,
      unit: "private-unit",
      publishedAt: null,
      fetchedAt: FETCHED_AT,
      quality: "verified",
      citationUrl: "https://private.example.test/?api_key=secret",
      metadata: { upstreamBody: "PRIVATE_METADATA" },
    }];
    const logger = memoryLogger();
    const report = await runLiveSmoke({
      targets: [{
        sourceId: "safe_source",
        sourceUrl: "https://private.example.test/?api_key=secret",
        adapter: { key: "private-adapter-key", collect: async () => result },
      }],
      scheduledAt: SCHEDULED_AT,
      fetchedAt: FETCHED_AT,
      fetch: vi.fn<typeof fetch>(),
      logger,
    });

    const serialized = JSON.stringify({ report, logs: logger.messages() });
    expect(serialized).not.toContain(privateBody);
    expect(serialized).not.toContain("PRIVATE_METADATA");
    expect(serialized).not.toContain("private-adapter-key");
    expect(serialized).not.toContain("private.example.test");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("f".repeat(64));
  });

  it("is a safe noop with no targets and never invokes fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const logger = memoryLogger();
    const report = await runLiveSmoke({
      targets: [],
      scheduledAt: SCHEDULED_AT,
      fetchedAt: FETCHED_AT,
      fetch,
      logger,
    });

    expect(report).toEqual({ outcome: "noop", sourcesChecked: 0, results: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.messages()).toEqual([
      JSON.stringify({ handler: "live_smoke", outcome: "noop", sourcesChecked: 0 }),
    ]);
  });

  it("rejects duplicate target configuration before collection", async () => {
    const collect = vi.fn(async () => collected("duplicate", "changed"));
    const action = runLiveSmoke({
      targets: [
        target("duplicate", { key: "one", collect }),
        target("duplicate", { key: "two", collect }),
      ],
      scheduledAt: SCHEDULED_AT,
      fetchedAt: FETCHED_AT,
      fetch: vi.fn<typeof fetch>(),
    });

    await expect(action).rejects.toMatchObject({ code: "VALIDATION" });
    expect(collect).not.toHaveBeenCalled();
  });

  it.each([
    ["scheduledAt", "2026-09-08T09:17:00+08:00", FETCHED_AT],
    ["fetchedAt", SCHEDULED_AT, "2026-09-08 01:17:01"],
  ])("rejects a non-canonical %s before collection", async (_field, scheduledAt, fetchedAt) => {
    const collect = vi.fn(async () => collected("safe_source", "changed"));
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(runLiveSmoke({
      targets: [target("safe_source", { key: "safe", collect })],
      scheduledAt,
      fetchedAt,
      fetch,
      logger: memoryLogger(),
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(collect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function target(sourceId: string, sourceAdapter: SourceAdapter): LiveSmokeTarget {
  return { sourceId, sourceUrl: `https://example.test/${sourceId}`, adapter: sourceAdapter };
}

function adapter(key: string, result: CollectResult): SourceAdapter {
  return { key, collect: async () => result };
}

function throwingAdapter(key: string, error: unknown): SourceAdapter {
  return { key, collect: async () => { throw error; } };
}

function collected(
  sourceId: string,
  status: CollectResult["status"],
  warnings: string[] = [],
): CollectResult {
  return {
    sourceId,
    fetchedAt: FETCHED_AT,
    sourcePublishedAt: null,
    etag: null,
    lastModified: null,
    contentType: null,
    contentHash: null,
    rawBody: null,
    observations: [],
    warnings,
    status,
  };
}

function memoryLogger(): LiveSmokeLogger & { messages(): string[] } {
  const messages: string[] = [];
  return {
    info: (message) => { messages.push(message); },
    warn: (message) => { messages.push(message); },
    messages: () => messages,
  };
}
