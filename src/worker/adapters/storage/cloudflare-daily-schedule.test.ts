import { describe, expect, it } from "vitest";

import { approvedDraftSeed } from "../../../domain/thesis-draft.test-support";
import { D1DailyScheduleRepository } from "./cloudflare-daily-schedule";

const CUTOFF = "2026-09-09T22:30:00.000Z";

describe("D1DailyScheduleRepository", () => {
  it("loads only cutoff-eligible observations with parameterized SQL", async () => {
    const database = new FakeDatabase([
      success([observationRow()]),
      success([]),
      success([sourceStateRow()]),
    ]);
    const repository = new D1DailyScheduleRepository(database as unknown as D1Database);

    const result = await repository.loadEvaluationInputs([approvedDraftSeed()], CUTOFF);

    expect(database.statements[0]!.query).toContain("observation.fetched_at <= ?");
    expect(database.statements[0]!.values.at(-1)).toBe(CUTOFF);
    expect(database.statements[0]!.query).not.toContain(CUTOFF);
    expect(database.statements[1]!.query).toContain("latest.based_on_cutoff < ?");
    expect(database.statements[1]!.query).toContain("latest.created_at < ?");
    expect(database.statements[1]!.values.slice(-2)).toEqual([CUTOFF, CUTOFF]);
    expect(database.statements[2]!.query).toContain("successful.finished_at <= ?");
    expect(database.statements[2]!.query).toContain("failed.finished_at <= ?");
    expect(database.statements[2]!.query).not.toContain("source.last_success_at");
    expect(result).toEqual([expect.objectContaining({
      thesisId: "TEST-THESIS-01",
      previousStage: "watch",
      hasPreviousVersion: false,
      evidence: [expect.objectContaining({
        evidenceId: "observation-1",
        indicatorId: "enso_roni_ersstv6",
        layer: "weather",
        stance: "supports",
        sourceTier: "A",
        sourceHealth: "healthy",
      })],
    })]);
  });

  it("reconstructs source health at the cutoff instead of reading mutable source health", async () => {
    const database = new FakeDatabase([
      success([observationRow()]),
      success([]),
      success([sourceStateRow({
        last_success_at: "2026-09-09T18:00:00.000Z",
        consecutive_failures: 3,
        last_error_code: "NETWORK",
      })]),
    ]);

    const [result] = await new D1DailyScheduleRepository(database as unknown as D1Database)
      .loadEvaluationInputs([approvedDraftSeed()], CUTOFF);

    expect(result!.evidence[0]).toMatchObject({
      sourceId: "source-weather-support",
      sourceHealth: "broken",
    });
    expect(database.statements[2]!.values.slice(0, 4)).toEqual([
      CUTOFF,
      CUTOFF,
      CUTOFF,
      CUTOFF,
    ]);
  });

  it("uses only a strictly prior, cutoff-available version as the previous stage", async () => {
    const database = new FakeDatabase([
      success([]),
      success([{
        thesis_id: "TEST-THESIS-01",
        stage: "physical_pressure",
        based_on_cutoff: "2026-09-08T22:30:00.000Z",
        created_at: "2026-09-08T22:31:00.000Z",
      }]),
      success([sourceStateRow()]),
    ]);

    const [result] = await new D1DailyScheduleRepository(database as unknown as D1Database)
      .loadEvaluationInputs([approvedDraftSeed()], CUTOFF);

    expect(result).toMatchObject({
      previousStage: "physical_pressure",
      hasPreviousVersion: true,
    });
    expect(database.statements[1]!.query).toContain("latest.based_on_cutoff < ?");
    expect(database.statements[1]!.query).toContain("latest.created_at < ?");
  });

  it("fails closed on a malformed previous-version availability timestamp", async () => {
    const database = new FakeDatabase([
      success([]),
      success([{
        thesis_id: "TEST-THESIS-01",
        stage: "watch",
        based_on_cutoff: "not-a-time",
        created_at: "2026-09-08T22:31:00.000Z",
      }]),
      success([sourceStateRow()]),
    ]);

    await expect(new D1DailyScheduleRepository(database as unknown as D1Database)
      .loadEvaluationInputs([approvedDraftSeed()], CUTOFF)).rejects.toMatchObject({
        code: "DATABASE",
      });
  });

  it("fails closed when an observation has no cutoff-bounded source state", async () => {
    const database = new FakeDatabase([
      success([observationRow()]),
      success([]),
      success([]),
    ]);

    await expect(new D1DailyScheduleRepository(database as unknown as D1Database)
      .loadEvaluationInputs([approvedDraftSeed()], CUTOFF)).rejects.toMatchObject({
        code: "DATABASE",
      });
  });

  it("fails closed when an in-place retry crossed the historical cutoff", async () => {
    const database = new FakeDatabase([
      success([observationRow()]),
      success([]),
      success([sourceStateRow({ ambiguous_retry_rewrites: 1 })]),
    ]);

    await expect(new D1DailyScheduleRepository(database as unknown as D1Database)
      .loadEvaluationInputs([approvedDraftSeed()], CUTOFF)).rejects.toMatchObject({
        code: "DATABASE",
      });
  });

  it("reads exact-cutoff publication candidates without guessing a different run", async () => {
    const database = new FakeDatabase([], success([{
      thesis_id: "ENSO-CORE-01",
      thesis_version_id: "version-enso-1",
      status: "draft",
    }]));
    const repository = new D1DailyScheduleRepository(database as unknown as D1Database);

    const result = await repository.findEvaluationCandidates(CUTOFF);

    expect(database.statements[0]!.values).toEqual([CUTOFF]);
    expect(database.statements[0]!.query).toContain("version.based_on_cutoff = ?");
    expect(result).toEqual([{
      thesisId: "ENSO-CORE-01",
      thesisVersionId: "version-enso-1",
      status: "draft",
    }]);
  });

  it("fails closed on malformed D1 rows", async () => {
    const database = new FakeDatabase([], success([{
      thesis_id: "ENSO-CORE-01",
      thesis_version_id: "version-enso-1",
      status: "private",
    }]));

    await expect(new D1DailyScheduleRepository(database as unknown as D1Database)
      .findEvaluationCandidates(CUTOFF)).rejects.toMatchObject({ code: "DATABASE" });
  });
});

class FakeStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly database: FakeDatabase,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  all(): Promise<D1Result<Record<string, unknown>>> {
    return Promise.resolve(this.database.allResult);
  }
}

class FakeDatabase {
  readonly statements: FakeStatement[] = [];

  constructor(
    private readonly batchResults: D1Result<Record<string, unknown>>[],
    readonly allResult: D1Result<Record<string, unknown>> = success([]),
  ) {}

  prepare(query: string): FakeStatement {
    const statement = new FakeStatement(query, this);
    this.statements.push(statement);
    return statement;
  }

  batch(): Promise<D1Result<Record<string, unknown>>[]> {
    return Promise.resolve(this.batchResults);
  }
}

function success(results: Record<string, unknown>[]): D1Result<Record<string, unknown>> {
  return { success: true, results } as D1Result<Record<string, unknown>>;
}

function observationRow(): Record<string, unknown> {
  return {
    id: "observation-1",
    indicator_id: "enso_roni_ersstv6",
    observed_at: "2026-09-09T22:00:00.000Z",
    value_num: 1.2,
    value_text: null,
    unit: "test-unit",
    published_at: "2026-09-09T22:05:00.000Z",
    fetched_at: "2026-09-09T22:10:00.000Z",
    revision: 0,
    supersedes_id: null,
    quality: "verified",
    source_run_id: "run-1",
    citation_url: "https://fixtures.invalid/observation-1",
    source_id: "source-weather-support",
  };
}

function sourceStateRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    source_id: "source-weather-support",
    source_tier: "A",
    last_success_at: "2026-09-09T22:10:00.000Z",
    late_after_minutes: 60,
    stale_after_minutes: 120,
    consecutive_failures: 0,
    last_error_code: null,
    ambiguous_retry_rewrites: 0,
    ...overrides,
  };
}
