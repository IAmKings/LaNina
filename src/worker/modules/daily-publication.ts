import {
  REQUIRED_DAILY_THESIS_IDS,
  type DailyBriefVersionTarget,
  type RequiredDailyThesisId,
} from "../../domain/daily-brief";
import { exemptionAnchorGap } from "../../domain/coverage-gaps";
import { INITIAL_THESIS_SEEDS } from "../../domain/initial-thesis-seeds";
import type { CoverageGap, ThesisSeed } from "../../domain/thesis-seeds";

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

/**
 * A thesis that cannot be frozen because it has no published version for the cutoff, paired with the
 * coverage gap an operator must explicitly acknowledge (路径①, 2026-09-24). The gap is descriptive
 * only: exemption never substitutes a proxy value for the missing evidence.
 */
export interface DailyBriefExemptionTarget {
  readonly thesisId: RequiredDailyThesisId;
  readonly gapId: string;
  readonly gapDescription: string;
}

/**
 * The single version a required thesis has at the cutoff, whatever its status. This is a display /
 * operator projection only: it lets the admin preflight show what still has to be published and at
 * which version, while the freeze still resolves its targets server-side from published versions.
 */
export interface DailyBriefCandidateTarget {
  readonly thesisId: RequiredDailyThesisId;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
}

export interface DailyPublicationTargetResolution {
  /** Six targets in stable product order, or null when any blocker exists. */
  readonly targets: readonly DailyBriefVersionTarget[] | null;
  readonly blockers: readonly string[];
  /** Required theses that have no published version at the cutoff and a real coverage gap. */
  readonly exemptibleTargets: readonly DailyBriefExemptionTarget[];
  /** Every cleanly resolved target, in stable product order; the pool a publisher exempts from. */
  readonly resolvableTargets: readonly DailyBriefVersionTarget[];
  /** Required theses that do not resolve cleanly, whether or not an exemption can cover them. */
  readonly unresolvedTheses: readonly RequiredDailyThesisId[];
  /** Every required thesis with exactly one cutoff version, in stable product order. */
  readonly candidateTargets: readonly DailyBriefCandidateTarget[];
}

/**
 * Resolves the six frozen versions a manual daily-brief publication must reference.
 *
 * The publication gate insists that every target was calculated at exactly the freeze cutoff, is
 * the latest version of its thesis and is already published. This module applies the same rules up
 * front so an operator sees an actionable blocker instead of an opaque gate failure, and never lets
 * the caller choose which public content gets frozen. A thesis that is genuinely unpublished at the
 * cutoff is reported as an exemptible target instead of a dead end, but it still needs an explicit
 * acknowledgement before the brief can be frozen.
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

    const seeds = new Map<string, ThesisSeed>(INITIAL_THESIS_SEEDS.map((seed) => [seed.id, seed]));
    const resolvableTargets: DailyBriefVersionTarget[] = [];
    const unresolvedTheses: RequiredDailyThesisId[] = [];
    const exemptibleTargets: DailyBriefExemptionTarget[] = [];
    const candidateTargets: DailyBriefCandidateTarget[] = [];

    for (const thesisId of REQUIRED_DAILY_THESIS_IDS) {
      const matches = byThesis.get(thesisId) ?? [];
      const published = matches.find((match) => match.status === "published");
      if (matches.length === 0) {
        blockers.push(`TARGET_MISSING:${thesisId}`);
      } else if (matches.length > 1) {
        blockers.push(`TARGET_DUPLICATE:${thesisId}`);
      } else if (published === undefined) {
        blockers.push(`VERSION_NOT_PUBLISHED:${thesisId}`);
      } else if (!published.isLatest) {
        blockers.push(`VERSION_NOT_LATEST:${thesisId}`);
      }

      if (matches.length === 1) {
        const match = matches[0]!;
        candidateTargets.push({
          thesisId,
          thesisVersionId: match.thesisVersionId,
          version: match.version,
          status: match.status,
        });
      }

      if (matches.length === 1 && published !== undefined && published.isLatest) {
        resolvableTargets.push({ thesisId, thesisVersionId: published.thesisVersionId });
        continue;
      }
      unresolvedTheses.push(thesisId);
      const anchor = exemptionAnchor(seeds.get(thesisId));
      // A thesis that already has a published version for the cutoff is never exemptible.
      if (published === undefined && anchor !== null) {
        exemptibleTargets.push({ thesisId, gapId: anchor.id, gapDescription: anchor.description });
      }
    }

    if (blockers.length > 0) {
      return Object.freeze({
        targets: null,
        blockers: Object.freeze([...blockers].sort()),
        exemptibleTargets: Object.freeze(exemptibleTargets),
        resolvableTargets: Object.freeze(resolvableTargets),
        unresolvedTheses: Object.freeze(unresolvedTheses),
        candidateTargets: Object.freeze(candidateTargets),
      });
    }
    return Object.freeze({
      targets: Object.freeze(resolvableTargets),
      blockers: Object.freeze([]),
      exemptibleTargets: Object.freeze([]),
      resolvableTargets: Object.freeze(resolvableTargets),
      unresolvedTheses: Object.freeze([]),
      candidateTargets: Object.freeze(candidateTargets),
    });
  }
}

function exemptionAnchor(seed: ThesisSeed | undefined): CoverageGap | null {
  return seed === undefined ? null : exemptionAnchorGap(seed);
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
