import { canonicalJson } from "../../../domain/canonical-json";
import { reportStorageFailure } from "./storage-logging";
import { THESIS_DIRECTIONS, THESIS_STAGES } from "../../../domain/contracts";
import type { ThesisDirection, ThesisStage } from "../../../domain/contracts";
import {
  EVIDENCE_LAYERS,
  EVIDENCE_STANCES,
  STAGE_GATE_REASON_CODES,
} from "../../../domain/evaluation";
import {
  computeThesisDraftKey,
  THESIS_DRAFT_CALCULATION_SCHEMA,
  THESIS_DRAFT_KEY_VERSION,
} from "../../../domain/thesis-draft";
import type {
  PersistedThesisDraft,
  ThesisDraftCalculation,
  ThesisDraftEvidenceRecord,
  ThesisDraftSelectedEvidenceReference,
  ThesisDraftStorageRecord,
} from "../../../domain/thesis-draft";
import type { ThesisDraftRepository } from "../../modules/thesis-drafts";
import type { AdministrativeDraftEditCommand } from "../../modules/thesis-drafts";
import { ThesisDraftError } from "../../modules/thesis-drafts";

interface CurrentVersion {
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
  readonly draftKey: string | null;
}

export class D1ThesisDraftRepository implements ThesisDraftRepository {
  constructor(
    private readonly database: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async createAutomatic(record: ThesisDraftStorageRecord): Promise<PersistedThesisDraft> {
    if (!await this.thesisExists(record.thesisId)) {
      throw new ThesisDraftError("NOT_FOUND", "未找到草稿所属论点");
    }
    const existing = await this.findByDraftKey(record.draftKey);
    if (existing !== null) return existing;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const versionId = this.createId();
      try {
        const results = await this.database.batch([
          this.insertAutomaticVersion(versionId, record),
          ...this.insertEvidenceStatements(versionId, record),
        ]);
        const versionChanges = writeBatchChanges(results, record.evidence.length);
        if (versionChanges === 1) {
          const persisted = await this.findByDraftKey(record.draftKey);
          if (persisted !== null) return persisted;
          throw databaseError();
        }
        const raced = await this.findByDraftKey(record.draftKey);
        if (raced !== null) return raced;
        const current = await this.findCurrentVersion(record.thesisId);
        if (current !== null && record.changeReason === null) {
          throw new ThesisDraftError("VALIDATION", "非首版草稿必须填写变更原因");
        }
        throw databaseError();
      } catch (error) {
        if (error instanceof ThesisDraftError) throw error;
        reportStorageFailure("thesis-drafts.createAutomatic", error);
        const raced = await this.findByDraftKey(record.draftKey);
        if (raced !== null) return raced;
        if (attempt === 1) throw databaseError();
      }
    }
    throw databaseError();
  }

  async editExpected(
    expectedVersion: number,
    record: ThesisDraftStorageRecord,
  ): Promise<PersistedThesisDraft> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ThesisDraftError("VALIDATION", "expectedVersion 必须是正整数");
    }
    if (record.changeReason === null || record.changeReason.trim().length === 0) {
      throw new ThesisDraftError("VALIDATION", "非首版草稿必须填写变更原因");
    }
    const versionId = this.createId();
    try {
      const results = await this.database.batch([
        this.insertExpectedVersion(versionId, expectedVersion, record),
        ...this.insertEvidenceStatements(versionId, record),
      ]);
      if (writeBatchChanges(results, record.evidence.length) !== 1) {
        await this.throwEditFailure(record, expectedVersion);
      }
      const persisted = await this.findByDraftKey(record.draftKey);
      if (persisted === null) throw databaseError();
      return persisted;
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.editExpected", error);
      return await this.throwEditFailure(record, expectedVersion);
    }
  }

  /**
   * Administrative edits are copy-on-write. The original calculated draft and
   * evidence references remain immutable; only bounded editorial copy can be
   * carried into the new current draft.
   */
  async editAdministrative(command: AdministrativeDraftEditCommand): Promise<PersistedThesisDraft> {
    const source = await this.findByVersionId(command.versionId);
    if (source === null || source.thesisId !== command.thesisId) {
      throw new ThesisDraftError("NOT_FOUND", "未找到可编辑论点草稿");
    }
    const record = await administrativeRecord(source, command);
    if (record.summary === source.summary && record.invalidation === source.invalidation) {
      throw new ThesisDraftError("VALIDATION", "编辑未产生新的草稿内容");
    }

    const replay = await this.findByDraftKey(record.draftKey);
    if (replay !== null) {
      if (replay.thesisId !== command.thesisId) throw databaseError();
      return replay;
    }

    const versionId = this.createId();
    const auditId = this.createId();
    try {
      const results = await this.database.batch([
        this.insertAdministrativeVersion(versionId, command, record),
        ...this.insertEvidenceStatements(versionId, record),
        this.insertAdministrativeAudit(auditId, versionId, source, command, record),
      ]);
      if (writeAdministrativeEditChanges(results, record.evidence.length) !== 1) {
        await this.throwEditFailure(record, command.expectedVersion);
      }
      const persisted = await this.findByDraftKey(record.draftKey);
      if (persisted === null) throw databaseError();
      return persisted;
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.editAdministrative", error);
      const replayed = await this.findByDraftKey(record.draftKey);
      if (replayed !== null && replayed.thesisId === command.thesisId) return replayed;
      return await this.throwEditFailure(record, command.expectedVersion);
    }
  }

  private insertAutomaticVersion(
    versionId: string,
    record: ThesisDraftStorageRecord,
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO thesis_versions (
         id, thesis_id, version, status, direction, stage, confidence, summary,
         invalidation, calculation_json, based_on_cutoff, created_by, published_by,
         created_at, published_at, change_reason, draft_key
       )
       SELECT ?, ?, COALESCE(MAX(version), 0) + 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?,
              NULL, ?, NULL, ?, ?
         FROM thesis_versions
        WHERE thesis_id = ?
       HAVING COALESCE(MAX(version), 0) = 0 OR length(trim(?)) > 0`,
    ).bind(
      versionId,
      record.thesisId,
      record.direction,
      record.stage,
      record.confidence,
      record.summary,
      record.invalidation,
      canonicalJson(record.calculation),
      record.basedOnCutoff,
      record.createdBy,
      record.createdAt,
      record.changeReason,
      record.draftKey,
      record.thesisId,
      record.changeReason,
    );
  }

  private insertExpectedVersion(
    versionId: string,
    expectedVersion: number,
    record: ThesisDraftStorageRecord,
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO thesis_versions (
         id, thesis_id, version, status, direction, stage, confidence, summary,
         invalidation, calculation_json, based_on_cutoff, created_by, published_by,
         created_at, published_at, change_reason, draft_key
       )
       SELECT ?, ?, ? + 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM thesis_versions source
           WHERE source.thesis_id = ? AND source.version = ? AND source.status = 'draft'
             AND source.version = (
               SELECT MAX(latest.version) FROM thesis_versions latest
                WHERE latest.thesis_id = source.thesis_id
             )
        )`,
    ).bind(
      versionId,
      record.thesisId,
      expectedVersion,
      record.direction,
      record.stage,
      record.confidence,
      record.summary,
      record.invalidation,
      canonicalJson(record.calculation),
      record.basedOnCutoff,
      record.createdBy,
      record.createdAt,
      record.changeReason,
      record.draftKey,
      record.thesisId,
      expectedVersion,
    );
  }

  private insertAdministrativeVersion(
    versionId: string,
    command: AdministrativeDraftEditCommand,
    record: ThesisDraftStorageRecord,
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO thesis_versions (
         id, thesis_id, version, status, direction, stage, confidence, summary,
         invalidation, calculation_json, based_on_cutoff, created_by, published_by,
         created_at, published_at, change_reason, draft_key
       )
       SELECT ?, ?, ? + 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM thesis_versions source
           WHERE source.id = ? AND source.thesis_id = ? AND source.version = ?
             AND source.status = 'draft'
             AND source.version = (
               SELECT MAX(latest.version) FROM thesis_versions latest
                WHERE latest.thesis_id = source.thesis_id
             )
        )`,
    ).bind(
      versionId,
      record.thesisId,
      command.expectedVersion,
      record.direction,
      record.stage,
      record.confidence,
      record.summary,
      record.invalidation,
      canonicalJson(record.calculation),
      record.basedOnCutoff,
      record.createdBy,
      record.createdAt,
      record.changeReason,
      record.draftKey,
      command.versionId,
      record.thesisId,
      command.expectedVersion,
    );
  }

  private insertAdministrativeAudit(
    auditId: string,
    versionId: string,
    source: PersistedThesisDraft,
    command: AdministrativeDraftEditCommand,
    record: ThesisDraftStorageRecord,
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO audit_log (
         id, entity_type, entity_id, action, actor, reason, before_json, after_json, created_at
       ) SELECT ?, 'thesis', ?, 'draft_edited', ?, ?,
                json_object('version', ?, 'summary', ?, 'invalidation', ?),
                json_object('version', ?, 'summary', ?, 'invalidation', ?), ?
           WHERE EXISTS (
             SELECT 1 FROM thesis_versions
              WHERE id = ? AND thesis_id = ? AND version = ? AND status = 'draft' AND draft_key = ?
           )`,
    ).bind(
      auditId,
      record.thesisId,
      command.actor,
      command.reason,
      source.version,
      source.summary,
      source.invalidation,
      source.version + 1,
      record.summary,
      record.invalidation,
      command.occurredAt,
      versionId,
      record.thesisId,
      source.version + 1,
      record.draftKey,
    );
  }

  private insertEvidenceStatements(
    versionId: string,
    record: ThesisDraftStorageRecord,
  ): D1PreparedStatement[] {
    return record.evidence.map((item) => this.database.prepare(
      `INSERT INTO evidence (
         id, thesis_version_id, observation_id, source_run_id, stance, layer,
         weight, summary, citation_url, sort_order
       )
       SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ?
         FROM thesis_versions
        WHERE id = ? AND draft_key = ?`,
    ).bind(
      this.createId(),
      item.observationId,
      item.sourceRunId,
      item.stance,
      item.layer,
      item.weight,
      item.summary,
      item.citationUrl,
      item.sortOrder,
      versionId,
      record.draftKey,
    ));
  }

  private async findByDraftKey(draftKey: string): Promise<PersistedThesisDraft | null> {
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT id, thesis_id, version, status, direction, stage, confidence, summary,
                  invalidation, calculation_json, based_on_cutoff, created_by, published_by,
                  created_at, published_at, change_reason, draft_key
             FROM thesis_versions
            WHERE draft_key = ?
            LIMIT 1`,
        ).bind(draftKey),
        this.database.prepare(
          `SELECT e.id, e.thesis_version_id, e.observation_id, e.source_run_id,
                  e.stance, e.layer, e.weight, e.summary, e.citation_url, e.sort_order
             FROM evidence e
             JOIN thesis_versions v ON v.id = e.thesis_version_id
            WHERE v.draft_key = ?
            ORDER BY e.sort_order, e.id`,
        ).bind(draftKey),
      ]);
      if (!Array.isArray(results) || results.length !== 2) throw databaseError();
      const versionRows = queryRows(results[0]);
      const evidenceRows = queryRows(results[1]);
      const versionRow = versionRows[0];
      if (versionRow === undefined) return null;
      if (versionRows.length !== 1) throw databaseError();
      if (thesisStatus(versionRow.status) !== "draft") {
        throw new ThesisDraftError("NON_DRAFT", "相同语义的论点版本已不再是草稿");
      }
      return await decodePersistedDraft(versionRow, evidenceRows);
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.findByDraftKey", error);
      throw databaseError();
    }
  }

  private async findByVersionId(versionId: string): Promise<PersistedThesisDraft | null> {
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT id, thesis_id, version, status, direction, stage, confidence, summary,
                  invalidation, calculation_json, based_on_cutoff, created_by, published_by,
                  created_at, published_at, change_reason, draft_key
             FROM thesis_versions
            WHERE id = ?
            LIMIT 1`,
        ).bind(versionId),
        this.database.prepare(
          `SELECT e.id, e.thesis_version_id, e.observation_id, e.source_run_id,
                  e.stance, e.layer, e.weight, e.summary, e.citation_url, e.sort_order
             FROM evidence e
             JOIN thesis_versions v ON v.id = e.thesis_version_id
            WHERE v.id = ?
            ORDER BY e.sort_order, e.id`,
        ).bind(versionId),
      ]);
      if (!Array.isArray(results) || results.length !== 2) throw databaseError();
      const versionRows = queryRows(results[0]);
      const evidenceRows = queryRows(results[1]);
      const versionRow = versionRows[0];
      if (versionRow === undefined) return null;
      if (versionRows.length !== 1) throw databaseError();
      if (thesisStatus(versionRow.status) !== "draft") {
        throw new ThesisDraftError("NON_DRAFT", "只有当前 draft 版本可以编辑");
      }
      return await decodePersistedDraft(versionRow, evidenceRows);
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.findByVersionId", error);
      throw databaseError();
    }
  }

  private async findCurrentVersion(thesisId: string): Promise<CurrentVersion | null> {
    try {
      const row = await this.database.prepare(
        `SELECT version, status, draft_key
           FROM thesis_versions
          WHERE thesis_id = ?
          ORDER BY version DESC
          LIMIT 1`,
      ).bind(thesisId).first<Record<string, unknown>>();
      if (row === null) return null;
      const item = exactRecord(row, ["version", "status", "draft_key"]);
      return {
        version: integer(item.version, "version", 1),
        status: thesisStatus(item.status),
        draftKey: nullableDraftKey(item.draft_key),
      };
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.findCurrentVersion", error);
      throw databaseError();
    }
  }

  private async thesisExists(thesisId: string): Promise<boolean> {
    try {
      const row = await this.database.prepare(
        `SELECT id FROM theses WHERE id = ? LIMIT 1`,
      ).bind(thesisId).first<Record<string, unknown>>();
      if (row === null) return false;
      const item = exactRecord(row, ["id"]);
      return nonEmptyString(item.id, "theses.id") === thesisId;
    } catch (error) {
      if (error instanceof ThesisDraftError) throw error;
      reportStorageFailure("thesis-drafts.thesisExists", error);
      throw databaseError();
    }
  }

  private async throwEditFailure(record: ThesisDraftStorageRecord, expectedVersion: number): Promise<never> {
    const current = await this.findCurrentVersion(record.thesisId);
    if (current === null) throw new ThesisDraftError("NOT_FOUND", "未找到待编辑论点版本");
    if (current.version !== expectedVersion) {
      throw new ThesisDraftError(
        "VERSION_CONFLICT",
        `草稿版本冲突：期望 ${expectedVersion}，当前 ${current.version}`,
        { expectedVersion, currentVersion: current.version },
      );
    }
    if (current.status !== "draft") {
      throw new ThesisDraftError("NON_DRAFT", "只有当前最新的 draft 版本可以编辑");
    }
    if (current.draftKey === record.draftKey) {
      throw new ThesisDraftError("VALIDATION", "编辑未产生新的草稿语义");
    }
    throw databaseError();
  }
}

async function decodePersistedDraft(
  row: Record<string, unknown>,
  evidenceRows: readonly Record<string, unknown>[],
): Promise<PersistedThesisDraft> {
  const item = exactRecord(row, [
    "id", "thesis_id", "version", "status", "direction", "stage", "confidence", "summary",
    "invalidation", "calculation_json", "based_on_cutoff", "created_by", "published_by",
    "created_at", "published_at", "change_reason", "draft_key",
  ]);
  const id = nonEmptyString(item.id, "id");
  const thesisId = nonEmptyString(item.thesis_id, "thesis_id");
  const version = integer(item.version, "version", 1);
  if (thesisStatus(item.status) !== "draft") throw databaseError();
  const direction = enumValue(item.direction, THESIS_DIRECTIONS, "direction");
  const stage = enumValue(item.stage, THESIS_STAGES, "stage");
  const confidence = integer(item.confidence, "confidence", 0, 100);
  const summary = nonEmptyString(item.summary, "summary");
  if ([...summary].length > 500) throw databaseError();
  const invalidation = nonEmptyString(item.invalidation, "invalidation");
  const basedOnCutoff = canonicalUtc(item.based_on_cutoff, "based_on_cutoff");
  const createdBy = nonEmptyString(item.created_by, "created_by");
  const createdAt = canonicalUtc(item.created_at, "created_at");
  if (item.published_by !== null || item.published_at !== null) throw databaseError();
  const changeReason = nullableNonEmptyString(item.change_reason, "change_reason");
  if (changeReason !== null && changeReason.trim().length === 0) throw databaseError();
  if (version > 1 && changeReason === null) throw databaseError();
  const draftKey = draftKeyValue(item.draft_key);
  const calculation = calculationValue(
    item.calculation_json,
    { thesisId, direction, stage, confidence, basedOnCutoff },
  );
  const evidence = evidenceRows.map((item) => evidenceValue(item, id));
  evidence.forEach((item, index) => {
    if (item.sortOrder !== index) throw databaseError();
  });
  if (
    evidence.length === 0
    || evidence.length !== calculation.selection.selectedEvidence.length
  ) throw databaseError();
  for (let index = 0; index < evidence.length; index += 1) {
    assertEvidenceMatchesReference(evidence[index]!, calculation.selection.selectedEvidence[index]!);
  }
  const result = {
    id,
    thesisId,
    version,
    status: "draft",
    direction,
    stage,
    confidence,
    summary,
    invalidation,
    calculation,
    basedOnCutoff,
    createdBy,
    createdAt,
    publishedBy: null,
    publishedAt: null,
    changeReason,
    draftKey,
    evidence,
  } satisfies PersistedThesisDraft;
  if (await computeThesisDraftKey(result) !== draftKey) throw databaseError();
  return deepFreeze(result);
}

async function administrativeRecord(
  source: PersistedThesisDraft,
  command: AdministrativeDraftEditCommand,
): Promise<ThesisDraftStorageRecord> {
  const summary = command.summary ?? source.summary;
  const invalidation = command.invalidation ?? source.invalidation;
  const recordWithoutKey = {
    thesisId: source.thesisId,
    status: "draft" as const,
    direction: source.direction,
    stage: source.stage,
    confidence: source.confidence,
    summary,
    invalidation,
    calculation: source.calculation,
    basedOnCutoff: source.basedOnCutoff,
    createdBy: command.actor,
    createdAt: command.occurredAt,
    publishedBy: null,
    publishedAt: null,
    changeReason: command.reason,
    evidence: source.evidence,
  } satisfies Omit<ThesisDraftStorageRecord, "draftKey">;
  return {
    ...recordWithoutKey,
    draftKey: await computeThesisDraftKey(recordWithoutKey),
  };
}

function evidenceValue(row: Record<string, unknown>, versionId: string): ThesisDraftEvidenceRecord {
  const item = exactRecord(row, [
    "id", "thesis_version_id", "observation_id", "source_run_id", "stance", "layer", "weight",
    "summary", "citation_url", "sort_order",
  ]);
  nonEmptyString(item.id, "evidence.id");
  if (item.thesis_version_id !== versionId) throw databaseError();
  const observationId = nullableNonEmptyString(item.observation_id, "evidence.observation_id");
  const sourceRunId = nullableNonEmptyString(item.source_run_id, "evidence.source_run_id");
  if (observationId === null && sourceRunId === null) throw databaseError();
  return {
    observationId,
    sourceRunId,
    stance: enumValue(item.stance, EVIDENCE_STANCES, "evidence.stance"),
    layer: enumValue(item.layer, EVIDENCE_LAYERS, "evidence.layer"),
    weight: integer(item.weight, "evidence.weight", 0, 100),
    summary: nonEmptyString(item.summary, "evidence.summary"),
    citationUrl: nonEmptyString(item.citation_url, "evidence.citation_url"),
    sortOrder: integer(item.sort_order, "evidence.sort_order", 0),
  };
}

function calculationValue(
  value: unknown,
  outer: {
    readonly thesisId: string;
    readonly direction: ThesisDirection;
    readonly stage: ThesisStage;
    readonly confidence: number;
    readonly basedOnCutoff: string;
  },
): ThesisDraftCalculation {
  if (typeof value !== "string") throw databaseError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
    canonicalJson(parsed);
  } catch {
    throw databaseError();
  }
  const item = exactRecord(parsed, [
    "schemaVersion", "thesisId", "methodologyVersion", "regionDefinitionVersion", "target",
    "marketScope", "timeHorizon", "cutoff", "previousStage", "selection", "stage",
    "direction", "confidence",
  ]);
  if (
    item.schemaVersion !== THESIS_DRAFT_CALCULATION_SCHEMA
    || item.thesisId !== outer.thesisId
    || canonicalUtc(item.cutoff, "calculation.cutoff") !== outer.basedOnCutoff
  ) throw databaseError();
  const methodologyVersion = nonEmptyString(item.methodologyVersion, "calculation.methodologyVersion");
  const regionDefinitionVersion = nonEmptyString(item.regionDefinitionVersion, "calculation.regionDefinitionVersion");
  const target = nonEmptyString(item.target, "calculation.target");
  const marketScope = nonEmptyString(item.marketScope, "calculation.marketScope");
  const timeHorizon = nonEmptyString(item.timeHorizon, "calculation.timeHorizon");
  const previousStage = enumValue(item.previousStage, THESIS_STAGES, "calculation.previousStage");
  const stage = validateCalculationStage(item.stage);
  const direction = validateCalculationDirection(item.direction);
  const confidence = validateCalculationConfidence(item.confidence);
  if (
    stage.thesisId !== outer.thesisId
    || stage.cutoff !== outer.basedOnCutoff
    || stage.previousStage !== previousStage
    || stage.stage !== outer.stage
    || stage.transition === "invalid"
    || stage.transition === "manual_forward_skip"
    || stage.manualConfirmationApplied !== false
    || direction.thesisId !== outer.thesisId
    || direction.methodologyVersion !== methodologyVersion
    || direction.regionDefinitionVersion !== regionDefinitionVersion
    || direction.target !== target
    || direction.marketScope !== marketScope
    || direction.timeHorizon !== timeHorizon
    || direction.direction !== outer.direction
    || direction.status !== "available"
    || confidence.status !== "available"
    || confidence.finalScore !== outer.confidence
  ) throw databaseError();
  const selection = exactRecord(item.selection, ["selectedEvidence", "rejectedEvidence", "coverageGapIds"]);
  if (!Array.isArray(selection.selectedEvidence) || selection.selectedEvidence.length === 0) {
    throw databaseError();
  }
  const selectedEvidence = selection.selectedEvidence.map((reference, index) => (
    selectedEvidenceReference(reference, index)
  ));
  const selectedEvidenceIds = selectedEvidence.map(({ evidenceId }) => evidenceId);
  uniqueStrings(selectedEvidenceIds);
  const coverageGapIds = stringArray(selection.coverageGapIds, true);
  uniqueStrings(coverageGapIds);
  if (!Array.isArray(selection.rejectedEvidence)) throw databaseError();
  for (const rejectionValue of selection.rejectedEvidence) {
    const rejection = exactRecord(rejectionValue, ["evidenceId", "selectorId", "indicatorId", "code", "reason"]);
    nullableNonEmptyString(rejection.evidenceId, "calculation.selection.rejectedEvidence.evidenceId");
    nullableNonEmptyString(rejection.selectorId, "calculation.selection.rejectedEvidence.selectorId");
    nonEmptyString(rejection.indicatorId, "calculation.selection.rejectedEvidence.indicatorId");
    enumValue(rejection.code, [
      "AFTER_CUTOFF", "INVALID_TIMESTAMP", "INVALID_REVISION", "INVALID_QUALITY",
      "AMBIGUOUS_REVISION", "SUPERSEDED_REVISION", "STALE_FOR_RULE", "SELECTOR_MISMATCH",
      "PENDING_SELECTOR", "MISSING_EVIDENCE", "MISSING_CITATION",
    ] as const, "calculation.selection.rejectedEvidence.code");
    nonEmptyString(rejection.reason, "calculation.selection.rejectedEvidence.reason");
  }
  assertCalculationEvidenceReferences(stage, direction, confidence, new Set(selectedEvidenceIds));
  return parsed as ThesisDraftCalculation;
}

function selectedEvidenceReference(
  value: unknown,
  expectedSortOrder: number,
): ThesisDraftSelectedEvidenceReference {
  const item = exactRecord(value, [
    "evidenceId", "selectorId", "observationId", "sourceRunId", "indicatorId", "sourceId",
    "observedAt", "revision", "stance", "layer", "weight", "summary", "citationUrl", "sortOrder",
  ]);
  const observationId = nullableNonEmptyString(item.observationId, "calculation.selection.observationId");
  const sourceRunId = nullableNonEmptyString(item.sourceRunId, "calculation.selection.sourceRunId");
  if (observationId === null && sourceRunId === null) throw databaseError();
  const sortOrder = integer(item.sortOrder, "calculation.selection.sortOrder", 0);
  if (sortOrder !== expectedSortOrder) throw databaseError();
  return {
    evidenceId: nonEmptyString(item.evidenceId, "calculation.selection.evidenceId"),
    selectorId: nonEmptyString(item.selectorId, "calculation.selection.selectorId"),
    observationId,
    sourceRunId,
    indicatorId: nonEmptyString(item.indicatorId, "calculation.selection.indicatorId"),
    sourceId: nonEmptyString(item.sourceId, "calculation.selection.sourceId"),
    observedAt: canonicalUtc(item.observedAt, "calculation.selection.observedAt"),
    revision: integer(item.revision, "calculation.selection.revision", 0),
    stance: enumValue(item.stance, EVIDENCE_STANCES, "calculation.selection.stance"),
    layer: enumValue(item.layer, EVIDENCE_LAYERS, "calculation.selection.layer"),
    weight: integer(item.weight, "calculation.selection.weight", 0, 100),
    summary: nonEmptyString(item.summary, "calculation.selection.summary"),
    citationUrl: nonEmptyString(item.citationUrl, "calculation.selection.citationUrl"),
    sortOrder,
  };
}

function assertEvidenceMatchesReference(
  evidence: ThesisDraftEvidenceRecord,
  reference: ThesisDraftSelectedEvidenceReference,
): void {
  if (canonicalJson(evidence) !== canonicalJson({
    observationId: reference.observationId,
    sourceRunId: reference.sourceRunId,
    stance: reference.stance,
    layer: reference.layer,
    weight: reference.weight,
    summary: reference.summary,
    citationUrl: reference.citationUrl,
    sortOrder: reference.sortOrder,
  })) throw databaseError();
}

function assertCalculationEvidenceReferences(
  stage: Record<string, unknown>,
  direction: Record<string, unknown>,
  confidence: Record<string, unknown>,
  selectedIds: ReadonlySet<string>,
): void {
  for (const check of stage.checks as Record<string, unknown>[]) {
    assertSubset(check.matchedEvidenceIds as string[], selectedIds);
  }
  for (const hit of direction.ruleHits as Record<string, unknown>[]) {
    assertSubset(hit.evidenceIds as string[], selectedIds);
  }
  const explanations = confidence.explanations as Record<string, Record<string, unknown>>;
  const freshness = explanations.freshness!;
  const sourceQuality = explanations.sourceQuality!;
  const agreement = explanations.agreement!;
  assertSubset(freshness.currentEvidenceIds as string[], selectedIds);
  assertSubset(sourceQuality.currentEvidenceIds as string[], selectedIds);
  assertSubset(agreement.supportEvidenceIds as string[], selectedIds);
  assertSubset(agreement.refuteEvidenceIds as string[], selectedIds);
  assertSubset(agreement.ignoredContextEvidenceIds as string[], selectedIds);
}

function assertSubset(values: readonly string[], selectedIds: ReadonlySet<string>): void {
  if (values.some((value) => !selectedIds.has(value))) throw databaseError();
}

function validateCalculationStage(value: unknown): Record<string, unknown> {
  const item = exactRecord(value, [
    "thesisId", "cutoff", "previousStage", "highestEligibleStage", "stage", "transition",
    "manualConfirmationApplied", "checks", "reasons",
  ]);
  enumValue(item.previousStage, THESIS_STAGES, "calculation.stage.previousStage");
  enumValue(item.highestEligibleStage, THESIS_STAGES, "calculation.stage.highestEligibleStage");
  enumValue(item.stage, THESIS_STAGES, "calculation.stage.stage");
  enumValue(item.transition, ["unchanged", "promoted", "manual_forward_skip", "downgraded", "blocked", "invalid"] as const, "calculation.stage.transition");
  booleanValue(item.manualConfirmationApplied);
  if (!Array.isArray(item.checks) || !Array.isArray(item.reasons)) throw databaseError();
  for (const checkValue of item.checks) {
    const check = exactRecord(checkValue, [
      "targetStage", "status", "requiredLayers", "presentLayers", "missingLayers", "staleLayers",
      "blockingCoverageGapIds", "matchedRuleIds", "matchedEvidenceIds", "rejectedRuleIds", "reasons",
    ]);
    enumValue(check.targetStage, THESIS_STAGES.filter((stage) => stage !== "watch"), "calculation.stage.check.targetStage");
    enumValue(check.status, ["passed", "blocked", "pending"] as const, "calculation.stage.check.status");
    for (const field of ["requiredLayers", "presentLayers", "missingLayers", "staleLayers"] as const) {
      const layers = stringArray(check[field], true);
      for (const layer of layers) enumValue(layer, EVIDENCE_LAYERS, `calculation.stage.check.${field}`);
    }
    for (const field of ["blockingCoverageGapIds", "matchedRuleIds", "matchedEvidenceIds", "rejectedRuleIds"] as const) {
      stringArray(check[field], true);
    }
    if (!Array.isArray(check.reasons)) throw databaseError();
    for (const reason of check.reasons) validateStageReason(reason);
  }
  for (const reason of item.reasons) validateStageReason(reason);
  return item;
}

function validateStageReason(value: unknown): void {
  const item = exactRecord(value, ["code", "targetStage", "layer", "ruleId", "coverageGapId", "reason"]);
  enumValue(item.code, STAGE_GATE_REASON_CODES, "calculation.stage.reason.code");
  if (item.targetStage !== null) enumValue(item.targetStage, THESIS_STAGES, "calculation.stage.reason.targetStage");
  if (item.layer !== null) enumValue(item.layer, EVIDENCE_LAYERS, "calculation.stage.reason.layer");
  nullableString(item.ruleId, "calculation.stage.reason.ruleId");
  nullableString(item.coverageGapId, "calculation.stage.reason.coverageGapId");
  nonEmptyString(item.reason, "calculation.stage.reason.reason");
}

function validateCalculationDirection(value: unknown): Record<string, unknown> {
  const item = exactRecord(value, [
    "status", "policyVersion", "thesisId", "methodologyVersion", "regionDefinitionVersion",
    "target", "marketScope", "timeHorizon", "direction", "matchedDirections", "ruleHits",
    "ruleRejections", "reasons",
  ]);
  enumValue(item.status, ["available", "unavailable"] as const, "calculation.direction.status");
  for (const field of ["policyVersion", "thesisId", "methodologyVersion", "regionDefinitionVersion", "target", "marketScope", "timeHorizon"] as const) {
    nonEmptyString(item[field], `calculation.direction.${field}`);
  }
  enumValue(item.direction, THESIS_DIRECTIONS, "calculation.direction.direction");
  for (const direction of stringArray(item.matchedDirections, true)) {
    enumValue(direction, THESIS_DIRECTIONS, "calculation.direction.matchedDirections");
  }
  if (!Array.isArray(item.ruleHits) || !Array.isArray(item.ruleRejections)) throw databaseError();
  for (const value of item.ruleHits) {
    const hit = exactRecord(value, ["ruleId", "evidenceIds", "reason"]);
    nonEmptyString(hit.ruleId, "calculation.direction.ruleHit.ruleId");
    stringArray(hit.evidenceIds, false);
    nonEmptyString(hit.reason, "calculation.direction.ruleHit.reason");
  }
  for (const value of item.ruleRejections) {
    const rejection = exactRecord(value, ["ruleId", "code", "reason"]);
    nonEmptyString(rejection.ruleId, "calculation.direction.ruleRejection.ruleId");
    enumValue(rejection.code, ["INACTIVE", "NOT_MATCHED", "MISSING_EVIDENCE", "PENDING_REVIEW", "UNRESOLVED_DIRECTION", "CONTEXT_ONLY"] as const, "calculation.direction.ruleRejection.code");
    nonEmptyString(rejection.reason, "calculation.direction.ruleRejection.reason");
  }
  stringArray(item.reasons, true);
  return item;
}

function validateCalculationConfidence(value: unknown): Record<string, unknown> {
  const item = exactRecord(value, [
    "status", "policyVersion", "components", "weightedScore", "appliedCaps", "finalScore",
    "roundingRule", "explanations", "reasons",
  ]);
  enumValue(item.status, ["available", "unavailable"] as const, "calculation.confidence.status");
  nonEmptyString(item.policyVersion, "calculation.confidence.policyVersion");
  const components = exactRecord(item.components, ["coverage", "freshness", "sourceQuality", "agreement"]);
  for (const score of Object.values(components)) integer(score, "calculation.confidence.component", 0, 100);
  integer(item.weightedScore, "calculation.confidence.weightedScore", 0, 100);
  integer(item.finalScore, "calculation.confidence.finalScore", 0, 100);
  if (item.roundingRule !== "round_half_up_after_weighted_sum") throw databaseError();
  if (!Array.isArray(item.appliedCaps)) throw databaseError();
  for (const capValue of item.appliedCaps) {
    const cap = exactRecord(capValue, ["code", "maximum", "reason"]);
    enumValue(cap.code, ["MISSING_REQUIRED_LAYER", "REQUIRED_LAYER_STALE", "FORECAST_ONLY", "PRICE_ONLY", "UNEXPLAINED_CONFLICT", "COVERAGE_GAP"] as const, "calculation.confidence.cap.code");
    integer(cap.maximum, "calculation.confidence.cap.maximum", 0, 100);
    nonEmptyString(cap.reason, "calculation.confidence.cap.reason");
  }
  const explanations = exactRecord(item.explanations, ["coverage", "freshness", "sourceQuality", "agreement"]);
  validateCoverageExplanation(explanations.coverage);
  validateFreshnessExplanation(explanations.freshness);
  validateSourceQualityExplanation(explanations.sourceQuality);
  validateAgreementExplanation(explanations.agreement);
  stringArray(item.reasons, true);
  return item;
}

function validateCoverageExplanation(value: unknown): void {
  const item = exactRecord(value, ["requiredLayers", "presentLayers", "missingLayers", "staleLayers"]);
  for (const field of ["requiredLayers", "presentLayers", "missingLayers", "staleLayers"] as const) {
    for (const layer of stringArray(item[field], true)) {
      enumValue(layer, EVIDENCE_LAYERS, `calculation.confidence.coverage.${field}`);
    }
  }
}

function validateFreshnessExplanation(value: unknown): void {
  const item = exactRecord(value, [
    "currentEvidenceIds", "freshSelectorIds", "lateSelectorIds", "staleSelectorIds", "missingSelectorIds",
  ]);
  for (const field of Object.keys(item)) stringArray(item[field], true);
}

function validateSourceQualityExplanation(value: unknown): void {
  const item = exactRecord(value, ["currentEvidenceIds", "tierScores"]);
  stringArray(item.currentEvidenceIds, true);
  const scores = exactRecord(item.tierScores, ["A", "B", "C"]);
  for (const score of Object.values(scores)) {
    if (score !== null) integer(score, "calculation.confidence.sourceQuality.tierScore", 0, 100);
  }
}

function validateAgreementExplanation(value: unknown): void {
  const item = exactRecord(value, [
    "supportEvidenceIds", "refuteEvidenceIds", "ignoredContextEvidenceIds", "supportWeight", "refuteWeight",
  ]);
  stringArray(item.supportEvidenceIds, true);
  stringArray(item.refuteEvidenceIds, true);
  stringArray(item.ignoredContextEvidenceIds, true);
  integer(item.supportWeight, "calculation.confidence.agreement.supportWeight", 0);
  integer(item.refuteWeight, "calculation.confidence.agreement.refuteWeight", 0);
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw databaseError();
  return value as Record<string, unknown>;
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

function stringArray(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw databaseError();
  return value.map((item) => nonEmptyString(item, "array item"));
}

function uniqueStrings(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw databaseError();
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw databaseError();
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  void field;
  if (typeof value !== "string" || !values.includes(value)) throw databaseError();
  return value as T[number];
}

function thesisStatus(value: unknown): "draft" | "published" | "withdrawn" {
  return enumValue(value, ["draft", "published", "withdrawn"] as const, "status");
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw databaseError();
  }
  return value as number;
}

function stringValue(value: unknown, field: string): string {
  void field;
  if (typeof value !== "string") throw databaseError();
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  const result = stringValue(value, field);
  if (result.trim().length === 0) throw databaseError();
  return result;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return stringValue(value, field);
}

function nullableNonEmptyString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return nonEmptyString(value, field);
}

function canonicalUtc(value: unknown, field: string): string {
  const result = stringValue(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)) throw databaseError();
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== result) throw databaseError();
  return result;
}

function draftKeyValue(value: unknown): string {
  const result = nonEmptyString(value, "draft_key");
  const pattern = new RegExp(`^${THESIS_DRAFT_KEY_VERSION}:sha256:[0-9a-f]{64}$`);
  if (!pattern.test(result)) throw databaseError();
  return result;
}

function nullableDraftKey(value: unknown): string | null {
  if (value === null) return null;
  return draftKeyValue(value);
}

function queryRows(result: unknown): Record<string, unknown>[] {
  const item = recordValue(result);
  if (item.success !== true || !Array.isArray(item.results)) throw databaseError();
  return item.results.map(recordValue);
}

function writeBatchChanges(results: unknown, evidenceCount: number): 0 | 1 {
  if (!Array.isArray(results) || results.length !== evidenceCount + 1) throw databaseError();
  const changes = results.map(writeChanges);
  const versionChanges = changes[0];
  if (versionChanges !== 0 && versionChanges !== 1) throw databaseError();
  if (changes.slice(1).some((value) => value !== versionChanges)) throw databaseError();
  return versionChanges;
}

function writeAdministrativeEditChanges(results: unknown, evidenceCount: number): 0 | 1 {
  if (!Array.isArray(results) || results.length !== evidenceCount + 2) throw databaseError();
  const changes = results.map(writeChanges);
  const versionChanges = changes[0];
  const evidenceChanges = changes.slice(1, evidenceCount + 1);
  const auditChanges = changes[evidenceCount + 1];
  if (versionChanges !== 0 && versionChanges !== 1) throw databaseError();
  if (evidenceChanges.some((count) => count !== versionChanges) || auditChanges !== versionChanges) {
    return 0;
  }
  return versionChanges;
}

function writeChanges(result: unknown): number {
  const item = recordValue(result);
  if (item.success !== true) throw databaseError();
  const meta = recordValue(item.meta);
  return integer(meta.changes, "meta.changes", 0);
}

function databaseError(): ThesisDraftError {
  return new ThesisDraftError("DATABASE", "D1 无法持久化或读取论点草稿");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
