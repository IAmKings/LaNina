import { describe, expect, it } from "vitest";

import {
  D1AtomFeedRepository,
  D1PublicDailyBriefRepository,
  D1PublicReadModelRepository,
  ReadModelStorageError,
} from "./cloudflare-read-models";
import { EMPTY_PUBLIC_CHANGES_QUERY, PublicIndicatorSeriesRangeError } from "../../modules/read-models";

const GENERATED_AT = "2026-09-09T23:00:00.000Z";

describe("D1PublicReadModelRepository", () => {
  it("reads the overview with one page-level batch and projects only public fields", async () => {
    const database = new FakeDatabase([
      success([briefRow()]),
      success([cardRow()]),
      success([changeRow()]),
      success([sourceRow()]),
    ]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .overview(GENERATED_AT);

    expect(database.statements).toHaveLength(4);
    expect(database.statements[1]!.query).toContain("thesis_publications publication");
    expect(database.statements[1]!.query).toContain("publication.current_version_id");
    expect(database.statements[1]!.query).toContain("version.status = 'published'");
    expect(database.statements[1]!.query).not.toContain("MAX(version)");
    expect(database.statements[2]!.query).toContain("change.published_version_id");
    expect(database.statements[2]!.values).toEqual([3]);
    expect(database.statements[3]!.query).toContain("source.enabled = 1");
    expect(JSON.stringify(database.statements.map((statement) => statement.query)))
      .not.toMatch(/snapshot_key|source_run_id|metadata_json|error_message|after_json|before_json/i);
    expect(result).toMatchObject({
      methodologyVersion: "evaluation-v1-draft",
      dailyBrief: { briefDate: "2026-09-10" },
      enso: { id: "ENSO-CORE-01", stage: "watch" },
      topChanges: [{ type: "thesis", afterLabel: "已进入公开版本" }],
      theses: [{ latestEvidenceSummary: null }],
      sourceHealth: { healthy: 1, delayed: 0, stale: 0, broken: 0 },
      freshness: "current",
    });
  });

  it("returns an explicit empty public overview rather than reading drafts", async () => {
    const database = new FakeDatabase([success([]), success([]), success([]), success([])]);

    await expect(new D1PublicReadModelRepository(database as unknown as D1Database)
      .overview(GENERATED_AT)).resolves.toEqual({
      methodologyVersion: "unavailable",
      dailyBrief: null,
      enso: null,
      topChanges: [],
      theses: [],
      sourceHealth: { healthy: 0, delayed: 0, stale: 0, broken: 0 },
      freshness: "current",
    });
    expect(database.statements[1]!.query).toContain("version.status = 'published'");
    expect(database.statements[1]!.query).not.toContain("status = 'draft'");
  });

  it("uses existing pointer/public-version query indexes without a card-level query", () => {
    const database = new FakeDatabase([success([]), success([]), success([]), success([])]);
    const repository = new D1PublicReadModelRepository(database as unknown as D1Database);

    void repository.overview(GENERATED_AT);

    const thesisQuery = database.statements[1]!.query;
    expect(thesisQuery).toMatch(/FROM thesis_publications publication/);
    expect(thesisQuery).toMatch(/publication\.current_version_id/);
    expect(thesisQuery).toMatch(/version\.status = 'published'/);
    expect(database.statements).toHaveLength(4);
  });

  it("reads a one-query public thesis-card list from current published pointers only", async () => {
    const database = new FakeDatabase([], [success([cardRow(), rubberCardRow()])]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .theses(null, GENERATED_AT);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]!.query).toContain("publication.current_version_id");
    expect(database.statements[0]!.query).toContain("version.status = 'published'");
    expect(database.statements[0]!.query).not.toMatch(/status = 'draft'|snapshot_key|source_run_id|metadata_json|audit/i);
    expect(result).toMatchObject([
      { id: "ENSO-CORE-01", category: "climate" },
      { id: "RUBBER-TH-01", category: "rubber" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/snapshot|source_run|metadata|audit|draft/i);
  });

  it("filters the public thesis-card list by one established category and keeps empty results public", async () => {
    const filtered = new FakeDatabase([], [success([rubberCardRow()])]);
    const empty = new FakeDatabase([], [success([])]);

    await expect(new D1PublicReadModelRepository(filtered as unknown as D1Database)
      .theses("rubber", GENERATED_AT)).resolves.toMatchObject([{ id: "RUBBER-TH-01", category: "rubber" }]);
    expect(filtered.statements).toHaveLength(1);
    expect(filtered.statements[0]!.values).toEqual(["rubber"]);
    expect(filtered.statements[0]!.query).toContain("thesis.category = ?");

    await expect(new D1PublicReadModelRepository(empty as unknown as D1Database)
      .theses("shipping", GENERATED_AT)).resolves.toEqual([]);
  });

  it("projects a bounded raw indicator series only through its public, redistributable source", async () => {
    const database = new FakeDatabase([], [success([publicIndicatorSeriesRow()])]);
    const result = await new D1PublicReadModelRepository(database as unknown as D1Database).indicatorSeries({
      indicatorId: "enso_roni_ersstv6",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T00:00:00.000Z",
      resolution: "raw",
    });

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]!.values).toEqual([
      "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z", "enso_roni_ersstv6", 1001,
    ]);
    expect(database.statements[0]!.query).toContain("indicator.public = 1");
    expect(database.statements[0]!.query).toContain("source.redistribution IN ('allowed', 'derived_only')");
    expect(database.statements[0]!.query).toContain("observation.quality <> 'invalid'");
    expect(database.statements[0]!.query).not.toMatch(/snapshot|source_run|metadata_json|error_message|audit/i);
    expect(result).toMatchObject({
      id: "enso_roni_ersstv6",
      points: [{ value: 0.8, revision: 1, isRevision: true, source: { name: "NOAA CPC" } }],
    });
  });

  it("fails closed rather than silently truncating a public indicator series", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => publicIndicatorSeriesRow({
      observed_at: `2026-09-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const database = new FakeDatabase([], [success(rows)]);

    await expect(new D1PublicReadModelRepository(database as unknown as D1Database).indicatorSeries({
      indicatorId: "enso_roni_ersstv6",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T00:00:00.000Z",
      resolution: "raw",
    })).rejects.toBeInstanceOf(PublicIndicatorSeriesRangeError);
  });

  it("fails closed on a malformed public row", async () => {
    const database = new FakeDatabase([
      success([]),
      success([{ ...cardRow(), confidence: 101 }]),
      success([]),
      success([]),
    ]);

    await expect(new D1PublicReadModelRepository(database as unknown as D1Database)
      .overview(GENERATED_AT)).rejects.toBeInstanceOf(ReadModelStorageError);
  });

  it("reads one thesis detail projection from the current public pointer only", async () => {
    const database = new FakeDatabase([
      success([detailThesisRow()]),
      success([detailEvidenceRow("supports"), detailEvidenceRow("refutes")]),
      success([detailIndicatorRow()]),
      success([detailVersionRow()]),
      success([sourceRow()]),
    ]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .thesis("enso-core", GENERATED_AT);

    expect(database.statements).toHaveLength(5);
    expect(database.statements.every((statement) => statement.values[0] === "enso-core")).toBe(true);
    expect(database.statements[0]!.query).toContain("publication.current_version_id");
    expect(database.statements[0]!.query).toContain("version.status = 'published'");
    expect(database.statements[1]!.query).toContain("evidence.stance IN ('supports', 'refutes')");
    expect(database.statements[2]!.query).toContain("indicator.public = 1");
    expect(database.statements[3]!.query).toContain("version.status = 'published'");
    expect(result).toMatchObject({
      thesis: { id: "ENSO-CORE-01", latestEvidenceSummary: "支持证据", freshness: "current" },
      invalidation: "独立机构反转确认。",
      supportingEvidence: [{ summary: "支持证据", source: { name: "NOAA CPC" } }],
      counterEvidence: [{ summary: "反向证据" }],
      indicators: [{ id: "enso_roni_ersstv6", points: [{ value: 0.8, isRevision: true }] }],
      versions: [{ version: 2, changeReason: "公开修订" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/snapshot_key|source_run_id|metadata_json|error_message|raw/i);
  });

  it("treats a slug without a current published pointer as absent rather than reading drafts", async () => {
    const database = new FakeDatabase([success([]), success([]), success([]), success([]), success([])]);

    await expect(new D1PublicReadModelRepository(database as unknown as D1Database)
      .thesis("draft-only", GENERATED_AT)).resolves.toBeNull();
    expect(database.statements[0]!.query).toContain("version.status = 'published'");
    expect(database.statements[0]!.query).not.toContain("status = 'draft'");
  });

  it("reads a market category through one public-only page projection", async () => {
    const database = new FakeDatabase([
      success([rubberCardRow()]),
      success([rubberChangeRow()]),
      success([sourceRow()]),
    ]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .category("rubber", GENERATED_AT);

    expect(database.statements).toHaveLength(3);
    expect(database.statements[0]!.values).toEqual(["rubber"]);
    expect(database.statements[0]!.query).toContain("publication.current_version_id");
    expect(database.statements[0]!.query).toContain("version.status = 'published'");
    expect(database.statements[1]!.values).toEqual(["rubber", 8]);
    expect(database.statements[1]!.query).toContain("change.published_version_id = version.id");
    expect(database.statements[2]!.query).toContain("evidence.stance IN ('supports', 'refutes')");
    expect(result).toMatchObject({
      category: "rubber",
      title: "天然橡胶",
      theses: [{ id: "RUBBER-TH-01", freshness: "current" }],
      changes: [{ thesisId: "RUBBER-TH-01", publishedInCurrentThesis: true }],
      freshness: "current",
    });
    expect(JSON.stringify(result))
      .not.toMatch(/snapshot_key|source_run_id|metadata_json|error_message|before_json|after_json/i);
  });

  it("does not expose a category with no current published thesis pointer", async () => {
    const database = new FakeDatabase([success([]), success([]), success([])]);

    await expect(new D1PublicReadModelRepository(database as unknown as D1Database)
      .category("shipping", GENERATED_AT)).resolves.toBeNull();
    expect(database.statements[0]!.query).toContain("version.status = 'published'");
    expect(database.statements[0]!.query).not.toContain("status = 'draft'");
  });

  it("pages only public changes and keeps private change payloads out of the projection", async () => {
    const database = new FakeDatabase([
      success([publicChangeRow()]),
      success([sourceRow()]),
    ]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .changes(null, EMPTY_PUBLIC_CHANGES_QUERY, GENERATED_AT);

    expect(database.statements).toHaveLength(2);
    expect(database.statements[0]!.values).toEqual([21]);
    expect(database.statements[0]!.query).toContain("released_version.status = 'published'");
    expect(database.statements[0]!.query).toContain("indicator_source.redistribution IN ('allowed', 'derived_only')");
    expect(database.statements[0]!.query).not.toMatch(/before_json|after_json|snapshot_key|source_run_id|metadata_json/i);
    expect(result).toMatchObject({
      changes: [{
        id: "change-public-1",
        source: { name: "NOAA CPC" },
        publishedInCurrentThesis: true,
        afterLabel: "已进入当前公开版本",
      }],
      nextCursor: null,
      freshness: "current",
    });
  });

  it("binds category, thesis and time filters in SQL order for the public change list", async () => {
    const database = new FakeDatabase([
      success([publicChangeRow()]),
      success([sourceRow()]),
    ]);
    const cursor = { detectedAt: "2026-09-09T22:10:00.000Z", id: "change-9" };

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database).changes(
      cursor,
      {
        category: "rubber",
        thesisId: "RUBBER-TH-01",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T00:00:00.000Z",
      },
      GENERATED_AT,
    );

    expect(database.statements[0]!.query).toContain("FROM theses category_thesis");
    expect(database.statements[0]!.query).toContain("category_thesis.category = ?");
    expect(database.statements[0]!.query).toContain("change.thesis_id = ?");
    expect(database.statements[0]!.query).toContain("change.detected_at >= ?");
    expect(database.statements[0]!.query).toContain("change.detected_at <= ?");
    expect(database.statements[0]!.values).toEqual([
      "rubber",
      "RUBBER-TH-01",
      "2026-09-01T00:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
      cursor.detectedAt,
      cursor.detectedAt,
      cursor.id,
      21,
    ]);
    expect(result.changes).toHaveLength(1);
    expect(database.statements[0]!.query).not.toMatch(/before_json|after_json|importance >=/i);
  });

  it("reads only major public changes and published daily briefs for Atom", async () => {
    const database = new FakeDatabase([
      success([publicChangeRow()]),
      success([atomBriefRow()]),
    ]);

    const result = await new D1AtomFeedRepository(database as unknown as D1Database).feed(GENERATED_AT);

    expect(database.statements).toHaveLength(2);
    expect(database.statements[0]!.values).toEqual([4, 20]);
    expect(database.statements[0]!.query).toContain("change.importance >= ?");
    expect(database.statements[0]!.query).toContain("released_version.status = 'published'");
    expect(database.statements[0]!.query).toContain("indicator_source.redistribution IN ('allowed', 'derived_only')");
    expect(database.statements[1]!.query).toContain("brief.status = 'published'");
    expect(database.statements[1]!.query).toContain("brief.published_at IS NOT NULL");
    expect(JSON.stringify(database.statements.map((statement) => statement.query)))
      .not.toMatch(/before_json|after_json|snapshot|source_run|metadata_json|audit|published_by|freeze_key/i);
    expect(result).toMatchObject({
      changes: [{ id: "change-public-1", publishedInCurrentThesis: true }],
      dailyBriefs: [{ briefDate: "2026-09-10", headline: "今日判定" }],
    });
  });

  it("reads a frozen public daily brief without version identities or private freeze fields", async () => {
    const database = new FakeDatabase([
      success([briefRow()]),
      success(dailyBriefThesisRows()),
    ]);

    const result = await new D1PublicDailyBriefRepository(database as unknown as D1Database)
      .findPublished("2026-09-10");

    expect(database.statements).toHaveLength(2);
    expect(database.statements.every((statement) => statement.values[0] === "2026-09-10")).toBe(true);
    expect(database.statements[0]!.query).toContain("brief.status = 'published'");
    expect(database.statements[1]!.query).toContain("daily_brief_theses link");
    expect(database.statements[1]!.query).toContain("version.status IN ('published', 'withdrawn')");
    expect(JSON.stringify(database.statements.map((statement) => statement.query)))
      .not.toMatch(/freeze_key|published_by|created_by|audit|snapshot|calculation_json|reason/i);
    expect(result).toMatchObject({
      briefDate: "2026-09-10",
      methodologyVersion: "evaluation-v1-draft",
    });
    expect(result?.theses).toEqual(expect.arrayContaining([
      expect.objectContaining({ thesisId: "ENSO-CORE-01", version: 2, invalidation: "独立机构反转确认。" }),
      expect.objectContaining({ thesisId: "RUBBER-TH-01", version: 2 }),
    ]));
    expect(JSON.stringify(result)).not.toMatch(/version_id|freeze|published_by|created_by|audit|snapshot|calculation/i);
  });

  it("returns null for an absent daily brief and fails closed if frozen links are incomplete", async () => {
    await expect(new D1PublicDailyBriefRepository(new FakeDatabase([
      success([]),
      success([]),
    ]) as unknown as D1Database).findPublished("2026-09-10")).resolves.toBeNull();

    await expect(new D1PublicDailyBriefRepository(new FakeDatabase([
      success([briefRow()]),
      success(dailyBriefThesisRows().slice(0, 5)),
    ]) as unknown as D1Database).findPublished("2026-09-10")).rejects.toBeInstanceOf(ReadModelStorageError);
  });

  it("returns an explicit empty Atom projection without inspecting drafts", async () => {
    const database = new FakeDatabase([success([]), success([])]);

    await expect(new D1AtomFeedRepository(database as unknown as D1Database).feed(GENERATED_AT))
      .resolves.toEqual({ changes: [], dailyBriefs: [] });
    expect(database.statements[0]!.query).toContain("change.importance >= ?");
    expect(database.statements[0]!.query).not.toContain("status = 'draft'");
  });

  it("projects source health in one query without internal run errors", async () => {
    const database = new FakeDatabase([], [success([sourceHealthRow()])]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .dataHealth(GENERATED_AT);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]!.values).toEqual(["2026-09-02T23:00:00.000Z"]);
    expect(database.statements[0]!.query).toContain("seven_day_success_rate");
    expect(database.statements[0]!.query).not.toMatch(/error_message|snapshot_key|metadata_json/i);
    expect(result).toEqual({
      generatedAt: GENERATED_AT,
      sources: [{
        sourceId: "noaa_cpc_roni",
        name: "NOAA CPC",
        organization: "NOAA",
        homepageUrl: "https://www.cpc.ncep.noaa.gov/",
        status: "healthy",
        cadenceMinutes: 60,
        lastSuccessAt: "2026-09-09T12:00:00.000Z",
        lastFetchedAt: "2026-09-09T22:30:00.000Z",
        sevenDaySuccessRate: 100,
        affectedIndicators: ["RONI"],
        affectedTheses: ["ENSO-CORE-01"],
      }],
    });
  });

  it("uses the latest published methodology version without reading frozen private snapshots", async () => {
    const database = new FakeDatabase([], [success([methodologyRow()])]);

    const result = await new D1PublicReadModelRepository(database as unknown as D1Database)
      .methodology(GENERATED_AT);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]!.query).toContain("link.methodology_version");
    expect(database.statements[0]!.query).not.toMatch(/snapshot_json|published_by|freeze_key/i);
    expect(result).toMatchObject({
      methodologyVersion: "evaluation-v1-draft",
      lastUpdatedAt: "2026-09-09T23:00:00.000Z",
      sections: expect.arrayContaining([expect.objectContaining({ id: "confidence" })]),
    });
  });
});

class FakeStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly standaloneResult: () => D1Result<Record<string, unknown>>,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  all(): Promise<D1Result<Record<string, unknown>>> {
    return Promise.resolve(this.standaloneResult());
  }
}

class FakeDatabase {
  readonly statements: FakeStatement[] = [];
  private standaloneIndex = 0;

  constructor(
    private readonly results: readonly D1Result<Record<string, unknown>>[],
    private readonly standaloneResults: readonly D1Result<Record<string, unknown>>[] = [],
  ) {}

  prepare(query: string): FakeStatement {
    const statement = new FakeStatement(query, () => this.standaloneResults[this.standaloneIndex++] ?? success([]));
    this.statements.push(statement);
    return statement;
  }

  batch(): Promise<readonly D1Result<Record<string, unknown>>[]> {
    return Promise.resolve(this.results);
  }
}

function success(results: readonly Record<string, unknown>[]): D1Result<Record<string, unknown>> {
  return { success: true, results } as D1Result<Record<string, unknown>>;
}

function briefRow(): Record<string, unknown> {
  return {
    brief_date: "2026-09-10",
    headline: "今日判定",
    summary: "公开摘要",
    data_cutoff: "2026-09-09T22:30:00.000Z",
    published_at: "2026-09-09T23:00:00.000Z",
    methodology_version: "evaluation-v1-draft",
  };
}

function atomBriefRow(): Record<string, unknown> {
  return {
    brief_date: "2026-09-10",
    headline: "今日判定",
    summary: "公开摘要",
    data_cutoff: "2026-09-09T22:30:00.000Z",
    published_at: "2026-09-09T23:00:00.000Z",
  };
}

function cardRow(): Record<string, unknown> {
  return {
    id: "ENSO-CORE-01",
    slug: "enso-core",
    title: "ENSO 强度与持续时间",
    category: "climate",
    region: "global",
    market_scope: "RONI/ONI 与区域风险窗口",
    direction: "neutral",
    stage: "watch",
    confidence: 61,
    summary: "公开论点摘要",
    based_on_cutoff: "2026-09-09T22:30:00.000Z",
    published_at: "2026-09-09T23:00:00.000Z",
    version: 2,
  };
}

function changeRow(): Record<string, unknown> {
  return {
    id: "change-1",
    change_type: "thesis",
    thesis_id: "ENSO-CORE-01",
    thesis_title: "ENSO 强度与持续时间",
    detected_at: "2026-09-09T22:40:00.000Z",
  };
}

function sourceRow(): Record<string, unknown> {
  return {
    id: "noaa_cpc_roni",
    last_success_at: "2026-09-09T22:30:00.000Z",
    late_after_minutes: 60,
    stale_after_minutes: 120,
    consecutive_failures: 0,
    last_error_code: null,
  };
}

function detailThesisRow(): Record<string, unknown> {
  return { ...cardRow(), invalidation: "独立机构反转确认。" };
}

function detailEvidenceRow(stance: "supports" | "refutes"): Record<string, unknown> {
  return {
    summary: stance === "supports" ? "支持证据" : "反向证据",
    layer: "weather",
    stance,
    citation_url: "https://www.cpc.ncep.noaa.gov/",
    source_name: "NOAA CPC",
    source_organization: "NOAA",
    observed_at: "2026-09-09T00:00:00.000Z",
    published_at: "2026-09-09T12:00:00.000Z",
    fetched_at: "2026-09-09T12:05:00.000Z",
    quality: "verified",
    revision: 0,
    value_num: 0.8,
    value_text: null,
    unit: "°C",
    sort_order: stance === "supports" ? 0 : 1,
  };
}

function detailIndicatorRow(): Record<string, unknown> {
  return {
    id: "enso_roni_ersstv6",
    name: "RONI",
    observed_at: "2026-09-09T00:00:00.000Z",
    value_num: 0.8,
    value_text: null,
    unit: "°C",
    quality: "verified",
    revision: 1,
    source_name: "NOAA CPC",
    source_organization: "NOAA",
    citation_url: "https://www.cpc.ncep.noaa.gov/",
    published_at: "2026-09-09T12:00:00.000Z",
    fetched_at: "2026-09-09T12:05:00.000Z",
  };
}

function publicIndicatorSeriesRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "enso_roni_ersstv6",
    name: "RONI",
    indicator_unit: "°C",
    source_name: "NOAA CPC",
    source_organization: "NOAA",
    observed_at: "2026-09-09T00:00:00.000Z",
    value_num: 0.8,
    value_text: null,
    observation_unit: "°C",
    quality: "verified",
    revision: 1,
    citation_url: "https://www.cpc.ncep.noaa.gov/",
    published_at: "2026-09-09T12:00:00.000Z",
    fetched_at: "2026-09-09T12:05:00.000Z",
    ...overrides,
  };
}

function detailVersionRow(): Record<string, unknown> {
  return {
    version: 2,
    direction: "neutral",
    stage: "watch",
    confidence: 61,
    summary: "公开论点摘要",
    published_at: "2026-09-09T23:00:00.000Z",
    change_reason: "公开修订",
  };
}

function rubberCardRow(): Record<string, unknown> {
  return {
    ...cardRow(),
    id: "RUBBER-TH-01",
    slug: "thailand-natural-rubber",
    title: "泰国天然橡胶",
    category: "rubber",
    region: "thailand-south",
    market_scope: "RU、NR、TSR20、RSS3",
    direction: "bullish",
    stage: "physical_pressure",
    confidence: 72,
    version: 3,
  };
}

function rubberChangeRow(): Record<string, unknown> {
  return {
    id: "change-rubber-1",
    change_type: "thesis",
    thesis_id: "RUBBER-TH-01",
    thesis_title: "泰国天然橡胶",
    detected_at: "2026-09-09T22:40:00.000Z",
  };
}

function publicChangeRow(): Record<string, unknown> {
  return {
    id: "change-public-1",
    change_type: "observation",
    thesis_id: "ENSO-CORE-01",
    thesis_title: "ENSO 强度与持续时间",
    detected_at: "2026-09-09T22:40:00.000Z",
    source_name: "NOAA CPC",
    source_organization: "NOAA",
    source_homepage_url: "https://www.cpc.ncep.noaa.gov/",
    published_in_current_thesis: 1,
  };
}

function sourceHealthRow(): Record<string, unknown> {
  return {
    id: "noaa_cpc_roni",
    name: "NOAA CPC",
    organization: "NOAA",
    homepage_url: "https://www.cpc.ncep.noaa.gov/",
    cadence_minutes: 60,
    last_success_at: "2026-09-09T22:30:00.000Z",
    late_after_minutes: 60,
    stale_after_minutes: 120,
    consecutive_failures: 0,
    last_error_code: null,
    last_published_at: "2026-09-09T12:00:00.000Z",
    seven_day_success_rate: 100,
    affected_indicators_json: "[\"RONI\"]",
    affected_theses_json: "[\"ENSO-CORE-01\"]",
  };
}

function methodologyRow(): Record<string, unknown> {
  return {
    published_at: "2026-09-09T23:00:00.000Z",
    methodology_version: "evaluation-v1-draft",
  };
}

function dailyBriefThesisRows(): Record<string, unknown>[] {
  const definitions = [
    ["ENSO-CORE-01", "enso-core", "ENSO 强度与持续时间", "climate", "global", "RONI/ONI 与区域风险窗口"],
    ["RUBBER-TH-01", "thailand-natural-rubber", "泰国天然橡胶", "rubber", "thailand-south", "RU、NR、TSR20、RSS3"],
    ["PALM-SEA-01", "southeast-asia-palm-oil", "东南亚棕榈油", "agriculture", "indonesia-malaysia", "棕榈油"],
    ["MAIZE-SA-01", "south-america-maize", "南美玉米", "agriculture", "south-america", "玉米"],
    ["SHIP-USEC-01", "us-east-coast-shipping", "美东航线", "shipping", "us-east-coast", "集装箱航运"],
    ["SHIP-EU-01", "europe-shipping", "欧洲航线", "shipping", "europe", "集装箱航运"],
  ] as const;
  return definitions.map(([thesis_id, slug, title, category, region, market_scope], sort_order) => ({
    thesis_id,
    sort_order,
    slug,
    title,
    category,
    region,
    market_scope,
    version: 2,
    direction: "neutral",
    stage: "watch",
    confidence: 61,
    summary: "冻结公开论点摘要",
    invalidation: "独立机构反转确认。",
    based_on_cutoff: "2026-09-09T22:30:00.000Z",
    published_at: "2026-09-09T23:00:00.000Z",
  }));
}
