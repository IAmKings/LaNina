import { describe, expect, it } from "vitest";
import { buildThesisDraftStorageRecord } from "../../../domain/thesis-draft";
import { makeDraftCandidate } from "../../../domain/thesis-draft.test-support";
import { ThesisDraftError, ThesisDraftModule } from "../../modules/thesis-drafts";
import { D1ThesisDraftRepository } from "./cloudflare-thesis-drafts";

describe("D1ThesisDraftRepository", () => {
  it("creates version 1 atomically and returns the existing draft for an identical rerun", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const candidate = makeDraftCandidate();

    const first = await module.create(candidate);
    const rerun = await module.create(makeDraftCandidate({
      createdBy: "another-job",
      createdAt: "2026-09-08T12:02:00.000Z",
    }));

    expect(first).toEqual({
      id: "draft-id-1",
      version: 1,
      ...(await buildThesisDraftStorageRecord(candidate)),
    });
    expect(rerun).toEqual(first);
    expect(database.versions).toHaveLength(1);
    expect(database.evidence).toHaveLength(2);
    expect(database.evidence.map((row) => row.sort_order)).toEqual([0, 1]);
    expect(database.writeBatchSizes).toEqual([3]);
  });

  it("creates a new automatic version for a different cutoff and requires its change reason", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await module.create(makeDraftCandidate());

    await expect(module.create(makeDraftCandidate({
      cutoff: "2026-09-08T12:30:00.000Z",
      createdAt: "2026-09-08T12:31:00.000Z",
    }))).rejects.toMatchObject({ code: "VALIDATION" });
    const second = await module.create(makeDraftCandidate({
      cutoff: "2026-09-08T12:30:00.000Z",
      createdAt: "2026-09-08T12:31:00.000Z",
      changeReason: "日切证据重新计算",
    }));

    expect(second.version).toBe(2);
    expect(second.changeReason).toBe("日切证据重新计算");
    expect(database.versions.map((row) => row.version)).toEqual([1, 2]);
    expect(database.evidence).toHaveLength(4);
  });

  it("edits by expected version with copy-on-write and complete evidence replacement", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const first = await module.create(makeDraftCandidate());
    const base = makeDraftCandidate({
      summary: "编辑后的摘要",
      invalidation: "编辑后的失效条件",
      changeReason: "研究员调整文案和证据说明",
      createdBy: "researcher@example.com",
      createdAt: "2026-09-08T13:00:00.000Z",
    });
    const edited = await module.edit(1, {
      ...base,
      evidence: base.evidence.map((item, index) => ({
        ...item,
        summary: `编辑后的证据 ${index + 1}`,
      })),
    });

    expect(edited).toMatchObject({
      version: 2,
      status: "draft",
      summary: "编辑后的摘要",
      invalidation: "编辑后的失效条件",
      changeReason: "研究员调整文案和证据说明",
      createdBy: "researcher@example.com",
      evidence: [
        { summary: "编辑后的证据 1", sortOrder: 0 },
        { summary: "编辑后的证据 2", sortOrder: 1 },
      ],
    });
    expect(first).toMatchObject({ version: 1, summary: "天气与市场证据形成首轮可审计草稿。" });
    expect(database.versions[0]?.summary).toBe(first.summary);
    expect(database.evidence.filter((row) => row.thesis_version_id === first.id)).toHaveLength(2);
    expect(database.evidence.filter((row) => row.thesis_version_id === edited.id)).toHaveLength(2);
  });

  it("copies a current draft's calculated evidence and appends a bounded audit entry atomically", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const source = await module.create(makeDraftCandidate());

    const edited = await module.editAdministrative({
      versionId: source.id,
      thesisId: source.thesisId,
      expectedVersion: source.version,
      summary: "编辑后的研究摘要",
      invalidation: undefined,
      reason: "补充人工可读的风险条件",
      actor: "editor@example.test",
      occurredAt: "2026-09-08T13:00:00.000Z",
    });

    expect(edited).toEqual({
      id: "draft-id-4",
      thesisId: source.thesisId,
      version: 2,
      status: "draft",
      createdAt: "2026-09-08T13:00:00.000Z",
    });
    expect(database.versions).toHaveLength(2);
    expect(database.versions[0]).toMatchObject({ summary: source.summary, created_by: source.createdBy });
    expect(database.versions[1]).toMatchObject({
      summary: "编辑后的研究摘要",
      invalidation: source.invalidation,
      calculation_json: database.versions[0]?.calculation_json,
      created_by: "editor@example.test",
      change_reason: "补充人工可读的风险条件",
    });
    expect(database.evidence.filter((row) => row.thesis_version_id === source.id)).toHaveLength(2);
    expect(database.evidence.filter((row) => row.thesis_version_id === edited.id)).toHaveLength(2);
    expect(database.audits).toEqual([{
      id: "draft-id-5",
      entity_type: "thesis",
      entity_id: source.thesisId,
      action: "draft_edited",
      actor: "editor@example.test",
      reason: "补充人工可读的风险条件",
      before: { version: 1, summary: source.summary, invalidation: source.invalidation },
      after: { version: 2, summary: "编辑后的研究摘要", invalidation: source.invalidation },
      created_at: "2026-09-08T13:00:00.000Z",
    }]);
    expect(database.writeBatchSizes).toEqual([3, 4]);
    expect(database.sql.some((sql) => sql.includes("INSERT INTO audit_log"))).toBe(true);
  });

  it("allows only one administrative edit against the same version and leaves no partial audit", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const source = await module.create(makeDraftCandidate());
    const edit = (summary: string) => module.editAdministrative({
      versionId: source.id,
      thesisId: source.thesisId,
      expectedVersion: 1,
      summary,
      invalidation: undefined,
      reason: `编辑 ${summary}`,
      actor: "editor@example.test",
      occurredAt: "2026-09-08T13:00:00.000Z",
    });

    const outcomes = await Promise.allSettled([edit("编辑 A"), edit("编辑 B")]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { code: "VERSION_CONFLICT", details: { expectedVersion: 1, currentVersion: 2 } },
    });
    expect(database.versions).toHaveLength(2);
    expect(database.evidence).toHaveLength(4);
    expect(database.audits).toHaveLength(1);
  });

  it("rejects an unchanged administrative draft without creating a version, evidence, or audit row", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const source = await module.create(makeDraftCandidate());

    await expect(module.editAdministrative({
      versionId: source.id,
      thesisId: source.thesisId,
      expectedVersion: source.version,
      summary: source.summary,
      invalidation: undefined,
      reason: "重复提交",
      actor: "editor@example.test",
      occurredAt: "2026-09-08T13:00:00.000Z",
    })).rejects.toMatchObject({ code: "VALIDATION" });

    expect(database.versions).toHaveLength(1);
    expect(database.evidence).toHaveLength(2);
    expect(database.audits).toEqual([]);
  });

  it("allows only one of two concurrent edits against the same expected version", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await module.create(makeDraftCandidate());

    const outcomes = await Promise.allSettled([
      module.edit(1, makeDraftCandidate({ summary: "并发编辑 A", changeReason: "A" })),
      module.edit(1, makeDraftCandidate({ summary: "并发编辑 B", changeReason: "B" })),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = outcomes.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: {
        code: "VERSION_CONFLICT",
        details: { expectedVersion: 1, currentVersion: 2 },
      },
    });
    expect(database.versions).toHaveLength(2);
    expect(database.evidence).toHaveLength(4);
  });

  it("returns stable conflict, non-draft and not-found errors without SQL details", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await expect(module.edit(1, makeDraftCandidate({ changeReason: "missing" })))
      .rejects.toMatchObject({ code: "NOT_FOUND", details: null });

    await module.create(makeDraftCandidate());
    await module.edit(1, makeDraftCandidate({ summary: "v2", changeReason: "v2" }));
    await expect(module.edit(1, makeDraftCandidate({ summary: "stale", changeReason: "stale" })))
      .rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: { expectedVersion: 1, currentVersion: 2 },
      });

    database.versions[1]!.status = "published";
    const publishedError = await module.edit(2, makeDraftCandidate({
      summary: "published source",
      changeReason: "published source",
    })).catch((error: unknown) => error);
    expect(publishedError).toMatchObject({ code: "NON_DRAFT", details: null });
    expect(String(publishedError)).not.toMatch(/SELECT|INSERT|thesis_versions/);

    database.versions[1]!.status = "withdrawn";
    await expect(module.edit(2, makeDraftCandidate({
      summary: "withdrawn source",
      changeReason: "withdrawn source",
    }))).rejects.toMatchObject({ code: "NON_DRAFT" });
  });

  it("does not recreate a semantic draft key that already belongs to a published version", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await module.create(makeDraftCandidate());
    database.versions[0]!.status = "published";

    await expect(module.create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "NON_DRAFT", details: null });
    expect(database.versions).toHaveLength(1);
    expect(database.evidence).toHaveLength(2);
  });

  it("returns NOT_FOUND when automatic creation references a missing thesis", async () => {
    const database = new FakeDraftD1();
    database.thesisIds.clear();

    await expect(draftModule(database).create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "NOT_FOUND", details: null });
    expect(database.versions).toEqual([]);
    expect(database.evidence).toEqual([]);
  });

  it("rolls back the version and evidence together on a D1 batch failure", async () => {
    const database = new FakeDraftD1();
    database.failWriteBatches = 2;
    const module = draftModule(database);

    await expect(module.create(makeDraftCandidate())).rejects.toMatchObject({ code: "DATABASE" });
    expect(database.versions).toEqual([]);
    expect(database.evidence).toEqual([]);
  });

  it("fails closed on malformed rows and read failures", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await module.create(makeDraftCandidate());
    database.versions[0]!.calculation_json = "{broken";
    await expect(module.create(makeDraftCandidate())).rejects.toMatchObject({ code: "DATABASE" });

    const unavailable = new FakeDraftD1();
    unavailable.failReads = true;
    await expect(draftModule(unavailable).create(makeDraftCandidate()))
      .rejects.toBeInstanceOf(ThesisDraftError);
    await expect(draftModule(unavailable).create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE", details: null });
  });

  it("fails closed when D1 batch metadata or query result envelopes are malformed", async () => {
    const malformedWrite = new FakeDraftD1();
    malformedWrite.malformedWriteResultIndex = 1;
    await expect(draftModule(malformedWrite).create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE", details: null });

    const malformedRead = new FakeDraftD1();
    malformedRead.malformedReadBatch = true;
    await expect(draftModule(malformedRead).create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE", details: null });
  });

  it("rejects row drift, extra columns and evidence that disagrees with calculation refs", async () => {
    const extraColumn = new FakeDraftD1();
    const extraModule = draftModule(extraColumn);
    await extraModule.create(makeDraftCandidate());
    extraColumn.versions[0]!.unexpected_private_column = "must not cross boundary";
    await expect(extraModule.create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE" });

    const keyDrift = new FakeDraftD1();
    const keyModule = draftModule(keyDrift);
    await keyModule.create(makeDraftCandidate());
    keyDrift.versions[0]!.summary = "未同步 draft key 的摘要";
    await expect(keyModule.create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE" });

    const evidenceDrift = new FakeDraftD1();
    const evidenceModule = draftModule(evidenceDrift);
    await evidenceModule.create(makeDraftCandidate());
    evidenceDrift.evidence[0]!.weight = 1;
    await expect(evidenceModule.create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("rejects calculation evidence references outside the selected evidence set", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    await module.create(makeDraftCandidate());
    const calculation = JSON.parse(database.versions[0]!.calculation_json) as {
      direction: { ruleHits: Array<{ evidenceIds: string[] }> };
    };
    calculation.direction.ruleHits[0]!.evidenceIds = ["forged-evidence"];
    database.versions[0]!.calculation_json = JSON.stringify(calculation);

    await expect(module.create(makeDraftCandidate()))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("uses parameterized SQL and never embeds draft copy", async () => {
    const database = new FakeDraftD1();
    const module = draftModule(database);
    const summary = "敏感但允许持久化的草稿摘要";
    await module.create(makeDraftCandidate({ summary }));

    expect(database.sql.some((sql) => sql.includes(summary))).toBe(false);
    expect(database.sql.every((sql) => !sql.includes("SELECT *"))).toBe(true);
    expect(database.binds.flat().includes(summary)).toBe(true);
  });
});

function draftModule(database: FakeDraftD1): ThesisDraftModule {
  let id = 0;
  return new ThesisDraftModule(new D1ThesisDraftRepository(
    database.asDatabase(),
    () => `draft-id-${++id}`,
  ));
}

interface FakeStatement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface FakeVersionRow extends Record<string, unknown> {
  id: string;
  thesis_id: string;
  version: number;
  status: "draft" | "published" | "withdrawn";
  direction: string;
  stage: string;
  confidence: number;
  summary: string;
  invalidation: string;
  calculation_json: string;
  based_on_cutoff: string;
  created_by: string;
  published_by: string | null;
  created_at: string;
  published_at: string | null;
  change_reason: string | null;
  draft_key: string;
}

interface FakeEvidenceRow extends Record<string, unknown> {
  id: string;
  thesis_version_id: string;
  observation_id: string | null;
  source_run_id: string | null;
  stance: string;
  layer: string;
  weight: number;
  summary: string;
  citation_url: string;
  sort_order: number;
}

interface FakeAuditRow {
  id: string;
  entity_type: "thesis";
  entity_id: string;
  action: "draft_edited";
  actor: string;
  reason: string;
  before: { version: number; summary: string; invalidation: string };
  after: { version: number; summary: string; invalidation: string };
  created_at: string;
}

class FakeDraftD1 {
  versions: FakeVersionRow[] = [];
  evidence: FakeEvidenceRow[] = [];
  audits: FakeAuditRow[] = [];
  readonly sql: string[] = [];
  readonly binds: unknown[][] = [];
  readonly writeBatchSizes: number[] = [];
  failWriteBatches = 0;
  failReads = false;
  malformedWriteResultIndex: number | null = null;
  malformedReadBatch = false;
  readonly thesisIds = new Set(["TEST-THESIS-01"]);

  asDatabase(): D1Database {
    return {
      prepare: (sql: string) => this.statement({ sql, values: [] }),
      batch: async (statements: D1PreparedStatement[]) => {
        const data = statements as unknown as FakeStatement[];
        const hasWrite = data.some(({ sql }) => !sql.trimStart().startsWith("SELECT"));
        if (!hasWrite) {
          if (this.failReads) throw new Error("private D1 read detail");
          const results = data.map((statement) => ({
            success: true,
            results: this.select(statement, this.versions, this.evidence),
            meta: {},
          }));
          if (this.malformedReadBatch) delete (results[0] as { results?: unknown }).results;
          return results;
        }
        const versions = this.versions.map((row) => ({ ...row }));
        const evidence = this.evidence.map((row) => ({ ...row }));
        const audits = this.audits.map((row) => ({
          ...row,
          before: { ...row.before },
          after: { ...row.after },
        }));
        const results = data.map((statement) => ({
          success: true,
          results: [],
          meta: { changes: this.apply(statement, versions, evidence, audits) },
        }));
        if (this.failWriteBatches > 0) {
          this.failWriteBatches -= 1;
          throw new Error("private D1 write detail");
        }
        this.versions = versions;
        this.evidence = evidence;
        this.audits = audits;
        this.writeBatchSizes.push(data.length);
        if (this.malformedWriteResultIndex !== null) {
          delete (results[this.malformedWriteResultIndex] as { meta?: unknown }).meta;
        }
        return results;
      },
    } as unknown as D1Database;
  }

  private statement(data: FakeStatement): D1PreparedStatement {
    this.sql.push(data.sql);
    return {
      ...data,
      bind: (...values: unknown[]) => {
        this.binds.push(values);
        return this.statement({ sql: data.sql, values });
      },
      first: async () => {
        if (this.failReads) throw new Error("private D1 read detail");
        return this.select(data, this.versions, this.evidence)[0] ?? null;
      },
    } as unknown as D1PreparedStatement;
  }

  private select(
    statement: FakeStatement,
    versions: readonly FakeVersionRow[],
    evidence: readonly FakeEvidenceRow[],
  ): Record<string, unknown>[] {
    if (statement.sql.includes("SELECT id FROM theses")) {
      return this.thesisIds.has(String(statement.values[0]))
        ? [{ id: statement.values[0] }]
        : [];
    }
    if (statement.sql.includes("FROM thesis_versions") && statement.sql.includes("WHERE draft_key = ?")) {
      return versions.filter(
        (row) => row.draft_key === statement.values[0],
      ).slice(0, 1).map((row) => ({ ...row }));
    }
    if (statement.sql.includes("FROM thesis_versions") && statement.sql.includes("WHERE id = ?")) {
      return versions.filter((row) => row.id === statement.values[0]).slice(0, 1).map((row) => ({ ...row }));
    }
    if (statement.sql.includes("FROM evidence e")) {
      const version = statement.sql.includes("WHERE v.id = ?")
        ? versions.find((row) => row.id === statement.values[0])
        : versions.find((row) => row.draft_key === statement.values[0]);
      return evidence
        .filter((row) => row.thesis_version_id === version?.id)
        .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
        .map((row) => ({ ...row }));
    }
    if (statement.sql.includes("ORDER BY version DESC")) {
      return versions
        .filter((row) => row.thesis_id === statement.values[0])
        .sort((left, right) => right.version - left.version)
        .slice(0, 1)
        .map(({ version, status, draft_key }) => ({ version, status, draft_key }));
    }
    throw new Error(`unexpected fake query: ${statement.sql}`);
  }

  private apply(
    statement: FakeStatement,
    versions: FakeVersionRow[],
    evidence: FakeEvidenceRow[],
    audits: FakeAuditRow[],
  ): number {
    if (statement.sql.includes("COALESCE(MAX(version), 0) + 1")) {
      const values = statement.values;
      const current = versions
        .filter((row) => row.thesis_id === values[13])
        .reduce((maximum, row) => Math.max(maximum, row.version), 0);
      if (current > 0 && (values[14] === null || String(values[14]).trim() === "")) return 0;
      return this.insertVersion(versions, {
        id: String(values[0]), thesis_id: String(values[1]), version: current + 1,
        status: "draft", direction: String(values[2]), stage: String(values[3]),
        confidence: Number(values[4]), summary: String(values[5]), invalidation: String(values[6]),
        calculation_json: String(values[7]), based_on_cutoff: String(values[8]),
        created_by: String(values[9]), published_by: null, created_at: String(values[10]),
        published_at: null, change_reason: values[11] as string | null, draft_key: String(values[12]),
      });
    }
    if (statement.sql.includes("SELECT ?, ?, ? + 1, 'draft'")) {
      const values = statement.values;
      const expected = Number(values[2]);
      const current = versions
        .filter((row) => row.thesis_id === values[statement.sql.includes("source.id = ?") ? 15 : 14])
        .sort((left, right) => right.version - left.version)[0];
      if (
        current?.version !== expected
        || current.status !== "draft"
        || (statement.sql.includes("source.id = ?") && current.id !== values[14])
      ) return 0;
      return this.insertVersion(versions, {
        id: String(values[0]), thesis_id: String(values[1]), version: expected + 1,
        status: "draft", direction: String(values[3]), stage: String(values[4]),
        confidence: Number(values[5]), summary: String(values[6]), invalidation: String(values[7]),
        calculation_json: String(values[8]), based_on_cutoff: String(values[9]),
        created_by: String(values[10]), published_by: null, created_at: String(values[11]),
        published_at: null, change_reason: values[12] as string | null, draft_key: String(values[13]),
      });
    }
    if (statement.sql.includes("INSERT INTO evidence")) {
      const values = statement.values;
      const version = versions.find((row) => row.id === values[9] && row.draft_key === values[10]);
      if (version === undefined) return 0;
      evidence.push({
        id: String(values[0]), thesis_version_id: version.id,
        observation_id: values[1] as string | null, source_run_id: values[2] as string | null,
        stance: String(values[3]), layer: String(values[4]), weight: Number(values[5]),
        summary: String(values[6]), citation_url: String(values[7]), sort_order: Number(values[8]),
      });
      return 1;
    }
    if (statement.sql.includes("INSERT INTO audit_log")) {
      const values = statement.values;
      const target = versions.find((row) => (
        row.id === values[11]
        && row.thesis_id === values[12]
        && row.version === values[13]
        && row.status === "draft"
        && row.draft_key === values[14]
      ));
      if (target === undefined) return 0;
      audits.push({
        id: String(values[0]), entity_type: "thesis", entity_id: String(values[1]),
        action: "draft_edited", actor: String(values[2]), reason: String(values[3]),
        before: { version: Number(values[4]), summary: String(values[5]), invalidation: String(values[6]) },
        after: { version: Number(values[7]), summary: String(values[8]), invalidation: String(values[9]) },
        created_at: String(values[10]),
      });
      return 1;
    }
    throw new Error(`unexpected fake write: ${statement.sql}`);
  }

  private insertVersion(versions: FakeVersionRow[], row: FakeVersionRow): number {
    if (
      versions.some((item) => item.id === row.id)
      || versions.some((item) => item.thesis_id === row.thesis_id && item.version === row.version)
      || versions.some((item) => item.draft_key === row.draft_key)
    ) throw new Error("fake unique constraint");
    versions.push(row);
    return 1;
  }
}
