import { describe, expect, it } from "vitest";

import thesisSql from "../../seeds/0001_theses.sql?raw";
import baseIndicatorSql from "../../seeds/0002_sources_indicators.sql?raw";
import rainfallIndicatorSql from "../../seeds/0003_regional_rainfall.sql?raw";
import agricultureIndicatorSql from "../../seeds/0004_usda_fas_psd.sql?raw";
import energyIndicatorSql from "../../seeds/0005_eia_europe_brent.sql?raw";
import { decodeConfidenceComponents } from "./evaluation";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import { decodeThesisSeed, EVALUATION_INDICATOR_IDS } from "./thesis-seeds";

function mutableSeed(index = 0): Record<string, unknown> {
  return JSON.parse(JSON.stringify(INITIAL_THESIS_SEEDS[index])) as Record<string, unknown>;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return value as Record<string, unknown>[];
}

function objectAt(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

describe("initial thesis seed contract", () => {
  it("decodes all six versioned seeds and keeps only SHIP-EU-01 unpublishable", () => {
    expect(INITIAL_THESIS_SEEDS).toHaveLength(6);
    for (const seed of INITIAL_THESIS_SEEDS) {
      expect(decodeThesisSeed(seed)).toEqual(seed);
      expect(seed.methodologyVersion).toBe("evaluation-v1-draft");
      expect(seed.regionDefinitionVersion).toBeTruthy();  // D-group unlocked 2026-09-21
      expect(seed.target).not.toBe("");
      expect(seed.timeHorizon).not.toBe("");
      // D 组口径（2026-09-25）：覆盖缺口只做"数据覆盖不足"展示与置信度封顶，不再否决发布；
      // SHIP-EU-01 因结构性没有方向证据保持 publication=false，走日报豁免。
      expect(seed.readiness).toMatchObject({
        reviewStatus: "approved",
        productionEvaluation: true,
        publication: seed.id !== "SHIP-EU-01",
        marketEvidenceReady: false,
      });
      expect(seed.materialChangeThresholds).toEqual({
        reviewStatus: "pending",
        active: false,
        confidenceDeltaPoints: null,
        observationRevisionDelta: null,
      });
      // D 组 D3 签字：selectors 已 approved/active 并带层权重（control 层为 0）。
      expect(seed.indicatorSelectors.every((selector) =>
        selector.reviewStatus === "approved" && selector.active,
      )).toBe(true);
      expect(seed.indicatorSelectors.every((selector) =>
        selector.layer === "control" ? selector.weight === 0 : selector.weight > 0,
      )).toBe(true);
      // D 组 D3 签字（2026-09-22）：所有 SLO 都已审核并激活，maxAgeMinutes 由种子精确给出
      expect(seed.freshnessSlos.every(
        (slo) => slo.reviewStatus === "approved" && slo.active && slo.maxAgeMinutes !== null,
      )).toBe(true);
      expect([
        ...seed.supportRules,
        ...seed.refuteRules,
        ...seed.invalidationRules,
        ...seed.reliefRules,
      ].every((rule) => rule.reviewStatus === "approved" && rule.active)).toBe(true);
      // D 组 D4 签字：门槛已 approved/active 且 threshold=1；方案 A 例外——无 market 层证据的
      // 论点其 market_confirmed 门槛必须保持 pending（不得声明无法归因的市场确认）。
      const hasMarketLayer = seed.requiredEvidenceLayers.includes("market");
      expect(seed.stageGates.every((gate) => {
        const unprovableMarket = gate.targetStage === "market_confirmed" && !hasMarketLayer;
        return unprovableMarket
          ? gate.reviewStatus === "pending" && !gate.active && gate.minimumRuleMatches === null
          : gate.reviewStatus === "approved" && gate.active && gate.minimumRuleMatches === 1;
      })).toBe(true);
      // D 组 D5 签字（2026-09-24）：方向与置信度策略已审核启用。
      expect(seed.directionPolicy).toMatchObject({
        version: "direction-v1",
        reviewStatus: "approved",
        active: true,
      });
      expect(seed.directionPolicy.mappings.some(({ direction }) => direction !== null)).toBe(true);
      expect(seed.confidencePolicy).toEqual({
        version: "confidence-v1",
        reviewStatus: "approved",
        active: true,
        lateFreshnessScore: 59,
        sourceTierScores: { A: 100, B: 85, C: 70 },
        missingRequiredLayerCap: 49,
        coverageGapCap: 69,
      });
    }
  });

  it("rejects unknown fields at every decoded object boundary", () => {
    const root = mutableSeed();
    root.unknown = true;
    expect(() => decodeThesisSeed(root)).toThrow(/unknown field/);

    const mutations: ((seed: Record<string, unknown>) => void)[] = [
      (seed) => { objectArray(seed.indicatorSelectors)[0].unknown = true; },
      (seed) => { objectArray(seed.freshnessSlos)[0].unknown = true; },
      (seed) => { objectArray(seed.supportRules)[0].unknown = true; },
      (seed) => { objectAt(objectArray(seed.supportRules)[0].predicate).unknown = true; },
      (seed) => { objectArray(seed.stageGates)[0].unknown = true; },
      (seed) => { objectAt(seed.directionPolicy).unknown = true; },
      (seed) => { objectArray(objectAt(seed.directionPolicy).mappings)[0].unknown = true; },
      (seed) => { objectAt(seed.confidencePolicy).unknown = true; },
      (seed) => { objectAt(objectAt(seed.confidencePolicy).sourceTierScores).unknown = true; },
      (seed) => { objectAt(seed.materialChangeThresholds).unknown = true; },
      (seed) => { objectAt(seed.templateCopy).unknown = true; },
      (seed) => { objectArray(seed.coverageGaps)[0].unknown = true; },
      (seed) => { objectAt(seed.readiness).unknown = true; },
    ];
    for (const mutate of mutations) {
      const nested = mutableSeed();
      mutate(nested);
      expect(() => decodeThesisSeed(nested)).toThrow(/unknown field/);
    }
  });

  it("rejects invalid enums, weights and confidence scores", () => {
    const invalidEnum = mutableSeed();
    invalidEnum.defaultDirection = "up";
    expect(() => decodeThesisSeed(invalidEnum)).toThrow(/invalid enum/);

    const invalidWeight = mutableSeed();
    objectArray(invalidWeight.indicatorSelectors)[0].weight = 101;
    expect(() => decodeThesisSeed(invalidWeight)).toThrow(/integer from 0 to 100/);

    expect(() =>
      decodeConfidenceComponents({ coverage: 101, freshness: 50, sourceQuality: 50, agreement: 50 }),
    ).toThrow(/integer from 0 to 100/);
  });

  it("rejects an empty target or time horizon", () => {
    const emptyTarget = mutableSeed();
    emptyTarget.target = " ";
    expect(() => decodeThesisSeed(emptyTarget)).toThrow(/seed.target/);

    const emptyHorizon = mutableSeed();
    emptyHorizon.timeHorizon = "";
    expect(() => decodeThesisSeed(emptyHorizon)).toThrow(/seed.timeHorizon/);
  });

  it("rejects duplicate selector or rule IDs", () => {
    const duplicateSelector = mutableSeed(2);
    const selectors = objectArray(duplicateSelector.indicatorSelectors);
    selectors[1].id = selectors[0].id;
    expect(() => decodeThesisSeed(duplicateSelector)).toThrow(/duplicates/);

    const duplicateRule = mutableSeed();
    objectArray(duplicateRule.refuteRules)[0].id = objectArray(duplicateRule.supportRules)[0].id;
    expect(() => decodeThesisSeed(duplicateRule)).toThrow(/duplicate rule id/);
  });

  it("requires one explicit gate mapping per non-watch stage and validates its rule category", () => {
    const missingGate = mutableSeed();
    missingGate.stageGates = objectArray(missingGate.stageGates).slice(1);
    expect(() => decodeThesisSeed(missingGate)).toThrow(/exactly one gate/);

    const duplicateGate = mutableSeed();
    objectArray(duplicateGate.stageGates)[1].targetStage = "weather_realized";
    expect(() => decodeThesisSeed(duplicateGate)).toThrow(/duplicates/);

    const refutePromotion = mutableSeed();
    objectArray(refutePromotion.stageGates)[0].ruleIds = ["enso-refute"];
    expect(() => decodeThesisSeed(refutePromotion)).toThrow(/promotion gate may only reference support/);

    const supportEasing = mutableSeed();
    objectArray(supportEasing.stageGates)[4].ruleIds = ["enso-support"];
    expect(() => decodeThesisSeed(supportEasing)).toThrow(/easing gate may only reference relief\/invalidation/);

    const approvedGateWithPendingRule = mutableSeed();
    Object.assign(objectArray(approvedGateWithPendingRule.stageGates)[0], {
      reviewStatus: "pending",
      active: true,
      minimumRuleMatches: 1,
    });
    expect(() => decodeThesisSeed(approvedGateWithPendingRule)).toThrow(/pending items must be/);
  });

  it("keeps pending gate thresholds inactive and rejects unsatisfiable layer mappings", () => {
    // D 组 D4 后门槛已 approved；这里显式退回 pending 来守住"未审核门槛不得声明阈值"的不变式。
    const pendingThreshold = mutableSeed();
    Object.assign(objectArray(pendingThreshold.stageGates)[0], {
      reviewStatus: "pending",
      active: false,
      minimumRuleMatches: 1,
    });
    expect(() => decodeThesisSeed(pendingThreshold)).toThrow(/pending gate/);

    const undeclaredLayer = mutableSeed();
    objectArray(undeclaredLayer.stageGates)[0].requiredLayers = ["weather", "physical"];
    expect(() => decodeThesisSeed(undeclaredLayer))
      .toThrow(/must be declared in requiredEvidenceLayers/);

    const unavailableLayer = mutableSeed(5);
    objectArray(unavailableLayer.stageGates)[3].requiredLayers = ["weather", "physical", "market", "control"];
    unavailableLayer.requiredEvidenceLayers = ["weather", "physical", "market", "control"];
    expect(() => decodeThesisSeed(unavailableLayer)).toThrow(/neither selector nor (stage-blocking )?coverage gap/);
  });

  it("rejects selectors that reference an indicator outside the code-owned allowlist", () => {
    const seed = mutableSeed();
    objectArray(seed.indicatorSelectors)[0].indicatorId = "invented_market_price";
    expect(() => decodeThesisSeed(seed)).toThrow(/indicatorId: invalid enum/);
  });

  it("rejects numeric judgments while their selector, rule or thresholds remain pending", () => {
    // D 组 D3 后 selectors/rules 已 approved；同样显式退回 pending 守住 fail-closed。
    const weightedSelector = mutableSeed();
    Object.assign(objectArray(weightedSelector.indicatorSelectors)[0], {
      reviewStatus: "pending",
      active: false,
      weight: 1,
    });
    expect(() => decodeThesisSeed(weightedSelector)).toThrow(/pending selector/);

    const executableRule = mutableSeed();
    Object.assign(objectArray(executableRule.supportRules)[0], { reviewStatus: "pending", active: false });
    objectArray(executableRule.supportRules)[0].predicate = {
      kind: "numeric_compare",
      selectorId: "enso-roni",
      operator: "gt",
      threshold: 1,
      unit: "degC",
    };
    expect(() => decodeThesisSeed(executableRule)).toThrow(/pending rule/);

    const materialThreshold = mutableSeed();
    objectAt(materialThreshold.materialChangeThresholds).confidenceDeltaPoints = 10;
    expect(() => decodeThesisSeed(materialThreshold)).toThrow(/pending thresholds/);

    const incompleteApprovedThreshold = mutableSeed();
    Object.assign(objectAt(incompleteApprovedThreshold.materialChangeThresholds), {
      reviewStatus: "pending",
      active: true,
      confidenceDeltaPoints: 10,
    });
    expect(() => decodeThesisSeed(incompleteApprovedThreshold)).toThrow(/pending items must be/);

    // 未审核策略仍必须 fail-closed：显式把方向/置信度策略退回 pending 后再断言拒绝。
    const pendingDirection = mutableSeed();
    Object.assign(objectAt(pendingDirection.directionPolicy), { reviewStatus: "pending", active: false });
    objectArray(objectAt(pendingDirection.directionPolicy).mappings)[0].direction = "bullish";
    expect(() => decodeThesisSeed(pendingDirection)).toThrow(/pending direction policy/);

    const pendingLateScore = mutableSeed();
    Object.assign(objectAt(pendingLateScore.confidencePolicy), { reviewStatus: "pending", active: false });
    objectAt(pendingLateScore.confidencePolicy).lateFreshnessScore = 50;
    expect(() => decodeThesisSeed(pendingLateScore)).toThrow(/pending confidence policy/);

    const invalidTierScore = mutableSeed();
    objectAt(objectAt(invalidTierScore.confidencePolicy).sourceTierScores).A = 101;
    expect(() => decodeThesisSeed(invalidTierScore)).toThrow(/integer from 0 to 100/);
  });

  it("requires one explicit known direction mapping per rule", () => {
    const missingMapping = mutableSeed();
    objectAt(missingMapping.directionPolicy).mappings = objectArray(
      objectAt(missingMapping.directionPolicy).mappings,
    ).slice(1);
    expect(() => decodeThesisSeed(missingMapping)).toThrow(/exactly one mapping/);

    const duplicateMapping = mutableSeed();
    objectArray(objectAt(duplicateMapping.directionPolicy).mappings)[1].ruleId =
      objectArray(objectAt(duplicateMapping.directionPolicy).mappings)[0].ruleId;
    expect(() => decodeThesisSeed(duplicateMapping)).toThrow(/duplicates/);

    const unknownMapping = mutableSeed();
    objectArray(objectAt(unknownMapping.directionPolicy).mappings)[0].ruleId = "invented-rule";
    expect(() => decodeThesisSeed(unknownMapping)).toThrow(/unknown rule/);
  });

  it("rejects a required layer with neither a selector nor an explicit coverage gap", () => {
    const seed = mutableSeed(1);
    seed.coverageGaps = objectArray(seed.coverageGaps).filter((gap) => gap.layer !== "physical");
    seed.readiness = {
      ...seed.readiness as Record<string, unknown>,
      blockingGapIds: ["rubber-balance", "rubber-licensed-market"],
    };
    expect(() => decodeThesisSeed(seed)).toThrow(/physical has neither selector nor coverage gap/);
  });

  it("requires missing-layer gaps to block evaluation and every gap to block readiness", () => {
    const nonBlockingLayerGap = mutableSeed(1);
    const physicalGap = objectArray(nonBlockingLayerGap.coverageGaps).find(
      (gap) => gap.id === "rubber-physical-market",
    );
    if (physicalGap === undefined) throw new Error("test fixture is missing the rubber physical gap");
    physicalGap.blocks = ["publication"];
    expect(() => decodeThesisSeed(nonBlockingLayerGap)).toThrow(/must block stage and confidence/);

    const orphanGap = mutableSeed();
    objectAt(orphanGap.readiness).blockingGapIds = [];
    expect(() => decodeThesisSeed(orphanGap)).toThrow(/must block readiness/);
  });

  it("keeps Europe mixed and fails closed when missing market evidence is marked ready", () => {
    const europe = mutableSeed(5);
    europe.defaultDirection = "bullish";
    expect(() => decodeThesisSeed(europe)).toThrow(/must default to mixed/);

    const inheritedPanama = mutableSeed(5);
    objectArray(inheritedPanama.indicatorSelectors)[0].indicatorId =
      "regional_rainfall_panama_canal_catchment_v1";
    expect(() => decodeThesisSeed(inheritedPanama)).toThrow(/must not inherit Panama evidence/);

    const rubber = mutableSeed(1);
    rubber.readiness = {
      ...rubber.readiness as Record<string, unknown>,
      marketEvidenceReady: true,
    };
    expect(() => decodeThesisSeed(rubber)).toThrow(/market layer is missing/);
  });

  it("aligns stable identity fields exactly with the six SQL thesis rows", () => {
    for (const { id, slug, title, category, region, marketScope } of INITIAL_THESIS_SEEDS) {
      const exactSqlRow = `(${[
        id,
        slug,
        title,
        category,
        region,
        marketScope,
        "unassigned",
      ].map(sqlLiteral).join(", ")}, 1)`;
      expect(thesisSql).toContain(exactSqlRow);
    }
  });

  it("only selects indicator IDs present in the current SQL seeds", () => {
    const indicatorSql = [baseIndicatorSql, rainfallIndicatorSql, agricultureIndicatorSql, energyIndicatorSql].join("\n");
    for (const indicatorId of EVALUATION_INDICATOR_IDS) {
      expect(indicatorSql).toContain(`'${indicatorId}'`);
    }
    for (const seed of INITIAL_THESIS_SEEDS) {
      for (const selector of seed.indicatorSelectors) {
        expect(EVALUATION_INDICATOR_IDS).toContain(selector.indicatorId);
        expect(indicatorSql).toContain(`'${selector.indicatorId}'`);
      }
    }
  });

  it("labels proxies and estimates correctly and never promotes EIA beyond control", () => {
    const allSelectors = INITIAL_THESIS_SEEDS.flatMap((seed) => seed.indicatorSelectors);
    for (const selector of allSelectors.filter((item) => item.indicatorId.startsWith("regional_rainfall_"))) {
      expect(selector.notes).toContain("代理");
    }
    for (const selector of allSelectors.filter((item) => item.indicatorId.startsWith("usda_psd_"))) {
      expect(selector.notes).toContain("marketing-year estimate");
    }
    const eia = allSelectors.find((selector) => selector.indicatorId.startsWith("eia_"));
    expect(eia).toMatchObject({ layer: "control", defaultStance: "context" });
    expect(eia?.notes).toContain("不是船燃");
    const europe = INITIAL_THESIS_SEEDS.find(({ id }) => id === "SHIP-EU-01");
    expect(europe?.coverageGaps.find(
      ({ id }) => id === "eu-red-sea-capacity-demand-controls",
    )?.blocks).toContain("stage");
  });

  it("keeps missing sources explicit and all shared seeds deeply frozen", () => {
    const gaps = INITIAL_THESIS_SEEDS.flatMap((seed) => seed.coverageGaps.map((gap) => gap.description)).join("\n");
    expect(gaps).toContain("独立 ENSO");
    expect(gaps).toContain("原料现货");
    expect(gaps).toContain("MPOB");
    expect(gaps).toContain("CEC forecast");
    expect(gaps).toContain("ACP");
    expect(gaps).toContain("美东持牌");
    expect(gaps).toContain("欧线持牌");
    expect(Object.isFrozen(INITIAL_THESIS_SEEDS)).toBe(true);
    expect(Object.isFrozen(INITIAL_THESIS_SEEDS[0].indicatorSelectors[0])).toBe(true);
    expect(() => {
      Object.assign(INITIAL_THESIS_SEEDS[0].indicatorSelectors[0], { id: "mutated" });
    }).toThrow();
  });
});
