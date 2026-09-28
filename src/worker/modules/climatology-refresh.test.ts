import { describe, expect, it, vi } from "vitest";

import type { RawSnapshotStore } from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { CLIMATOLOGY_SOURCE_CONFIGS } from "../adapters/sources/nasa-power-climatology";
import {
  ClimatologyRefreshJob,
  type ClimatologyPersistRequest,
  type ClimatologyRefreshRepository,
} from "./climatology-refresh";

const SCHEDULED_AT = "2026-09-26T22:30:00.000Z";
const PANAMA = CLIMATOLOGY_SOURCE_CONFIGS[3]!;

describe("ClimatologyRefreshJob", () => {
  it("skips the network when twelve months were fetched inside the refresh interval", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network must not be called");
    });
    const repository: ClimatologyRefreshRepository = {
      loadFreshness: async () => ({ monthCount: 12, newestFetchedAt: "2026-09-10T22:30:00.000Z" }),
      persist: async () => {
        throw new Error("persist must not be called");
      },
    };

    const result = await new ClimatologyRefreshJob(repository, fetch, snapshots(), [PANAMA]).run({
      scheduledAt: SCHEDULED_AT,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      expect.objectContaining({ indicatorId: PANAMA.indicatorId, status: "skipped_fresh", errorCode: null }),
    ]);
  });

  it("records a schema failure for one region without failing the refresh", async () => {
    const fetch = vi.fn(async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const persisted: ClimatologyPersistRequest[] = [];
    const repository: ClimatologyRefreshRepository = {
      loadFreshness: async () => ({ monthCount: 0, newestFetchedAt: null }),
      persist: async (request) => {
        persisted.push(request);
        return "written";
      },
    };

    const result = await new ClimatologyRefreshJob(repository, fetch, snapshots(), [PANAMA]).run({
      scheduledAt: SCHEDULED_AT,
    });

    expect(persisted).toHaveLength(0);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ status: "failed", errorCode: "SCHEMA_DRIFT" }),
    ]);
  });

  it("rethrows database failures so the evaluation cron stays fail-closed", async () => {
    const repository: ClimatologyRefreshRepository = {
      loadFreshness: async () => {
        throw new SourceCollectionError("DATABASE", "D1 不可用");
      },
      persist: async () => "written",
    };

    await expect(
      new ClimatologyRefreshJob(repository, vi.fn(), snapshots(), [PANAMA]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "DATABASE" });
  });
});

function snapshots(): RawSnapshotStore {
  return { put: async () => "raw/test/climatology.json" };
}
