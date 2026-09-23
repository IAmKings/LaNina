import {
  REQUIRED_DAILY_THESIS_IDS,
  type DailyBriefVersionTarget,
} from "../../domain/daily-brief";

export const DAILY_PUBLICATION_TARGET_ERROR_CODES = ["VALIDATION", "DATABASE"] as const;
export type DailyPublicationTargetErrorCode = (typeof DAILY_PUBLICATION_TARGET_ERROR_CODES)[number];

export class DailyPublicationTargetError extends Error {
  constructor(readonly code: DailyPublicationTargetErrorCode, message: string) {
    super(message);
    this.name = "DailyPublicationTargetError";
  }
}

/** A version that claims the requested evaluation cutoff, before the gate rules are applied. */
export interface CutoffThesisVersion {
  readonly thesisId: string;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
  readonly isLatest: boolean;
}

export interface DailyPublicationTargetRepository {
  findCutoffVersions(cutoff: string): Promise<readonly CutoffThesisVersion[]>;
}

export interface DailyPublicationTargetResolution {
  /** Six targets in stable product order, or null when any blocker exists. */
  readonly targets: readonly DailyBriefVersionTarget[] | null;
  readonly blockers: readonly string[];
}

/**
 * Resolves the six frozen versions a manual daily-brief publication must reference.
 *
 * The publication gate insists that every target was calculated at exactly the freeze cutoff, is
 * the latest version of its thesis and is already published. This module applies the same rules up
 * front so an operator sees an actionable blocker instead of an opaque gate failure, and never lets
 * the caller choose which public content gets frozen.
 */
export class DailyPublicationTargetModule {
  constructor(private readonly repository: DailyPublicationTargetRepository) {}

  async resolve(cutoff: string): Promise<DailyPublicationTargetResolution> {
    const canonical = canonicalUtc(cutoff);
    const versions = await this.repository.findCutoffVersions(canonical);
    const blockers: string[] = [];
    const known = new Set<string>(REQUIRED_DAILY_THESIS_IDS);
    for (const version of versions) {
      if (!known.has(version.thesisId)) blockers.push(`UNKNOWN_THESIS:${version.thesisId}`);
    }

    const byThesis = new Map<string, CutoffThesisVersion[]>();
    for (const version of versions) {
      const current = byThesis.get(version.thesisId) ?? [];
      current.push(version);
      byThesis.set(version.thesisId, current);
    }

    for (const thesisId of REQUIRED_DAILY_THESIS_IDS) {
      const matches = byThesis.get(thesisId) ?? [];
      if (matches.length === 0) {
        blockers.push(`TARGET_MISSING:${thesisId}`);
        continue;
      }
      if (matches.length > 1) {
        blockers.push(`TARGET_DUPLICATE:${thesisId}`);
        continue;
      }
      const match = matches[0]!;
      if (match.status !== "published") blockers.push(`VERSION_NOT_PUBLISHED:${thesisId}`);
      if (!match.isLatest) blockers.push(`VERSION_NOT_LATEST:${thesisId}`);
    }

    if (blockers.length > 0) {
      return Object.freeze({ targets: null, blockers: Object.freeze([...blockers].sort()) });
    }
    const targets = REQUIRED_DAILY_THESIS_IDS.map((thesisId) => ({
      thesisId,
      thesisVersionId: byThesis.get(thesisId)![0]!.thesisVersionId,
    }));
    return Object.freeze({ targets: Object.freeze(targets), blockers: Object.freeze([]) });
  }
}

function canonicalUtc(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new DailyPublicationTargetError("VALIDATION", "cutoff 必须是规范 UTC 时间");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new DailyPublicationTargetError("VALIDATION", "cutoff 必须是规范 UTC 时间");
  }
  return value;
}
