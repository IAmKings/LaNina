import { describe, expect, it } from "vitest";

import type { SourceHealthInput } from "../../domain/ingestion";
import { calculateSourceHealth } from "./source-health";

const BASE: SourceHealthInput = {
  sourceId: "source-a",
  checkedAt: "2026-09-08T03:00:00.000Z",
  lastSuccessAt: "2026-09-08T02:00:00.000Z",
  lateAfterMinutes: 60,
  staleAfterMinutes: 180,
  consecutiveFailures: 0,
  lastErrorCode: null,
};

describe("source health", () => {
  it.each([
    ["healthy", "2026-09-08T02:00:00.000Z"],
    ["healthy", "2026-09-08T02:30:00.000Z"],
    ["delayed", "2026-09-08T01:59:59.999Z"],
    ["delayed", "2026-09-08T00:00:00.000Z"],
    ["stale", "2026-09-07T23:59:59.999Z"],
  ] as const)("is %s at the late/stale boundary for %s", (status, lastSuccessAt) => {
    expect(calculateSourceHealth({ ...BASE, lastSuccessAt }).status).toBe(status);
  });

  it("is stale before the first successful collection", () => {
    expect(calculateSourceHealth({ ...BASE, lastSuccessAt: null }).status).toBe("stale");
  });

  it("becomes broken at the third consecutive failure", () => {
    expect(calculateSourceHealth({ ...BASE, consecutiveFailures: 2 }).status).toBe("healthy");
    expect(calculateSourceHealth({ ...BASE, consecutiveFailures: 3 }).status).toBe("broken");
  });

  it("becomes broken immediately for schema drift", () => {
    expect(
      calculateSourceHealth({
        ...BASE,
        consecutiveFailures: 1,
        lastErrorCode: "SCHEMA_DRIFT",
      }).status,
    ).toBe("broken");
  });
});
