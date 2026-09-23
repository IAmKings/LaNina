import { describe, expect, it } from "vitest";

import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type {
  EvidenceLayer,
  EvidenceSelectionResult,
  SelectedEvidence,
  StageGateResult,
} from "./evaluation";
import { selectEvidence } from "./evidence-selector";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import { evaluateStageGates } from "./stage-gate";
import { decodeThesisSeed } from "./thesis-seeds";
import type {
  EvaluationIndicatorId,
  IndicatorSelector,
  RuleDescriptor,
  ThesisSeed,
} from "./thesis-seeds";

const CUTOFF = "2026-09-08T12:00:00.000Z";

describe("evaluateDirectionAndConfidence", () => {
  it("calculates all four components with fixed 30/25/25/20 weights and half-up rounding", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support", "physical", "balance", "market", "control"], {
      physical: { freshness: "late", sourceHealth: "delayed", sourceTier: "B" },
      balance: { sourceTier: "C" },
      control: { sourceTier: "C" },
    });
    const stage = evaluateStageGates(seed, selected, {
      previousStage: "balance_tightening",
    });

    const result = evaluateDirectionAndConfidence(seed, selected, stage);

    expect(result.confidence.components).toEqual({
      coverage: 100,
      freshness: 72,
      sourceQuality: 83,
      agreement: 100,
    });
    expect(result.confidence.weightedScore).toBe(89);
    expect(result.confidence.finalScore).toBe(89);
    expect(result.direction.direction).toBe("bullish");
    expect(result).toMatchSnapshot();
  });

  it("treats support-only and refute-only evidence symmetrically", () => {
    const seed = reviewedSeed();
    const supportSelection = selection(seed, ["weather-support"]);
    const refuteSelection = selection(seed, ["weather-refute"]);
    const support = evaluateDirectionAndConfidence(
      seed,
      supportSelection,
      evaluateStageGates(seed, supportSelection, { previousStage: "watch" }),
    );
    const refute = evaluateDirectionAndConfidence(
      seed,
      refuteSelection,
      evaluateStageGates(seed, refuteSelection, { previousStage: "watch" }),
    );

    expect(support.direction.direction).toBe("bullish");
    expect(refute.direction.direction).toBe("bearish");
    expect(support.confidence.components.agreement).toBe(100);
    expect(refute.confidence.components.agreement).toBe(100);
    expect({ support, refute }).toMatchSnapshot();
  });

  it("resolves balanced conflicting directions to mixed and applies the unexplained conflict cap", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support", "weather-refute"]);
    const result = evaluateDirectionAndConfidence(
      seed,
      selected,
      evaluateStageGates(seed, selected, { previousStage: "watch" }),
    );

    expect(result.direction.direction).toBe("mixed");
    expect(result.direction.matchedDirections).toEqual(["bullish", "bearish"]);
    expect(result.confidence.components.agreement).toBe(0);
    expect(result.confidence.appliedCaps).toContainEqual(expect.objectContaining({
      code: "UNEXPLAINED_CONFLICT",
      maximum: 69,
    }));
    expect(result).toMatchSnapshot();
  });

  it("keeps context/control evidence visible without turning it into a direction", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["control"]);
    const result = evaluateDirectionAndConfidence(
      seed,
      selected,
      evaluateStageGates(seed, selected, { previousStage: "watch" }),
    );

    expect(result.direction.direction).toBe("neutral");
    expect(result.direction.status).toBe("unavailable");
    expect(result.direction.ruleHits).toEqual([]);
    expect(result.direction.ruleRejections).toContainEqual(expect.objectContaining({
      ruleId: "invalidate-control",
      code: "CONTEXT_ONLY",
    }));
    expect(result.confidence.components.agreement).toBe(0);
    expect(result.confidence.explanations.agreement.ignoredContextEvidenceIds).toEqual([
      "evidence-control-current",
    ]);
    expect(result).toMatchSnapshot();
  });

  it("requires every selector in a compound direction rule to have the rule category stance", () => {
    const base = reviewedSeed();
    const seed = {
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "support-weather"
        ? presentRule("support-weather", ["weather-support", "control"])
        : rule),
    };
    const selected = selection(seed, ["weather-support", "control"]);
    const result = evaluateDirectionAndConfidence(
      seed,
      selected,
      evaluateStageGates(seed, selected, { previousStage: "watch" }),
    );

    expect(result.direction.ruleHits).not.toContainEqual(expect.objectContaining({
      ruleId: "support-weather",
    }));
    expect(result.direction.ruleRejections).toContainEqual(expect.objectContaining({
      ruleId: "support-weather",
      code: "CONTEXT_ONLY",
    }));
  });

  it("does not let a support rule consume refutes evidence or an unresolved hit look available", () => {
    const base = reviewedSeed();
    const wrongStanceSeed = {
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "support-weather"
        ? presentRule("support-weather", ["weather-refute"])
        : rule),
    };
    const wrongStanceSelection = selection(wrongStanceSeed, ["weather-refute"]);
    const wrongStance = evaluateDirectionAndConfidence(
      wrongStanceSeed,
      wrongStanceSelection,
      evaluateStageGates(wrongStanceSeed, wrongStanceSelection, { previousStage: "watch" }),
    );
    expect(wrongStance.direction.ruleRejections).toContainEqual(expect.objectContaining({
      ruleId: "support-weather",
      code: "CONTEXT_ONLY",
    }));

    const unresolvedSeed = {
      ...base,
      directionPolicy: {
        ...base.directionPolicy,
        mappings: base.directionPolicy.mappings.map((mapping) => mapping.ruleId === "support-weather"
          ? { ...mapping, direction: null }
          : mapping),
      },
    };
    const unresolvedSelection = selection(unresolvedSeed, ["weather-support"]);
    const unresolved = evaluateDirectionAndConfidence(
      unresolvedSeed,
      unresolvedSelection,
      evaluateStageGates(unresolvedSeed, unresolvedSelection, { previousStage: "watch" }),
    );
    expect(unresolved.direction).toMatchObject({
      status: "unavailable",
      direction: "neutral",
    });
    expect(unresolved.direction.ruleRejections).toContainEqual(expect.objectContaining({
      ruleId: "support-weather",
      code: "UNRESOLVED_DIRECTION",
    }));
    expect({ wrongStance, unresolved }).toMatchSnapshot();
  });

  it("applies forecast-only 49, required-layer stale 59 and strictest multiple reviewed caps", () => {
    const base = reviewedSeed();
    const forecastSelection = selection(base, ["forecast"]);
    const forecast = evaluateDirectionAndConfidence(
      base,
      forecastSelection,
      evaluateStageGates(base, forecastSelection, { previousStage: "watch" }),
    );
    expect(forecast.confidence.appliedCaps).toContainEqual(expect.objectContaining({
      code: "FORECAST_ONLY",
      maximum: 49,
    }));
    expect(forecast.confidence.finalScore).toBe(49);

    const seed = reviewedSeed({
      confidencePolicy: {
        ...base.confidencePolicy,
        missingRequiredLayerCap: 40,
        coverageGapCap: 35,
      },
      coverageGaps: [{
        id: "test-control-gap",
        layer: "control",
        description: "test-only reviewed gap",
        blocks: ["confidence", "publication"],
      }],
      readiness: { ...base.readiness, blockingGapIds: ["test-control-gap"] },
    });
    const cappedSelection = selection(seed, ["forecast", "weather-refute"], {
      staleSelectorIds: ["market"],
    });
    const capped = evaluateDirectionAndConfidence(
      seed,
      cappedSelection,
      evaluateStageGates(seed, cappedSelection, { previousStage: "watch" }),
    );
    expect(capped.confidence.appliedCaps.map(({ code, maximum }) => ({ code, maximum }))).toEqual([
      { code: "COVERAGE_GAP", maximum: 35 },
      { code: "MISSING_REQUIRED_LAYER", maximum: 40 },
      { code: "REQUIRED_LAYER_STALE", maximum: 59 },
      { code: "UNEXPLAINED_CONFLICT", maximum: 69 },
    ]);
    expect(capped.confidence.finalScore).toBe(35);
    expect({ forecast, capped }).toMatchSnapshot();
  });

  it("treats support/refute contradiction from one source as unexplained and excludes control from agreement", () => {
    const base = reviewedSeed();
    const sharedSource = "source-with-conflicting-observations";
    const support = selected(base, "weather-support", { sourceId: sharedSource });
    const refute = selected(base, "weather-refute", { sourceId: sharedSource });
    const contradictory = selectionFromEvidence(base, [support, refute]);
    const contradictionResult = evaluateDirectionAndConfidence(
      base,
      contradictory,
      evaluateStageGates(base, contradictory, { previousStage: "watch" }),
    );
    expect(contradictionResult.confidence.appliedCaps).toContainEqual(expect.objectContaining({
      code: "UNEXPLAINED_CONFLICT",
      maximum: 69,
    }));

    const controlAsSupportSeed = {
      ...base,
      indicatorSelectors: base.indicatorSelectors.map((selector) => selector.id === "control"
        ? { ...selector, defaultStance: "supports" as const }
        : selector),
    };
    const controlOnly = selection(controlAsSupportSeed, ["control"]);
    const controlResult = evaluateDirectionAndConfidence(
      controlAsSupportSeed,
      controlOnly,
      evaluateStageGates(controlAsSupportSeed, controlOnly, { previousStage: "watch" }),
    );
    expect(controlResult.confidence.components.agreement).toBe(0);
    expect(controlResult.confidence.explanations.agreement.supportEvidenceIds).toEqual([]);
    expect(controlResult.confidence.explanations.agreement.ignoredContextEvidenceIds).toEqual([
      "evidence-control-current",
    ]);
  });

  it("keeps a price-only result at watch without inventing a numeric price cap", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["market"]);
    const stage = evaluateStageGates(seed, selected, { previousStage: "watch" });
    const result = evaluateDirectionAndConfidence(seed, selected, stage);

    expect(result.stage).toBe("watch");
    expect(result.confidence.appliedCaps).not.toContainEqual(expect.objectContaining({ code: "PRICE_ONLY" }));
    expect(result).toMatchSnapshot();
  });

  it("returns explainable unavailable zero-safe results for all six pending production seeds", () => {
    const results = INITIAL_THESIS_SEEDS.map((seed) => {
      const selected = selection(seed, []);
      return evaluateDirectionAndConfidence(
        seed,
        selected,
        evaluateStageGates(seed, selected, { previousStage: "watch" }),
      );
    });

    expect(results).toHaveLength(6);
    expect(results.every(({ direction, confidence }) =>
      direction.status === "unavailable"
      && confidence.status === "unavailable"
      && confidence.finalScore === 0,
    )).toBe(true);
    expect(results.find(({ thesisId }) => thesisId === "SHIP-EU-01")?.direction.direction).toBe("mixed");
    expect(results.every(({ direction }) =>
      direction.ruleHits.length === 0 && direction.ruleRejections.length === 4,
    )).toBe(true);
    expect(results).toMatchSnapshot();
  });

  it("uses only the latest observation per selector and is input-order deterministic", () => {
    const seed = reviewedSeed();
    const current = selected(seed, "weather-support");
    const historical = selected(seed, "weather-support", {
      evidenceId: "evidence-weather-support-historical",
      observationId: "observation-weather-support-historical",
      observedAt: "2026-09-07T11:30:00.000Z",
      publishedAt: "2026-09-07T11:40:00.000Z",
      fetchedAt: "2026-09-07T11:55:00.000Z",
      sourceTier: "C",
    });
    const forward = selectionFromEvidence(seed, [historical, current]);
    const reverse = selectionFromEvidence(seed, [current, historical]);
    const forwardResult = evaluateDirectionAndConfidence(
      seed,
      forward,
      evaluateStageGates(seed, forward, { previousStage: "watch" }),
    );
    const reverseResult = evaluateDirectionAndConfidence(
      seed,
      reverse,
      evaluateStageGates(seed, reverse, { previousStage: "watch" }),
    );

    expect(forwardResult).toEqual(reverseResult);
    expect(forwardResult.confidence.explanations.sourceQuality.currentEvidenceIds).toEqual([
      "evidence-weather-support-current",
    ]);
    expect(Object.isFrozen(forwardResult)).toBe(true);
    expect(Object.isFrozen(forwardResult.confidence.explanations.agreement)).toBe(true);
    expect(() => JSON.stringify(forwardResult)).not.toThrow();
  });

  it("fails closed when the stage result belongs to a different selection cutoff", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support"]);
    const validStage = evaluateStageGates(seed, selected, { previousStage: "watch" });
    const mismatchedStage = { ...validStage, cutoff: "2026-09-08T11:59:59.000Z" } as StageGateResult;

    const result = evaluateDirectionAndConfidence(seed, selected, mismatchedStage);

    expect(result.stage).toBe("watch");
    expect(result.direction.status).toBe("unavailable");
    expect(result.direction.ruleHits).toEqual([]);
    expect(result.confidence.status).toBe("unavailable");
    expect(result.confidence.finalScore).toBe(0);
    expect(result).toMatchSnapshot();
  });

  it("fails closed when callers forge selector rejections or stage gate details", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support"]);
    const stage = evaluateStageGates(seed, selected, { previousStage: "watch" });
    const forgedRejections = {
      ...selected,
      rejectedEvidence: selected.rejectedEvidence.filter(({ selectorId }) => selectorId !== "market"),
    };
    const forgedCheck = {
      ...stage,
      checks: stage.checks.map((check) => check.targetStage === "weather_realized"
        ? { ...check, requiredLayers: [] }
        : check),
    } as StageGateResult;

    for (const [selectionInput, stageInput] of [
      [forgedRejections, stage],
      [selected, forgedCheck],
    ] as const) {
      const result = evaluateDirectionAndConfidence(seed, selectionInput, stageInput);
      expect(result).toMatchObject({
        stage: "watch",
        direction: { status: "unavailable", ruleHits: [] },
        confidence: { status: "unavailable", finalScore: 0 },
      });
    }
  });

  it("does not trust a bare manualConfirmationApplied boolean at the evaluation boundary", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support", "physical", "balance", "market"]);
    const manualStage = evaluateStageGates(seed, selected, {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: "reviewer@example.com", reason: "reviewed test skip" },
    });
    expect(manualStage.manualConfirmationApplied).toBe(true);

    const result = evaluateDirectionAndConfidence(seed, selected, manualStage);

    expect(result).toMatchObject({
      stage: "watch",
      direction: { status: "unavailable", ruleHits: [] },
      confidence: { status: "unavailable", finalScore: 0 },
    });
    expect(result.direction.reasons.join("\n")).toContain("manualConfirmationApplied");
  });
});

function reviewedSeed(overrides: Partial<ThesisSeed> = {}): ThesisSeed {
  const selectors = [
    selector("forecast", "enso_roni_ersstv6", "forecast", "supports", 20),
    selector("weather-support", "regional_rainfall_southern_thailand_rubber_v1", "weather", "supports", 30),
    selector("weather-refute", "regional_rainfall_maritime_continent_palm_v1", "weather", "refutes", 30),
    selector("physical", "usda_psd_malaysia_palm_oil_production_1000mt", "physical", "supports", 20),
    selector("balance", "usda_psd_malaysia_palm_oil_ending_stocks_1000mt", "balance", "supports", 20),
    selector("market", "eia_europe_brent_spot_usd_per_bbl_daily", "market", "supports", 30),
    selector("control", "usda_psd_malaysia_palm_oil_exports_1000mt", "control", "context", 100),
  ];
  const supportRules = [
    presentRule("support-weather", ["weather-support"]),
    presentRule("support-physical", ["physical"]),
    presentRule("support-balance", ["balance"]),
    presentRule("support-market", ["market"]),
    presentRule("support-forecast", ["forecast"]),
  ];
  const refuteRules = [presentRule("refute-weather", ["weather-refute"])];
  const invalidationRules = [presentRule("invalidate-control", ["control"])];
  const reliefRules = [numericRule("relief-weather", "weather-refute", "lt", 0)];
  const allRules = [...supportRules, ...refuteRules, ...invalidationRules, ...reliefRules];
  const base = decodeThesisSeed({
    id: "TEST-01",
    slug: "test-thesis",
    title: "Test reviewed thesis",
    category: "agriculture",
    region: "test-region",
    marketScope: "test scoped market",
    methodologyVersion: "test-reviewed-v1",
    regionDefinitionVersion: "test-region-v1",
    target: "test scoped target",
    timeHorizon: "next test horizon",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["forecast", "weather", "physical", "balance", "market", "control"],
    indicatorSelectors: selectors,
    freshnessSlos: selectors.map(({ id }) => ({
      selectorId: id,
      maxAgeMinutes: 180,
      reviewStatus: "approved",
      active: true,
    })),
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    stageGates: [
      gate("weather_realized", ["weather"], ["support-weather"]),
      gate("physical_pressure", ["weather", "physical"], ["support-physical"]),
      gate("balance_tightening", ["weather", "physical", "balance"], ["support-balance"]),
      gate("market_confirmed", ["weather", "physical", "balance", "market"], ["support-market"]),
      gate("easing", ["weather", "physical"], ["relief-weather"]),
    ],
    directionPolicy: {
      version: "test-direction-v1",
      reviewStatus: "approved",
      active: true,
      mappings: allRules.map(({ id }) => ({
        ruleId: id,
        direction: id.startsWith("support") ? "bullish" : id.startsWith("refute") ? "bearish" : "neutral",
      })),
    },
    confidencePolicy: {
      version: "test-confidence-v1",
      reviewStatus: "approved",
      active: true,
      lateFreshnessScore: 60,
      sourceTierScores: { A: 100, B: 80, C: 50 },
      missingRequiredLayerCap: null,
      coverageGapCap: null,
    },
    materialChangeThresholds: {
      reviewStatus: "approved",
      active: true,
      confidenceDeltaPoints: 10,
      observationRevisionDelta: 1,
    },
    templateCopy: { summary: "test", invalidation: "test", coverageGap: "test" },
    coverageGaps: [],
    readiness: {
      reviewStatus: "approved",
      productionEvaluation: false,
      publication: false,
      marketEvidenceReady: true,
      blockingGapIds: [],
    },
  });
  return { ...base, ...overrides };
}

function selector(
  id: string,
  indicatorId: EvaluationIndicatorId,
  layer: EvidenceLayer,
  defaultStance: "supports" | "refutes" | "context",
  weight: number,
): IndicatorSelector {
  return {
    id,
    indicatorId,
    layer,
    defaultStance,
    weight,
    reviewStatus: "approved",
    active: true,
    notes: "test-only reviewed selector",
  };
}

function presentRule(id: string, selectorIds: readonly string[]): RuleDescriptor {
  return {
    id,
    label: id,
    reviewStatus: "approved",
    active: true,
    predicate: { kind: "selector_present", selectorIds, minimumMatches: selectorIds.length },
  };
}

function numericRule(
  id: string,
  selectorId: string,
  operator: "gt" | "gte" | "lt" | "lte",
  threshold: number,
): RuleDescriptor {
  return {
    id,
    label: id,
    reviewStatus: "approved",
    active: true,
    predicate: { kind: "numeric_compare", selectorId, operator, threshold, unit: "test-unit" },
  };
}

function gate(
  targetStage: "weather_realized" | "physical_pressure" | "balance_tightening" | "market_confirmed" | "easing",
  requiredLayers: readonly EvidenceLayer[],
  ruleIds: readonly string[],
) {
  return {
    targetStage,
    requiredLayers,
    ruleIds,
    minimumRuleMatches: 1,
    reviewStatus: "approved" as const,
    active: true,
  };
}

function selection(
  seed: ThesisSeed,
  selectorIds: readonly string[],
  options: {
    readonly staleSelectorIds?: readonly string[];
    readonly physical?: Partial<SelectedEvidence>;
    readonly balance?: Partial<SelectedEvidence>;
    readonly control?: Partial<SelectedEvidence>;
  } = {},
): EvidenceSelectionResult {
  const evidence = selectorIds.map((selectorId) => selected(
    seed,
    selectorId,
    selectorId === "physical"
      ? options.physical
      : selectorId === "balance"
        ? options.balance
        : selectorId === "control"
          ? options.control
          : undefined,
  ));
  const staleEvidence = (options.staleSelectorIds ?? []).map((selectorId) => selected(seed, selectorId, {
    evidenceId: `stale-${selectorId}`,
    observationId: `stale-observation-${selectorId}`,
    sourceHealth: "stale",
    freshness: "stale",
  }));
  return selectionFromEvidence(seed, [...evidence, ...staleEvidence]);
}

function selectionFromEvidence(
  seed: ThesisSeed,
  evidence: readonly SelectedEvidence[],
): EvidenceSelectionResult {
  return selectEvidence(seed, CUTOFF, evidence);
}

function selected(
  seed: ThesisSeed,
  selectorId: string,
  overrides: Partial<SelectedEvidence> = {},
): SelectedEvidence {
  const matching = seed.indicatorSelectors.find(({ id }) => id === selectorId);
  if (matching === undefined) throw new TypeError(`unknown test selector ${selectorId}`);
  return {
    evidenceId: `evidence-${selectorId}-current`,
    observationId: `observation-${selectorId}-current`,
    sourceRunId: `run-${selectorId}`,
    revision: 0,
    supersedesId: null,
    indicatorId: matching.indicatorId,
    sourceId: `source-${selectorId}`,
    layer: matching.layer,
    stance: matching.defaultStance,
    weight: matching.weight,
    observedAt: "2026-09-08T11:30:00.000Z",
    publishedAt: "2026-09-08T11:40:00.000Z",
    fetchedAt: "2026-09-08T11:55:00.000Z",
    value: 1,
    unit: "test-unit",
    quality: "verified",
    citationUrl: `https://fixtures.invalid/${selectorId}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "fresh",
    selectorId,
    selectionReason: "test-only reviewed selection",
    ...overrides,
  };
}
