import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "./page-models.fixtures";
import { ADMIN_ROLES, PUBLIC_MARKET_CATEGORIES, PUBLIC_THESIS_CATEGORIES } from "./page-models";

describe("page model contracts", () => {
  it("keeps public categories and admin roles in one shared contract", () => {
    expect(PUBLIC_THESIS_CATEGORIES).toEqual(["climate", "rubber", "agriculture", "shipping"]);
    expect(PUBLIC_MARKET_CATEGORIES).toEqual(["rubber", "agriculture", "shipping"]);
    expect(ADMIN_ROLES).toEqual(["viewer", "editor", "publisher"]);
  });

  it("provides current, stale, empty, loading and safe error examples", () => {
    expect(PAGE_MODEL_FIXTURES.overview.freshness).toBe("current");
    expect(PAGE_MODEL_FIXTURES.staleOverview).toMatchObject({
      dailyBrief: null,
      freshness: "stale",
      sourceHealth: { stale: 1, broken: 1 },
    });
    expect(PAGE_MODEL_FIXTURES.emptyChanges).toEqual({
      changes: [],
      nextCursor: null,
      freshness: "current",
    });
    expect(PAGE_MODEL_FIXTURES.states.loading).toEqual({ status: "loading" });
    expect(PAGE_MODEL_FIXTURES.states.error).toEqual({
      status: "error",
      message: "暂时无法载入公开判定，请稍后重试。",
    });
  });

  it("preserves evidence times and revision markers without exposing private storage fields", () => {
    const [revision] = PAGE_MODEL_FIXTURES.thesis.indicators[0]!.points;

    expect(revision).toMatchObject({
      quality: "provisional",
      revision: 1,
      isRevision: true,
      times: expect.objectContaining({
        observedAt: "2026-09-09T00:00:00.000Z",
        publishedAt: "2026-09-09T12:00:00.000Z",
        fetchedAt: "2026-09-09T12:05:00.000Z",
      }),
    });
    expect(JSON.stringify(PAGE_MODEL_FIXTURES)).not.toMatch(/snapshot_key|source_run_id|metadata_json/i);
  });

  it("keeps supporting and counter evidence structurally equal", () => {
    const supporting = PAGE_MODEL_FIXTURES.thesis.supportingEvidence[0]!;
    const counter = PAGE_MODEL_FIXTURES.thesis.counterEvidence[0]!;

    expect(Object.keys(counter).sort()).toEqual(Object.keys(supporting).sort());
    expect(counter.stance).toBe("refutes");
    expect(supporting.stance).toBe("supports");
    expect(counter.times.observedAt).toBeNull();
  });
});
