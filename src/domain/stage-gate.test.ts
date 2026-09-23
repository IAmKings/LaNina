import { describe, expect, it } from "vitest";

import type { ThesisStage } from "./contracts";
import type {
  EvidenceLayer,
  EvidenceSelectionResult,
  SelectedEvidence,
} from "./evaluation";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import { selectEvidence } from "./evidence-selector";
import { evaluateStageGates } from "./stage-gate";
import { decodeThesisSeed } from "./thesis-seeds";
import type { EvaluationIndicatorId, ThesisSeed } from "./thesis-seeds";

const CUTOFF = "2026-09-08T12:00:00.000Z";

describe("evaluateStageGates", () => {
  it.each([
    ["watch", [], "watch"],
    ["weather_realized", ["weather"], "watch"],
    ["physical_pressure", ["weather", "physical"], "weather_realized"],
    ["balance_tightening", ["weather", "physical", "balance"], "physical_pressure"],
    ["market_confirmed", ["weather", "physical", "balance", "market"], "balance_tightening"],
  ] as const)("evaluates the complete deterministic object for %s", (expectedStage, layers, previousStage) => {
    const seed = reviewedSeed();
    const result = evaluateStageGates(seed, selection(seed, layers), { previousStage });

    expect(result.stage).toBe(expectedStage);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.checks.every((check) => Object.isFrozen(check) && Object.isFrozen(check.reasons))).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it("requires an approved relief or invalidation basis for easing, not one price reversal", () => {
    const seed = reviewedSeed();
    const easing = evaluateStageGates(seed, selection(seed, ["weather", "physical"], {
      evidenceOverrides: { weather: { value: -1 }, physical: { value: -1 } },
    }), { previousStage: "market_confirmed" });
    expect(easing).toMatchObject({
      highestEligibleStage: "easing",
      stage: "easing",
      transition: "promoted",
    });

    const priceOnly = evaluateStageGates(seed, selection(seed, ["market"]), {
      previousStage: "market_confirmed",
    });
    expect(priceOnly.stage).toBe("watch");
    expect(priceOnly.reasons.map(({ code }) => code)).toContain("RELIEF_BASIS_REQUIRED");
    expect(priceOnly.reasons.map(({ code }) => code)).toContain("PRICE_ONLY");
    expect(easing).toMatchSnapshot();
    expect(priceOnly).toMatchSnapshot();
  });

  it("never steps into a blocked pressure gate while an easing skip awaits confirmation", () => {
    const base = reviewedSeed();
    const seed = decodeThesisSeed({
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "gate-physical"
        ? {
            ...rule,
            predicate: {
              kind: "numeric_compare",
              selectorId: "physical",
              operator: "gt",
              threshold: 0,
              unit: "test-unit",
            },
          }
        : rule),
    });
    const result = evaluateStageGates(seed, selection(seed, ["weather", "physical"], {
      evidenceOverrides: { weather: { value: -1 }, physical: { value: -1 } },
    }), { previousStage: "weather_realized" });

    expect(result).toMatchObject({
      highestEligibleStage: "easing",
      stage: "weather_realized",
      transition: "blocked",
      manualConfirmationApplied: false,
    });
    expect(result.checks.find(({ targetStage }) => targetStage === "physical_pressure")).toMatchObject({
      status: "blocked",
      rejectedRuleIds: ["gate-physical"],
    });
    expect(result.reasons.map(({ code }) => code)).toContain("FORWARD_SKIP_REQUIRES_CONFIRMATION");
  });

  it("allows only one upward step unless a named manual confirmation explicitly approves the skip", () => {
    const seed = reviewedSeed();
    const allEvidence = selection(seed, ["weather", "physical", "balance", "market"]);
    const blocked = evaluateStageGates(seed, allEvidence, { previousStage: "watch" });
    const confirmed = evaluateStageGates(seed, allEvidence, {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: "reviewer@example.com", reason: "逐层证据已人工复核" },
    });

    expect(blocked).toMatchObject({
      highestEligibleStage: "market_confirmed",
      stage: "weather_realized",
      transition: "blocked",
      manualConfirmationApplied: false,
    });
    expect(confirmed).toMatchObject({
      highestEligibleStage: "market_confirmed",
      stage: "market_confirmed",
      transition: "manual_forward_skip",
      manualConfirmationApplied: true,
    });
    expect(blocked).toMatchSnapshot();
    expect(confirmed).toMatchSnapshot();
  });

  it("does not let manual confirmation bypass missing layers, rules or stage coverage gaps", () => {
    const seed = reviewedSeed({
      coverageGaps: [{
        id: "physical-gap",
        layer: "physical",
        description: "test gap",
        blocks: ["stage", "confidence"],
      }],
      readiness: {
        reviewStatus: "approved",
        productionEvaluation: false,
        publication: false,
        marketEvidenceReady: false,
        blockingGapIds: ["physical-gap"],
      },
    });
    const result = evaluateStageGates(
      seed,
      selection(seed, ["weather", "market"], { coverageGapIds: ["physical-gap"] }),
      {
        previousStage: "watch",
        manualConfirmation: { confirmedBy: "reviewer", reason: "只确认状态步进" },
      },
    );

    expect(result.stage).toBe("weather_realized");
    expect(result.manualConfirmationApplied).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "physical" }),
      expect.objectContaining({ code: "COVERAGE_GAP", coverageGapId: "physical-gap" }),
    ]));
    expect(result).toMatchSnapshot();
  });

  it("distinguishes stale required evidence and permits an observable jump-back downgrade", () => {
    const seed = reviewedSeed();
    const stalePhysical = selection(seed, ["weather"], { staleLayers: ["physical"] });
    const result = evaluateStageGates(seed, stalePhysical, { previousStage: "market_confirmed" });

    expect(result).toMatchObject({
      highestEligibleStage: "weather_realized",
      stage: "weather_realized",
      transition: "downgraded",
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "STALE_REQUIRED_LAYER", layer: "physical" }),
      expect.objectContaining({ code: "DOWNGRADE" }),
    ]));
    expect(result).toMatchSnapshot();
  });

  it("keeps forecast-only evidence at watch and blocks a price-only market confirmation", () => {
    const seed = reviewedSeed();
    const forecastOnly = evaluateStageGates(seed, selection(seed, ["forecast"]), {
      previousStage: "watch",
    });
    const priceOnly = evaluateStageGates(seed, selection(seed, ["market"]), {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: "reviewer", reason: "cannot override evidence" },
    });

    expect(forecastOnly.stage).toBe("watch");
    expect(forecastOnly.reasons.map(({ code }) => code)).toContain("FORECAST_ONLY");
    expect(priceOnly.stage).toBe("watch");
    expect(priceOnly.reasons.map(({ code }) => code)).toContain("PRICE_ONLY");
    expect(forecastOnly).toMatchSnapshot();
    expect(priceOnly).toMatchSnapshot();
  });

  it("does not treat control as realized or attributable evidence", () => {
    const seed = reviewedSeed();
    const controlOnly = evaluateStageGates(seed, selection(seed, ["forecast", "control"]), {
      previousStage: "watch",
    });
    const marketAndControl = evaluateStageGates(seed, selection(seed, ["market", "control"]), {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: "reviewer", reason: "controls reviewed" },
    });

    expect(controlOnly.stage).toBe("watch");
    expect(controlOnly.reasons.map(({ code }) => code)).toContain("FORECAST_ONLY");
    expect(marketAndControl.stage).toBe("watch");
    expect(marketAndControl.reasons.map(({ code }) => code)).toContain("PRICE_ONLY");
  });

  it("keeps every production seed at watch with stable pending and missing explanations", () => {
    for (const seed of INITIAL_THESIS_SEEDS) {
      const result = evaluateStageGates(seed, selection(seed, []), { previousStage: "watch" });
      expect(result).toMatchObject({
        thesisId: seed.id,
        highestEligibleStage: "watch",
        stage: "watch",
        transition: "unchanged",
        manualConfirmationApplied: false,
      });
      expect(result.reasons.map(({ code }) => code)).toContain("PENDING_GATE");
      expect(result.reasons.map(({ code }) => code)).toContain("PENDING_RULE");
      expect(result.reasons.map(({ code }) => code)).toContain("MISSING_REQUIRED_LAYER");
    }
  });

  it("requires the Europe control/confounder layer before market confirmation", () => {
    const base = reviewedSeed();
    const europe = decodeThesisSeed({
      ...base,
      id: "SHIP-EU-01",
      defaultDirection: "mixed",
      stageGates: base.stageGates.map((gate) => gate.targetStage === "market_confirmed"
        ? { ...gate, requiredLayers: ["weather", "physical", "balance", "market", "control"] }
        : gate),
    });
    const withoutControl = evaluateStageGates(
      europe,
      selection(europe, ["weather", "physical", "balance", "market"]),
      { previousStage: "balance_tightening" },
    );
    const withControl = evaluateStageGates(
      europe,
      selection(europe, ["weather", "physical", "balance", "market", "control"]),
      { previousStage: "balance_tightening" },
    );

    expect(withoutControl.stage).toBe("balance_tightening");
    expect(withoutControl.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "control" }),
    ]));
    expect(withControl.stage).toBe("market_confirmed");
  });

  it("does not allow ENSO weather evidence to imply market confirmation", () => {
    const seed = INITIAL_THESIS_SEEDS[0];
    if (seed === undefined) throw new TypeError("missing ENSO seed");
    const result = evaluateStageGates(seed, selection(seed, []), {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: "reviewer", reason: "weather reviewed" },
    });

    expect(result.highestEligibleStage).toBe("watch");
    expect(result.stage).toBe("watch");
    expect(result.checks.find(({ targetStage }) => targetStage === "market_confirmed")).toMatchObject({
      status: "pending",
      requiredLayers: [],
    });
  });

  it("is input-order deterministic and fails closed for mismatched or invalid selections", () => {
    const seed = reviewedSeed();
    const original = selection(seed, ["weather", "physical", "balance", "market"]);
    const reversed = {
      ...original,
      inputs: [...original.inputs].reverse(),
      selectedEvidence: [...original.selectedEvidence].reverse(),
      rejectedEvidence: [...original.rejectedEvidence].reverse(),
      coverageGapIds: [...original.coverageGapIds].reverse(),
    };
    expect(evaluateStageGates(seed, original, { previousStage: "balance_tightening" })).toEqual(
      evaluateStageGates(seed, reversed, { previousStage: "balance_tightening" }),
    );

    const mismatch = evaluateStageGates(seed, { ...original, thesisId: "OTHER" }, {
      previousStage: "market_confirmed",
    });
    expect(mismatch).toEqual({
      thesisId: seed.id,
      cutoff: CUTOFF,
      previousStage: "market_confirmed",
      highestEligibleStage: "watch",
      stage: "watch",
      transition: "invalid",
      manualConfirmationApplied: false,
      checks: [],
      reasons: [{
        code: "THESIS_MISMATCH",
        targetStage: null,
        layer: null,
        ruleId: null,
        coverageGapId: null,
        reason: `证据选择属于 OTHER，不能用于 ${seed.id}`,
      }],
    });

    const invalidEvidence = { ...original.selectedEvidence[0], layer: "market" as const };
    const invalid = evaluateStageGates(seed, {
      ...original,
      selectedEvidence: [invalidEvidence],
    }, { previousStage: "weather_realized" });
    expect(invalid).toMatchObject({ stage: "watch", transition: "invalid" });
    expect(invalid.reasons[0]?.code).toBe("INVALID_SELECTION");

    const removedGap = INITIAL_THESIS_SEEDS[1];
    if (removedGap === undefined) throw new TypeError("missing rubber seed");
    const gapBypass = evaluateStageGates(removedGap, {
      ...selection(removedGap, []),
      coverageGapIds: [],
    }, { previousStage: "watch" });
    expect(gapBypass).toMatchObject({ stage: "watch", transition: "invalid" });
    expect(gapBypass.reasons[0]?.reason).toContain("coverageGapIds");
  });

  it("rejects forged, duplicated or cutoff-ineligible selected evidence", () => {
    const seed = reviewedSeed();
    const original = selection(seed, ["weather"]);
    const first = original.selectedEvidence[0];
    if (first === undefined) throw new TypeError("missing selected evidence");
    const differentPeriod = {
      ...first,
      evidenceId: "evidence-weather-duplicate-period",
      observationId: "observation-weather-duplicate-period",
    };
    const cases: readonly EvidenceSelectionResult[] = [
      { ...original, inputs: [] },
      { ...original, selectedEvidence: [first, first] },
      {
        ...original,
        inputs: [...original.inputs, differentPeriod],
        selectedEvidence: [first, differentPeriod],
      },
      {
        ...original,
        selectedEvidence: [{ ...first, value: 99 }],
      },
      {
        ...original,
        inputs: [{ ...first, fetchedAt: "2026-09-08T12:01:00.000Z" }],
        selectedEvidence: [{ ...first, fetchedAt: "2026-09-08T12:01:00.000Z" }],
      },
    ];

    for (const forged of cases) {
      const result = evaluateStageGates(seed, forged, { previousStage: "watch" });
      expect(result).toMatchObject({ stage: "watch", transition: "invalid" });
      expect(result.reasons[0]?.code).toBe("INVALID_SELECTION");
    }
  });

  it("fails closed for malformed previous-stage and manual-confirmation options", () => {
    const seed = reviewedSeed();
    const current = selection(seed, ["weather", "physical", "balance", "market"]);
    const invalidPreviousStage = evaluateStageGates(seed, current, {
      previousStage: "unknown" as ThesisStage,
    });
    const invalidConfirmation = evaluateStageGates(seed, current, {
      previousStage: "watch",
      manualConfirmation: { confirmedBy: 1, reason: "invalid" } as never,
    });

    for (const result of [invalidPreviousStage, invalidConfirmation]) {
      expect(result).toMatchObject({
        previousStage: "watch",
        highestEligibleStage: "watch",
        stage: "watch",
        transition: "invalid",
        manualConfirmationApplied: false,
      });
      expect(result.reasons[0]?.code).toBe("INVALID_SELECTION");
    }
  });

  it("evaluates numeric rules against the latest selected observation, never an older match", () => {
    const base = reviewedSeed();
    const numeric = decodeThesisSeed({
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "gate-weather"
        ? {
            ...rule,
            predicate: {
              kind: "numeric_compare",
              selectorId: "weather",
              operator: "gt",
              threshold: 5,
              unit: "test-unit",
            },
          }
        : rule),
    });
    const current = selection(numeric, ["weather"]);
    const latest = { ...current.selectedEvidence[0], value: 1 } as SelectedEvidence;
    const older = {
      ...latest,
      evidenceId: "evidence-weather-old",
      observationId: "observation-weather-old",
      observedAt: "2026-09-07T11:30:00.000Z",
      value: 10,
    };
    const result = evaluateStageGates(
      numeric,
      selectEvidence(numeric, CUTOFF, [older, latest]),
      { previousStage: "watch" },
    );

    expect(result.stage).toBe("watch");
    expect(result.checks[0]).toMatchObject({
      targetStage: "weather_realized",
      matchedRuleIds: [],
      rejectedRuleIds: ["gate-weather"],
    });
  });
});

function reviewedSeed(overrides: Partial<ThesisSeed> = {}): ThesisSeed {
  const selectors = [
    selector("forecast", "enso_roni_ersstv6", "forecast"),
    selector("weather", "regional_rainfall_southern_thailand_rubber_v1", "weather"),
    selector("physical", "usda_psd_malaysia_palm_oil_production_1000mt", "physical"),
    selector("balance", "usda_psd_malaysia_palm_oil_exports_1000mt", "balance"),
    selector("market", "usda_psd_malaysia_palm_oil_ending_stocks_1000mt", "market"),
    selector("control", "eia_europe_brent_spot_usd_per_bbl_daily", "control"),
  ];
  const supportRules = [
    presentRule("gate-weather", ["weather"]),
    presentRule("gate-physical", ["physical"]),
    presentRule("gate-balance", ["balance"]),
    presentRule("gate-market", ["market"]),
  ];
  const base = decodeThesisSeed({
    id: "TEST-THESIS-01",
    slug: "test-thesis",
    title: "Test reviewed thesis",
    category: "agriculture",
    region: "test-region",
    marketScope: "test market",
    methodologyVersion: "test-reviewed-v1",
    regionDefinitionVersion: "test-region-v1",
    target: "test target",
    timeHorizon: "test horizon",
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
    refuteRules: [presentRule("refute", ["weather"])],
    invalidationRules: [numericRule("invalidate", "physical", "lt", 0)],
    reliefRules: [numericRule("relief", "weather", "lt", 0)],
    stageGates: [
      gate("weather_realized", ["weather"], ["gate-weather"]),
      gate("physical_pressure", ["weather", "physical"], ["gate-physical"]),
      gate("balance_tightening", ["weather", "physical", "balance"], ["gate-balance"]),
      gate("market_confirmed", ["weather", "physical", "balance", "market"], ["gate-market"]),
      gate("easing", ["weather", "physical"], ["relief", "invalidate"], 1),
    ],
    directionPolicy: {
      version: "test-direction-v1",
      reviewStatus: "approved",
      active: true,
      mappings: [
        ...supportRules.map(({ id }) => ({ ruleId: id, direction: "bullish" as const })),
        { ruleId: "refute", direction: "bearish" },
        { ruleId: "invalidate", direction: "neutral" },
        { ruleId: "relief", direction: "neutral" },
      ],
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

function selector(id: string, indicatorId: EvaluationIndicatorId, layer: EvidenceLayer) {
  return {
    id,
    indicatorId,
    layer,
    defaultStance: "supports" as const,
    weight: 10,
    reviewStatus: "approved" as const,
    active: true,
    notes: "test-only reviewed selector",
  };
}

function presentRule(id: string, selectorIds: readonly string[], minimumMatches = 1) {
  return {
    id,
    label: id,
    reviewStatus: "approved" as const,
    active: true,
    predicate: { kind: "selector_present" as const, selectorIds, minimumMatches },
  };
}

function numericRule(
  id: string,
  selectorId: string,
  operator: "gt" | "gte" | "lt" | "lte",
  threshold: number,
) {
  return {
    id,
    label: id,
    reviewStatus: "approved" as const,
    active: true,
    predicate: {
      kind: "numeric_compare" as const,
      selectorId,
      operator,
      threshold,
      unit: "test-unit",
    },
  };
}

function gate(
  targetStage: Exclude<ThesisStage, "watch">,
  requiredLayers: readonly EvidenceLayer[],
  ruleIds: readonly string[],
  minimumRuleMatches = 1,
) {
  return {
    targetStage,
    requiredLayers,
    ruleIds,
    minimumRuleMatches,
    reviewStatus: "approved" as const,
    active: true,
  };
}

function selection(
  seed: ThesisSeed,
  layers: readonly EvidenceLayer[],
  options: {
    readonly staleLayers?: readonly EvidenceLayer[];
    readonly coverageGapIds?: readonly string[];
    readonly evidenceOverrides?: Partial<Record<EvidenceLayer, Partial<SelectedEvidence>>>;
  } = {},
): EvidenceSelectionResult {
  const inputs = [
    ...layers.map((layer) => selected(seed, layer, options.evidenceOverrides?.[layer])),
    ...(options.staleLayers ?? []).map((layer) => selected(seed, layer, {
      evidenceId: `stale-${layer}`,
      observationId: `stale-observation-${layer}`,
      sourceHealth: "stale",
      freshness: "stale",
    })),
  ];
  const result = selectEvidence(seed, CUTOFF, inputs);
  return options.coverageGapIds === undefined
    ? result
    : { ...result, coverageGapIds: options.coverageGapIds };
}

function selected(
  seed: ThesisSeed,
  layer: EvidenceLayer,
  overrides: Partial<SelectedEvidence> = {},
): SelectedEvidence {
  const matchingSelector = seed.indicatorSelectors.find((selector) => selector.layer === layer);
  if (matchingSelector === undefined) throw new TypeError(`missing ${layer} selector`);
  return {
    evidenceId: `evidence-${layer}`,
    observationId: `observation-${layer}`,
    sourceRunId: `run-${layer}`,
    revision: 0,
    supersedesId: null,
    indicatorId: matchingSelector.indicatorId,
    sourceId: `source-${layer}`,
    layer,
    stance: "supports",
    weight: 10,
    observedAt: "2026-09-08T11:30:00.000Z",
    publishedAt: "2026-09-08T11:40:00.000Z",
    fetchedAt: "2026-09-08T11:55:00.000Z",
    value: 1,
    unit: "test-unit",
    quality: "verified",
    citationUrl: `https://fixtures.invalid/${layer}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "fresh",
    selectorId: matchingSelector.id,
    selectionReason: "test selection",
    ...overrides,
  };
}
