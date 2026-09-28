import { describe, expect, it } from "vitest";

import type { SourceHealthDerivationInput } from "./source-health";
import { calculateSourceHealth } from "./source-health";

const BASE: SourceHealthDerivationInput = {
  sourceId: "source-a",
  checkedAt: "2026-09-08T03:00:00.000Z",
  lastSuccessAt: "2026-09-08T02:00:00.000Z",
  lateAfterMinutes: 60,
  staleAfterMinutes: 180,
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastRunIsPartial: false,
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

  // D4:B：partial 采集刷新了 last_success_at，最新完结 run 为 partial → degraded。
  it("is degraded when the latest finished run is partial and data is fresh", () => {
    expect(calculateSourceHealth({ ...BASE, lastRunIsPartial: true }).status).toBe("degraded");
  });

  it("keeps degraded inside the stale window even past the late threshold", () => {
    // 数据年龄超过 late_after_minutes 本应报 delayed，但最新到达本身是 partial：
    // 数据确实在到，「延迟」名不副实，降级优先于延迟。
    expect(
      calculateSourceHealth({
        ...BASE,
        lastSuccessAt: "2026-09-08T00:00:00.000Z",
        lastRunIsPartial: true,
      }).status,
    ).toBe("degraded");
  });

  it("prefers stale over degraded once the data age exceeds the stale window", () => {
    expect(
      calculateSourceHealth({
        ...BASE,
        lastSuccessAt: "2026-09-07T23:59:59.999Z",
        lastRunIsPartial: true,
      }).status,
    ).toBe("stale");
  });

  it("prefers stale over degraded before the first data arrival", () => {
    expect(
      calculateSourceHealth({ ...BASE, lastSuccessAt: null, lastRunIsPartial: true }).status,
    ).toBe("stale");
  });

  it("prefers broken over degraded for accumulated failures or schema drift", () => {
    expect(
      calculateSourceHealth({ ...BASE, consecutiveFailures: 3, lastRunIsPartial: true }).status,
    ).toBe("broken");
    expect(
      calculateSourceHealth({
        ...BASE,
        consecutiveFailures: 1,
        lastErrorCode: "SCHEMA_DRIFT",
        lastRunIsPartial: true,
      }).status,
    ).toBe("broken");
  });

  it("recovers to healthy when the run after a partial is a full success", () => {
    expect(
      calculateSourceHealth({ ...BASE, lastRunIsPartial: false, consecutiveFailures: 0 }).status,
    ).toBe("healthy");
  });
});
