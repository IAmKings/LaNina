import { describe, expect, it } from "vitest";
import { REQUIRED_DAILY_THESIS_IDS, dailyBriefFreezeKey } from "../../../domain/daily-brief";
import { DailyBriefModule } from "../../modules/daily-briefs";
import { D1DailyBriefRepository } from "./cloudflare-daily-briefs";

describe("D1DailyBriefRepository", () => {
  it("rebuilds four gates from D1 facts and atomically publishes six exact versions", async () => {
    const freezeKey = await expectedFreezeKey("healthy");
    const database = new ScriptedD1([
      factResults(),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      writeBatch(14),
      publishedRead(freezeKey),
    ]);

    const result = await module(database).freezeAndPublish(command());

    expect(result).toMatchObject({
      briefDate: "2026-09-10",
      status: "published",
      cutoff: "2026-09-09T22:30:00.000Z",
      publishedBy: "publisher@example.com",
    });
    expect(result.versions.map(({ thesisId, thesisVersionId }) => ({ thesisId, thesisVersionId })))
      .toEqual(targets());
    expect(result.gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(database.sql.some((sql) => sql.includes("guarded.calculation_json = json_extract"))).toBe(true);
    expect(database.sql.some((sql) => sql.includes("MAX(latest.version)"))).toBe(true);
    expect(database.sql.some((sql) => sql.includes("guarded_evidence.citation_url = json_extract"))).toBe(true);
    expect(database.sql.some((sql) => sql.includes("successful.finished_at <= ?"))).toBe(true);
    expect(database.sql.some((sql) => sql.includes("rewritten.finished_at > ?"))).toBe(true);
    expect(database.sql.every((sql) => !sql.includes("source.last_success_at"))).toBe(true);
    expect(database.binds.flat().filter((value) => value === command().cutoff).length).toBeGreaterThanOrEqual(12);
    expect(database.sql.some((sql) => sql.includes("latest_attempt.freeze_key"))).toBe(true);
    expect(database.sql.some((sql) => sql.includes("prior_link.thesis_version_id = json_extract"))).toBe(true);
    expect(database.sql.every((sql) => !sql.includes("publisher@example.com"))).toBe(true);
    expect(database.binds.flat().includes("publisher@example.com")).toBe(true);
    expect(database.sql.every((sql) => !sql.includes("SELECT *"))).toBe(true);
  });

  it("records delayed gates without changing the previous published daily brief", async () => {
    const database = new ScriptedD1([
      factResults({ primaryLastSuccess: "2026-09-01T00:00:00.000Z" }),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      writeBatch(5),
    ]);

    const result = await module(database).freezeAndPublish(command());

    expect(result.status).toBe("delayed");
    expect(result.gates[0]).toMatchObject({ status: "failed" });
    expect(database.sql.some((sql) => sql.includes("INSERT INTO daily_briefs"))).toBe(false);
    expect(database.sql.some((sql) => sql.includes("UPDATE daily_briefs"))).toBe(false);
    expect(database.sql.some((sql) => sql.includes("latest_attempt.freeze_key"))).toBe(true);
  });

  it("fails closed when an in-place source retry crossed the frozen cutoff", async () => {
    await expect(module(new ScriptedD1([
      factResults({ ambiguousRetryRewrites: 1 }),
    ])).freezeAndPublish(command())).rejects.toMatchObject({ code: "DATABASE" });
  });

  it("delays instead of publishing when one target version has no evidence", async () => {
    const evidenceRows = REQUIRED_DAILY_THESIS_IDS.slice(1).map((_thesisId, index) => ({
      id: `evidence-${index + 2}`,
      thesis_version_id: `version-${index + 2}`,
      citation_url: `https://source.example/${index + 2}`,
      sort_order: 0,
    }));
    const database = new ScriptedD1([
      factResults({ evidenceRows }),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      writeBatch(5),
    ]);

    const result = await module(database).freezeAndPublish(command());

    expect(result.status).toBe("delayed");
    expect(result.gates[2]).toMatchObject({
      status: "failed",
      reasons: ["EVIDENCE_MISSING:ENSO-CORE-01"],
    });
    expect(database.sql.some((sql) => sql.includes("INSERT INTO daily_briefs"))).toBe(false);
  });

  it("records a delayed attempt only when expectedFreezeKey still owns the latest attempt", async () => {
    const competing = { ...attemptRow("delayed"), freeze_key: "competing-freeze" };
    const database = new ScriptedD1([
      factResults({ primaryLastSuccess: "2026-09-01T00:00:00.000Z" }),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      [{ success: true, meta: { changes: 0 } }, ...writeBatch(4)],
      queryBatch([]),
      queryBatch([competing]),
      queryBatch(gateRows("delayed")),
    ]);

    await expect(module(database).freezeAndPublish(command()))
      .rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: { expectedFreezeKey: null, currentFreezeKey: "competing-freeze" },
      });
  });

  it("fails closed when the publication guard observes TOCTOU drift", async () => {
    const database = new ScriptedD1([
      factResults(),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      [{ success: true, meta: { changes: 0 } }, ...writeBatch(13)],
      queryBatch([]),
    ]);

    await expect(module(database).freezeAndPublish(command()))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("freezes the exact previous published brief used as the high-risk baseline", async () => {
    const database = new ScriptedD1([
      factResults({ previousRows: previousFactRows() }),
      queryBatch([]),
      queryBatch([]),
      emptyPublishedRead(),
      [{ success: true, meta: { changes: 0 } }, ...writeBatch(13)],
      queryBatch([]),
      queryBatch([]),
    ]);

    await expect(module(database).freezeAndPublish(command()))
      .rejects.toMatchObject({ code: "DATABASE" });
    expect(database.sql.some((sql) => sql.includes("MAX(prior.brief_date)"))).toBe(true);
    expect(database.binds.flat().some((value) => typeof value === "string"
      && value.includes('"briefDate":"2026-09-09"'))).toBe(true);
  });

  it("fails closed when the previous published brief baseline is incomplete", async () => {
    await expect(module(new ScriptedD1([
      factResults({ previousRows: previousFactRows().slice(0, 5) }),
    ])).freezeAndPublish(command())).rejects.toMatchObject({ code: "DATABASE" });
  });

  it("fails closed on malformed D1 envelopes and rows without leaking SQL", async () => {
    const malformedEnvelope = new ScriptedD1([[{ success: true }]]);
    const error = await module(malformedEnvelope).freezeAndPublish(command())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DATABASE" });
    expect(String(error)).not.toMatch(/SELECT|INSERT|daily_briefs/);

    const malformedRow = factResults();
    (malformedRow[0] as { results: Record<string, unknown>[] }).results[0]!.unknown = true;
    await expect(module(new ScriptedD1([malformedRow])).freezeAndPublish(command()))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("is idempotent for the same frozen facts and reports expected-freeze conflicts", async () => {
    const existingAttempt = attemptRow("delayed", await expectedFreezeKey("stale"));
    const existingGates = gateRows("delayed");
    const idempotent = new ScriptedD1([
      factResults({ primaryLastSuccess: "2026-09-01T00:00:00.000Z" }),
      queryBatch([existingAttempt]),
      queryBatch(existingGates),
    ]);
    const result = await module(idempotent).freezeAndPublish(command());
    expect(result.status).toBe("delayed");
    expect(idempotent.sql.some((sql) => sql.includes("INSERT INTO daily_brief_attempts"))).toBe(false);

    const conflictDb = new ScriptedD1([
      factResults(),
      queryBatch([]),
      queryBatch([{ ...attemptRow("delayed"), freeze_key: "different-freeze" }]),
      queryBatch(gateRows("delayed")),
    ]);
    await expect(module(conflictDb).freezeAndPublish(command()))
      .rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: { expectedFreezeKey: null, currentFreezeKey: "different-freeze" },
      });
  });

  it("fails public reads closed when a frozen link disappears", async () => {
    const missingLink = publishedRead();
    (missingLink[1] as { results: unknown[] }).results.pop();
    await expect(new D1DailyBriefRepository(new ScriptedD1([missingLink]).asDatabase())
      .findPublished("2026-09-10"))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("keeps a historical published brief readable after a linked thesis version is withdrawn", async () => {
    const historical = publishedRead();
    (historical[1] as { results: Record<string, unknown>[] }).results[0]!.status = "withdrawn";
    await expect(new D1DailyBriefRepository(new ScriptedD1([historical]).asDatabase())
      .findPublished("2026-09-10")).resolves.toMatchObject({ status: "published" });
  });

  it("reads a migration-backed legacy publication without inventing unavailable freeze facts", async () => {
    const legacy = publishedRead("daily-brief-freeze-legacy-v1:2026-09-10");
    const brief = (legacy[0] as { results: Record<string, unknown>[] }).results[0]!;
    const links = (legacy[1] as { results: Record<string, unknown>[] }).results;
    const attempt = (legacy[2] as { results: Record<string, unknown>[] }).results[0]!;
    const sourceSnapshot = JSON.stringify([]);
    brief.source_health_snapshot_json = sourceSnapshot;
    attempt.source_health_snapshot_json = sourceSnapshot;
    for (const link of links) {
      link.methodology_version = "legacy-unavailable";
      link.rule_version = "legacy-unavailable";
      link.based_on_cutoff = "2026-09-01T00:00:00.000Z";
      link.calculation_json = "{}";
    }
    brief.methodology_snapshot_json = JSON.stringify(links.map((link) => ({
      thesisId: link.thesis_id,
      methodologyVersion: "legacy-unavailable",
    })));
    brief.rule_snapshot_json = JSON.stringify(links.map((link) => ({
      thesisId: link.thesis_id,
      ruleVersion: "legacy-unavailable",
    })));

    await expect(new D1DailyBriefRepository(new ScriptedD1([legacy]).asDatabase())
      .findPublished("2026-09-10")).resolves.toMatchObject({
      freezeKey: "daily-brief-freeze-legacy-v1:2026-09-10",
      sourceHealth: [],
    });
  });

  it("rejects more than three, blank or duplicate top-change IDs before D1", async () => {
    for (const topChanges of [
      ["a", "b", "c", "d"],
      ["a", " "],
      ["a", "a"],
    ]) {
      await expect(module(new ScriptedD1([])).freezeAndPublish({ ...command(), topChanges }))
        .rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
});

class ScriptedD1 {
  readonly sql: string[] = [];
  readonly binds: unknown[][] = [];
  private index = 0;

  constructor(private readonly batches: unknown[][]) {}

  asDatabase(): D1Database {
    return {
      prepare: (sql: string) => {
        this.sql.push(sql);
        const statement = {
          bind: (...values: unknown[]) => {
            this.binds.push(values);
            return statement;
          },
        };
        return statement as unknown as D1PreparedStatement;
      },
      batch: async () => {
        const result = this.batches[this.index++];
        if (result === undefined) throw new Error("unexpected fake batch");
        return result;
      },
    } as unknown as D1Database;
  }
}

function module(database: ScriptedD1): DailyBriefModule {
  let id = 0;
  return new DailyBriefModule(
    new D1DailyBriefRepository(database.asDatabase()),
    () => `daily-id-${++id}`,
  );
}

function command() {
  return {
    cutoff: "2026-09-09T22:30:00.000Z",
    targets: targets(),
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    topChanges: ["无重大变化"],
    actor: "publisher@example.com",
    reason: "四类门禁通过",
    occurredAt: "2026-09-09T23:00:00.000Z",
    expectedFreezeKey: null,
  };
}

function targets() {
  return REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
    thesisId,
    thesisVersionId: `version-${index + 1}`,
  }));
}

function factResults(options: {
  primaryLastSuccess?: string;
  ambiguousRetryRewrites?: number;
  evidenceRows?: Record<string, unknown>[];
  previousRows?: Record<string, unknown>[];
} = {}): unknown[] {
  const cutoff = "2026-09-09T22:30:00.000Z";
  return [
    queryResult(REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
      id: `version-${index + 1}`,
      thesis_id: thesisId,
      version: 1,
      status: "published",
      direction: "bullish",
      stage: "watch",
      confidence: 50,
      based_on_cutoff: cutoff,
      calculation_json: JSON.stringify({
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId,
        methodologyVersion: "evaluation-v1",
        cutoff,
      }),
      latest_version: 1,
    }))),
    queryResult(options.evidenceRows ?? REQUIRED_DAILY_THESIS_IDS.map((_thesisId, index) => ({
      id: `evidence-${index + 1}`,
      thesis_version_id: `version-${index + 1}`,
      citation_url: `https://source.example/${index + 1}`,
      sort_order: 0,
    }))),
    queryResult([{
      id: "noaa_cpc_roni",
      last_success_at: options.primaryLastSuccess ?? "2026-09-09T21:30:00.000Z",
      late_after_minutes: 1440,
      stale_after_minutes: 10080,
      consecutive_failures: 0,
      last_error_code: null,
      ambiguous_retry_rewrites: options.ambiguousRetryRewrites ?? 0,
    }]),
    queryResult(options.previousRows ?? []),
    queryResult([]),
  ];
}

function previousFactRows(): Record<string, unknown>[] {
  return REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
    brief_date: "2026-09-09",
    thesis_id: thesisId,
    thesis_version_id: `previous-${index + 1}`,
    direction: "bullish",
    stage: "watch",
    confidence: 50,
  }));
}

function publishedRead(freezeKey = "daily-brief-freeze-v1:sha256:fake"): unknown[] {
  const attempt = attemptRow("published", freezeKey);
  return [
    queryResult([{
      brief_date: "2026-09-10",
      status: "published",
      freeze_key: attempt.freeze_key,
      headline: attempt.headline,
      summary: attempt.summary,
      top_changes_json: attempt.top_changes_json,
      data_cutoff: attempt.data_cutoff,
      methodology_snapshot_json: attempt.methodology_snapshot_json,
      rule_snapshot_json: attempt.rule_snapshot_json,
      source_health_snapshot_json: attempt.source_health_snapshot_json,
      publication_attempt_id: attempt.id,
      published_at: attempt.created_at,
      published_by: attempt.actor,
    }]),
    queryResult(REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
      brief_date: "2026-09-10",
      thesis_id: thesisId,
      thesis_version_id: `version-${index + 1}`,
      methodology_version: "evaluation-v1",
      rule_version: "thesis-draft-calculation-v1",
      sort_order: index,
      version: 1,
      status: "published",
      based_on_cutoff: attempt.data_cutoff,
      calculation_json: JSON.stringify({
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId,
        methodologyVersion: "evaluation-v1",
        cutoff: attempt.data_cutoff,
      }),
    }))),
    queryResult([{
      id: attempt.id,
      brief_date: attempt.brief_date,
      freeze_key: attempt.freeze_key,
      outcome: attempt.outcome,
      data_cutoff: attempt.data_cutoff,
      headline: attempt.headline,
      summary: attempt.summary,
      top_changes_json: attempt.top_changes_json,
      source_health_snapshot_json: attempt.source_health_snapshot_json,
      actor: attempt.actor,
      created_at: attempt.created_at,
    }]),
    queryResult(gateRows("published")),
  ];
}

function emptyPublishedRead(): unknown[] {
  return [queryResult([]), queryResult([]), queryResult([]), queryResult([])];
}

function attemptRow(
  outcome: "published" | "delayed",
  freezeKey = "daily-brief-freeze-v1:sha256:fake",
) {
  const versions = REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
    thesisId,
    thesisVersionId: `version-${index + 1}`,
    version: 1,
    sortOrder: index,
  }));
  return {
    id: "daily-id-1",
    brief_date: "2026-09-10",
    freeze_key: freezeKey,
    outcome,
    data_cutoff: "2026-09-09T22:30:00.000Z",
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    top_changes_json: JSON.stringify(["无重大变化"]),
    target_snapshot_json: JSON.stringify(versions),
    methodology_snapshot_json: JSON.stringify(versions.map(({ thesisId }) => ({
      thesisId, methodologyVersion: "evaluation-v1",
    }))),
    rule_snapshot_json: JSON.stringify(versions.map(({ thesisId }) => ({
      thesisId, ruleVersion: "thesis-draft-calculation-v1",
    }))),
    source_health_snapshot_json: JSON.stringify([{
      sourceId: "noaa_cpc_roni",
      status: outcome === "published" ? "healthy" : "stale",
      checkedAt: "2026-09-09T22:30:00.000Z",
      lastSuccessAt: outcome === "published"
        ? "2026-09-09T21:30:00.000Z"
        : "2026-09-01T00:00:00.000Z",
      consecutiveFailures: 0,
    }]),
    actor: "publisher@example.com",
    created_at: "2026-09-09T23:00:00.000Z",
  };
}

async function expectedFreezeKey(status: "healthy" | "stale"): Promise<string> {
  const cutoff = "2026-09-09T22:30:00.000Z";
  return dailyBriefFreezeKey({
    briefDate: "2026-09-10",
    cutoff,
    targets: targets(),
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    topChanges: ["无重大变化"],
    versions: REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
      thesisId,
      thesisVersionId: `version-${index + 1}`,
      version: 1,
      status: "published",
      isLatest: true,
      basedOnCutoff: cutoff,
      calculationThesisId: thesisId,
      calculationCutoff: cutoff,
      methodologyVersion: "evaluation-v1",
      ruleVersion: "thesis-draft-calculation-v1",
      citations: [`https://source.example/${index + 1}`],
      direction: "bullish",
      stage: "watch",
      confidence: 50,
      previousPublished: null,
      transitionReviewed: false,
    })),
    sourceHealth: [{
      sourceId: "noaa_cpc_roni",
      status,
      checkedAt: cutoff,
      lastSuccessAt: status === "healthy"
        ? "2026-09-09T21:30:00.000Z"
        : "2026-09-01T00:00:00.000Z",
      consecutiveFailures: 0,
    }],
  });
}

function gateRows(outcome: "published" | "delayed") {
  return [
    "PRIMARY_SOURCE_HEALTH",
    "FREEZE_COMPLETENESS",
    "CITATION_COMPLETENESS",
    "HIGH_RISK_REVIEW",
  ].map((gateCode, index) => ({
    attempt_id: "daily-id-1",
    gate_code: gateCode,
    status: outcome === "delayed" && index === 0 ? "failed" : "passed",
    explanation: outcome === "delayed" && index === 0 ? "权威来源过期" : "门禁通过",
    reasons_json: JSON.stringify(outcome === "delayed" && index === 0
      ? ["PRIMARY_SOURCE_STALE:noaa_cpc_roni"]
      : []),
  }));
}

function queryBatch(rows: Record<string, unknown>[]): unknown[] {
  return [queryResult(rows)];
}

function queryResult(rows: unknown[]) {
  return { success: true, results: rows };
}

function writeBatch(count: number): unknown[] {
  return Array.from({ length: count }, () => ({ success: true, meta: { changes: 1 } }));
}
