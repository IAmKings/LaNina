import { describe, expect, it } from "vitest";

import { D1AdminReadModelRepository, AdminReadModelStorageError } from "./cloudflare-admin-read-models";

const ACTOR = { email: "researcher@example.test", roles: ["viewer", "editor"] as const };

describe("D1AdminReadModelRepository", () => {
  it("projects only bounded editor-safe source-run fields", async () => {
    const database = new FakeDatabase(success([runRow()]));

    const result = await new D1AdminReadModelRepository(database as unknown as D1Database).runs(ACTOR, null);

    expect(database.statement.values).toEqual([26]);
    expect(database.statement.query).toContain("JOIN sources source ON source.id = run.source_id");
    expect(database.statement.query).toContain("ORDER BY run.scheduled_at DESC, run.id DESC");
    expect(database.statement.query).not.toMatch(/error_message|snapshot_key|content_hash|etag|last_modified|metadata_json|stack/i);
    expect(result).toEqual({
      actor: ACTOR,
      runs: [{
        id: "run-noaa-1",
        sourceId: "noaa_cpc_roni",
        sourceName: "NOAA CPC",
        scheduledAt: "2026-09-09T12:00:00.000Z",
        finishedAt: "2026-09-09T12:05:00.000Z",
        status: "failed",
        observationsInserted: 0,
        observationsRevised: 1,
        safeErrorCode: "NETWORK",
      }],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|stack|snapshot|message/i);
  });

  it("binds a canonical cursor and returns the next page cursor from the final visible run", async () => {
    const database = new FakeDatabase(success(Array.from({ length: 26 }, (_, index) => runRow({
      id: `run-${String(26 - index).padStart(2, "0")}`,
    }))));

    const result = await new D1AdminReadModelRepository(database as unknown as D1Database).runs(ACTOR, {
      scheduledAt: "2026-09-10T00:00:00.000Z",
      id: "run-next",
    });

    expect(database.statement.values).toEqual([
      "2026-09-10T00:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
      "run-next",
      26,
    ]);
    expect(result.runs).toHaveLength(25);
    expect(result.nextCursor).toBe(JSON.stringify({ scheduledAt: "2026-09-09T12:00:00.000Z", id: "run-02" }));
  });

  it("fails closed when a stored error code is not an approved safe category", async () => {
    const database = new FakeDatabase(success([runRow({ error_code: "private upstream message" })]));

    await expect(new D1AdminReadModelRepository(database as unknown as D1Database).runs(ACTOR, null))
      .rejects.toBeInstanceOf(AdminReadModelStorageError);
  });

  it("projects only review-safe draft and current published fields", async () => {
    const database = new FakeDatabase(success([draftReviewRow()]));

    const result = await new D1AdminReadModelRepository(database as unknown as D1Database)
      .draft(ACTOR, "RUBBER-TH-01");

    expect(database.statement.values).toEqual(["RUBBER-TH-01"]);
    expect(database.statement.query).toContain("LEFT JOIN thesis_publications publication");
    expect(database.statement.query).toContain("draft.status = 'draft'");
    expect(database.statement.query).toContain("published.status = 'published'");
    expect(database.statement.query).not.toMatch(/calculation_json|evidence|observation|source_run|snapshot|audit|created_by|published_by/i);
    expect(result).toEqual({
      actor: ACTOR,
      thesis: { id: "RUBBER-TH-01", title: "天然橡胶供应风险", currentPublishedVersion: 2 },
      draft: expect.objectContaining({ version: 3, summary: "草稿摘要", changeReason: "区域观测修订。" }),
      published: expect.objectContaining({ version: 2, summary: "已发布摘要", changeReason: "初始发布。" }),
    });
    expect(JSON.stringify(result)).not.toMatch(/calculation|evidence|observation|source_run|snapshot|audit|created_by|published_by/i);
  });

  it("returns a known thesis with no draft as a safe reviewable empty draft", async () => {
    const database = new FakeDatabase(success([draftReviewRow({
      draft_version: null,
      draft_id: null,
      draft_direction: null,
      draft_stage: null,
      draft_confidence: null,
      draft_summary: null,
      draft_invalidation: null,
      draft_based_on_cutoff: null,
      draft_created_at: null,
      draft_change_reason: null,
    })]));

    const result = await new D1AdminReadModelRepository(database as unknown as D1Database)
      .draft(ACTOR, "RUBBER-TH-01");

    expect(result?.draft).toBeNull();
    expect(result?.published?.version).toBe(2);
  });
});

class FakeStatement {
  values: unknown[] = [];

  constructor(readonly query: string, private readonly result: D1Result<Record<string, unknown>>) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  all(): Promise<D1Result<Record<string, unknown>>> {
    return Promise.resolve(this.result);
  }
}

class FakeDatabase {
  statement!: FakeStatement;

  constructor(private readonly result: D1Result<Record<string, unknown>>) {}

  prepare(query: string): FakeStatement {
    this.statement = new FakeStatement(query, this.result);
    return this.statement;
  }
}

function success(results: readonly Record<string, unknown>[]): D1Result<Record<string, unknown>> {
  return { success: true, results } as D1Result<Record<string, unknown>>;
}

function runRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "run-noaa-1",
    source_id: "noaa_cpc_roni",
    source_name: "NOAA CPC",
    scheduled_at: "2026-09-09T12:00:00.000Z",
    finished_at: "2026-09-09T12:05:00.000Z",
    status: "failed",
    observations_inserted: 0,
    observations_revised: 1,
    error_code: "NETWORK",
    ...overrides,
  };
}

function draftReviewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    thesis_id: "RUBBER-TH-01",
    thesis_title: "天然橡胶供应风险",
    current_published_version_id: "rubber-version-2",
    draft_id: "rubber-version-3",
    draft_version: 3,
    draft_direction: "bullish",
    draft_stage: "physical_pressure",
    draft_confidence: 68,
    draft_summary: "草稿摘要",
    draft_invalidation: "草稿失效条件",
    draft_based_on_cutoff: "2026-09-09T22:30:00.000Z",
    draft_created_at: "2026-09-09T22:35:00.000Z",
    draft_change_reason: "区域观测修订。",
    published_id: "rubber-version-2",
    published_version: 2,
    published_direction: "bullish",
    published_stage: "weather_realized",
    published_confidence: 62,
    published_summary: "已发布摘要",
    published_invalidation: "已发布失效条件",
    published_based_on_cutoff: "2026-09-08T22:30:00.000Z",
    published_created_at: "2026-09-08T22:35:00.000Z",
    published_change_reason: "初始发布。",
    ...overrides,
  };
}
