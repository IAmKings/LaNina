import type { ThesisDirection, ThesisStage } from "./contracts";
import type { EvidenceLayer, EvidenceStance } from "./evaluation";
import type { ObservationQuality, SourceErrorCode, SourceHealthStatus } from "./ingestion";

export const PUBLIC_THESIS_CATEGORIES = ["climate", "rubber", "agriculture", "shipping"] as const;
export const PUBLIC_MARKET_CATEGORIES = ["rubber", "agriculture", "shipping"] as const;

export type PublicThesisCategory = (typeof PUBLIC_THESIS_CATEGORIES)[number];
export type PublicMarketCategory = (typeof PUBLIC_MARKET_CATEGORIES)[number];
export type PageFreshness = "current" | "stale";
export type PageLoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "empty"; readonly data: T }
  | { readonly status: "error"; readonly message: string };

export interface PublicSourceReference {
  readonly name: string;
  readonly organization: string;
  readonly citationUrl: string;
}

export interface PublicTimeReferences {
  readonly observedAt: string | null;
  readonly publishedAt: string | null;
  readonly fetchedAt: string;
}

export interface ThesisCardModel {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly category: PublicThesisCategory;
  readonly region: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly latestEvidenceSummary: string | null;
  readonly freshness: PageFreshness;
  readonly basedOnCutoff: string;
  readonly publishedAt: string;
  readonly version: number;
}

export interface ThesisEvidenceModel {
  readonly summary: string;
  readonly layer: EvidenceLayer;
  readonly stance: Exclude<EvidenceStance, "context">;
  readonly source: PublicSourceReference;
  readonly times: PublicTimeReferences;
  readonly quality: ObservationQuality;
  readonly revision: number;
  readonly valueLabel: string | null;
}

export interface IndicatorPointModel {
  readonly observedAt: string;
  readonly value: number | string | null;
  readonly unit: string;
  readonly quality: ObservationQuality;
  readonly revision: number;
  readonly isRevision: boolean;
  readonly source: PublicSourceReference;
  readonly times: PublicTimeReferences;
}

export interface IndicatorSeriesModel {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly points: readonly IndicatorPointModel[];
  readonly missingReason: string | null;
}

export interface ThesisVersionTimelineModel {
  readonly version: number;
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly publishedAt: string;
  readonly changeReason: string | null;
}

export interface ThesisPageModel {
  readonly thesis: ThesisCardModel;
  readonly invalidation: string;
  readonly supportingEvidence: readonly ThesisEvidenceModel[];
  readonly counterEvidence: readonly ThesisEvidenceModel[];
  readonly indicators: readonly IndicatorSeriesModel[];
  readonly versions: readonly ThesisVersionTimelineModel[];
  readonly freshness: PageFreshness;
}

export interface PublicChangeModel {
  readonly id: string;
  readonly type: "observation" | "revision" | "threshold" | "thesis" | "source_health" | "manual";
  readonly thesisId: string | null;
  readonly thesisTitle: string | null;
  readonly summary: string;
  readonly beforeLabel: string | null;
  readonly afterLabel: string;
  readonly detectedAt: string;
  readonly publishedInCurrentThesis: boolean;
  readonly source: PublicSourceReference | null;
}

export interface SourceHealthModel {
  readonly sourceId: string;
  readonly name: string;
  readonly organization: string;
  readonly homepageUrl: string;
  readonly status: SourceHealthStatus;
  readonly cadenceMinutes: number;
  readonly lastSuccessAt: string | null;
  readonly lastFetchedAt: string | null;
  readonly sevenDaySuccessRate: number | null;
  readonly affectedIndicators: readonly string[];
  readonly affectedTheses: readonly string[];
}

/**
 * 路径①（2026-09-24）：被显式豁免的覆盖缺口。公开页面如实展示缺口文案，且**不**提供方向或
 * 置信度——被豁免论点没有已发布版本，任何方向的展示都会是编造。
 */
export interface PublicCoverageGapModel {
  readonly thesisId: string;
  readonly title: string;
  readonly gapDescription: string;
}

export interface OverviewPageModel {
  readonly methodologyVersion: string;
  readonly dailyBrief: {
    readonly briefDate: string;
    readonly headline: string;
    readonly summary: string;
    readonly dataCutoff: string;
    readonly publishedAt: string;
  } | null;
  readonly enso: ThesisCardModel | null;
  readonly topChanges: readonly PublicChangeModel[];
  readonly theses: readonly ThesisCardModel[];
  readonly coverageGaps: readonly PublicCoverageGapModel[];
  readonly sourceHealth: {
    readonly healthy: number;
    readonly delayed: number;
    readonly stale: number;
    readonly broken: number;
  };
  readonly freshness: PageFreshness;
}

/**
 * A historic daily brief is an immutable public record. It intentionally uses
 * the numeric version for human context, but never exposes the opaque frozen
 * thesis-version identity or any publication/audit metadata.
 */
export interface DailyBriefThesisModel {
  readonly thesisId: string;
  readonly slug: string;
  readonly title: string;
  readonly category: PublicThesisCategory;
  readonly region: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly version: number;
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly invalidation: string;
  readonly basedOnCutoff: string;
  readonly publishedAt: string;
}

export interface DailyBriefPageModel {
  readonly briefDate: string;
  readonly headline: string;
  readonly summary: string;
  readonly dataCutoff: string;
  readonly publishedAt: string;
  readonly methodologyVersion: string;
  readonly theses: readonly DailyBriefThesisModel[];
}

export interface CategoryPageModel {
  readonly category: PublicMarketCategory;
  readonly title: string;
  readonly summary: string;
  readonly theses: readonly ThesisCardModel[];
  readonly changes: readonly PublicChangeModel[];
  readonly coverageGaps: readonly string[];
  readonly freshness: PageFreshness;
}

export interface ChangesPageModel {
  readonly changes: readonly PublicChangeModel[];
  readonly nextCursor: string | null;
  readonly freshness: PageFreshness;
}

export interface DataHealthPageModel {
  readonly sources: readonly SourceHealthModel[];
  readonly generatedAt: string;
}

export interface MethodologyPageModel {
  readonly methodologyVersion: string;
  readonly lastUpdatedAt: string;
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
  }[];
  /** 最新已发布每日判定中显式豁免的覆盖缺口，如实公开。 */
  readonly coverageGaps: readonly PublicCoverageGapModel[];
}

export const ADMIN_ROLES = ["viewer", "editor", "publisher"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminRunModel {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly scheduledAt: string;
  readonly finishedAt: string | null;
  readonly status: "success" | "unchanged" | "partial" | "failed";
  readonly observationsInserted: number;
  readonly observationsRevised: number;
  readonly safeErrorCode: SourceErrorCode | null;
}

export interface AdminRunsPageModel {
  readonly actor: { readonly email: string; readonly roles: readonly AdminRole[] };
  readonly runs: readonly AdminRunModel[];
  readonly nextCursor: string | null;
}

/**
 * The deliberately small version shape a reviewer may compare before a
 * publication command. Calculation inputs, evidence rows and audit identity
 * stay in their owning storage/workflow modules.
 */
export interface AdminDraftReviewVersionModel {
  /** Opaque version identity, returned only by the authenticated admin review projection. */
  readonly id: string;
  readonly version: number;
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly invalidation: string;
  readonly basedOnCutoff: string;
  readonly createdAt: string;
  readonly changeReason: string | null;
}

export interface AdminDraftPageModel {
  readonly actor: { readonly email: string; readonly roles: readonly AdminRole[] };
  readonly thesis: {
    readonly id: string;
    readonly title: string;
    readonly currentPublishedVersion: number | null;
  };
  readonly draft: AdminDraftReviewVersionModel | null;
  /** Current pointer only; historical published versions are intentionally not a review endpoint. */
  readonly published: AdminDraftReviewVersionModel | null;
}

/**
 * The single version a required thesis has at the cutoff, shown to an operator so the one-click
 * publish action can target drafts with the exact optimistic-concurrency version. The Worker still
 * resolves the freeze targets server-side; a browser never chooses which public content is frozen.
 */
export interface AdminDailyTargetModel {
  readonly thesisId: string;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
}

/**
 * A thesis the Worker resolved as unpublished at the cutoff and therefore exemptible from the
 * daily brief. The gap copy is server-provided so the browser only acknowledges what it is shown.
 */
export interface AdminDailyExemptionTargetModel {
  readonly thesisId: string;
  readonly gapId: string;
  readonly gapDescription: string;
}

/**
 * A high-risk transition (direction change, stage jump ≥2, or confidence delta ≥20 against the
 * previous published brief) that still needs a recorded human review before publication.
 */
export interface AdminDailyReviewObligationModel {
  readonly thesisId: string;
  readonly afterVersionId: string;
  readonly beforeVersionId: string;
  readonly triggers: readonly string[];
}

/**
 * The authenticated preflight projection of one daily brief. It carries only what a publisher needs
 * to act: the resolved targets, why publication is blocked, whether the date is already published,
 * the freeze key that acts as the concurrency token for a retry, and any coverage-gap exemptions
 * that would let an otherwise incomplete day be published.
 */
export interface AdminDailyPageModel {
  readonly actor: { readonly email: string; readonly roles: readonly AdminRole[] };
  readonly briefDate: string;
  readonly cutoff: string;
  readonly published: boolean;
  readonly publishedAt: string | null;
  readonly currentFreezeKey: string | null;
  readonly targets: readonly AdminDailyTargetModel[];
  readonly blockers: readonly string[];
  readonly exemptibleTargets: readonly AdminDailyExemptionTargetModel[];
  readonly pendingReviews: readonly AdminDailyReviewObligationModel[];
}
