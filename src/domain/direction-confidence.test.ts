import { describe, expect, it } from "vitest";

import { scaledEpsilonTolerance } from "./internal/compare";
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
      // D3（2026-09-26 签字）：coverage/freshness 分母恒为种子全集 6 层（此处 forecast 缺失），
      // 不随 market_confirmed gate 的层集缩放。
      coverage: 83,
      freshness: 66,
      sourceQuality: 76,
      agreement: 100,
    });
    expect(result.confidence.weightedScore).toBe(80);
    expect(result.confidence.finalScore).toBe(80);
    // D1 过渡守卫：命中方向的规则均为 selector_present，方向不判定（保留默认方向）。
    expect(result.direction.status).toBe("unavailable");
    expect(result.direction.direction).toBe("neutral");
    expect(result).toMatchSnapshot();
  });

  it("treats support-only and refute-only evidence symmetrically", () => {
    // 数值比较规则参与命中（D1 守卫解除），方向分辨率机制本身保持可验证。
    const base = reviewedSeed();
    const seed = {
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "support-weather"
        ? numericRule("support-weather", "weather-support", "gt", 0)
        : rule),
      refuteRules: base.refuteRules.map((rule) => rule.id === "refute-weather"
        ? numericRule("refute-weather", "weather-refute", "gt", 0)
        : rule),
    };
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
    const base = reviewedSeed();
    const seed = {
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "support-weather"
        ? numericRule("support-weather", "weather-support", "gt", 0)
        : rule),
      refuteRules: base.refuteRules.map((rule) => rule.id === "refute-weather"
        ? numericRule("refute-weather", "weather-refute", "gt", 0)
        : rule),
    };
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

  it("compares the rebuilt stage result key-order independently at the evaluation boundary", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support"]);
    const stage = evaluateStageGates(seed, selected, { previousStage: "watch" });
    // JSON 往返 + 逐层反转键序：等价对象的键插入顺序不同不应把合法阶段结果误判为伪造。
    const reordered = reverseObjectKeys(JSON.parse(JSON.stringify(stage))) as StageGateResult;

    const baseline = evaluateDirectionAndConfidence(seed, selected, stage);
    const result = evaluateDirectionAndConfidence(seed, selected, reordered);

    expect(result).toEqual(baseline);
    expect(result.confidence.status).toBe("available");
  });

  it("reads the forecast-only, stale-layer and conflict caps from the reviewed policy", () => {
    const base = reviewedSeed();
    const seed = reviewedSeed({
      confidencePolicy: {
        ...base.confidencePolicy,
        forecastOnlyCap: 30,
        requiredLayerStaleCap: 45,
        unexplainedConflictCap: 55,
      },
    });

    const forecastSelection = selection(seed, ["forecast"]);
    const forecast = evaluateDirectionAndConfidence(
      seed,
      forecastSelection,
      evaluateStageGates(seed, forecastSelection, { previousStage: "watch" }),
    );
    expect(forecast.confidence.appliedCaps).toContainEqual(expect.objectContaining({
      code: "FORECAST_ONLY",
      maximum: 30,
    }));
    expect(forecast.confidence.finalScore).toBeLessThanOrEqual(30);

    const staleSelection = selection(seed, ["forecast", "weather-refute"], {
      staleSelectorIds: ["market"],
    });
    const stale = evaluateDirectionAndConfidence(
      seed,
      staleSelection,
      evaluateStageGates(seed, staleSelection, { previousStage: "watch" }),
    );
    expect(stale.confidence.appliedCaps.map(({ code, maximum }) => ({ code, maximum }))).toEqual(
      expect.arrayContaining([
        { code: "REQUIRED_LAYER_STALE", maximum: 45 },
        { code: "UNEXPLAINED_CONFLICT", maximum: 55 },
      ]),
    );
    expect(stale.confidence.appliedCaps).not.toContainEqual(
      expect.objectContaining({ code: "FORECAST_ONLY" }),
    );
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

  it("applies the approved D5 direction and confidence policy to all six production seeds", () => {
    const results = INITIAL_THESIS_SEEDS.map((seed) => {
      const selected = selection(seed, []);
      return evaluateDirectionAndConfidence(
        seed,
        selected,
        evaluateStageGates(seed, selected, { previousStage: "watch" }),
      );
    });

    expect(results).toHaveLength(6);
    // D 组 D5 签字后方向/置信度策略已 approved/active（策略版本落库为 direction-v1 /
    // confidence-v1）。注意：逐条 selectors/rules/stage gates 仍处于 pending（D3/D4 未签字），
    // 因此空选择下方向依旧不可解析——那是规则门禁，不是策略门禁。
    expect(results.every(({ direction }) => direction.policyVersion === "direction-v1")).toBe(true);
    expect(results.every(({ confidence }) => confidence.policyVersion === "confidence-v1")).toBe(true);
    expect(results.every(({ confidence }) => confidence.finalScore <= 100)).toBe(true);
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

  it("fails closed when a stale stage result still carries the retired manual-forward-skip markers", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support", "physical", "balance", "market"]);
    const stage = evaluateStageGates(seed, selected, { previousStage: "watch" });
    // D2（2026-09-26 签字）删除了 manualConfirmationApplied / manual_forward_skip 通道；
    // 携带已退役标记或被篡改阶段的过期载荷无法通过重建校验，必须整体 fail-closed。
    const legacyStage = JSON.parse(JSON.stringify({
      ...stage,
      stage: "market_confirmed",
      transition: "manual_forward_skip",
      manualConfirmationApplied: true,
    })) as StageGateResult;

    const result = evaluateDirectionAndConfidence(seed, selected, legacyStage);

    expect(result).toMatchObject({
      stage: "watch",
      direction: { status: "unavailable", ruleHits: [] },
      confidence: { status: "unavailable", finalScore: 0 },
    });
    expect(result.direction.reasons.join("\n")).toContain("重建");
  });

  it("keeps direction unavailable while only selector_present rules decide it (D1 guard)", () => {
    const seed = reviewedSeed();
    const selected = selection(seed, ["weather-support"]);
    const result = evaluateDirectionAndConfidence(
      seed,
      selected,
      evaluateStageGates(seed, selected, { previousStage: "watch" }),
    );

    // 命中方向的规则仅有 selector_present 谓词：方向不判定，保留 seed 的有范围默认方向，
    // 但命中记录（matchedDirections/ruleHits）仍然如实输出供审计。
    expect(result.direction.status).toBe("unavailable");
    expect(result.direction.direction).toBe("neutral");
    expect(result.direction.matchedDirections).toEqual(["bullish"]);
    expect(result.direction.ruleHits).toContainEqual(expect.objectContaining({
      ruleId: "support-weather",
    }));
    expect(result.direction.reasons.join("\n")).toContain("数值比较规则尚未上线，方向暂不判定");
    // D1 最小语义：守卫只影响 direction 字段，confidence 仍按固定公式计算。
    expect(result.confidence.status).toBe("available");

    // 数值比较规则参与命中后，守卫解除，方向恢复判定。
    const numericSeed = {
      ...seed,
      supportRules: seed.supportRules.map((rule) => rule.id === "support-weather"
        ? numericRule("support-weather", "weather-support", "gt", 0)
        : rule),
    };
    const numericSelection = selection(numericSeed, ["weather-support"]);
    const numericResult = evaluateDirectionAndConfidence(
      numericSeed,
      numericSelection,
      evaluateStageGates(numericSeed, numericSelection, { previousStage: "watch" }),
    );
    expect(numericResult.direction).toMatchObject({ status: "available", direction: "bullish" });
  });

  it("keeps the coverage denominator fixed to the seed's full layer set across stages (D3)", () => {
    const base = reviewedSeed();
    const seed = reviewedSeed({
      confidencePolicy: {
        ...base.confidencePolicy,
        missingRequiredLayerCap: 40,
      },
    });
    const selected = selection(seed, ["weather-support", "physical", "balance", "market", "control"]);

    for (const previousStage of ["watch", "weather_realized", "balance_tightening", "market_confirmed"] as const) {
      const stage = evaluateStageGates(seed, selected, { previousStage });
      const result = evaluateDirectionAndConfidence(seed, selected, stage);

      // 同一证据跨阶段分母不变：始终是种子全集（6 层），只有 forecast 缺失。
      expect(result.confidence.explanations.coverage.requiredLayers).toEqual([
        "forecast", "weather", "physical", "balance", "market", "control",
      ]);
      expect(result.confidence.components.coverage).toBe(83);
      // 分母同源：MISSING_REQUIRED_LAYER cap 在高阶段也按全集口径列出缺失层。
      expect(result.confidence.appliedCaps).toContainEqual(expect.objectContaining({
        code: "MISSING_REQUIRED_LAYER",
        maximum: 40,
        reason: expect.stringContaining("forecast"),
      }));
    }
  });
});

describe("ENSO numeric threshold semantics (D3 signed rule)", () => {
  const ensoSeed = INITIAL_THESIS_SEEDS.find(({ id }) => id === "ENSO-CORE-01");
  if (ensoSeed === undefined) throw new TypeError("missing ENSO-CORE-01 seed");

  const ensoEvaluation = (value: number) => {
    const selection = selectionFromEvidence(ensoSeed, [
      selected(ensoSeed, "enso-roni", { value, unit: "°C" }),
    ]);
    return evaluateDirectionAndConfidence(
      ensoSeed,
      selection,
      evaluateStageGates(ensoSeed, selection, { previousStage: "watch" }),
    );
  };

  it("hits at exactly +0.5 (≥ includes equality) and releases the D1 guard", () => {
    const result = ensoEvaluation(0.5);
    expect(result.direction).toMatchObject({
      status: "available",
      direction: "bullish",
      matchedDirections: ["bullish"],
    });
    // 组合语义：存在性 enso-support 与数值 enso-numeric-support 同时命中，数值规则参与后守卫解除。
    expect(result.direction.ruleHits.map(({ ruleId }) => ruleId)).toEqual([
      "enso-numeric-support",
      "enso-support",
    ]);
  });

  it("treats a value just below the threshold within the shared 4×EPSILON tolerance as equal", () => {
    // 「0.4999…」型表示误差：0.5 − ε/2 是 0.5 下方最近的 double，与阈值之差落在签字容差
    // （4×EPSILON×max(1, |值|, |阈值|) = 4×EPSILON）内，按「恰好等于阈值」命中（≥ 含等）。
    const result = ensoEvaluation(0.5 - Number.EPSILON / 2);
    expect(result.direction).toMatchObject({ status: "available", direction: "bullish" });
  });

  it("keeps direction unavailable below the tolerance bound as threshold semantics, not a guard regression", () => {
    const result = ensoEvaluation(0.4999);
    expect(result.direction).toMatchObject({
      status: "unavailable",
      direction: "neutral",
      matchedDirections: ["bullish"],
    });
    // 数值规则未命中；唯一命中的方向规则是存在性 enso-support → D1 守卫输出不可判。
    // 这是阈值语义（RONI 低于事件确立线），不是守卫回归（worksheet §6.1）。
    expect(result.direction.ruleHits.map(({ ruleId }) => ruleId)).toEqual(["enso-support"]);
    expect(result.direction.ruleRejections).toContainEqual(expect.objectContaining({
      ruleId: "enso-numeric-support",
      code: "NOT_MATCHED",
    }));
    expect(result.direction.reasons).toContainEqual(
      expect.stringContaining("数值比较规则尚未上线，方向暂不判定"),
    );
  });

  it("restores an available bullish direction for typical ENSO evidence (JJA 2026 RONI +1.4)", () => {
    expect(ensoEvaluation(1.4).direction).toMatchObject({ status: "available", direction: "bullish" });
  });

  it("keeps the D1 guard triggered when signed seeds only have presence evidence", () => {
    // 橡胶/棕榈/玉米已有数值规则，但这组证据只给到原降水代理，数值 selector 没有观测，
    // 命中方向的仍只有存在性规则，守卫继续。USEC 与欧线本轮没有数值规则。
    const unitsByFirstSelector: Record<string, string> = {
      "rubber-rainfall-proxy": "mm/day",
      "palm-rainfall-proxy": "mm/day",
      "maize-rainfall-proxy": "mm/day",
      "usec-panama-rainfall-proxy": "mm/day",
      "eu-brent-control": "USD/bbl",
    };
    for (const seed of INITIAL_THESIS_SEEDS.filter(({ id }) => id !== "ENSO-CORE-01")) {
      const selector = seed.indicatorSelectors[0];
      if (selector === undefined) throw new TypeError(`missing first selector for ${seed.id}`);
      const selection = selectionFromEvidence(seed, [
        selected(seed, selector.id, { value: 1, unit: unitsByFirstSelector[selector.id] ?? "test-unit" }),
      ]);
      const result = evaluateDirectionAndConfidence(
        seed,
        selection,
        evaluateStageGates(seed, selection, { previousStage: "watch" }),
      );
      expect(result.direction.status).toBe("unavailable");
      if (seed.id === "SHIP-EU-01") {
        // Brent 是 control/context 证据，不参与方向计算（CONTEXT_ONLY），与守卫无关。
        expect(result.direction.ruleRejections.every(({ code }) => code === "CONTEXT_ONLY")).toBe(true);
      } else {
        // 存在性规则命中、无数值规则参与 → 守卫继续触发（未来种子的 fail-closed 保险丝）。
        expect(result.direction.reasons).toContainEqual(
          expect.stringContaining("数值比较规则尚未上线，方向暂不判定"),
        );
      }
    }
  });

  it("releases the D1 guard only past the signed strict thresholds", () => {
    // 签字是严格小于（−25/−10/−15/−25/−25）。恰好等于阈值在 4×EPSILON 内容差内视为相等，
    // `<` 不命中；存在性规则此时也没有降水代理证据，所以没有方向命中。越过容差下界才偏多。
    const cases = [
      ["RUBBER-TH-01", "rubber-rain-anomaly-30d", "rubber-numeric-anomaly-support", -25],
      ["PALM-SEA-01", "palm-rain-anomaly-90d", "palm-numeric-rain-support", -25],
      ["PALM-SEA-01", "palm-ending-stocks-yoy", "palm-numeric-stocks-support", -10],
      ["MAIZE-SA-01", "maize-production-vs-5yr", "maize-numeric-mean-support", -15],
      ["MAIZE-SA-01", "maize-rain-anomaly-crop-window", "maize-numeric-window-support", -25],
    ] as const;
    for (const [thesisId, selectorId, ruleId, threshold] of cases) {
      const seed = INITIAL_THESIS_SEEDS.find(({ id }) => id === thesisId);
      if (seed === undefined) throw new TypeError(`missing ${thesisId}`);
      const atThreshold = evaluateSigned(seed, selectorId, threshold);
      const withinTolerance = evaluateSigned(seed, selectorId, justInside(threshold));
      const beyondTolerance = evaluateSigned(seed, selectorId, justOutside(threshold));
      expect(atThreshold.direction).toMatchObject({ status: "unavailable", direction: "neutral" });
      expect(atThreshold.direction.ruleHits.map(({ ruleId: id }) => id)).not.toContain(ruleId);
      expect(withinTolerance.direction.ruleHits.map(({ ruleId: id }) => id)).not.toContain(ruleId);
      expect(beyondTolerance.direction).toMatchObject({ status: "available", direction: "bullish" });
      expect(beyondTolerance.direction.ruleHits.map(({ ruleId: id }) => id)).toEqual([ruleId]);
    }
  });
});

/** 容差带内的下一档：仍被 4×EPSILON 视为等于阈值。 */
function justInside(threshold: number): number {
  return threshold - scaledEpsilonTolerance(threshold, threshold) / 2;
}

/** 容差带外的下一档。大阈值上一次减法会被 IEEE 舍入吞掉，所以按实际比较结果向外走。 */
function justOutside(threshold: number): number {
  const step = scaledEpsilonTolerance(threshold, threshold);
  let value = threshold - step;
  while (Math.abs(value - threshold) <= scaledEpsilonTolerance(value, threshold)) {
    value -= step;
  }
  return value;
}

function evaluateSigned(
  seed: ThesisSeed,
  selectorId: string,
  value: number,
) {
  const selection = selectionFromEvidence(seed, [
    selected(seed, selectorId, { value, unit: "%" }),
  ]);
  return evaluateDirectionAndConfidence(
    seed,
    selection,
    evaluateStageGates(seed, selection, { previousStage: "watch" }),
  );
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]),
    );
  }
  return value;
}

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
      forecastOnlyCap: null,
      requiredLayerStaleCap: null,
      unexplainedConflictCap: null,
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
