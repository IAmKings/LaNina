import { describe, expect, it } from "vitest";
import { approvedPublicationSeed } from "../../../domain/thesis-draft.test-support";
import { ThesisPublicationModule } from "../../modules/thesis-publications";
import { D1ThesisPublicationRepository } from "./cloudflare-thesis-publications";

describe("D1ThesisPublicationRepository", () => {
  it("publishes the latest expected draft and moves the sole public pointer atomically", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    const module = publicationModule(database);

    const result = await module.publish(command(1));

    expect(result).toMatchObject({
      action: "publish",
      targetVersionId: "version-1",
      expectedVersion: 1,
      previousPublishedVersionId: null,
      currentPublished: { id: "version-1", version: 1, status: "published" },
      audit: {
        actor: "publisher@example.com",
        reason: "研究负责人审核通过 v1",
      },
    });
    expect(database.versions[0]).toMatchObject({
      status: "published",
      published_by: "publisher@example.com",
      published_at: "2026-09-09T01:01:00.000Z",
    });
    expect(database.publication).toMatchObject({
      current_version_id: "version-1",
      previous_version_id: null,
      cache_token: result.cacheToken,
    });
    expect(database.audits).toHaveLength(1);
    expect(await module.findCurrentPublished("TEST-THESIS-01")).toEqual(result.currentPublished);
    expect(database.writeBatchSizes).toEqual([3]);
  });

  it("withdraws without deletion and restores the nearest lower published version", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    const module = publicationModule(database);
    await module.publish(command(1));
    database.addVersion(2, "draft");
    await module.publish(command(2));

    const withdrawn = await module.withdraw(command(2, "撤回有误的 v2"));

    expect(withdrawn).toMatchObject({
      action: "withdraw",
      targetVersionId: "version-2",
      previousPublishedVersionId: "version-2",
      currentPublished: { id: "version-1", version: 1, status: "published" },
      audit: { reason: "撤回有误的 v2" },
    });
    expect(database.versions).toHaveLength(2);
    expect(database.versions.map(({ status }) => status)).toEqual(["published", "withdrawn"]);
    expect(database.publication).toMatchObject({
      current_version_id: "version-1",
      previous_version_id: "version-2",
    });
    expect(database.audits).toHaveLength(3);
    expect(JSON.parse(database.audits[2]!.before_json)).toEqual({ currentVersionId: "version-2" });
    expect(JSON.parse(database.audits[2]!.after_json)).toEqual({
      currentVersionId: "version-1",
      cacheToken: withdrawn.cacheToken,
      transitionId: withdrawn.transitionId,
    });
  });

  it("sets the public pointer to null when no previous published version exists", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    const module = publicationModule(database);
    await module.publish(command(1));

    const result = await module.withdraw(command(1, "撤回唯一公开版本"));

    expect(result.currentPublished).toBeNull();
    expect(database.publication?.current_version_id).toBeNull();
    expect(await module.findCurrentPublished("TEST-THESIS-01")).toBeNull();
    expect(database.versions[0]?.status).toBe("withdrawn");
  });

  it("never restores a version that was withdrawn earlier", async () => {
    const database = new FakePublicationD1();
    const module = publicationModule(database);
    database.addVersion(1, "draft");
    await module.publish(command(1));
    database.addVersion(2, "draft");
    await module.publish(command(2));
    await module.withdraw(command(2, "v2 withdrawn"));
    database.addVersion(3, "draft");
    await module.publish(command(3));

    const result = await module.withdraw(command(3, "v3 withdrawn"));

    expect(result.currentPublished?.version).toBe(1);
    expect(database.versions[1]?.status).toBe("withdrawn");
    expect(database.publication?.current_version_id).toBe("version-1");
  });

  it("never restores a published version owned by another thesis", async () => {
    const database = new FakePublicationD1();
    const module = publicationModule(database);
    database.addVersion(1, "draft");
    await module.publish(command(1));
    database.addVersion(2, "draft");
    await module.publish(command(2));
    database.addVersionFor("OTHER-THESIS-01", 99, "published");

    const result = await module.withdraw(command(2, "撤回并核对跨论点恢复隔离"));

    expect(result.currentPublished?.id).toBe("version-1");
    expect(database.publication?.current_version_id).toBe("version-1");
  });

  it("prevents stale and concurrent publication with stable safe errors", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    database.addVersion(2, "draft");
    const module = publicationModule(database);

    const stale = await module.publish(command(1)).catch((error: unknown) => error);
    expect(stale).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 1, currentVersion: 2 },
    });
    expect(String(stale)).not.toMatch(/SELECT|UPDATE|thesis_versions/);

    await module.publish(command(2));
    await expect(module.publish(command(2))).rejects.toMatchObject({
      code: "NON_DRAFT",
      details: null,
    });
    await expect(module.withdraw(command(1))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 1, currentVersion: 2 },
    });
  });

  it("does not mutate a version when its URL identity disagrees with the thesis and expected version", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");

    await expect(publicationModule(database).publish({
      ...command(1),
      versionId: "other-version-id",
    })).rejects.toMatchObject({ code: "NOT_FOUND", details: null });

    expect(database.versions[0]).toMatchObject({ id: "version-1", status: "draft" });
    expect(database.publication).toBeNull();
    expect(database.audits).toEqual([]);
  });

  it("rolls back all publication effects when the D1 batch rejects", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    database.failWriteBatch = true;

    await expect(publicationModule(database).publish(command(1)))
      .rejects.toMatchObject({ code: "DATABASE" });
    expect(database.versions[0]?.status).toBe("draft");
    expect(database.publication).toBeNull();
    expect(database.audits).toEqual([]);
  });

  it("fails closed on partial or malformed D1 batch metadata and read rows", async () => {
    const partial = new FakePublicationD1();
    partial.addVersion(1, "draft");
    partial.forcePartialChanges = true;
    await expect(publicationModule(partial).publish(command(1)))
      .rejects.toMatchObject({ code: "DATABASE" });

    const malformedMeta = new FakePublicationD1();
    malformedMeta.addVersion(1, "draft");
    malformedMeta.malformedWriteResultIndex = 1;
    await expect(publicationModule(malformedMeta).publish(command(1)))
      .rejects.toMatchObject({ code: "DATABASE" });

    const malformedRead = new FakePublicationD1();
    malformedRead.addVersion(1, "draft");
    const module = publicationModule(malformedRead);
    await module.publish(command(1));
    malformedRead.versions[0]!.confidence = 101;
    await expect(module.findCurrentPublished("TEST-THESIS-01"))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("does not expose a pointer whose target is not published", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    database.publication = {
      thesis_id: "TEST-THESIS-01",
      current_version_id: "version-1",
      previous_version_id: null,
      cache_token: "cache",
      last_transition_id: "transition",
      updated_at: "2026-09-09T01:00:00.000Z",
    };

    await expect(new D1ThesisPublicationRepository(database.asDatabase())
      .findCurrentPublished("TEST-THESIS-01"))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("does not expose a pointer whose target belongs to another thesis", async () => {
    const database = new FakePublicationD1();
    database.addVersionFor("OTHER-THESIS-01", 1, "published");
    database.publication = {
      thesis_id: "TEST-THESIS-01",
      current_version_id: "OTHER-THESIS-01-version-1",
      previous_version_id: null,
      cache_token: "cache",
      last_transition_id: "transition",
      updated_at: "2026-09-09T01:00:00.000Z",
    };

    await expect(new D1ThesisPublicationRepository(database.asDatabase())
      .findCurrentPublished("TEST-THESIS-01"))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("fails closed when persisted audit before/after does not match the pointer transition", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    database.corruptAuditAfterWrite = true;

    await expect(publicationModule(database).publish(command(1)))
      .rejects.toMatchObject({ code: "DATABASE" });
  });

  it("does not expose a published pointer after its thesis is deactivated", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    const module = publicationModule(database);
    await module.publish(command(1));

    database.thesis.active = 0;

    await expect(module.findCurrentPublished("TEST-THESIS-01")).resolves.toBeNull();
  });

  it("binds actor and reason as parameters and selects no wildcard columns", async () => {
    const database = new FakePublicationD1();
    database.addVersion(1, "draft");
    const reason = "内部审核原因，不得拼进 SQL";
    await publicationModule(database).publish(command(1, reason));

    expect(database.sql.some((sql) => sql.includes(reason))).toBe(false);
    expect(database.sql.every((sql) => !sql.includes("SELECT *"))).toBe(true);
    expect(database.binds.flat().includes(reason)).toBe(true);
  });
});

function publicationModule(database: FakePublicationD1): ThesisPublicationModule {
  let id = 0;
  return new ThesisPublicationModule(
    new D1ThesisPublicationRepository(database.asDatabase()),
    () => approvedPublicationSeed(),
    () => `publication-id-${++id}`,
  );
}

function command(version: number, reason = `研究负责人审核通过 v${version}`) {
  return {
    versionId: `version-${version}`,
    thesisId: "TEST-THESIS-01",
    expectedVersion: version,
    actor: "publisher@example.com",
    reason,
    occurredAt: `2026-09-09T01:0${version}:00.000Z`,
  };
}

interface FakeStatement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface FakeThesisRow extends Record<string, unknown> {
  id: string;
  active: 0 | 1;
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
  based_on_cutoff: string;
  published_by: string | null;
  published_at: string | null;
  status_transition_id: string | null;
}

interface FakePublicationRow extends Record<string, unknown> {
  thesis_id: string;
  current_version_id: string | null;
  previous_version_id: string | null;
  cache_token: string;
  last_transition_id: string;
  updated_at: string;
}

interface FakeAuditRow extends Record<string, unknown> {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  reason: string;
  before_json: string;
  after_json: string;
  created_at: string;
}

class FakePublicationD1 {
  readonly thesis: FakeThesisRow = { id: "TEST-THESIS-01", active: 1 };
  versions: FakeVersionRow[] = [];
  publication: FakePublicationRow | null = null;
  audits: FakeAuditRow[] = [];
  readonly sql: string[] = [];
  readonly binds: unknown[][] = [];
  readonly writeBatchSizes: number[] = [];
  failWriteBatch = false;
  forcePartialChanges = false;
  malformedWriteResultIndex: number | null = null;
  corruptAuditAfterWrite = false;

  addVersion(version: number, status: FakeVersionRow["status"]): void {
    this.addVersionFor(this.thesis.id, version, status);
  }

  addVersionFor(
    thesisId: string,
    version: number,
    status: FakeVersionRow["status"],
  ): void {
    this.versions.push({
      id: thesisId === this.thesis.id ? `version-${version}` : `${thesisId}-version-${version}`,
      thesis_id: thesisId,
      version,
      status,
      direction: "bullish",
      stage: "weather_realized",
      confidence: 72,
      summary: `论点版本 ${version}`,
      invalidation: "区域天气恢复并持续改善",
      based_on_cutoff: "2026-09-09T00:00:00.000Z",
      published_by: status === "published" ? "legacy-publisher" : null,
      published_at: status === "published" ? "2026-09-08T01:00:00.000Z" : null,
      status_transition_id: null,
    });
  }

  asDatabase(): D1Database {
    return {
      prepare: (sql: string) => this.statement({ sql, values: [] }),
      batch: async (statements: D1PreparedStatement[]) => {
        const items = statements as unknown as FakeStatement[];
        const isWrite = items.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql.trimStart()));
        if (!isWrite) {
          return items.map((statement) => ({
            success: true,
            results: this.select(statement),
            meta: {},
          }));
        }
        const versions = this.versions.map((row) => ({ ...row }));
        let publication = this.publication === null ? null : { ...this.publication };
        const audits = this.audits.map((row) => ({ ...row }));
        const changes = items.map((statement) => {
          const result = this.apply(statement, versions, publication, audits);
          publication = result.publication;
          return result.changes;
        });
        if (this.failWriteBatch) throw new Error("private D1 write failure");
        if (this.corruptAuditAfterWrite && audits.length > 0) {
          audits[audits.length - 1]!.after_json = JSON.stringify({
            currentVersionId: publication?.current_version_id ?? null,
            cacheToken: "corrupted-cache-token",
          });
        }
        this.versions = versions;
        this.publication = publication;
        this.audits = audits;
        this.writeBatchSizes.push(items.length);
        if (this.forcePartialChanges) changes[1] = 0;
        const results: Array<Record<string, unknown>> = changes.map((count) => ({
          success: true,
          results: [],
          meta: { changes: count },
        }));
        if (this.malformedWriteResultIndex !== null) {
          delete results[this.malformedWriteResultIndex]?.meta;
        }
        return results;
      },
    } as unknown as D1Database;
  }

  private statement(statement: FakeStatement): D1PreparedStatement {
    this.sql.push(statement.sql);
    return {
      ...statement,
      bind: (...values: unknown[]) => {
        this.binds.push(values);
        return this.statement({ sql: statement.sql, values });
      },
      first: async () => this.select(statement)[0] ?? null,
    } as unknown as D1PreparedStatement;
  }

  private apply(
    statement: FakeStatement,
    versions: FakeVersionRow[],
    publication: FakePublicationRow | null,
    audits: FakeAuditRow[],
  ): { readonly changes: number; readonly publication: FakePublicationRow | null } {
    const sql = statement.sql;
    const values = statement.values;
    if (sql.includes("SET status = 'published'")) {
      const target = versions.find((row) =>
        row.thesis_id === values[3] && row.version === values[4] && row.id === values[5]);
      const latest = Math.max(...versions.filter(({ thesis_id }) => thesis_id === values[3])
        .map(({ version }) => version));
      if (target?.status !== "draft" || target.version !== latest || this.thesis.active !== 1) {
        return { changes: 0, publication };
      }
      target.status = "published";
      target.published_by = String(values[0]);
      target.published_at = String(values[1]);
      target.status_transition_id = String(values[2]);
      return { changes: 1, publication };
    }
    if (sql.includes("INSERT INTO thesis_publications")) {
      const target = versions.find((row) =>
        row.thesis_id === values[3]
        && row.version === values[4]
        && row.status === "published"
        && row.status_transition_id === values[5]
        && row.published_by === values[6]
        && row.published_at === values[7]
        && row.id === values[8]);
      if (target === undefined) return { changes: 0, publication };
      const next: FakePublicationRow = publication === null
        ? {
            thesis_id: target.thesis_id,
            current_version_id: target.id,
            previous_version_id: null,
            cache_token: String(values[0]),
            last_transition_id: String(values[1]),
            updated_at: String(values[2]),
          }
        : {
            ...publication,
            previous_version_id: publication.current_version_id,
            current_version_id: target.id,
            cache_token: String(values[0]),
            last_transition_id: String(values[1]),
            updated_at: String(values[2]),
          };
      return { changes: 1, publication: next };
    }
    if (sql.includes("SET status = 'withdrawn'")) {
      const target = versions.find((row) =>
        row.thesis_id === values[1]
        && row.version === values[2]
        && row.id === values[3]
        && row.status === "published"
        && row.id === publication?.current_version_id);
      if (target === undefined) return { changes: 0, publication };
      target.status = "withdrawn";
      target.status_transition_id = String(values[0]);
      return { changes: 1, publication };
    }
    if (sql.includes("UPDATE thesis_publications")) {
      const target = versions.find((row) =>
        row.thesis_id === values[5]
        && row.version === values[6]
        && row.status === "withdrawn"
        && row.status_transition_id === values[7]
        && row.id === values[8]
        && row.id === publication?.current_version_id);
      if (publication === null || target === undefined || publication.thesis_id !== values[4]) {
        return { changes: 0, publication };
      }
      const restored = versions
        .filter((row) => row.thesis_id === publication?.thesis_id
          && row.version < Number(values[0]) && row.status === "published")
        .sort((left, right) => right.version - left.version)[0];
      return {
        changes: 1,
        publication: {
          ...publication,
          previous_version_id: publication.current_version_id,
          current_version_id: restored?.id ?? null,
          cache_token: String(values[1]),
          last_transition_id: String(values[2]),
          updated_at: String(values[3]),
        },
      };
    }
    if (sql.includes("INSERT INTO audit_log")) {
      const target = versions.find((row) =>
        row.thesis_id === values[7]
        && row.version === values[5]
        && row.id === values[6]
        && row.status_transition_id === publication?.last_transition_id);
      if (publication === null || target === undefined || publication.last_transition_id !== values[8]) {
        return { changes: 0, publication };
      }
      audits.push({
        id: String(values[0]),
        entity_type: "thesis",
        entity_id: publication.thesis_id,
        action: String(values[1]),
        actor: String(values[2]),
        reason: String(values[3]),
        before_json: JSON.stringify({ currentVersionId: publication.previous_version_id }),
        after_json: JSON.stringify({
          currentVersionId: publication.current_version_id,
          cacheToken: publication.cache_token,
          transitionId: publication.last_transition_id,
        }),
        created_at: String(values[4]),
      });
      return { changes: 1, publication };
    }
    throw new Error(`unexpected fake write: ${sql}`);
  }

  private select(statement: FakeStatement): Record<string, unknown>[] {
    const sql = statement.sql;
    const values = statement.values;
    const publication = this.publication;
    if (sql.includes("FROM thesis_publications") && sql.includes("last_transition_id = ?")) {
      if (publication === null) return [];
      return publication.thesis_id === values[0] && publication.last_transition_id === values[1]
        ? [{ ...publication }]
        : [];
    }
    if (sql.includes("status_transition_id = ?") && sql.includes("SELECT id, thesis_id")) {
      return this.versions.filter((row) =>
        row.thesis_id === values[0]
        && row.version === values[1]
        && row.id === values[2]
        && row.status_transition_id === values[3])
        .map(({ id, thesis_id, version, status, status_transition_id }) => ({
          id, thesis_id, version, status, status_transition_id,
        }));
    }
    if (sql.includes("SELECT version.id") && sql.includes("version.direction")) {
      const row = this.versions.find((version) =>
        version.id === publication?.current_version_id
        && version.thesis_id === values[0]
        && version.status === "published"
        && this.thesis.active === 1);
      if (row === undefined) return [];
      const {
        id, thesis_id, version, status, direction, stage, confidence, summary,
        invalidation, based_on_cutoff, published_by, published_at,
      } = row;
      return [{
        id, thesis_id, version, status, direction, stage, confidence, summary,
        invalidation, based_on_cutoff, published_by, published_at,
      }];
    }
    if (sql.includes("FROM audit_log")) {
      return this.audits.filter(({ id }) => id === values[0]).map((row) => ({ ...row }));
    }
    if (sql.includes("SELECT version.version")) {
      const row = this.versions.find((version) =>
        version.id === publication?.current_version_id
        && version.status === "published"
        && publication?.thesis_id === values[0]);
      return row === undefined ? [] : [{ version: row.version }];
    }
    if (sql.includes("publication.thesis_id") && sql.includes("publication.current_version_id")) {
      if (publication === null) return [];
      return publication.thesis_id === values[0] && this.thesis.active === 1
        ? [{ thesis_id: publication.thesis_id, current_version_id: publication.current_version_id }]
        : [];
    }
    if (sql.includes("SELECT id, active FROM theses")) {
      return this.thesis.id === values[0] ? [{ ...this.thesis }] : [];
    }
    if (sql.includes("SELECT id, version, status FROM thesis_versions")) {
      return this.versions.filter((row) => row.thesis_id === values[0] && row.version === values[1] && row.id === values[2])
        .map(({ id, version, status }) => ({ id, version, status }));
    }
    if (sql.includes("ORDER BY version DESC")) {
      const row = this.versions.filter(({ thesis_id }) => thesis_id === values[0])
        .sort((left, right) => right.version - left.version)[0];
      return row === undefined ? [] : [{ version: row.version }];
    }
    throw new Error(`unexpected fake query: ${sql}`);
  }
}
