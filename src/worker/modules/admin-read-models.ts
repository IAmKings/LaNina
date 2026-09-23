import type { AdminDraftPageModel, AdminRunsPageModel } from "../../domain/page-models";

export interface AdminRunsCursor {
  readonly scheduledAt: string;
  readonly id: string;
}

export function parseAdminRunsCursor(value: string | null): AdminRunsCursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.scheduledAt !== "string" || typeof record.id !== "string") {
      return null;
    }
    if (!isCanonicalUtc(record.scheduledAt) || record.id.trim().length === 0 || record.id.length > 256) return null;
    return { scheduledAt: record.scheduledAt, id: record.id };
  } catch {
    return null;
  }
}

function isCanonicalUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

export interface AdminReadModelRepository {
  runs(
    actor: AdminRunsPageModel["actor"],
    cursor: AdminRunsCursor | null,
  ): Promise<AdminRunsPageModel>;
  draft(
    actor: AdminDraftPageModel["actor"],
    thesisId: string,
  ): Promise<AdminDraftPageModel | null>;
}

/** Authenticated admin projections stay separate from public read models and write commands. */
export class AdminReadModelModule {
  constructor(private readonly repository: AdminReadModelRepository) {}

  runs(actor: AdminRunsPageModel["actor"], cursor: AdminRunsCursor | null): Promise<AdminRunsPageModel> {
    return this.repository.runs(actor, cursor);
  }

  draft(
    actor: AdminDraftPageModel["actor"],
    thesisId: string,
  ): Promise<AdminDraftPageModel | null> {
    if (!isAdminThesisId(thesisId)) return Promise.resolve(null);
    return this.repository.draft(actor, thesisId);
  }
}

export function isAdminThesisId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
