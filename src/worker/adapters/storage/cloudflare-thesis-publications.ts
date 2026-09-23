import { reportStorageFailure } from "./storage-logging";
import { THESIS_DIRECTIONS, THESIS_STAGES } from "../../../domain/contracts";
import type { ThesisDirection, ThesisStage } from "../../../domain/contracts";
import type {
  PublishedThesisVersionReference,
  ThesisPublicationMutation,
  ThesisPublicationTransition,
} from "../../../domain/thesis-publication";
import type { ThesisPublicationRepository } from "../../modules/thesis-publications";
import { ThesisPublicationError } from "../../modules/thesis-publications";

const TRANSITION_STATEMENT_COUNT = 3;

interface VersionState {
  readonly id: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
}

export class D1ThesisPublicationRepository implements ThesisPublicationRepository {
  constructor(private readonly database: D1Database) {}

  async publish(mutation: ThesisPublicationMutation): Promise<ThesisPublicationTransition> {
    assertMutation(mutation, "publish");
    try {
      const results = await this.database.batch([
        this.database.prepare(
          `UPDATE thesis_versions
              SET status = 'published', published_by = ?, published_at = ?, status_transition_id = ?
            WHERE thesis_id = ? AND version = ? AND id = ? AND status = 'draft'
              AND version = (
                SELECT MAX(latest.version)
                  FROM thesis_versions latest
                 WHERE latest.thesis_id = thesis_versions.thesis_id
              )
              AND EXISTS (
                SELECT 1 FROM theses
                 WHERE theses.id = thesis_versions.thesis_id AND theses.active = 1
              )`,
        ).bind(
          mutation.actor,
          mutation.occurredAt,
          mutation.transitionId,
          mutation.thesisId,
          mutation.expectedVersion,
          mutation.versionId,
        ),
        this.database.prepare(
          `INSERT INTO thesis_publications (
             thesis_id, current_version_id, previous_version_id, cache_token,
             last_transition_id, updated_at
           )
           SELECT version.thesis_id, version.id, NULL, ?, ?, ?
             FROM thesis_versions version
            WHERE version.thesis_id = ? AND version.version = ?
              AND version.status = 'published' AND version.status_transition_id = ?
              AND version.published_by = ? AND version.published_at = ? AND version.id = ?
           ON CONFLICT(thesis_id) DO UPDATE SET
             previous_version_id = thesis_publications.current_version_id,
             current_version_id = excluded.current_version_id,
             cache_token = excluded.cache_token,
             last_transition_id = excluded.last_transition_id,
             updated_at = excluded.updated_at`,
        ).bind(
          mutation.cacheToken,
          mutation.transitionId,
          mutation.occurredAt,
          mutation.thesisId,
          mutation.expectedVersion,
          mutation.transitionId,
          mutation.actor,
          mutation.occurredAt,
          mutation.versionId,
        ),
        this.auditStatement(mutation),
      ]);
      const changed = transitionBatchChanges(results);
      if (changed === 0) return await this.throwPublishFailure(mutation);
      return await this.readTransition(mutation);
    } catch (error) {
      if (error instanceof ThesisPublicationError) throw error;
      reportStorageFailure("thesis-publications.publish", error);
      throw databaseError();
    }
  }

  async withdrawAndRestore(
    mutation: ThesisPublicationMutation,
  ): Promise<ThesisPublicationTransition> {
    assertMutation(mutation, "withdraw");
    try {
      const results = await this.database.batch([
        this.database.prepare(
          `UPDATE thesis_versions
              SET status = 'withdrawn', status_transition_id = ?
            WHERE thesis_id = ? AND version = ? AND id = ? AND status = 'published'
              AND id = (
                SELECT current_version_id FROM thesis_publications
                 WHERE thesis_id = thesis_versions.thesis_id
              )`,
        ).bind(
          mutation.transitionId,
          mutation.thesisId,
          mutation.expectedVersion,
          mutation.versionId,
        ),
        this.database.prepare(
          `UPDATE thesis_publications
              SET previous_version_id = current_version_id,
                  current_version_id = (
                    SELECT previous.id
                      FROM thesis_versions previous
                     WHERE previous.thesis_id = thesis_publications.thesis_id
                       AND previous.version < ? AND previous.status = 'published'
                     ORDER BY previous.version DESC
                     LIMIT 1
                  ),
                  cache_token = ?, last_transition_id = ?, updated_at = ?
            WHERE thesis_id = ?
              AND current_version_id = (
                SELECT withdrawn.id
                  FROM thesis_versions withdrawn
                 WHERE withdrawn.thesis_id = ? AND withdrawn.version = ?
                   AND withdrawn.status = 'withdrawn'
                   AND withdrawn.status_transition_id = ? AND withdrawn.id = ?
              )`,
        ).bind(
          mutation.expectedVersion,
          mutation.cacheToken,
          mutation.transitionId,
          mutation.occurredAt,
          mutation.thesisId,
          mutation.thesisId,
          mutation.expectedVersion,
          mutation.transitionId,
          mutation.versionId,
        ),
        this.auditStatement(mutation),
      ]);
      const changed = transitionBatchChanges(results);
      if (changed === 0) return await this.throwWithdrawFailure(mutation);
      return await this.readTransition(mutation);
    } catch (error) {
      if (error instanceof ThesisPublicationError) throw error;
      reportStorageFailure("thesis-publications.withdrawAndRestore", error);
      throw databaseError();
    }
  }

  async findCurrentPublished(thesisId: string): Promise<PublishedThesisVersionReference | null> {
    if (typeof thesisId !== "string" || thesisId.trim().length === 0) {
      throw new ThesisPublicationError("VALIDATION", "论点 ID 不能为空");
    }
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT publication.thesis_id, publication.current_version_id
             FROM thesis_publications publication
             JOIN theses thesis ON thesis.id = publication.thesis_id AND thesis.active = 1
            WHERE publication.thesis_id = ?
            LIMIT 1`,
        ).bind(thesisId),
        this.currentPublishedStatement(thesisId),
      ]);
      if (!Array.isArray(results) || results.length !== 2) throw databaseError();
      const stateRows = queryRows(results[0]);
      const versionRows = queryRows(results[1]);
      if (stateRows.length === 0) {
        if (versionRows.length !== 0) throw databaseError();
        return null;
      }
      if (stateRows.length !== 1 || versionRows.length > 1) throw databaseError();
      const state = exactRecord(stateRows[0], ["thesis_id", "current_version_id"]);
      if (nonEmptyString(state.thesis_id) !== thesisId) throw databaseError();
      const currentId = nullableNonEmptyString(state.current_version_id);
      if (currentId === null) {
        if (versionRows.length !== 0) throw databaseError();
        return null;
      }
      if (versionRows.length !== 1) throw databaseError();
      const version = publishedVersion(versionRows[0]);
      if (version.id !== currentId || version.thesisId !== thesisId) throw databaseError();
      return version;
    } catch (error) {
      if (error instanceof ThesisPublicationError) throw error;
      reportStorageFailure("thesis-publications.findCurrentPublished", error);
      throw databaseError();
    }
  }

  private auditStatement(mutation: ThesisPublicationMutation): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO audit_log (
         id, entity_type, entity_id, action, actor, reason,
         before_json, after_json, created_at
       )
       SELECT ?, 'thesis', publication.thesis_id, ?, ?, ?,
              json_object('currentVersionId', publication.previous_version_id),
              json_object(
                'currentVersionId', publication.current_version_id,
                'cacheToken', publication.cache_token,
                'transitionId', publication.last_transition_id
              ),
              ?
         FROM thesis_publications publication
         JOIN thesis_versions target
           ON target.thesis_id = publication.thesis_id
          AND target.version = ?
          AND target.id = ?
          AND target.status_transition_id = publication.last_transition_id
        WHERE publication.thesis_id = ? AND publication.last_transition_id = ?`,
    ).bind(
      mutation.auditId,
      mutation.action,
      mutation.actor,
      mutation.reason,
      mutation.occurredAt,
      mutation.expectedVersion,
      mutation.versionId,
      mutation.thesisId,
      mutation.transitionId,
    );
  }

  private currentPublishedStatement(thesisId: string): D1PreparedStatement {
    return this.database.prepare(
      `SELECT version.id, version.thesis_id, version.version, version.status,
              version.direction, version.stage, version.confidence, version.summary,
              version.invalidation, version.based_on_cutoff, version.published_by,
              version.published_at
         FROM thesis_publications publication
         JOIN theses thesis ON thesis.id = publication.thesis_id AND thesis.active = 1
         JOIN thesis_versions version
           ON version.id = publication.current_version_id
          AND version.thesis_id = publication.thesis_id
          AND version.status = 'published'
        WHERE publication.thesis_id = ?
        LIMIT 1`,
    ).bind(thesisId);
  }

  private async readTransition(
    mutation: ThesisPublicationMutation,
  ): Promise<ThesisPublicationTransition> {
    const results = await this.database.batch<Record<string, unknown>>([
      this.database.prepare(
        `SELECT thesis_id, current_version_id, previous_version_id, cache_token,
                last_transition_id, updated_at
           FROM thesis_publications
          WHERE thesis_id = ? AND last_transition_id = ?
          LIMIT 1`,
      ).bind(mutation.thesisId, mutation.transitionId),
      this.database.prepare(
        `SELECT id, thesis_id, version, status, status_transition_id
           FROM thesis_versions
          WHERE thesis_id = ? AND version = ? AND id = ? AND status_transition_id = ?
          LIMIT 1`,
      ).bind(mutation.thesisId, mutation.expectedVersion, mutation.versionId, mutation.transitionId),
      this.currentPublishedStatement(mutation.thesisId),
      this.database.prepare(
        `SELECT id, entity_type, entity_id, action, actor, reason,
                before_json, after_json, created_at
           FROM audit_log
          WHERE id = ?
          LIMIT 1`,
      ).bind(mutation.auditId),
    ]);
    if (!Array.isArray(results) || results.length !== 4) throw databaseError();
    const stateRows = queryRows(results[0]);
    const targetRows = queryRows(results[1]);
    const currentRows = queryRows(results[2]);
    const auditRows = queryRows(results[3]);
    if (
      stateRows.length !== 1
      || targetRows.length !== 1
      || currentRows.length > 1
      || auditRows.length !== 1
    ) throw databaseError();

    const state = exactRecord(stateRows[0], [
      "thesis_id", "current_version_id", "previous_version_id", "cache_token",
      "last_transition_id", "updated_at",
    ]);
    const stateThesisId = nonEmptyString(state.thesis_id);
    const currentVersionId = nullableNonEmptyString(state.current_version_id);
    const previousVersionId = nullableNonEmptyString(state.previous_version_id);
    const cacheToken = boundedNonEmptyString(state.cache_token);
    const transitionId = boundedNonEmptyString(state.last_transition_id);
    const updatedAt = canonicalUtc(state.updated_at);
    if (
      stateThesisId !== mutation.thesisId
      || cacheToken !== mutation.cacheToken
      || transitionId !== mutation.transitionId
      || updatedAt !== mutation.occurredAt
      || (currentVersionId !== null && currentVersionId === previousVersionId)
    ) throw databaseError();

    const target = targetVersion(targetRows[0]);
    const expectedStatus = mutation.action === "publish" ? "published" : "withdrawn";
    if (
      target.thesisId !== mutation.thesisId
      || target.id !== mutation.versionId
      || target.version !== mutation.expectedVersion
      || target.status !== expectedStatus
      || target.transitionId !== mutation.transitionId
    ) throw databaseError();
    if (mutation.action === "publish" && currentVersionId !== target.id) throw databaseError();
    if (mutation.action === "withdraw" && previousVersionId !== target.id) throw databaseError();

    let currentPublished: PublishedThesisVersionReference | null = null;
    if (currentVersionId === null) {
      if (currentRows.length !== 0) throw databaseError();
    } else {
      if (currentRows.length !== 1) throw databaseError();
      currentPublished = publishedVersion(currentRows[0]);
      if (currentPublished.id !== currentVersionId || currentPublished.thesisId !== mutation.thesisId) {
        throw databaseError();
      }
      if (mutation.action === "withdraw" && currentPublished.version >= mutation.expectedVersion) {
        throw databaseError();
      }
    }

    const audit = auditRecord(auditRows[0]);
    if (
      audit.id !== mutation.auditId
      || audit.entityId !== mutation.thesisId
      || audit.action !== mutation.action
      || audit.actor !== mutation.actor
      || audit.reason !== mutation.reason
      || audit.createdAt !== mutation.occurredAt
      || audit.beforeCurrentVersionId !== previousVersionId
      || audit.afterCurrentVersionId !== currentVersionId
      || audit.cacheToken !== cacheToken
      || audit.transitionId !== transitionId
    ) throw databaseError();

    return deepFreeze({
      action: mutation.action,
      thesisId: mutation.thesisId,
      targetVersionId: target.id,
      expectedVersion: mutation.expectedVersion,
      previousPublishedVersionId: previousVersionId,
      currentPublished,
      cacheToken,
      transitionId,
      audit: {
        id: audit.id,
        actor: audit.actor,
        reason: audit.reason,
        createdAt: audit.createdAt,
      },
    });
  }

  private async throwPublishFailure(mutation: ThesisPublicationMutation): Promise<never> {
    const state = await this.readFailureState(mutation.thesisId, mutation.expectedVersion, mutation.versionId);
    if (!state.thesisExists || state.target === null) {
      throw new ThesisPublicationError("NOT_FOUND", "未找到待发布论点版本");
    }
    if (!state.thesisActive) {
      throw new ThesisPublicationError("PUBLICATION_DISABLED", "论点已停用，不能发布");
    }
    if (state.latestVersion !== mutation.expectedVersion) {
      throw versionConflict(mutation.expectedVersion, state.latestVersion);
    }
    if (state.target.status !== "draft") {
      throw new ThesisPublicationError("NON_DRAFT", "只有当前最新的 draft 版本可以发布");
    }
    throw databaseError();
  }

  private async throwWithdrawFailure(mutation: ThesisPublicationMutation): Promise<never> {
    const state = await this.readFailureState(mutation.thesisId, mutation.expectedVersion, mutation.versionId);
    if (!state.thesisExists || state.target === null) {
      throw new ThesisPublicationError("NOT_FOUND", "未找到待撤回论点版本");
    }
    if (state.currentPublishedVersion !== mutation.expectedVersion) {
      throw versionConflict(mutation.expectedVersion, state.currentPublishedVersion);
    }
    if (state.target.status !== "published") {
      throw new ThesisPublicationError("NOT_PUBLISHED", "只有当前公开的 published 版本可以撤回");
    }
    throw databaseError();
  }

  private async readFailureState(thesisId: string, expectedVersion: number, versionId: string): Promise<{
    readonly thesisExists: boolean;
    readonly thesisActive: boolean;
    readonly target: VersionState | null;
    readonly latestVersion: number | null;
    readonly currentPublishedVersion: number | null;
  }> {
    const results = await this.database.batch<Record<string, unknown>>([
      this.database.prepare(`SELECT id, active FROM theses WHERE id = ? LIMIT 1`).bind(thesisId),
      this.database.prepare(
        `SELECT id, version, status FROM thesis_versions
          WHERE thesis_id = ? AND version = ? AND id = ? LIMIT 1`,
      ).bind(thesisId, expectedVersion, versionId),
      this.database.prepare(
        `SELECT version FROM thesis_versions
          WHERE thesis_id = ? ORDER BY version DESC LIMIT 1`,
      ).bind(thesisId),
      this.database.prepare(
        `SELECT version.version
           FROM thesis_publications publication
           JOIN thesis_versions version ON version.id = publication.current_version_id
          WHERE publication.thesis_id = ? AND version.status = 'published'
          LIMIT 1`,
      ).bind(thesisId),
    ]);
    if (!Array.isArray(results) || results.length !== 4) throw databaseError();
    const thesisRows = queryRows(results[0]);
    const targetRows = queryRows(results[1]);
    const latestRows = queryRows(results[2]);
    const currentRows = queryRows(results[3]);
    if (
      thesisRows.length > 1
      || targetRows.length > 1
      || latestRows.length > 1
      || currentRows.length > 1
    ) throw databaseError();
    let thesisActive = false;
    if (thesisRows.length === 1) {
      const row = exactRecord(thesisRows[0], ["id", "active"]);
      if (nonEmptyString(row.id) !== thesisId) throw databaseError();
      thesisActive = booleanInteger(row.active);
    }
    const target = targetRows.length === 0 ? null : versionState(targetRows[0]);
    const latestVersion = singleVersion(latestRows);
    const currentPublishedVersion = singleVersion(currentRows);
    return {
      thesisExists: thesisRows.length === 1,
      thesisActive,
      target,
      latestVersion,
      currentPublishedVersion,
    };
  }
}

function publishedVersion(row: Record<string, unknown>): PublishedThesisVersionReference {
  const item = exactRecord(row, [
    "id", "thesis_id", "version", "status", "direction", "stage", "confidence", "summary",
    "invalidation", "based_on_cutoff", "published_by", "published_at",
  ]);
  if (item.status !== "published") throw databaseError();
  const summary = nonEmptyString(item.summary);
  if ([...summary].length > 500) throw databaseError();
  return deepFreeze({
    id: nonEmptyString(item.id),
    thesisId: nonEmptyString(item.thesis_id),
    version: integer(item.version, 1),
    status: "published",
    direction: enumValue(item.direction, THESIS_DIRECTIONS) as ThesisDirection,
    stage: enumValue(item.stage, THESIS_STAGES) as ThesisStage,
    confidence: integer(item.confidence, 0, 100),
    summary,
    invalidation: nonEmptyString(item.invalidation),
    basedOnCutoff: canonicalUtc(item.based_on_cutoff),
    publishedBy: nonEmptyString(item.published_by),
    publishedAt: canonicalUtc(item.published_at),
  });
}

function targetVersion(row: Record<string, unknown>): VersionState & {
  readonly thesisId: string;
  readonly transitionId: string;
} {
  const item = exactRecord(row, ["id", "thesis_id", "version", "status", "status_transition_id"]);
  return {
    id: nonEmptyString(item.id),
    thesisId: nonEmptyString(item.thesis_id),
    version: integer(item.version, 1),
    status: enumValue(item.status, ["draft", "published", "withdrawn"] as const),
    transitionId: boundedNonEmptyString(item.status_transition_id),
  };
}

function versionState(row: Record<string, unknown>): VersionState {
  const item = exactRecord(row, ["id", "version", "status"]);
  return {
    id: nonEmptyString(item.id),
    version: integer(item.version, 1),
    status: enumValue(item.status, ["draft", "published", "withdrawn"] as const),
  };
}

function auditRecord(row: Record<string, unknown>): {
  readonly id: string;
  readonly entityId: string;
  readonly action: "publish" | "withdraw";
  readonly actor: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly beforeCurrentVersionId: string | null;
  readonly afterCurrentVersionId: string | null;
  readonly cacheToken: string;
  readonly transitionId: string;
} {
  const item = exactRecord(row, [
    "id", "entity_type", "entity_id", "action", "actor", "reason",
    "before_json", "after_json", "created_at",
  ]);
  if (item.entity_type !== "thesis") throw databaseError();
  const before = jsonRecord(item.before_json, ["currentVersionId"]);
  const after = jsonRecord(item.after_json, ["currentVersionId", "cacheToken", "transitionId"]);
  return {
    id: nonEmptyString(item.id),
    entityId: nonEmptyString(item.entity_id),
    action: enumValue(item.action, ["publish", "withdraw"] as const),
    actor: nonEmptyString(item.actor),
    reason: nonEmptyString(item.reason),
    createdAt: canonicalUtc(item.created_at),
    beforeCurrentVersionId: nullableNonEmptyString(before.currentVersionId),
    afterCurrentVersionId: nullableNonEmptyString(after.currentVersionId),
    cacheToken: boundedNonEmptyString(after.cacheToken),
    transitionId: boundedNonEmptyString(after.transitionId),
  };
}

function assertMutation(
  mutation: ThesisPublicationMutation,
  action: ThesisPublicationMutation["action"],
): void {
  if (
    typeof mutation !== "object"
    || mutation === null
    || mutation.action !== action
    || !/^[A-Za-z0-9_-]{1,128}$/.test(mutation.versionId)
    || typeof mutation.thesisId !== "string"
    || mutation.thesisId.trim().length === 0
    || !Number.isInteger(mutation.expectedVersion)
    || mutation.expectedVersion < 1
    || typeof mutation.actor !== "string"
    || mutation.actor.trim().length === 0
    || typeof mutation.reason !== "string"
    || mutation.reason.trim().length === 0
  ) throw new ThesisPublicationError("VALIDATION", "发布存储命令无效");
  canonicalUtc(mutation.occurredAt);
  boundedNonEmptyString(mutation.transitionId);
  boundedNonEmptyString(mutation.auditId);
  boundedNonEmptyString(mutation.cacheToken);
}

function transitionBatchChanges(results: unknown): 0 | 1 {
  if (!Array.isArray(results) || results.length !== TRANSITION_STATEMENT_COUNT) throw databaseError();
  const changes = results.map(writeChanges);
  if (changes.every((value) => value === 1)) return 1;
  if (changes.every((value) => value === 0)) return 0;
  throw databaseError();
}

function writeChanges(result: unknown): number {
  const item = recordValue(result);
  if (item.success !== true) throw databaseError();
  const meta = recordValue(item.meta);
  return integer(meta.changes, 0);
}

function queryRows(result: unknown): Record<string, unknown>[] {
  const item = recordValue(result);
  if (item.success !== true || !Array.isArray(item.results)) throw databaseError();
  return item.results.map(recordValue);
}

function jsonRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "string") throw databaseError();
  try {
    return exactRecord(JSON.parse(value) as unknown, keys);
  } catch {
    throw databaseError();
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const item = recordValue(value);
  const expected = new Set(keys);
  if (
    Object.keys(item).some((key) => !expected.has(key))
    || keys.some((key) => !(key in item))
  ) throw databaseError();
  return item;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw databaseError();
  return value as Record<string, unknown>;
}

function singleVersion(rows: readonly Record<string, unknown>[]): number | null {
  if (rows.length === 0) return null;
  const row = exactRecord(rows[0], ["version"]);
  return integer(row.version, 1);
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw databaseError();
  }
  return value as number;
}

function booleanInteger(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw databaseError();
  return value === 1;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw databaseError();
  return value;
}

function boundedNonEmptyString(value: unknown): string {
  const result = nonEmptyString(value);
  if (result.length > 128) throw databaseError();
  return result;
}

function nullableNonEmptyString(value: unknown): string | null {
  if (value === null) return null;
  return nonEmptyString(value);
}

function canonicalUtc(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw databaseError();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw databaseError();
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw databaseError();
  return value as T[number];
}

function versionConflict(expectedVersion: number, currentVersion: number | null): ThesisPublicationError {
  return new ThesisPublicationError(
    "VERSION_CONFLICT",
    `发布版本冲突：期望 ${expectedVersion}，当前 ${currentVersion ?? "无公开版本"}`,
    { expectedVersion, currentVersion },
  );
}

function databaseError(): ThesisPublicationError {
  return new ThesisPublicationError("DATABASE", "D1 无法完成或读取论点发布转换");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
