import { canonicalJson, sha256Hex } from "./canonical-json";
import type { SourceHealthStatus } from "./ingestion";

export const DAILY_BRIEF_TIME_ZONE = "Asia/Shanghai" as const;
export const REQUIRED_DAILY_THESIS_IDS = [
  "ENSO-CORE-01",
  "RUBBER-TH-01",
  "PALM-SEA-01",
  "MAIZE-SA-01",
  "SHIP-USEC-01",
  "SHIP-EU-01",
] as const;
export const PRIMARY_ENSO_SOURCE_IDS = ["noaa_cpc_roni"] as const;
export const DAILY_BRIEF_GATE_CODES = [
  "PRIMARY_SOURCE_HEALTH",
  "FREEZE_COMPLETENESS",
  "CITATION_COMPLETENESS",
  "HIGH_RISK_REVIEW",
] as const;

export type RequiredDailyThesisId = (typeof REQUIRED_DAILY_THESIS_IDS)[number];
export type DailyBriefGateCode = (typeof DAILY_BRIEF_GATE_CODES)[number];

export interface DailyBriefVersionTarget {
  readonly thesisId: RequiredDailyThesisId;
  readonly thesisVersionId: string;
}

/**
 * An explicitly acknowledged coverage gap (路径①, 2026-09-24). An exempted thesis has no published
 * version for the cutoff, so it is not frozen; the gap is recorded instead of inventing a proxy.
 */
export interface DailyBriefExemption {
  readonly thesisId: RequiredDailyThesisId;
  readonly gapId: string;
}

export interface DailyBriefFreezeCommand {
  readonly cutoff: string;
  readonly targets: readonly DailyBriefVersionTarget[];
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly actor: string;
  readonly reason: string;
  readonly occurredAt: string;
  readonly expectedFreezeKey: string | null;
  /** Optional for compatibility: a brief with six published targets has no exemptions. */
  readonly exemptions?: readonly DailyBriefExemption[];
}

export interface DailyBriefSourceHealthSnapshot {
  readonly sourceId: string;
  readonly status: SourceHealthStatus;
  readonly checkedAt: string;
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
}

export interface DailyBriefFrozenVersionFact {
  readonly thesisId: RequiredDailyThesisId;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
  readonly isLatest: boolean;
  readonly basedOnCutoff: string;
  readonly calculationThesisId: string;
  readonly calculationCutoff: string;
  readonly methodologyVersion: string | null;
  readonly ruleVersion: string | null;
  readonly citations: readonly string[];
  readonly direction: "bullish" | "bearish" | "neutral" | "mixed";
  readonly stage:
    | "watch"
    | "weather_realized"
    | "physical_pressure"
    | "balance_tightening"
    | "market_confirmed"
    | "easing";
  readonly confidence: number;
  readonly previousPublished: {
    readonly thesisVersionId: string;
    readonly direction: DailyBriefFrozenVersionFact["direction"];
    readonly stage: DailyBriefFrozenVersionFact["stage"];
    readonly confidence: number;
  } | null;
  readonly transitionReviewed: boolean;
}

export interface DailyBriefGateResult {
  readonly code: DailyBriefGateCode;
  readonly status: "passed" | "failed";
  readonly explanation: string;
  readonly reasons: readonly string[];
}

export interface DailyBriefGateFacts {
  readonly cutoff: string;
  readonly targets: readonly DailyBriefVersionTarget[];
  readonly versions: readonly DailyBriefFrozenVersionFact[];
  readonly sourceHealth: readonly DailyBriefSourceHealthSnapshot[];
  /** Acknowledged coverage gaps; `targets.length + exemptions.length` must reach six. */
  readonly exemptions?: readonly DailyBriefExemption[];
}

export interface FrozenDailyBriefVersion {
  readonly thesisId: RequiredDailyThesisId;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly methodologyVersion: string;
  readonly ruleVersion: string;
  readonly sortOrder: number;
}

export interface DailyBriefResult {
  readonly briefDate: string;
  readonly status: "published" | "delayed";
  readonly freezeKey: string;
  readonly cutoff: string;
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly gates: readonly DailyBriefGateResult[];
  readonly sourceHealth: readonly DailyBriefSourceHealthSnapshot[];
  readonly versions: readonly FrozenDailyBriefVersion[];
  readonly exemptions: readonly DailyBriefExemption[];
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly attemptId: string;
}

const STAGES: readonly DailyBriefFrozenVersionFact["stage"][] = [
  "watch",
  "weather_realized",
  "physical_pressure",
  "balance_tightening",
  "market_confirmed",
  "easing",
];

export function shanghaiBriefDate(cutoff: string): string {
  const instant = canonicalUtc(cutoff, "cutoff");
  const shifted = new Date(instant.valueOf() + 8 * 60 * 60 * 1_000);
  return shifted.toISOString().slice(0, 10);
}

export function evaluateDailyBriefGates(facts: DailyBriefGateFacts): readonly DailyBriefGateResult[] {
  canonicalUtc(facts.cutoff, "cutoff");
  const targetReasons = [
    ...targetValidationReasons(facts.targets, facts.versions, facts.cutoff, facts.exemptions ?? []),
    ...sourceSnapshotReasons(facts.sourceHealth, facts.cutoff),
  ];
  const primary = PRIMARY_ENSO_SOURCE_IDS.map((sourceId) =>
    facts.sourceHealth.find((item) => item.sourceId === sourceId),
  );
  const primaryReasons = primary.flatMap((health, index) => {
    const sourceId = PRIMARY_ENSO_SOURCE_IDS[index]!;
    if (health === undefined) return [`PRIMARY_SOURCE_MISSING:${sourceId}`];
    if (health.checkedAt !== facts.cutoff) return [`SOURCE_SNAPSHOT_CUTOFF_MISMATCH:${sourceId}`];
    return health.status === "stale" || health.status === "broken"
      ? [`PRIMARY_SOURCE_${health.status.toUpperCase()}:${sourceId}`]
      : [];
  });
  const citationReasons = facts.versions.flatMap((version) => {
    if (version.citations.length === 0) return [`EVIDENCE_MISSING:${version.thesisId}`];
    return version.citations.flatMap((citation, index) =>
      citation.trim().length === 0
        ? [`CITATION_MISSING:${version.thesisId}:${index}`]
        : [],
    );
  });
  const reviewReasons = facts.versions.flatMap(highRiskReasons);
  return deepFreeze([
    gate("PRIMARY_SOURCE_HEALTH", primaryReasons, "ENSO 权威主来源健康"),
    gate("FREEZE_COMPLETENESS", targetReasons, "六论点与冻结元数据完整"),
    gate("CITATION_COMPLETENESS", citationReasons, "冻结证据引用完整"),
    gate("HIGH_RISK_REVIEW", reviewReasons, "高风险变化均已人工审核"),
  ]);
}

function sourceSnapshotReasons(
  sourceHealth: readonly DailyBriefSourceHealthSnapshot[],
  cutoff: string,
): string[] {
  if (sourceHealth.length === 0) return ["SOURCE_HEALTH_SNAPSHOT_MISSING"];
  const reasons: string[] = [];
  const ids = new Set<string>();
  for (const item of sourceHealth) {
    if (ids.has(item.sourceId)) reasons.push(`SOURCE_HEALTH_DUPLICATE:${item.sourceId}`);
    ids.add(item.sourceId);
    if (item.checkedAt !== cutoff) reasons.push(`SOURCE_HEALTH_CUTOFF_MISMATCH:${item.sourceId}`);
  }
  return reasons;
}

export async function dailyBriefFreezeKey(input: {
  readonly briefDate: string;
  readonly cutoff: string;
  readonly targets: readonly DailyBriefVersionTarget[];
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly versions: readonly DailyBriefFrozenVersionFact[];
  readonly sourceHealth: readonly DailyBriefSourceHealthSnapshot[];
  readonly exemptions?: readonly DailyBriefExemption[];
}): Promise<string> {
  const exemptions = [...(input.exemptions ?? [])].sort(compareExemptions);
  const semantic = {
    keyVersion: "daily-brief-freeze-v1",
    briefDate: input.briefDate,
    cutoff: input.cutoff,
    targets: [...input.targets].sort(compareTargets),
    // Omitted when empty so a six-published-version brief keeps the freeze identity it had before
    // 路径①: only an actual exemption set changes the key.
    ...(exemptions.length === 0 ? {} : { exemptions }),
    headline: input.headline,
    summary: input.summary,
    topChanges: input.topChanges,
    versions: [...input.versions].sort((left, right) => left.thesisId.localeCompare(right.thesisId)),
    sourceHealth: [...input.sourceHealth].sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  };
  return `daily-brief-freeze-v1:sha256:${await sha256Hex(canonicalJson(semantic))}`;
}

function targetValidationReasons(
  targets: readonly DailyBriefVersionTarget[],
  versions: readonly DailyBriefFrozenVersionFact[],
  cutoff: string,
  exemptions: readonly DailyBriefExemption[],
): string[] {
  const reasons: string[] = [];
  const targetTheses = new Set(targets.map((target) => target.thesisId));
  const targetVersions = new Set(targets.map((target) => target.thesisVersionId));
  const exemptTheses = new Set(exemptions.map((exemption) => exemption.thesisId));
  if (targets.length + exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length) {
    reasons.push("TARGET_COUNT_NOT_SIX");
  }
  if (targetTheses.size !== targets.length) reasons.push("DUPLICATE_THESIS_TARGET");
  if (targetVersions.size !== targets.length) reasons.push("DUPLICATE_VERSION_TARGET");
  if (exemptTheses.size !== exemptions.length) reasons.push("DUPLICATE_EXEMPTION");
  for (const thesisId of REQUIRED_DAILY_THESIS_IDS) {
    if (!targetTheses.has(thesisId) && !exemptTheses.has(thesisId)) reasons.push(`TARGET_MISSING:${thesisId}`);
  }
  for (const thesisId of exemptTheses) {
    if (!REQUIRED_DAILY_THESIS_IDS.includes(thesisId)) reasons.push(`UNKNOWN_EXEMPTION:${thesisId}`);
    if (targetTheses.has(thesisId)) reasons.push(`EXEMPTION_CONFLICTS_TARGET:${thesisId}`);
  }
  if (versions.length !== targets.length) reasons.push("VERSION_FACT_COUNT_MISMATCH");
  const byThesis = new Map(versions.map((version) => [version.thesisId, version]));
  for (const target of targets) {
    const version = byThesis.get(target.thesisId);
    if (version === undefined) continue;
    if (version.thesisVersionId !== target.thesisVersionId) {
      reasons.push(`VERSION_ID_MISMATCH:${target.thesisId}`);
    }
    if (version.calculationThesisId !== target.thesisId) reasons.push(`CROSS_THESIS:${target.thesisId}`);
    if (version.status !== "published") reasons.push(`VERSION_NOT_PUBLISHED:${target.thesisId}`);
    if (!version.isLatest) reasons.push(`VERSION_NOT_LATEST:${target.thesisId}`);
    if (version.basedOnCutoff !== cutoff || version.calculationCutoff !== cutoff) {
      reasons.push(`CUTOFF_MISMATCH:${target.thesisId}`);
    }
    if (version.methodologyVersion === null || version.methodologyVersion.trim().length === 0) {
      reasons.push(`METHODOLOGY_VERSION_MISSING:${target.thesisId}`);
    }
    if (version.ruleVersion === null || version.ruleVersion.trim().length === 0) {
      reasons.push(`RULE_VERSION_MISSING:${target.thesisId}`);
    }
  }
  if (factsSourceSnapshotInvalid(versions, targets)) reasons.push("VERSION_FACT_IDENTITY_INVALID");
  return reasons.sort();
}

function factsSourceSnapshotInvalid(
  versions: readonly DailyBriefFrozenVersionFact[],
  targets: readonly DailyBriefVersionTarget[],
): boolean {
  const versionTheses = new Set(versions.map((item) => item.thesisId));
  return versionTheses.size !== versions.length || targets.some((item) => !versionTheses.has(item.thesisId));
}

/** The minimal transition shape the high-risk rule compares; shared by gates and admin previews. */
export interface HighRiskTransition {
  readonly direction: DailyBriefFrozenVersionFact["direction"];
  readonly stage: DailyBriefFrozenVersionFact["stage"];
  readonly confidence: number;
}

/**
 * High-risk trigger codes for a transition against the previous published brief. Returns an empty
 * list when there is no baseline. The daily-brief gate prefixes these with `UNREVIEWED_`; the admin
 * review preview uses the bare codes so an operator can see what needs a recorded review.
 */
export function highRiskTriggers(input: {
  readonly direction: HighRiskTransition["direction"];
  readonly stage: HighRiskTransition["stage"];
  readonly confidence: number;
  readonly previousPublished: HighRiskTransition | null;
}): readonly string[] {
  const previous = input.previousPublished;
  if (previous === null) return [];
  const stageDelta = Math.abs(stageIndex(input.stage) - stageIndex(previous.stage));
  const confidenceDelta = Math.abs(input.confidence - previous.confidence);
  return [
    ...(input.direction !== previous.direction ? ["DIRECTION_CHANGE"] : []),
    ...(stageDelta >= 2 ? [`STAGE_DELTA_${stageDelta}`] : []),
    ...(confidenceDelta >= 20 ? [`CONFIDENCE_DELTA_${confidenceDelta}`] : []),
  ];
}

function highRiskReasons(version: DailyBriefFrozenVersionFact): string[] {
  const triggers = highRiskTriggers(version);
  if (triggers.length === 0 || version.transitionReviewed) return [];
  return triggers.map((trigger) => `UNREVIEWED_${trigger}:${version.thesisId}`);
}

function stageIndex(stage: DailyBriefFrozenVersionFact["stage"]): number {
  const index = STAGES.indexOf(stage);
  if (index < 0) throw new Error("无效传导阶段");
  return index;
}

function gate(code: DailyBriefGateCode, reasons: string[], explanation: string): DailyBriefGateResult {
  const stableReasons = [...new Set(reasons)].sort();
  return {
    code,
    status: stableReasons.length === 0 ? "passed" : "failed",
    explanation: stableReasons.length === 0 ? `${explanation}：通过` : `${explanation}：未通过`,
    reasons: stableReasons,
  };
}

function compareTargets(left: DailyBriefVersionTarget, right: DailyBriefVersionTarget): number {
  return REQUIRED_DAILY_THESIS_IDS.indexOf(left.thesisId)
    - REQUIRED_DAILY_THESIS_IDS.indexOf(right.thesisId);
}

function compareExemptions(left: DailyBriefExemption, right: DailyBriefExemption): number {
  return REQUIRED_DAILY_THESIS_IDS.indexOf(left.thesisId)
    - REQUIRED_DAILY_THESIS_IDS.indexOf(right.thesisId);
}

function canonicalUtc(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${field} 必须是规范 UTC 时间`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} 必须是规范 UTC 时间`);
  }
  return parsed;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
