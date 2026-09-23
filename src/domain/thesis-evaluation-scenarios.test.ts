import { describe, expect, it } from "vitest";

import type { ThesisStage } from "./contracts";
import { shanghaiBriefDate } from "./daily-brief";
import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type {
  DirectionConfidenceEvaluation,
  EvidenceLayer,
  EvidenceSelectionResult,
  EvaluationEvidenceInput,
  StageGateResult,
} from "./evaluation";
import { selectEvidence } from "./evidence-selector";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import {
  detectMaterialChanges,
  type MaterialChange,
  type MaterialChangeDetectionResult,
  type MaterialChangeSnapshot,
} from "./material-change";
import { evaluateStageGates } from "./stage-gate";
import {
  decodeThesisSeed,
  type EvaluationIndicatorId,
  type IndicatorSelector,
  type RuleDescriptor,
  type ThesisSeed,
} from "./thesis-seeds";
import {
  automaticPublicationDisabledResult,
  precedingEvaluationCutoff,
} from "../worker/modules/daily-schedule";

const BASE_CUTOFF = "2026-09-08T12:00:00.000Z";

describe("reviewed test-only market-impact scenarios", () => {
  it("keeps RUBBER-TH-01 price-only evidence at watch with a complete attribution explanation", () => {
    const seed = rubberScenarioSeed();
    const result = evaluateScenario(seed, "watch", BASE_CUTOFF, [
      evidence(seed, "rubber-market-price", { value: 105 }),
    ]);

    expect(result.selection.selectedEvidence.map(({ evidenceId, selectorId, layer, stance }) => ({
      evidenceId,
      selectorId,
      layer,
      stance,
    }))).toEqual([{
      evidenceId: "evidence-rubber-market-price",
      selectorId: "rubber-market-price",
      layer: "market",
      stance: "supports",
    }]);
    expect(result.selection.rejectedEvidence.filter(({ code }) => code === "MISSING_EVIDENCE"))
      .toEqual([
        expect.objectContaining({ selectorId: "rubber-balance-stock", indicatorId: "usda_psd_malaysia_palm_oil_ending_stocks_1000mt" }),
        expect.objectContaining({ selectorId: "rubber-physical-supply", indicatorId: "usda_psd_malaysia_palm_oil_production_1000mt" }),
        expect.objectContaining({ selectorId: "rubber-regional-weather", indicatorId: "regional_rainfall_southern_thailand_rubber_v1" }),
      ]);
    expect(result.stage).toMatchObject({
      stage: "watch",
      highestEligibleStage: "watch",
      transition: "unchanged",
    });
    expect(result.stage.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRICE_ONLY", targetStage: "market_confirmed" }),
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "weather" }),
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "physical" }),
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "balance" }),
    ]));
    expect(result.evaluation).toMatchObject({
      thesisId: "RUBBER-TH-01",
      stage: "watch",
      target: "RU/NR 近月及泰国天然橡胶原料",
      marketScope: "RU、NR、TSR20、RSS3（测试审核策略）",
      timeHorizon: "未来 2–8 周",
      direction: {
        status: "available",
        direction: "bullish",
        ruleHits: [{
          ruleId: "rubber-market-up",
          evidenceIds: ["evidence-rubber-market-price"],
          reason: expect.stringContaining("显式映射为 bullish"),
        }],
      },
      confidence: {
        status: "available",
        components: { coverage: 25, freshness: 25, sourceQuality: 100, agreement: 100 },
        weightedScore: 59,
        finalScore: 59,
        appliedCaps: [],
        explanations: {
          coverage: {
            requiredLayers: ["weather", "physical", "balance", "market"],
            presentLayers: ["market"],
            missingLayers: ["weather", "physical", "balance"],
            staleLayers: [],
          },
          freshness: {
            currentEvidenceIds: ["evidence-rubber-market-price"],
            freshSelectorIds: ["rubber-market-price"],
            lateSelectorIds: [],
            staleSelectorIds: [],
            missingSelectorIds: ["rubber-balance-stock", "rubber-physical-supply", "rubber-regional-weather"],
          },
          sourceQuality: {
            currentEvidenceIds: ["evidence-rubber-market-price"],
            tierScores: { A: 100, B: 80, C: 50 },
          },
          agreement: {
            supportEvidenceIds: ["evidence-rubber-market-price"],
            refuteEvidenceIds: [],
            ignoredContextEvidenceIds: [],
            supportWeight: 40,
            refuteWeight: 0,
          },
        },
      },
    });
    expect(result.evaluation.confidence.appliedCaps).not.toContainEqual(
      expect.objectContaining({ code: "PRICE_ONLY" }),
    );
    expect({ selection: result.selection, stage: result.stage, evaluation: result.evaluation })
      .toMatchSnapshot("rubber price-only full explanation");
  });

  it("preserves Panama restriction and relief facts and changes confidence deterministically", async () => {
    const seed = panamaScenarioSeed();
    const weather = evidence(seed, "usec-catchment-weather", {
      evidenceId: "panama-weather-support",
      observedAt: "2026-09-08T09:00:00.000Z",
      value: -2,
    });
    const restriction = evidence(seed, "usec-slot-restriction", {
      evidenceId: "acp-slot-restriction",
      observedAt: "2026-09-08T10:00:00.000Z",
      value: 1,
      weight: 1,
    });
    const relief = evidence(seed, "usec-draft-delay-relief", {
      evidenceId: "acp-draft-adjustment-delayed",
      observedAt: "2026-09-08T12:15:00.000Z",
      publishedAt: "2026-09-08T12:20:00.000Z",
      fetchedAt: "2026-09-08T12:30:00.000Z",
      value: 1,
      weight: 99,
    });
    const before = snapshot(seed, "weather_realized", BASE_CUTOFF, [restriction, weather]);
    const afterCutoff = "2026-09-08T13:00:00.000Z";
    const after = snapshot(seed, before.evaluation.stage, afterCutoff, [relief, weather, restriction]);
    const reordered = snapshot(seed, before.evaluation.stage, afterCutoff, [restriction, weather, relief]);

    expect(before.evaluation.stage).toBe("physical_pressure");
    expect(after).toEqual(reordered);
    expect(after.selection.inputs.map(({ evidenceId }) => evidenceId)).toEqual([
      "panama-weather-support",
      "acp-draft-adjustment-delayed",
      "acp-slot-restriction",
    ]);
    expect(after.selection.selectedEvidence.map(({ evidenceId, revision, stance }) => ({
      evidenceId,
      revision,
      stance,
    }))).toEqual([
      { evidenceId: "panama-weather-support", revision: 0, stance: "supports" },
      { evidenceId: "acp-draft-adjustment-delayed", revision: 0, stance: "refutes" },
      { evidenceId: "acp-slot-restriction", revision: 0, stance: "supports" },
    ]);
    expect(after.evaluation).toMatchObject({
      stage: "physical_pressure",
      direction: {
        status: "available",
        direction: "mixed",
        matchedDirections: ["bullish", "bearish"],
        ruleHits: [
          expect.objectContaining({ ruleId: "usec-catchment-support", evidenceIds: ["panama-weather-support"] }),
          expect.objectContaining({ ruleId: "usec-operational-relief", evidenceIds: ["acp-draft-adjustment-delayed"] }),
          expect.objectContaining({ ruleId: "usec-slot-pressure", evidenceIds: ["acp-slot-restriction"] }),
        ],
      },
      confidence: {
        components: { coverage: 100, freshness: 100, sourceQuality: 100, agreement: 33 },
        weightedScore: 87,
        finalScore: 69,
        appliedCaps: [expect.objectContaining({ code: "UNEXPLAINED_CONFLICT", maximum: 69 })],
        explanations: {
          agreement: {
            supportEvidenceIds: ["acp-slot-restriction", "panama-weather-support"],
            refuteEvidenceIds: ["acp-draft-adjustment-delayed"],
            ignoredContextEvidenceIds: [],
            supportWeight: 80,
            refuteWeight: 40,
          },
        },
      },
    });
    const afterStage = evaluateStageGates(seed, after.selection, {
      previousStage: before.evaluation.stage,
    });
    expect(afterStage.checks.find(({ targetStage }) => targetStage === "easing")).toMatchObject({
      status: "blocked",
      rejectedRuleIds: ["usec-easing-confirmed"],
    });

    const firstChange = await detectMaterialChanges(seed, before, after);
    const reorderedChange = await detectMaterialChanges(seed, before, reordered);
    const repeatedChange = await detectMaterialChanges(seed, before, after);
    expect(firstChange).toEqual(reorderedChange);
    expect(firstChange).toEqual(repeatedChange);
    expect(firstChange.changes).toEqual([
      expect.objectContaining({
        changeClass: "thesis",
        changeType: "thesis",
        triggers: [
          { kind: "direction", before: "bullish", after: "mixed" },
          { kind: "confidence", before: 92, after: 69, absoluteDelta: 23, threshold: 10 },
        ],
      }),
    ]);
    expect(new Set(firstChange.changes.map(({ idempotencyKey }) => idempotencyKey)).size)
      .toBe(firstChange.changes.length);
    expect({ before, after, change: firstChange }).toMatchSnapshot("Panama contradiction full explanation");
  });

  it("keeps Europe mixed and blocks market confirmation without route-specific controls", () => {
    const seed = europeScenarioSeed();
    const europeWeather = evidence(seed, "eu-climate-weather", { value: -3 });
    const europeMarket = evidence(seed, "eu-route-market", { value: 12 });
    const panamaEvidence: EvaluationEvidenceInput = {
      ...europeWeather,
      evidenceId: "foreign-panama-rainfall",
      observationId: "foreign-panama-rainfall-observation",
      indicatorId: "regional_rainfall_panama_canal_catchment_v1",
      sourceId: "panama-source",
    };
    const withoutControls = evaluateScenario(
      seed,
      "balance_tightening",
      BASE_CUTOFF,
      [panamaEvidence, europeMarket, europeWeather],
    );

    expect(withoutControls.selection.selectedEvidence.map(({ selectorId }) => selectorId)).toEqual([
      "eu-climate-weather",
      "eu-route-market",
    ]);
    expect(withoutControls.selection.rejectedEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceId: "foreign-panama-rainfall",
        selectorId: null,
        code: "SELECTOR_MISMATCH",
      }),
      expect.objectContaining({
        evidenceId: null,
        selectorId: "eu-red-sea-capacity-demand-control",
        code: "MISSING_EVIDENCE",
      }),
    ]));
    expect(withoutControls.stage).toMatchObject({
      stage: "balance_tightening",
      highestEligibleStage: "balance_tightening",
      transition: "unchanged",
    });
    expect(withoutControls.stage.checks.find(({ targetStage }) => targetStage === "market_confirmed"))
      .toMatchObject({
        status: "blocked",
        requiredLayers: ["weather", "market", "control"],
        presentLayers: ["weather", "market"],
        missingLayers: ["control"],
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "control" }),
        ]),
      });
    expect(withoutControls.evaluation).toMatchObject({
      stage: "balance_tightening",
      target: "亚洲至欧洲即期运价、EC 与船期可靠性",
      marketScope: "SCFI 欧线、EC、船期可靠性；须分离红海/苏伊士、运力与需求",
      timeHorizon: "未来 1–8 周",
      direction: { status: "available", direction: "mixed", matchedDirections: ["mixed"] },
    });

    const controlCannotSubstitute = evaluateScenario(seed, "watch", BASE_CUTOFF, [
      evidence(seed, "eu-route-market", { value: 12 }),
      evidence(seed, "eu-red-sea-capacity-demand-control", { value: 1 }),
    ]);
    expect(controlCannotSubstitute.stage.stage).toBe("watch");
    expect(controlCannotSubstitute.stage.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRICE_ONLY", targetStage: "market_confirmed" }),
      expect.objectContaining({ code: "MISSING_REQUIRED_LAYER", layer: "weather" }),
    ]));
    expect(controlCannotSubstitute.evaluation.confidence.explanations.agreement)
      .toMatchObject({ ignoredContextEvidenceIds: ["evidence-eu-red-sea-capacity-demand-control"] });
    expect({ withoutControls, controlCannotSubstitute })
      .toMatchSnapshot("Europe confounder and attribution explanation");
  });
});

describe("cutoff revision scenario", () => {
  it("supersedes only cutoff-eligible revisions and emits semantic threshold/revision changes", async () => {
    const seed = revisionScenarioSeed();
    const original = evidence(seed, "revision-weather", {
      evidenceId: "weather-period-r0",
      observationId: "weather-period-observation-r0",
      observedAt: "2026-09-08T10:00:00.000Z",
      publishedAt: "2026-09-08T10:15:00.000Z",
      fetchedAt: "2026-09-08T10:30:00.000Z",
      revision: 0,
      value: 9,
    });
    const beforeCutoffRevision = evidence(seed, "revision-weather", {
      evidenceId: "weather-period-r1",
      observationId: "weather-period-observation-r1",
      supersedesId: original.observationId,
      observedAt: original.observedAt,
      publishedAt: "2026-09-08T11:15:00.000Z",
      fetchedAt: "2026-09-08T11:30:00.000Z",
      revision: 1,
      value: 11,
    });
    const afterCutoffRevision = evidence(seed, "revision-weather", {
      evidenceId: "weather-period-r9",
      observationId: "weather-period-observation-r9",
      supersedesId: beforeCutoffRevision.observationId,
      observedAt: original.observedAt,
      publishedAt: "2026-09-08T12:00:00.001Z",
      fetchedAt: "2026-09-08T12:00:00.001Z",
      revision: 9,
      value: 8,
    });
    const allRevisions = [afterCutoffRevision, beforeCutoffRevision, original];
    const early = snapshot(seed, "watch", "2026-09-08T11:00:00.000Z", allRevisions);
    const atCutoff = snapshot(seed, early.evaluation.stage, BASE_CUTOFF, allRevisions);

    expect(early.selection.selectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "weather-period-r0", revision: 0, value: 9 }),
    ]);
    expect(atCutoff.selection.selectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "weather-period-r1", revision: 1, value: 11 }),
    ]);
    expect(atCutoff.selection.rejectedEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: "weather-period-r0", code: "SUPERSEDED_REVISION" }),
      expect.objectContaining({ evidenceId: "weather-period-r9", code: "AFTER_CUTOFF" }),
    ]));

    const entered = await detectMaterialChanges(seed, early, atCutoff);
    const enteredRepeat = await detectMaterialChanges(
      seed,
      snapshot(seed, "watch", early.selection.cutoff, [...allRevisions].reverse()),
      snapshot(seed, early.evaluation.stage, atCutoff.selection.cutoff, [...allRevisions].reverse()),
    );
    expect(enteredRepeat).toEqual(entered);
    expect(factChanges(entered, "threshold")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "revision-threshold-support",
        transition: "entered",
        before: expect.objectContaining({ revision: 0, value: 9 }),
        after: expect.objectContaining({ revision: 1, value: 11 }),
      }),
    ]));
    expect(factChanges(entered, "revision")).toEqual([
      expect.objectContaining({
        observedAt: original.observedAt,
        absoluteValueDelta: 2,
        requiredValueDelta: 1,
        before: expect.objectContaining({ revision: 0, value: 9 }),
        after: expect.objectContaining({ revision: 1, value: 11 }),
      }),
    ]);
    expect(new Set(entered.changes.map(({ idempotencyKey }) => idempotencyKey)).size)
      .toBe(entered.changes.length);

    const later = snapshot(seed, atCutoff.evaluation.stage, "2026-09-08T13:00:00.000Z", allRevisions);
    expect(later.selection.selectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "weather-period-r9", revision: 9, value: 8 }),
    ]);
    const exited = await detectMaterialChanges(seed, atCutoff, later);
    expect(factChanges(exited, "threshold")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "revision-threshold-support",
        transition: "exited",
        before: expect.objectContaining({ revision: 1, value: 11 }),
        after: expect.objectContaining({ revision: 9, value: 8 }),
      }),
    ]));
    expect(factChanges(exited, "revision")).toEqual([
      expect.objectContaining({
        absoluteValueDelta: 3,
        requiredValueDelta: 1,
        before: expect.objectContaining({ revision: 1, value: 11 }),
        after: expect.objectContaining({ revision: 9, value: 8 }),
      }),
    ]);
    expect(factChanges(exited, "revision")[0]?.absoluteValueDelta).not.toBe(8);
    expect({ early, atCutoff, entered, later, exited })
      .toMatchSnapshot("revision cutoff and semantic delta explanation");
  });
});

describe("Asia/Shanghai scheduled date scenarios", () => {
  it.each([
    ["ordinary day", "2026-09-09T22:30:00.000Z", "2026-09-09T23:00:00.000Z", "2026-09-10"],
    ["month end", "2026-01-31T22:30:00.000Z", "2026-01-31T23:00:00.000Z", "2026-02-01"],
    ["leap-day entry", "2028-02-28T22:30:00.000Z", "2028-02-28T23:00:00.000Z", "2028-02-29"],
    ["leap-day exit", "2028-02-29T22:30:00.000Z", "2028-02-29T23:00:00.000Z", "2028-03-01"],
    ["year end", "2026-12-31T22:30:00.000Z", "2026-12-31T23:00:00.000Z", "2027-01-01"],
  ])("maps the 06:30/07:00 pair across %s", (_label, evaluationAt, publicationAt, briefDate) => {
    expect(shanghaiBriefDate(evaluationAt)).toBe(briefDate);
    expect(automaticPublicationDisabledResult({ scheduledAt: publicationAt })).toMatchObject({
      briefDate,
      scheduledAt: publicationAt,
      evaluationCutoff: evaluationAt,
      delayCodes: ["AUTOMATIC_PUBLICATION_DISABLED"],
    });
    expect(precedingEvaluationCutoff(publicationAt)).toBe(evaluationAt);
  });

  it("does not depend on the actual host timezone", () => {
    const evaluationAt = "2026-09-09T22:30:00.000Z";
    const publicationAt = "2026-09-09T23:00:00.000Z";
    const originalTimeZone = process.env.TZ;
    try {
      for (const timeZone of ["UTC", "Pacific/Honolulu", "Pacific/Kiritimati", "Europe/London"]) {
        process.env.TZ = timeZone;
        expect(dateInZone(evaluationAt, timeZone)).toMatch(/^2026-09-(09|10)$/);
        expect(shanghaiBriefDate(evaluationAt)).toBe("2026-09-10");
        expect(automaticPublicationDisabledResult({ scheduledAt: publicationAt })).toMatchObject({
          briefDate: "2026-09-10",
          evaluationCutoff: evaluationAt,
        });
      }
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });
});

interface ScenarioEvaluation {
  readonly selection: EvidenceSelectionResult;
  readonly stage: StageGateResult;
  readonly evaluation: DirectionConfidenceEvaluation;
}

function evaluateScenario(
  seed: ThesisSeed,
  previousStage: ThesisStage,
  cutoff: string,
  inputs: readonly EvaluationEvidenceInput[],
): ScenarioEvaluation {
  const selection = selectEvidence(seed, cutoff, inputs);
  const stage = evaluateStageGates(seed, selection, { previousStage });
  return {
    selection,
    stage,
    evaluation: evaluateDirectionAndConfidence(seed, selection, stage),
  };
}

function snapshot(
  seed: ThesisSeed,
  previousStage: ThesisStage,
  cutoff: string,
  inputs: readonly EvaluationEvidenceInput[],
): MaterialChangeSnapshot {
  const { selection, evaluation } = evaluateScenario(seed, previousStage, cutoff, inputs);
  return { previousStage, selection, evaluation };
}

function factChanges<T extends "threshold" | "revision">(
  result: MaterialChangeDetectionResult,
  type: T,
): readonly Extract<MaterialChange, { readonly changeType: T }>[] {
  return result.changes.filter(
    (change): change is Extract<MaterialChange, { readonly changeType: T }> => change.changeType === type,
  );
}

function rubberScenarioSeed(): ThesisSeed {
  const base = initialSeed("RUBBER-TH-01");
  const selectors = [
    selector("rubber-regional-weather", "regional_rainfall_southern_thailand_rubber_v1", "weather", "supports", 20),
    selector("rubber-physical-supply", "usda_psd_malaysia_palm_oil_production_1000mt", "physical", "supports", 20),
    selector("rubber-balance-stock", "usda_psd_malaysia_palm_oil_ending_stocks_1000mt", "balance", "refutes", 20),
    selector("rubber-market-price", "eia_europe_brent_spot_usd_per_bbl_daily", "market", "supports", 40),
  ];
  const supportRules = [
    numericRule("rubber-weather-pressure", "rubber-regional-weather", "lt", -1),
    presentRule("rubber-physical-pressure", ["rubber-physical-supply"]),
    presentRule("rubber-balance-tightening", ["rubber-balance-stock"]),
    numericRule("rubber-market-up", "rubber-market-price", "gt", 100),
  ];
  const refuteRules = [numericRule("rubber-inventory-relief", "rubber-balance-stock", "gt", 0)];
  const invalidationRules = [numericRule("rubber-weather-normal", "rubber-regional-weather", "gte", 0)];
  const reliefRules = [numericRule("rubber-pressure-relief", "rubber-physical-supply", "lt", 0)];
  return reviewedClone(base, {
    selectors,
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    requiredEvidenceLayers: ["weather", "physical", "balance", "market"],
    stageGates: [
      gate("weather_realized", ["weather"], ["rubber-weather-pressure"]),
      gate("physical_pressure", ["weather", "physical"], ["rubber-physical-pressure"]),
      gate("balance_tightening", ["weather", "physical", "balance"], ["rubber-balance-tightening"]),
      gate("market_confirmed", ["weather", "physical", "balance", "market"], ["rubber-market-up"]),
      gate("easing", ["weather", "physical"], ["rubber-pressure-relief"]),
    ],
    directionMappings: [
      ["rubber-weather-pressure", "bullish"],
      ["rubber-physical-pressure", "bullish"],
      ["rubber-balance-tightening", "bullish"],
      ["rubber-market-up", "bullish"],
      ["rubber-inventory-relief", "bearish"],
      ["rubber-weather-normal", "bearish"],
      ["rubber-pressure-relief", "bearish"],
    ],
    marketScope: "RU、NR、TSR20、RSS3（测试审核策略）",
  });
}

function panamaScenarioSeed(): ThesisSeed {
  const base = initialSeed("SHIP-USEC-01");
  const selectors = [
    selector("usec-catchment-weather", "regional_rainfall_panama_canal_catchment_v1", "weather", "supports", 20),
    selector("usec-slot-restriction", "usda_psd_malaysia_palm_oil_production_1000mt", "physical", "supports", 60),
    selector("usec-draft-delay-relief", "usda_psd_malaysia_palm_oil_exports_1000mt", "physical", "refutes", 40),
    selector("usec-route-market", "eia_europe_brent_spot_usd_per_bbl_daily", "market", "supports", 20),
  ];
  const supportRules = [
    presentRule("usec-catchment-support", ["usec-catchment-weather"]),
    presentRule("usec-slot-pressure", ["usec-slot-restriction"]),
    presentRule("usec-route-market-confirmation", ["usec-route-market"]),
  ];
  const refuteRules = [presentRule("usec-operational-relief", ["usec-draft-delay-relief"])];
  const invalidationRules = [numericRule("usec-restriction-withdrawn", "usec-draft-delay-relief", "lt", -100)];
  const reliefRules = [numericRule("usec-easing-confirmed", "usec-draft-delay-relief", "lt", -100)];
  return reviewedClone(base, {
    selectors,
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    requiredEvidenceLayers: ["weather", "physical", "market"],
    stageGates: [
      gate("weather_realized", ["weather"], ["usec-catchment-support"]),
      gate("physical_pressure", ["weather", "physical"], ["usec-slot-pressure"]),
      gate("balance_tightening", ["weather", "physical", "market"], ["usec-route-market-confirmation"]),
      gate("market_confirmed", ["weather", "physical", "market"], ["usec-route-market-confirmation"]),
      gate("easing", ["physical"], ["usec-easing-confirmed"]),
    ],
    directionMappings: [
      ["usec-catchment-support", "bullish"],
      ["usec-slot-pressure", "bullish"],
      ["usec-route-market-confirmation", "bullish"],
      ["usec-operational-relief", "bearish"],
      ["usec-restriction-withdrawn", "bearish"],
      ["usec-easing-confirmed", "bearish"],
    ],
  });
}

function europeScenarioSeed(): ThesisSeed {
  const base = initialSeed("SHIP-EU-01");
  const selectors = [
    selector("eu-climate-weather", "regional_rainfall_maritime_continent_palm_v1", "weather", "supports", 30),
    selector("eu-route-market", "usda_psd_malaysia_palm_oil_ending_stocks_1000mt", "market", "supports", 30),
    selector("eu-red-sea-capacity-demand-control", "eia_europe_brent_spot_usd_per_bbl_daily", "control", "context", 40),
  ];
  const supportRules = [
    presentRule("eu-weather-attribution", ["eu-climate-weather"]),
    presentRule("eu-market-change", ["eu-route-market"]),
  ];
  const refuteRules = [presentRule("eu-control-explanation", ["eu-red-sea-capacity-demand-control"])];
  const invalidationRules = [numericRule("eu-attribution-invalid", "eu-red-sea-capacity-demand-control", "gt", 999)];
  const reliefRules = [numericRule("eu-pressure-relief", "eu-red-sea-capacity-demand-control", "lt", -999)];
  return reviewedClone(base, {
    selectors,
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    requiredEvidenceLayers: ["weather", "market", "control"],
    stageGates: [
      gate("weather_realized", ["weather"], ["eu-weather-attribution"]),
      gate("physical_pressure", ["weather"], ["eu-weather-attribution"]),
      gate("balance_tightening", ["weather"], ["eu-weather-attribution"]),
      gate("market_confirmed", ["weather", "market", "control"], ["eu-market-change"]),
      gate("easing", ["weather", "control"], ["eu-pressure-relief"]),
    ],
    directionMappings: [
      ["eu-weather-attribution", "mixed"],
      ["eu-market-change", "mixed"],
      ["eu-control-explanation", "neutral"],
      ["eu-attribution-invalid", "neutral"],
      ["eu-pressure-relief", "neutral"],
    ],
    defaultDirection: "mixed",
    marketScope: "SCFI 欧线、EC、船期可靠性；须分离红海/苏伊士、运力与需求",
  });
}

function revisionScenarioSeed(): ThesisSeed {
  const base = initialSeed("RUBBER-TH-01");
  const selectors = [
    selector("revision-weather", "regional_rainfall_southern_thailand_rubber_v1", "weather", "supports", 60),
    selector("revision-market", "eia_europe_brent_spot_usd_per_bbl_daily", "market", "supports", 40),
  ];
  const supportRules = [
    numericRule("revision-threshold-support", "revision-weather", "gt", 10),
    presentRule("revision-market-confirmation", ["revision-market"]),
  ];
  const refuteRules = [numericRule("revision-threshold-refute", "revision-weather", "lte", 10)];
  const invalidationRules = [numericRule("revision-invalidation", "revision-weather", "lt", -100)];
  const reliefRules = [numericRule("revision-relief", "revision-weather", "lt", -100)];
  return reviewedClone(base, {
    selectors,
    supportRules,
    refuteRules,
    invalidationRules,
    reliefRules,
    requiredEvidenceLayers: ["weather", "market"],
    stageGates: [
      gate("weather_realized", ["weather"], ["revision-threshold-support"]),
      gate("physical_pressure", ["weather"], ["revision-threshold-support"]),
      gate("balance_tightening", ["weather"], ["revision-threshold-support"]),
      gate("market_confirmed", ["weather", "market"], ["revision-market-confirmation"]),
      gate("easing", ["weather"], ["revision-relief"]),
    ],
    directionMappings: [
      ["revision-threshold-support", "bullish"],
      ["revision-market-confirmation", "bullish"],
      ["revision-threshold-refute", "bearish"],
      ["revision-invalidation", "bearish"],
      ["revision-relief", "bearish"],
    ],
  });
}

interface ReviewedCloneOptions {
  readonly selectors: readonly IndicatorSelector[];
  readonly supportRules: readonly RuleDescriptor[];
  readonly refuteRules: readonly RuleDescriptor[];
  readonly invalidationRules: readonly RuleDescriptor[];
  readonly reliefRules: readonly RuleDescriptor[];
  readonly requiredEvidenceLayers: readonly EvidenceLayer[];
  readonly stageGates: readonly ReturnType<typeof gate>[];
  readonly directionMappings: readonly (readonly [string, "bullish" | "bearish" | "neutral" | "mixed"])[];
  readonly defaultDirection?: "bullish" | "bearish" | "neutral" | "mixed";
  readonly marketScope?: string;
}

function reviewedClone(base: ThesisSeed, options: ReviewedCloneOptions): ThesisSeed {
  return decodeThesisSeed({
    ...base,
    methodologyVersion: `${base.id.toLowerCase()}-test-reviewed-scenario-v1`,
    regionDefinitionVersion: `${base.id.toLowerCase()}-test-region-v1`,
    marketScope: options.marketScope ?? `${base.marketScope}（测试审核策略）`,
    defaultDirection: options.defaultDirection ?? base.defaultDirection,
    requiredEvidenceLayers: options.requiredEvidenceLayers,
    indicatorSelectors: options.selectors,
    freshnessSlos: options.selectors.map(({ id }) => ({
      selectorId: id,
      maxAgeMinutes: 10_000,
      reviewStatus: "approved",
      active: true,
    })),
    supportRules: options.supportRules,
    refuteRules: options.refuteRules,
    invalidationRules: options.invalidationRules,
    reliefRules: options.reliefRules,
    stageGates: options.stageGates,
    directionPolicy: {
      version: `${base.id.toLowerCase()}-test-direction-v1`,
      reviewStatus: "approved",
      active: true,
      mappings: options.directionMappings.map(([ruleId, direction]) => ({ ruleId, direction })),
    },
    confidencePolicy: {
      version: `${base.id.toLowerCase()}-test-confidence-v1`,
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
    templateCopy: {
      summary: "仅用于回归测试的已审核场景，不代表生产方法论获批。",
      invalidation: "仅用于回归测试的失效条件。",
      coverageGap: "生产 coverage gap 保持不变；本 clone 不进入生产。",
    },
    coverageGaps: [],
    readiness: {
      reviewStatus: "approved",
      productionEvaluation: true,
      publication: false,
      marketEvidenceReady: true,
      blockingGapIds: [],
    },
  });
}

function initialSeed(id: ThesisSeed["id"]): ThesisSeed {
  const seed = INITIAL_THESIS_SEEDS.find((candidate) => candidate.id === id);
  if (seed === undefined) throw new TypeError(`missing initial thesis ${id}`);
  return seed;
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
    notes: "TEST ONLY：虚构的已审核 selector clone，不得用于生产评估或发布。",
  };
}

function presentRule(id: string, selectorIds: readonly string[]): RuleDescriptor {
  return {
    id,
    label: `TEST ONLY ${id}`,
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
    label: `TEST ONLY ${id}`,
    reviewStatus: "approved",
    active: true,
    predicate: { kind: "numeric_compare", selectorId, operator, threshold, unit: "scenario-unit" },
  };
}

function gate(
  targetStage: Exclude<ThesisStage, "watch">,
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

function evidence(
  seed: ThesisSeed,
  selectorId: string,
  overrides: Partial<EvaluationEvidenceInput> = {},
): EvaluationEvidenceInput {
  const matching = seed.indicatorSelectors.find(({ id }) => id === selectorId);
  if (matching === undefined) throw new TypeError(`unknown scenario selector ${selectorId}`);
  return {
    evidenceId: `evidence-${selectorId}`,
    observationId: `observation-${selectorId}`,
    sourceRunId: `source-run-${selectorId}`,
    revision: 0,
    supersedesId: null,
    indicatorId: matching.indicatorId,
    sourceId: `source-${selectorId}`,
    layer: matching.layer,
    stance: matching.defaultStance,
    weight: matching.weight,
    observedAt: "2026-09-08T10:00:00.000Z",
    publishedAt: "2026-09-08T10:30:00.000Z",
    fetchedAt: "2026-09-08T11:00:00.000Z",
    value: 1,
    unit: "scenario-unit",
    quality: "verified",
    citationUrl: `https://scenario-fixtures.invalid/${selectorId}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "unknown",
    ...overrides,
  };
}

function dateInZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
