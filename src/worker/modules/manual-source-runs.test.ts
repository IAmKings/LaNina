import { describe, expect, it, vi } from "vitest";

import type { SourceAdapter } from "../../domain/ingestion";
import type { CodeOwnedSourceTarget } from "../ingestion/live-smoke-targets";
import type { RunSourceOutcome } from "../ingestion/run-source";
import {
  ManualSourceRunError,
  ManualSourceRunModule,
  type EnabledManualSource,
  type ManualSourceRunOperation,
  type ManualSourceRunRepository,
} from "./manual-source-runs";

const target: CodeOwnedSourceTarget = {
  sourceId: "noaa_cpc_roni",
  sourceUrl: "https://code-owned.example.test/noaa",
  adapterKey: "noaa-v1",
  requiredSecret: null,
};

const adapter: SourceAdapter = { key: "noaa-v1", collect: async () => { throw new Error("not used"); } };

describe("manual source run module", () => {
  it("runs only the registered code-owned target once and audits a repeated idempotency key once", async () => {
    const repository = memoryRepository({ id: target.sourceId, adapterKey: target.adapterKey });
    const runner = vi.fn(async (): Promise<RunSourceOutcome> => outcome());
    const module = new ManualSourceRunModule(repository, (id) => id === target.sourceId ? target : null, new Map([[target.adapterKey, adapter]]), runner);
    const first = await module.run(input());
    const replay = await module.run(input({ operationId: "operation-ignored-on-replay" }));

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith({
      sourceId: target.sourceId,
      sourceUrl: target.sourceUrl,
      scheduledAt: "2026-09-10T01:00:00.000Z",
    }, adapter);
    expect(first).toMatchObject({ status: "completed", replayed: false, run: { id: "run-safe", errorCode: null } });
    expect(replay).toMatchObject({ status: "completed", replayed: true, operationId: "operation-1" });
    expect(repository.audit).toEqual([
      { action: "manual_run_requested", actor: "editor@example.test", reason: "核对 NOAA 更新" },
      { action: "manual_run_completed", actor: "editor@example.test", reason: "核对 NOAA 更新" },
    ]);
    expect(JSON.stringify([first, replay])).not.toMatch(/snapshot|url|secret|reason/i);
  });

  it("fails closed before dispatch for disabled, unregistered, or adapter-mismatched sources", async () => {
    const runner = vi.fn();
    const disabled = new ManualSourceRunModule(memoryRepository(null), () => target, new Map([[target.adapterKey, adapter]]), runner);
    await expect(disabled.run(input())).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });

    const mismatch = new ManualSourceRunModule(
      memoryRepository({ id: target.sourceId, adapterKey: "wrong-adapter" }),
      () => target,
      new Map([[target.adapterKey, adapter]]),
      runner,
    );
    await expect(mismatch.run(input())).rejects.toMatchObject({ code: "SOURCE_CONFIGURATION" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("classifies an unexpected runner failure as an internal command failure", async () => {
    const module = new ManualSourceRunModule(
      memoryRepository({ id: target.sourceId, adapterKey: target.adapterKey }),
      () => target,
      new Map([[target.adapterKey, adapter]]),
      async () => { throw new Error("upstream body=private"); },
    );
    await expect(module.run(input())).rejects.toEqual(expect.objectContaining(new ManualSourceRunError("DATABASE")));
  });
});

function input(overrides: Partial<Parameters<ManualSourceRunModule["run"]>[0]> = {}) {
  return {
    sourceId: target.sourceId,
    reason: "核对 NOAA 更新",
    idempotencyKey: "manual-run-key-0001",
    actor: { email: "editor@example.test", roles: ["editor"] as const },
    occurredAt: "2026-09-10T01:00:00.000Z",
    operationId: "operation-1",
    ...overrides,
  };
}

function outcome(): RunSourceOutcome {
  return {
    collectionStatus: "changed",
    run: {
      id: "run-safe",
      sourceId: target.sourceId,
      scheduledAt: "2026-09-10T01:00:00.000Z",
      status: "success",
      snapshotKey: "raw/private/never-returned",
      observationsInserted: 1,
      observationsRevised: 0,
      errorCode: null,
      retryCount: 0,
      nextRetryAt: null,
      recovered: false,
    },
  };
}

function memoryRepository(source: EnabledManualSource | null): ManualSourceRunRepository & {
  audit: Array<{ action: string; actor: string; reason: string }>;
} {
  const operations = new Map<string, ManualSourceRunOperation>();
  const audit: Array<{ action: string; actor: string; reason: string }> = [];
  return {
    audit,
    findEnabledSource: async () => source,
    begin: async (operation) => {
      const existing = operations.get(operation.idempotencyKey);
      if (existing !== undefined) return { operation: existing, created: false };
      const created: ManualSourceRunOperation = {
        id: operation.operationId,
        sourceId: operation.sourceId,
        idempotencyKey: operation.idempotencyKey,
        status: "dispatching",
        run: null,
      };
      operations.set(operation.idempotencyKey, created);
      audit.push({ action: "manual_run_requested", actor: operation.actor, reason: operation.reason });
      return { operation: created, created: true };
    },
    complete: async (operationId, actor, reason, _occurredAt, completed) => {
      const entry = [...operations.values()].find((candidate) => candidate.id === operationId);
      if (entry === undefined) throw new Error("missing operation");
      const next: ManualSourceRunOperation = {
        ...entry,
        status: completed.run.status === "failed" ? "failed" : "completed",
        run: completed.run,
      };
      operations.set(entry.idempotencyKey, next);
      audit.push({
        action: next.status === "failed" ? "manual_run_failed" : "manual_run_completed",
        actor,
        reason,
      });
      return next;
    },
  };
}
