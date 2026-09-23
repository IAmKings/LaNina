import type {
  PersistedThesisDraft,
  ThesisDraftCandidate,
  ThesisDraftStorageRecord,
} from "../../domain/thesis-draft";
import {
  buildThesisDraftStorageRecord,
  ThesisDraftValidationError,
} from "../../domain/thesis-draft";

export const THESIS_DRAFT_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "NON_DRAFT",
  "DATABASE",
] as const;

export type ThesisDraftErrorCode = (typeof THESIS_DRAFT_ERROR_CODES)[number];

export class ThesisDraftError extends Error {
  constructor(
    readonly code: ThesisDraftErrorCode,
    message: string,
    readonly details: Readonly<{ expectedVersion: number; currentVersion: number }> | null = null,
  ) {
    super(message);
    this.name = "ThesisDraftError";
  }
}

export interface ThesisDraftRepository {
  createAutomatic(record: ThesisDraftStorageRecord): Promise<PersistedThesisDraft>;
  editExpected(
    expectedVersion: number,
    record: ThesisDraftStorageRecord,
  ): Promise<PersistedThesisDraft>;
  editAdministrative(command: AdministrativeDraftEditCommand): Promise<PersistedThesisDraft>;
}

/**
 * The administrative boundary intentionally permits only editorial copy. It
 * cannot alter the calculated direction, stage, confidence, cutoff, selected
 * evidence, or any source-backed evidence weight.
 */
export interface AdministrativeDraftEditCommand {
  readonly versionId: string;
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly summary: string | undefined;
  readonly invalidation: string | undefined;
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: string;
}

export interface AdministrativeDraftEditResult {
  readonly id: string;
  readonly thesisId: string;
  readonly version: number;
  readonly status: "draft";
  readonly createdAt: string;
}

export class ThesisDraftModule {
  constructor(private readonly repository: ThesisDraftRepository) {}

  async create(candidate: ThesisDraftCandidate): Promise<PersistedThesisDraft> {
    return this.repository.createAutomatic(await buildRecord(candidate));
  }

  async edit(
    expectedVersion: number,
    candidate: ThesisDraftCandidate,
  ): Promise<PersistedThesisDraft> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ThesisDraftError("VALIDATION", "expectedVersion 必须是正整数");
    }
    if (candidate.changeReason === null || candidate.changeReason.trim().length === 0) {
      throw new ThesisDraftError("VALIDATION", "非首版草稿必须填写变更原因");
    }
    return this.repository.editExpected(expectedVersion, await buildRecord(candidate));
  }

  async editAdministrative(
    command: AdministrativeDraftEditCommand,
  ): Promise<AdministrativeDraftEditResult> {
    validateAdministrativeEdit(command);
    const draft = await this.repository.editAdministrative(command);
    return {
      id: draft.id,
      thesisId: draft.thesisId,
      version: draft.version,
      status: "draft",
      createdAt: draft.createdAt,
    };
  }
}

function validateAdministrativeEdit(command: AdministrativeDraftEditCommand): void {
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
    throw new ThesisDraftError("VALIDATION", "expectedVersion 必须是正整数");
  }
  if (!isBoundedNonEmpty(command.versionId, 128) || !isBoundedNonEmpty(command.thesisId, 128)) {
    throw new ThesisDraftError("VALIDATION", "草稿或论点标识无效");
  }
  if (!isBoundedNonEmpty(command.actor, 320) || !isBoundedNonEmpty(command.reason, 500)) {
    throw new ThesisDraftError("VALIDATION", "操作者和变更原因不能为空");
  }
  if (!isCanonicalUtc(command.occurredAt)) {
    throw new ThesisDraftError("VALIDATION", "编辑时间必须是 UTC ISO 时间");
  }
  if (command.summary === undefined && command.invalidation === undefined) {
    throw new ThesisDraftError("VALIDATION", "至少需要修改摘要或失效条件");
  }
  if (command.summary !== undefined && !isBoundedNonEmpty(command.summary, 500)) {
    throw new ThesisDraftError("VALIDATION", "摘要不能为空且不能超过 500 字符");
  }
  if (command.invalidation !== undefined && !isBoundedNonEmpty(command.invalidation, 2_000)) {
    throw new ThesisDraftError("VALIDATION", "失效条件不能为空且不能超过 2000 字符");
  }
}

function isBoundedNonEmpty(value: string, maximumLength: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= maximumLength;
}

function isCanonicalUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

async function buildRecord(candidate: ThesisDraftCandidate): Promise<ThesisDraftStorageRecord> {
  try {
    return await buildThesisDraftStorageRecord(candidate);
  } catch (error) {
    if (error instanceof ThesisDraftValidationError) {
      throw new ThesisDraftError("VALIDATION", error.message);
    }
    throw error;
  }
}
