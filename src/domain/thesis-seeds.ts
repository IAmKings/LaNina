import { THESIS_DIRECTIONS, THESIS_STAGES } from "./contracts";
import type { ThesisDirection, ThesisStage } from "./contracts";
import { EVIDENCE_LAYERS, EVIDENCE_STANCES } from "./evaluation";
import type { EvidenceLayer, EvidenceStance } from "./evaluation";

export const THESIS_CATEGORIES = ["climate", "rubber", "agriculture", "shipping"] as const;
export const RULE_REVIEW_STATUSES = ["pending", "approved"] as const;
const RULE_PREDICATE_KINDS = ["selector_present", "numeric_compare", "manual_review_required"] as const;

export const EVALUATION_INDICATOR_IDS = [
  "enso_roni_ersstv6",
  "regional_rainfall_southern_thailand_rubber_v1",
  "regional_rainfall_maritime_continent_palm_v1",
  "regional_rainfall_southern_africa_maize_v1",
  "regional_rainfall_panama_canal_catchment_v1",
  "usda_psd_malaysia_palm_oil_production_1000mt",
  "usda_psd_malaysia_palm_oil_exports_1000mt",
  "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
  "usda_psd_south_africa_corn_production_1000mt",
  "usda_psd_south_africa_corn_exports_1000mt",
  "usda_psd_south_africa_corn_ending_stocks_1000mt",
  "eia_europe_brent_spot_usd_per_bbl_daily",
] as const;

export type ThesisCategory = (typeof THESIS_CATEGORIES)[number];
export type RuleReviewStatus = (typeof RULE_REVIEW_STATUSES)[number];
export type EvaluationIndicatorId = (typeof EVALUATION_INDICATOR_IDS)[number];

export interface IndicatorSelector {
  readonly id: string;
  readonly indicatorId: EvaluationIndicatorId;
  readonly layer: EvidenceLayer;
  readonly defaultStance: EvidenceStance;
  readonly weight: number;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
  readonly notes: string;
}

export interface FreshnessSlo {
  readonly selectorId: string;
  readonly maxAgeMinutes: number | null;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
}

export type RulePredicate =
  | {
      readonly kind: "selector_present";
      readonly selectorIds: readonly string[];
      readonly minimumMatches: number;
    }
  | {
      readonly kind: "numeric_compare";
      readonly selectorId: string;
      readonly operator: "gt" | "gte" | "lt" | "lte";
      readonly threshold: number;
      readonly unit: string;
    }
  | {
      readonly kind: "manual_review_required";
      readonly reason: string;
    };

export interface RuleDescriptor {
  readonly id: string;
  readonly label: string;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
  readonly predicate: RulePredicate;
}

export type PromotableThesisStage = Exclude<ThesisStage, "watch">;

export interface StageGateDescriptor {
  readonly targetStage: PromotableThesisStage;
  readonly requiredLayers: readonly EvidenceLayer[];
  readonly ruleIds: readonly string[];
  readonly minimumRuleMatches: number | null;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
}

export interface DirectionRuleMapping {
  readonly ruleId: string;
  readonly direction: ThesisDirection | null;
}

export interface DirectionPolicy {
  readonly version: string;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
  readonly mappings: readonly DirectionRuleMapping[];
}

export interface ConfidencePolicy {
  readonly version: string;
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
  readonly lateFreshnessScore: number | null;
  readonly sourceTierScores: Readonly<Record<"A" | "B" | "C", number | null>>;
  readonly missingRequiredLayerCap: number | null;
  readonly coverageGapCap: number | null;
}

export interface CoverageGap {
  readonly id: string;
  readonly layer: EvidenceLayer;
  readonly description: string;
  readonly blocks: readonly ("stage" | "confidence" | "market_readiness" | "publication")[];
}

export interface MaterialChangeThresholds {
  readonly reviewStatus: RuleReviewStatus;
  readonly active: boolean;
  readonly confidenceDeltaPoints: number | null;
  readonly observationRevisionDelta: number | null;
}

export interface ThesisSeed {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly category: ThesisCategory;
  readonly region: string;
  readonly marketScope: string;
  readonly methodologyVersion: string;
  readonly regionDefinitionVersion: string;
  readonly target: string;
  readonly timeHorizon: string;
  readonly defaultDirection: ThesisDirection;
  readonly requiredEvidenceLayers: readonly EvidenceLayer[];
  readonly indicatorSelectors: readonly IndicatorSelector[];
  readonly freshnessSlos: readonly FreshnessSlo[];
  readonly supportRules: readonly RuleDescriptor[];
  readonly refuteRules: readonly RuleDescriptor[];
  readonly invalidationRules: readonly RuleDescriptor[];
  readonly reliefRules: readonly RuleDescriptor[];
  readonly stageGates: readonly StageGateDescriptor[];
  readonly directionPolicy: DirectionPolicy;
  readonly confidencePolicy: ConfidencePolicy;
  readonly materialChangeThresholds: MaterialChangeThresholds;
  readonly templateCopy: {
    readonly summary: string;
    readonly invalidation: string;
    readonly coverageGap: string;
  };
  readonly coverageGaps: readonly CoverageGap[];
  readonly readiness: {
    readonly reviewStatus: RuleReviewStatus;
    readonly productionEvaluation: boolean;
    readonly publication: boolean;
    readonly marketEvidenceReady: boolean;
    readonly blockingGapIds: readonly string[];
  };
}

const EXACT_SEED_KEYS = [
  "id",
  "slug",
  "title",
  "category",
  "region",
  "marketScope",
  "methodologyVersion",
  "regionDefinitionVersion",
  "target",
  "timeHorizon",
  "defaultDirection",
  "requiredEvidenceLayers",
  "indicatorSelectors",
  "freshnessSlos",
  "supportRules",
  "refuteRules",
  "invalidationRules",
  "reliefRules",
  "stageGates",
  "directionPolicy",
  "confidencePolicy",
  "materialChangeThresholds",
  "templateCopy",
  "coverageGaps",
  "readiness",
] as const;

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function assertNever(value: never, path: string): never {
  return fail(path, `unsupported value ${String(value)}`);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const record = recordAt(value, path);
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) fail(`${path}.${key}`, "unknown field");
  }
  for (const key of keys) {
    if (!(key in record)) fail(`${path}.${key}`, "missing field");
  }
  return record;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fail(path, "must be non-empty");
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "must be boolean");
  return value;
}

function enumAt<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) return fail(path, "invalid enum value");
  return value as T;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, "must be an array");
  return value;
}

function integerInRange(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail(path, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "must be finite");
  return value;
}

function nullablePositiveNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  const number = finiteNumber(value, path);
  if (number <= 0) return fail(path, "must be positive");
  return number;
}

function nullableConfidenceDelta(value: unknown, path: string): number | null {
  if (value === null) return null;
  return integerInRange(value, 1, 100, path);
}

function uniqueStrings(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, "must not contain duplicates");
}

function validateReviewState(
  reviewStatus: RuleReviewStatus,
  active: boolean,
  path: string,
): void {
  if ((reviewStatus === "pending" && active) || (reviewStatus === "approved" && !active)) {
    fail(path, "pending items must be inactive and approved items must be active");
  }
}

function decodeSelector(value: unknown, path: string): IndicatorSelector {
  const item = exactRecord(
    value,
    ["id", "indicatorId", "layer", "defaultStance", "weight", "reviewStatus", "active", "notes"],
    path,
  );
  const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${path}.reviewStatus`);
  const active = booleanAt(item.active, `${path}.active`);
  validateReviewState(reviewStatus, active, path);
  const weight = integerInRange(item.weight, 0, 100, `${path}.weight`);
  if (reviewStatus === "pending" && weight !== 0) {
    fail(`${path}.weight`, "pending selector must not claim an approved weight");
  }
  return {
    id: nonEmptyString(item.id, `${path}.id`),
    indicatorId: enumAt(item.indicatorId, EVALUATION_INDICATOR_IDS, `${path}.indicatorId`),
    layer: enumAt(item.layer, EVIDENCE_LAYERS, `${path}.layer`),
    defaultStance: enumAt(item.defaultStance, EVIDENCE_STANCES, `${path}.defaultStance`),
    weight,
    reviewStatus,
    active,
    notes: nonEmptyString(item.notes, `${path}.notes`),
  };
}

function decodeFreshnessSlo(value: unknown, selectorIds: ReadonlySet<string>, path: string): FreshnessSlo {
  const item = exactRecord(value, ["selectorId", "maxAgeMinutes", "reviewStatus", "active"], path);
  const selectorId = nonEmptyString(item.selectorId, `${path}.selectorId`);
  if (!selectorIds.has(selectorId)) fail(`${path}.selectorId`, "unknown selector");
  const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${path}.reviewStatus`);
  const active = booleanAt(item.active, `${path}.active`);
  validateReviewState(reviewStatus, active, path);
  const maxAgeMinutes = item.maxAgeMinutes === null
    ? null
    : integerInRange(item.maxAgeMinutes, 1, 525_600, `${path}.maxAgeMinutes`);
  if (reviewStatus === "pending" && maxAgeMinutes !== null) {
    fail(`${path}.maxAgeMinutes`, "pending SLO must not claim an approved threshold");
  }
  if (reviewStatus === "approved" && maxAgeMinutes === null) {
    fail(`${path}.maxAgeMinutes`, "approved SLO requires a threshold");
  }
  return { selectorId, maxAgeMinutes, reviewStatus, active };
}

function decodePredicate(value: unknown, selectorIds: ReadonlySet<string>, path: string): RulePredicate {
  const base = recordAt(value, path);
  const kind = enumAt(base.kind, RULE_PREDICATE_KINDS, `${path}.kind`);
  switch (kind) {
    case "selector_present": {
      const item = exactRecord(value, ["kind", "selectorIds", "minimumMatches"], path);
      const ids = arrayAt(item.selectorIds, `${path}.selectorIds`).map((id, index) =>
        nonEmptyString(id, `${path}.selectorIds[${index}]`),
      );
      if (ids.length === 0) fail(`${path}.selectorIds`, "must not be empty");
      uniqueStrings(ids, `${path}.selectorIds`);
      for (const id of ids) if (!selectorIds.has(id)) fail(`${path}.selectorIds`, `unknown selector ${id}`);
      return {
        kind,
        selectorIds: ids,
        minimumMatches: integerInRange(item.minimumMatches, 1, ids.length, `${path}.minimumMatches`),
      };
    }
    case "numeric_compare": {
      const item = exactRecord(value, ["kind", "selectorId", "operator", "threshold", "unit"], path);
      const selectorId = nonEmptyString(item.selectorId, `${path}.selectorId`);
      if (!selectorIds.has(selectorId)) fail(`${path}.selectorId`, "unknown selector");
      return {
        kind,
        selectorId,
        operator: enumAt(item.operator, ["gt", "gte", "lt", "lte"] as const, `${path}.operator`),
        threshold: finiteNumber(item.threshold, `${path}.threshold`),
        unit: nonEmptyString(item.unit, `${path}.unit`),
      };
    }
    case "manual_review_required": {
      const item = exactRecord(value, ["kind", "reason"], path);
      return { kind, reason: nonEmptyString(item.reason, `${path}.reason`) };
    }
    default:
      return assertNever(kind, `${path}.kind`);
  }
}

function decodeRules(
  value: unknown,
  selectorIds: ReadonlySet<string>,
  seenRuleIds: Set<string>,
  path: string,
): readonly RuleDescriptor[] {
  const rules = arrayAt(value, path);
  if (rules.length === 0) fail(path, "must not be empty");
  return rules.map((value, index) => {
    const rulePath = `${path}[${index}]`;
    const item = exactRecord(value, ["id", "label", "reviewStatus", "active", "predicate"], rulePath);
    const id = nonEmptyString(item.id, `${rulePath}.id`);
    if (seenRuleIds.has(id)) fail(`${rulePath}.id`, "duplicate rule id");
    seenRuleIds.add(id);
    const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${rulePath}.reviewStatus`);
    const active = booleanAt(item.active, `${rulePath}.active`);
    validateReviewState(reviewStatus, active, rulePath);
    const predicate = decodePredicate(item.predicate, selectorIds, `${rulePath}.predicate`);
    if (reviewStatus === "pending" && predicate.kind !== "manual_review_required") {
      fail(`${rulePath}.predicate`, "pending rule must not claim an approved predicate");
    }
    if (reviewStatus === "approved" && predicate.kind === "manual_review_required") {
      fail(`${rulePath}.predicate`, "approved rule requires an executable predicate");
    }
    return {
      id,
      label: nonEmptyString(item.label, `${rulePath}.label`),
      reviewStatus,
      active,
      predicate,
    };
  });
}

const PROMOTABLE_THESIS_STAGES = THESIS_STAGES.filter(
  (stage): stage is PromotableThesisStage => stage !== "watch",
);

function decodeStageGates(
  value: unknown,
  supportRuleIds: ReadonlySet<string>,
  easingRuleIds: ReadonlySet<string>,
  allRulesById: ReadonlyMap<string, RuleDescriptor>,
  path: string,
): readonly StageGateDescriptor[] {
  const gates = arrayAt(value, path).map((value, index) => {
    const gatePath = `${path}[${index}]`;
    const item = exactRecord(
      value,
      ["targetStage", "requiredLayers", "ruleIds", "minimumRuleMatches", "reviewStatus", "active"],
      gatePath,
    );
    const targetStage = enumAt(item.targetStage, PROMOTABLE_THESIS_STAGES, `${gatePath}.targetStage`);
    const requiredLayers = arrayAt(item.requiredLayers, `${gatePath}.requiredLayers`).map((layer, layerIndex) =>
      enumAt(layer, EVIDENCE_LAYERS, `${gatePath}.requiredLayers[${layerIndex}]`),
    );
    uniqueStrings(requiredLayers, `${gatePath}.requiredLayers`);
    const ruleIds = arrayAt(item.ruleIds, `${gatePath}.ruleIds`).map((id, ruleIndex) =>
      nonEmptyString(id, `${gatePath}.ruleIds[${ruleIndex}]`),
    );
    if (ruleIds.length === 0) fail(`${gatePath}.ruleIds`, "must not be empty");
    uniqueStrings(ruleIds, `${gatePath}.ruleIds`);
    const allowedRuleIds = targetStage === "easing" ? easingRuleIds : supportRuleIds;
    for (const ruleId of ruleIds) {
      if (!allowedRuleIds.has(ruleId)) {
        fail(
          `${gatePath}.ruleIds`,
          targetStage === "easing"
            ? `easing gate may only reference relief/invalidation rule ${ruleId}`
            : `promotion gate may only reference support rule ${ruleId}`,
        );
      }
    }
    const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${gatePath}.reviewStatus`);
    const active = booleanAt(item.active, `${gatePath}.active`);
    validateReviewState(reviewStatus, active, gatePath);
    const minimumRuleMatches = item.minimumRuleMatches === null
      ? null
      : integerInRange(item.minimumRuleMatches, 1, ruleIds.length, `${gatePath}.minimumRuleMatches`);
    if (reviewStatus === "pending" && minimumRuleMatches !== null) {
      fail(`${gatePath}.minimumRuleMatches`, "pending gate must not claim an approved threshold");
    }
    if (reviewStatus === "approved" && minimumRuleMatches === null) {
      fail(`${gatePath}.minimumRuleMatches`, "approved gate requires a rule threshold");
    }
    if (reviewStatus === "approved") {
      if (requiredLayers.length === 0) fail(`${gatePath}.requiredLayers`, "approved gate requires evidence layers");
      for (const ruleId of ruleIds) {
        const rule = allRulesById.get(ruleId);
        if (rule?.reviewStatus !== "approved" || !rule.active) {
          fail(`${gatePath}.ruleIds`, `approved gate references pending or inactive rule ${ruleId}`);
        }
      }
      if (targetStage === "weather_realized" && !requiredLayers.includes("weather")) {
        fail(`${gatePath}.requiredLayers`, "weather realization requires weather evidence");
      }
      if (
        targetStage === "market_confirmed"
        && (
          !requiredLayers.includes("market")
          || !requiredLayers.some((layer) => ["weather", "physical", "balance"].includes(layer))
        )
      ) {
        fail(
          `${gatePath}.requiredLayers`,
          "market confirmation requires market and weather/physical/balance attribution evidence",
        );
      }
    }
    return {
      targetStage,
      requiredLayers,
      ruleIds,
      minimumRuleMatches,
      reviewStatus,
      active,
    };
  });
  const targetStages = gates.map(({ targetStage }) => targetStage);
  uniqueStrings(targetStages, `${path}.targetStage`);
  if (
    gates.length !== PROMOTABLE_THESIS_STAGES.length
    || PROMOTABLE_THESIS_STAGES.some((stage) => !targetStages.includes(stage))
  ) {
    fail(path, "must define exactly one gate for every non-watch stage");
  }
  return gates.sort(
    (left, right) => THESIS_STAGES.indexOf(left.targetStage) - THESIS_STAGES.indexOf(right.targetStage),
  );
}

function decodeCoverageGap(value: unknown, path: string): CoverageGap {
  const item = exactRecord(value, ["id", "layer", "description", "blocks"], path);
  const blocks = arrayAt(item.blocks, `${path}.blocks`).map((block, index) =>
    enumAt(
      block,
      ["stage", "confidence", "market_readiness", "publication"] as const,
      `${path}.blocks[${index}]`,
    ),
  );
  if (blocks.length === 0) fail(`${path}.blocks`, "must not be empty");
  uniqueStrings(blocks, `${path}.blocks`);
  return {
    id: nonEmptyString(item.id, `${path}.id`),
    layer: enumAt(item.layer, EVIDENCE_LAYERS, `${path}.layer`),
    description: nonEmptyString(item.description, `${path}.description`),
    blocks,
  };
}

function decodeDirectionPolicy(
  value: unknown,
  ruleIds: ReadonlySet<string>,
  path: string,
): DirectionPolicy {
  const item = exactRecord(value, ["version", "reviewStatus", "active", "mappings"], path);
  const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${path}.reviewStatus`);
  const active = booleanAt(item.active, `${path}.active`);
  validateReviewState(reviewStatus, active, path);
  const mappings = arrayAt(item.mappings, `${path}.mappings`).map((value, index) => {
    const mappingPath = `${path}.mappings[${index}]`;
    const mapping = exactRecord(value, ["ruleId", "direction"], mappingPath);
    const ruleId = nonEmptyString(mapping.ruleId, `${mappingPath}.ruleId`);
    if (!ruleIds.has(ruleId)) fail(`${mappingPath}.ruleId`, `unknown rule ${ruleId}`);
    return {
      ruleId,
      direction: mapping.direction === null
        ? null
        : enumAt(mapping.direction, THESIS_DIRECTIONS, `${mappingPath}.direction`),
    };
  });
  const mappedRuleIds = mappings.map(({ ruleId }) => ruleId);
  uniqueStrings(mappedRuleIds, `${path}.mappings.ruleId`);
  if (mappedRuleIds.length !== ruleIds.size || [...ruleIds].some((ruleId) => !mappedRuleIds.includes(ruleId))) {
    fail(`${path}.mappings`, "must define exactly one mapping for every thesis rule");
  }
  if (reviewStatus === "pending" && mappings.some(({ direction }) => direction !== null)) {
    fail(`${path}.mappings`, "pending direction policy must not claim reviewed directions");
  }
  if (reviewStatus === "approved" && mappings.every(({ direction }) => direction === null)) {
    fail(`${path}.mappings`, "approved direction policy requires at least one resolved direction");
  }
  return {
    version: nonEmptyString(item.version, `${path}.version`),
    reviewStatus,
    active,
    mappings,
  };
}

function nullableScore(value: unknown, path: string): number | null {
  return value === null ? null : integerInRange(value, 0, 100, path);
}

function decodeConfidencePolicy(value: unknown, path: string): ConfidencePolicy {
  const item = exactRecord(
    value,
    [
      "version",
      "reviewStatus",
      "active",
      "lateFreshnessScore",
      "sourceTierScores",
      "missingRequiredLayerCap",
      "coverageGapCap",
    ],
    path,
  );
  const reviewStatus = enumAt(item.reviewStatus, RULE_REVIEW_STATUSES, `${path}.reviewStatus`);
  const active = booleanAt(item.active, `${path}.active`);
  validateReviewState(reviewStatus, active, path);
  const sourceTierScores = exactRecord(item.sourceTierScores, ["A", "B", "C"], `${path}.sourceTierScores`);
  const decodedTierScores = {
    A: nullableScore(sourceTierScores.A, `${path}.sourceTierScores.A`),
    B: nullableScore(sourceTierScores.B, `${path}.sourceTierScores.B`),
    C: nullableScore(sourceTierScores.C, `${path}.sourceTierScores.C`),
  };
  const lateFreshnessScore = nullableScore(item.lateFreshnessScore, `${path}.lateFreshnessScore`);
  const missingRequiredLayerCap = nullableScore(
    item.missingRequiredLayerCap,
    `${path}.missingRequiredLayerCap`,
  );
  const coverageGapCap = nullableScore(item.coverageGapCap, `${path}.coverageGapCap`);
  if (
    reviewStatus === "pending"
    && (
      lateFreshnessScore !== null
      || Object.values(decodedTierScores).some((score) => score !== null)
      || missingRequiredLayerCap !== null
      || coverageGapCap !== null
    )
  ) {
    fail(path, "pending confidence policy must not claim reviewed scores or additional caps");
  }
  if (
    reviewStatus === "approved"
    && (lateFreshnessScore === null || Object.values(decodedTierScores).some((score) => score === null))
  ) {
    fail(path, "approved confidence policy requires late freshness and all source-tier scores");
  }
  return {
    version: nonEmptyString(item.version, `${path}.version`),
    reviewStatus,
    active,
    lateFreshnessScore,
    sourceTierScores: decodedTierScores,
    missingRequiredLayerCap,
    coverageGapCap,
  };
}

export function decodeThesisSeed(value: unknown): ThesisSeed {
  const item = exactRecord(value, EXACT_SEED_KEYS, "seed");
  const requiredEvidenceLayers = arrayAt(item.requiredEvidenceLayers, "seed.requiredEvidenceLayers").map(
    (layer, index) => enumAt(layer, EVIDENCE_LAYERS, `seed.requiredEvidenceLayers[${index}]`),
  );
  if (requiredEvidenceLayers.length === 0) fail("seed.requiredEvidenceLayers", "must not be empty");
  uniqueStrings(requiredEvidenceLayers, "seed.requiredEvidenceLayers");

  const indicatorSelectors = arrayAt(item.indicatorSelectors, "seed.indicatorSelectors").map((selector, index) =>
    decodeSelector(selector, `seed.indicatorSelectors[${index}]`),
  );
  const selectorIds = indicatorSelectors.map((selector) => selector.id);
  uniqueStrings(selectorIds, "seed.indicatorSelectors.id");
  uniqueStrings(
    indicatorSelectors.map((selector) => selector.indicatorId),
    "seed.indicatorSelectors.indicatorId",
  );
  const selectorIdSet = new Set(selectorIds);

  const freshnessSlos = arrayAt(item.freshnessSlos, "seed.freshnessSlos").map((slo, index) =>
    decodeFreshnessSlo(slo, selectorIdSet, `seed.freshnessSlos[${index}]`),
  );
  uniqueStrings(freshnessSlos.map((slo) => slo.selectorId), "seed.freshnessSlos.selectorId");
  if (freshnessSlos.length !== indicatorSelectors.length) {
    fail("seed.freshnessSlos", "must define exactly one SLO for every selector");
  }

  const seenRuleIds = new Set<string>();
  const supportRules = decodeRules(item.supportRules, selectorIdSet, seenRuleIds, "seed.supportRules");
  const refuteRules = decodeRules(item.refuteRules, selectorIdSet, seenRuleIds, "seed.refuteRules");
  const invalidationRules = decodeRules(
    item.invalidationRules,
    selectorIdSet,
    seenRuleIds,
    "seed.invalidationRules",
  );
  const reliefRules = decodeRules(item.reliefRules, selectorIdSet, seenRuleIds, "seed.reliefRules");
  const allRules = [...supportRules, ...refuteRules, ...invalidationRules, ...reliefRules];
  const stageGates = decodeStageGates(
    item.stageGates,
    new Set(supportRules.map(({ id }) => id)),
    new Set([...invalidationRules, ...reliefRules].map(({ id }) => id)),
    new Map(allRules.map((rule) => [rule.id, rule] as const)),
    "seed.stageGates",
  );
  const directionPolicy = decodeDirectionPolicy(
    item.directionPolicy,
    new Set(allRules.map(({ id }) => id)),
    "seed.directionPolicy",
  );
  const confidencePolicy = decodeConfidencePolicy(item.confidencePolicy, "seed.confidencePolicy");

  const threshold = exactRecord(
    item.materialChangeThresholds,
    ["reviewStatus", "active", "confidenceDeltaPoints", "observationRevisionDelta"],
    "seed.materialChangeThresholds",
  );
  const thresholdReviewStatus = enumAt(
    threshold.reviewStatus,
    RULE_REVIEW_STATUSES,
    "seed.materialChangeThresholds.reviewStatus",
  );
  const thresholdActive = booleanAt(threshold.active, "seed.materialChangeThresholds.active");
  validateReviewState(thresholdReviewStatus, thresholdActive, "seed.materialChangeThresholds");
  const confidenceDeltaPoints = nullableConfidenceDelta(
    threshold.confidenceDeltaPoints,
    "seed.materialChangeThresholds.confidenceDeltaPoints",
  );
  const observationRevisionDelta = nullablePositiveNumber(
    threshold.observationRevisionDelta,
    "seed.materialChangeThresholds.observationRevisionDelta",
  );
  if (thresholdReviewStatus === "pending" && (confidenceDeltaPoints !== null || observationRevisionDelta !== null)) {
    fail("seed.materialChangeThresholds", "pending thresholds must be null");
  }
  if (thresholdReviewStatus === "approved" && (confidenceDeltaPoints === null || observationRevisionDelta === null)) {
    fail("seed.materialChangeThresholds", "approved thresholds must be defined");
  }

  const template = exactRecord(
    item.templateCopy,
    ["summary", "invalidation", "coverageGap"],
    "seed.templateCopy",
  );
  const coverageGaps = arrayAt(item.coverageGaps, "seed.coverageGaps").map((gap, index) =>
    decodeCoverageGap(gap, `seed.coverageGaps[${index}]`),
  );
  const gapIds = coverageGaps.map((gap) => gap.id);
  uniqueStrings(gapIds, "seed.coverageGaps.id");

  const selectorLayers = new Set(indicatorSelectors.map((selector) => selector.layer));
  const gapLayers = new Set(coverageGaps.map((gap) => gap.layer));
  for (const layer of requiredEvidenceLayers) {
    if (!selectorLayers.has(layer) && !gapLayers.has(layer)) {
      fail("seed.requiredEvidenceLayers", `${layer} has neither selector nor coverage gap`);
    }
    if (!selectorLayers.has(layer)) {
      const hasBlockingGap = coverageGaps.some(
        (gap) => gap.layer === layer && gap.blocks.includes("stage") && gap.blocks.includes("confidence"),
      );
      if (!hasBlockingGap) {
        fail("seed.requiredEvidenceLayers", `${layer} coverage gap must block stage and confidence`);
      }
    }
  }
  for (const gate of stageGates) {
    for (const layer of gate.requiredLayers) {
      if (!requiredEvidenceLayers.includes(layer)) {
        fail(
          "seed.stageGates",
          `${gate.targetStage} layer ${layer} must be declared in requiredEvidenceLayers`,
        );
      }
      const hasStageBlockingGap = coverageGaps.some(
        (gap) => gap.layer === layer && gap.blocks.includes("stage"),
      );
      if (!selectorLayers.has(layer) && !hasStageBlockingGap) {
        fail(
          "seed.stageGates",
          `${gate.targetStage} layer ${layer} has neither selector nor stage-blocking coverage gap`,
        );
      }
    }
  }

  const readiness = exactRecord(
    item.readiness,
    ["reviewStatus", "productionEvaluation", "publication", "marketEvidenceReady", "blockingGapIds"],
    "seed.readiness",
  );
  const readinessReviewStatus = enumAt(
    readiness.reviewStatus,
    RULE_REVIEW_STATUSES,
    "seed.readiness.reviewStatus",
  );
  const blockingGapIds = arrayAt(readiness.blockingGapIds, "seed.readiness.blockingGapIds").map((id, index) =>
    nonEmptyString(id, `seed.readiness.blockingGapIds[${index}]`),
  );
  uniqueStrings(blockingGapIds, "seed.readiness.blockingGapIds");
  for (const id of blockingGapIds) if (!gapIds.includes(id)) fail("seed.readiness.blockingGapIds", `unknown gap ${id}`);
  const blockingGapIdSet = new Set(blockingGapIds);
  for (const id of gapIds) {
    if (!blockingGapIdSet.has(id)) {
      fail("seed.readiness.blockingGapIds", `coverage gap ${id} must block readiness`);
    }
  }
  const productionEvaluation = booleanAt(
    readiness.productionEvaluation,
    "seed.readiness.productionEvaluation",
  );
  const publication = booleanAt(readiness.publication, "seed.readiness.publication");
  const marketEvidenceReady = booleanAt(readiness.marketEvidenceReady, "seed.readiness.marketEvidenceReady");
  if (readinessReviewStatus === "pending" && (productionEvaluation || publication)) {
    fail("seed.readiness", "pending seed cannot be production-ready or publishable");
  }
  if (coverageGaps.length > 0 && blockingGapIds.length === 0) {
    fail("seed.readiness.blockingGapIds", "coverage gaps require a blocking readiness reference");
  }
  const missingMarketEvidence = requiredEvidenceLayers.includes("market")
    && (!selectorLayers.has("market") || coverageGaps.some((gap) => gap.layer === "market"));
  if (missingMarketEvidence && marketEvidenceReady) {
    fail("seed.readiness.marketEvidenceReady", "market layer is missing or has a coverage gap");
  }

  const id = nonEmptyString(item.id, "seed.id");
  const defaultDirection = enumAt(item.defaultDirection, THESIS_DIRECTIONS, "seed.defaultDirection");
  if (id === "SHIP-EU-01" && defaultDirection !== "mixed") {
    fail("seed.defaultDirection", "SHIP-EU-01 must default to mixed");
  }
  if (
    id === "SHIP-EU-01"
    && indicatorSelectors.some(
      (selector) => selector.indicatorId === "regional_rainfall_panama_canal_catchment_v1",
    )
  ) {
    fail("seed.indicatorSelectors", "SHIP-EU-01 must not inherit Panama evidence");
  }

  return deepFreeze({
    id,
    slug: nonEmptyString(item.slug, "seed.slug"),
    title: nonEmptyString(item.title, "seed.title"),
    category: enumAt(item.category, THESIS_CATEGORIES, "seed.category"),
    region: nonEmptyString(item.region, "seed.region"),
    marketScope: nonEmptyString(item.marketScope, "seed.marketScope"),
    methodologyVersion: nonEmptyString(item.methodologyVersion, "seed.methodologyVersion"),
    regionDefinitionVersion: nonEmptyString(
      item.regionDefinitionVersion,
      "seed.regionDefinitionVersion",
    ),
    target: nonEmptyString(item.target, "seed.target"),
    timeHorizon: nonEmptyString(item.timeHorizon, "seed.timeHorizon"),
    defaultDirection,
    requiredEvidenceLayers,
    indicatorSelectors,
    freshnessSlos,
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    stageGates,
    directionPolicy,
    confidencePolicy,
    materialChangeThresholds: {
      reviewStatus: thresholdReviewStatus,
      active: thresholdActive,
      confidenceDeltaPoints,
      observationRevisionDelta,
    },
    templateCopy: {
      summary: nonEmptyString(template.summary, "seed.templateCopy.summary"),
      invalidation: nonEmptyString(template.invalidation, "seed.templateCopy.invalidation"),
      coverageGap: nonEmptyString(template.coverageGap, "seed.templateCopy.coverageGap"),
    },
    coverageGaps,
    readiness: {
      reviewStatus: readinessReviewStatus,
      productionEvaluation,
      publication,
      marketEvidenceReady,
      blockingGapIds,
    },
  });
}

export function decodeThesisSeeds(value: unknown): readonly ThesisSeed[] {
  const seeds = arrayAt(value, "seeds").map((seed) => decodeThesisSeed(seed));
  if (seeds.length !== 6) fail("seeds", "must contain exactly six initial theses");
  uniqueStrings(seeds.map((seed) => seed.id), "seeds.id");
  uniqueStrings(seeds.map((seed) => seed.slug), "seeds.slug");
  return deepFreeze(seeds);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// The decoder owns the trust boundary. Exported constants are decoded copies, not the mutable input.
export const PENDING_REVIEW = { reviewStatus: "pending", active: false } as const;

/**
 * D 组 D3 签字（2026-09-24）：selectors 转 approved/active。权重 0–100 整数按层给出；
 * control 层（控制变量）权重 0：参与解释与门禁，不参与方向计算。
 */
export function approvedSelector(
  id: string, indicatorId: EvaluationIndicatorId, layer: EvidenceLayer,
  defaultStance: EvidenceStance, notes: string,
): IndicatorSelector {
  const weightByLayer: Record<EvidenceLayer, number> = {
    market: 100, physical: 80, balance: 70, weather: 60, forecast: 50, control: 0,
  };
  return {
    id, indicatorId, layer, defaultStance,
    weight: weightByLayer[layer], reviewStatus: "approved", active: true, notes,
  };
}

/**
 * D 组 D3 签字：规则 approved/active。第一版用 `selector_present`（可执行、不虚构数值阈值）；
 * 数值阈值作为 D3 第二批升级为 numeric_compare。解码器禁止 approved 使用 manual_review_required。
 */
export function approvedRule(
  id: string, label: string, reason: string, selectorIds: readonly string[],
): RuleDescriptor {
  return {
    id, label, reviewStatus: "approved", active: true,
    predicate: { kind: "selector_present", selectorIds: [...selectorIds], minimumMatches: 1 },
  };
}

/**
 * D 组 D4 签字：阶段门槛 approved/active，minimumRuleMatches=1（落在 1..ruleIds.length）。
 * 例外（方案 A，2026-09-24 负责人确认）：该论点若**没有 market 层证据**，
 * `market_confirmed` 门槛保持 pending/inactive —— 不主张无法归因的市场确认阶段。
 */
export function approvedStageGates(
  supportRuleId: string,
  easingRuleIds: readonly string[],
  requiredLayers: Readonly<Record<PromotableThesisStage, readonly EvidenceLayer[]>>,
): readonly StageGateDescriptor[] {
  return PROMOTABLE_THESIS_STAGES.map((targetStage) => {
    const ruleIds = targetStage === "easing" ? [...easingRuleIds] : [supportRuleId];
    const layers = [...requiredLayers[targetStage]];
    const unprovableMarketGate = targetStage === "market_confirmed" && !layers.includes("market");
    return {
      targetStage,
      requiredLayers: layers,
      ruleIds,
      minimumRuleMatches: unprovableMarketGate ? null : Math.min(1, ruleIds.length),
      reviewStatus: unprovableMarketGate ? "pending" : "approved",
      active: !unprovableMarketGate,
    };
  });
}

export function pendingSelector(
  id: string,
  indicatorId: EvaluationIndicatorId,
  layer: EvidenceLayer,
  defaultStance: EvidenceStance,
  notes: string,
): IndicatorSelector {
  return { id, indicatorId, layer, defaultStance, weight: 0, ...PENDING_REVIEW, notes };
}

/**
 * 已通过 D 组研究审核（2026-09-22 负责人签字）的 freshness SLO：
 * 逐层新鮮度上限（分钟）。刚刚过期的阈值仍按层所属的发布节律（日/周/月）取宽值。
 */
export function approvedSlo(selectorId: string, maxAgeMinutes: number): FreshnessSlo {
  return { selectorId, maxAgeMinutes, reviewStatus: "approved", active: true };
}

export function pendingSlo(selectorId: string): FreshnessSlo {
  return { selectorId, maxAgeMinutes: null, ...PENDING_REVIEW };
}

export function pendingRule(id: string, label: string, reason: string): RuleDescriptor {
  return {
    id,
    label,
    ...PENDING_REVIEW,
    predicate: { kind: "manual_review_required", reason },
  };
}

export function pendingStageGates(
  supportRuleId: string,
  easingRuleIds: readonly string[],
  requiredLayers: Readonly<Record<PromotableThesisStage, readonly EvidenceLayer[]>>,
): readonly StageGateDescriptor[] {
  return PROMOTABLE_THESIS_STAGES.map((targetStage) => ({
    targetStage,
    requiredLayers: [...requiredLayers[targetStage]],
    ruleIds: targetStage === "easing" ? [...easingRuleIds] : [supportRuleId],
    minimumRuleMatches: null,
    ...PENDING_REVIEW,
  }));
}

/**
 * D 组 D5 签字（2026-09-24 负责人确认）：方向策略 approved/active。
 * 支撑→偏多；证伪/缓解→偏空；失效规则不主张方向（null）。未审核策略仍 fail-closed。
 */
export function approvedDirectionPolicy(ruleIds: readonly string[]): DirectionPolicy {
  return {
    version: "direction-v1",
    reviewStatus: "approved",
    active: true,
    mappings: ruleIds.map((ruleId) => ({
      ruleId,
      direction: ruleId.endsWith("-support")
        ? "bullish"
        : ruleId.endsWith("-refute") || ruleId.endsWith("-relief")
          ? "bearish"
          : null,
    })),
  };
}

/** D5 签字：置信度策略 approved/active，上限沿用一页纸口径（仅预测 49 / 必需层过期 59 / 覆盖缺口 69）。 */
export const APPROVED_CONFIDENCE_POLICY: ConfidencePolicy = {
  version: "confidence-v1",
  reviewStatus: "approved",
  active: true,
  lateFreshnessScore: 59,
  sourceTierScores: { A: 100, B: 85, C: 70 },
  missingRequiredLayerCap: 49,
  coverageGapCap: 69,
};

export function pendingDirectionPolicy(ruleIds: readonly string[]): DirectionPolicy {
  return {
    version: "direction-v1-pending-review",
    ...PENDING_REVIEW,
    mappings: ruleIds.map((ruleId) => ({ ruleId, direction: null })),
  };
}

export const PENDING_CONFIDENCE_POLICY: ConfidencePolicy = {
  version: "confidence-v1-pending-review",
  ...PENDING_REVIEW,
  lateFreshnessScore: null,
  sourceTierScores: { A: null, B: null, C: null },
  missingRequiredLayerCap: null,
  coverageGapCap: null,
};

export const EMPTY_PENDING_THRESHOLDS = {
  ...PENDING_REVIEW,
  confidenceDeltaPoints: null,
  observationRevisionDelta: null,
} as const satisfies MaterialChangeThresholds;
