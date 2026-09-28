import { describe, expect, it } from "vitest";

import { evaluateDirectionAndConfidence } from "./direction-confidence";
import type {
  EvaluationEvidenceInput,
} from "./evaluation";
import { selectEvidence } from "./evidence-selector";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import {
  detectMaterialChanges,
  type MaterialChangeSnapshot,
} from "./material-change";
import { evaluateRulePredicate } from "./rule-predicate";
import { evaluateStageGates } from "./stage-gate";
import {
  decodeThesisSeed,
  type EvaluationIndicatorId,
  type RuleDescriptor,
  type ThesisSeed,
} from "./thesis-seeds";

const BEFORE_CUTOFF = "2026-09-08T12:00:00.000Z";
const AFTER_CUTOFF = "2026-09-08T13:00:00.000Z";

describe("detectMaterialChanges", () => {
  it("keeps all six production seeds unavailable while change policy and readiness are pending", async () => {
    for (const seed of INITIAL_THESIS_SEEDS) {
      const before = snapshot(seed, "watch", BEFORE_CUTOFF, []);
      const after = snapshot(seed, "watch", AFTER_CUTOFF, []);

      await expect(detectMaterialChanges(seed, before, after)).resolves.toMatchObject({
        status: "unavailable",
        thesisId: seed.id,
        changes: [],
        reasons: [expect.stringContaining("尚未通过研究审核")],
      });
    }
  });

  it("returns an available deterministic empty result when no material condition changed", async () => {
    const seed = reviewedSeed();
    const input = evidence(seed, "weather-support", { value: 11 });
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [input]);
    const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [input]);

    const result = await detectMaterialChanges(seed, before, after);

    expect(result).toEqual({
      status: "available",
      thesisId: seed.id,
      methodologyVersion: seed.methodologyVersion,
      regionDefinitionVersion: seed.regionDefinitionVersion,
      target: seed.target,
      marketScope: seed.marketScope,
      timeHorizon: seed.timeHorizon,
      beforeCutoff: BEFORE_CUTOFF,
      afterCutoff: AFTER_CUTOFF,
      changes: [],
      reasons: ["前后快照没有达到已审核的重大变化条件"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("merges stage, direction and confidence triggers into one thesis change", async () => {
    const seed = reviewedSeed();
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
      // D3 后前后 coverage/freshness 同分母不再产生差值，用来源等级降级补足置信度触发。
      evidence(seed, "weather-refute", { value: 11, sourceTier: "C" }),
    ]);
    const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
      evidence(seed, "weather-support", { value: 11 }),
    ]);

    const result = await detectMaterialChanges(seed, before, after);
    const thesisChange = result.changes.find(({ changeType }) => changeType === "thesis");

    expect(thesisChange).toMatchObject({
      changeClass: "thesis",
      changeType: "thesis",
      publishing: {
        reviewPath: "requires_published_thesis_version",
        automaticPublication: "not_authorized",
      },
      triggers: [
        { kind: "stage", before: "watch", after: "weather_realized" },
        { kind: "direction", before: "bearish", after: "bullish" },
        { kind: "confidence", threshold: 10 },
      ],
    });
    expect(result.changes.filter(({ changeType }) => changeType === "thesis")).toHaveLength(1);
    if (thesisChange?.changeType !== "thesis") throw new TypeError("expected one thesis change");
    expect(thesisChange?.idempotencyKey).toMatch(/^material-change-v1:sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(thesisChange.triggers)).toBe(true);
  });

  it("uses the reviewed confidence threshold inclusively at 9, 10 and 11 points", async () => {
    const ninePointSeed = reviewedSeed({ sourceTierScores: { A: 100, B: 60, C: 64 } });
    const tenPointSeed = ninePointSeed;
    const elevenPointSeed = reviewedSeed({ sourceTierScores: { A: 100, B: 60, C: 56 } });

    const nine = await confidenceChange(ninePointSeed, "C", "A");
    const ten = await confidenceChange(tenPointSeed, "B", "A");
    const eleven = await confidenceChange(elevenPointSeed, "C", "A");

    expect(thesisTriggers(nine)).not.toContainEqual(expect.objectContaining({ kind: "confidence" }));
    // D3（2026-09-26 签字）后 coverage/freshness 分母为种子全集：coverage 25、freshness 20，
    // 分值本身变化，但仅 sourceQuality 不同的前后置信度差值不变（tier 差 × 25% 权重）。
    expect(thesisTriggers(ten)).toContainEqual({
      kind: "confidence",
      before: 48,
      after: 58,
      absoluteDelta: 10,
      threshold: 10,
    });
    expect(thesisTriggers(eleven)).toContainEqual({
      kind: "confidence",
      before: 47,
      after: 58,
      absoluteDelta: 11,
      threshold: 10,
    });
  });

  it("does not create a direction trigger while the D1 guard keeps a direction unavailable", async () => {
    const base = reviewedSeed();
    // 把 weather 支持规则换成 selector_present：before 只有 selector_present 命中，
    // D1 守卫输出 unavailable（方向值回到默认 neutral）；after 由 numeric 规则命中 bullish。
    const guardedSeed = {
      ...base,
      supportRules: base.supportRules.map((rule) => rule.id === "support-weather"
        ? {
            id: "support-weather",
            label: "support weather present",
            reviewStatus: "approved" as const,
            active: true,
            predicate: {
              kind: "selector_present" as const,
              selectorIds: ["weather-support"],
              minimumMatches: 1,
            },
          }
        : rule),
    };
    const before = snapshot(guardedSeed, "watch", BEFORE_CUTOFF, [
      evidence(guardedSeed, "weather-support", { value: 11 }),
    ]);
    const after = snapshot(guardedSeed, before.evaluation.stage, AFTER_CUTOFF, [
      evidence(guardedSeed, "market", { value: 11 }),
    ]);

    expect(before.evaluation.direction).toMatchObject({ status: "unavailable", direction: "neutral" });
    expect(after.evaluation.direction).toMatchObject({ status: "available", direction: "bullish" });

    const result = await detectMaterialChanges(guardedSeed, before, after);

    // 方向值虽从 neutral 变为 bullish，但前值 unavailable：不触发方向变化审核。
    expect(thesisTriggers(result)).not.toContainEqual(expect.objectContaining({ kind: "direction" }));
  });

  it("emits independent entered and exited threshold facts from reviewed numeric rules", async () => {
    const seed = reviewedSeed();
    const entered = await thresholdTransition(seed, 9, 11);
    const exited = await thresholdTransition(seed, 11, 9);

    expect(factChanges(entered, "threshold")).toEqual([
      expect.objectContaining({
        changeClass: "fact",
        changeType: "threshold",
        ruleId: "support-weather",
        selectorId: "weather-support",
        indicatorId: "regional_rainfall_southern_thailand_rubber_v1",
        transition: "entered",
        predicate: { operator: "gt", threshold: 10, unit: "test-unit" },
        before: expect.objectContaining({ value: 9 }),
        after: expect.objectContaining({ value: 11 }),
        publishing: {
          reviewPath: "independent_fact_review",
          automaticPublication: "not_authorized",
        },
      }),
    ]);
    expect(factChanges(exited, "threshold")).toEqual([
      expect.objectContaining({
        ruleId: "support-weather",
        transition: "exited",
        before: expect.objectContaining({ value: 11 }),
        after: expect.objectContaining({ value: 9 }),
      }),
    ]);
    expect(factChanges(entered, "threshold")[0]?.idempotencyKey)
      .not.toBe(factChanges(exited, "threshold")[0]?.idempotencyKey);
  });

  it("does not fall back to an older numeric value when the latest selector value is text", async () => {
    const seed = reviewedSeed();
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
      evidence(seed, "weather-support", {
        evidenceId: "weather-before",
        observedAt: "2026-09-08T09:00:00.000Z",
        value: 9,
      }),
    ]);
    const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
      evidence(seed, "weather-support", {
        evidenceId: "weather-after-older-number",
        observedAt: "2026-09-08T09:00:00.000Z",
        value: 11,
      }),
      evidence(seed, "weather-support", {
        evidenceId: "weather-after-latest-text",
        observedAt: "2026-09-08T10:00:00.000Z",
        value: "not-applicable",
      }),
    ]);

    const result = await detectMaterialChanges(seed, before, after);

    expect(factChanges(result, "threshold")).toEqual([]);
  });

  it("does not execute pending numeric rules", async () => {
    const base = reviewedSeed();
    const pendingRule: RuleDescriptor = {
      id: "pending-weather-threshold",
      label: "pending weather threshold",
      reviewStatus: "pending",
      active: false,
      predicate: {
        kind: "numeric_compare",
        selectorId: "weather-support",
        operator: "gt",
        threshold: 5,
        unit: "test-unit",
      },
    };
    const seed: ThesisSeed = {
      ...base,
      supportRules: [...base.supportRules, pendingRule],
      directionPolicy: {
        ...base.directionPolicy,
        mappings: [...base.directionPolicy.mappings, { ruleId: pendingRule.id, direction: null }],
      },
    };
    const result = await thresholdTransition(seed, 4, 6);

    expect(factChanges(result, "threshold")).toEqual([]);
  });

  it("detects only same-period forward numeric revisions at or above the reviewed value delta", async () => {
    const seed = reviewedSeed();

    expect(factChanges(await revisionTransition(seed, 11, 11.5, 0, 1), "revision")).toEqual([]);
    expect(factChanges(await revisionTransition(seed, 11, 12, 0, 1), "revision")).toEqual([
      expect.objectContaining({
        selectorId: "weather-support",
        observedAt: "2026-09-08T10:00:00.000Z",
        absoluteValueDelta: 1,
        requiredValueDelta: 1,
        before: expect.objectContaining({ revision: 0, value: 11 }),
        after: expect.objectContaining({ revision: 1, value: 12 }),
      }),
    ]);
    expect(factChanges(await revisionTransition(seed, 11, 13, 0, 2), "revision")).toHaveLength(1);
    expect(factChanges(await revisionTransition(seed, 11, 11, 0, 1), "revision")).toEqual([]);
  });

  it("treats a decimal delta mathematically equal to the reviewed threshold as inclusive", async () => {
    const seed = {
      ...reviewedSeed(),
      materialChangeThresholds: {
        reviewStatus: "approved" as const,
        active: true,
        confidenceDeltaPoints: 10,
        observationRevisionDelta: 0.1,
      },
    };

    const result = await revisionTransition(seed, 0.2, 0.3, 0, 1);

    expect(factChanges(result, "revision")).toEqual([
      expect.objectContaining({
        absoluteValueDelta: 0.09999999999999998,
        requiredValueDelta: 0.1,
      }),
    ]);
  });

  it("judges the same inclusive boundary identically through numeric_compare and the revision delta", async () => {
    // D3 容差签字（threshold-worksheet §5）：numeric_compare 与修订达标判定（meetsInclusiveDelta）
    // 共用 internal/compare 的 4×EPSILON 缩放容差。before 值取 0 使 revision 路径的容差标定
    // （max(1, |before|, |after|, |required|)）与 numeric_compare（max(1, |值|, |阈值|)）一致，
    // 两条路径对同一边界值必须给出相同答案——否则方向判定与修订达标判定会互相矛盾。
    const base = reviewedSeed();
    const seed: ThesisSeed = {
      ...base,
      supportRules: [numericRule("support-weather", "weather-support", "gte", 0.5)],
      materialChangeThresholds: {
        reviewStatus: "approved" as const,
        active: true,
        confidenceDeltaPoints: 10,
        observationRevisionDelta: 0.5,
      },
    };
    const rule = seed.supportRules[0];
    if (rule?.predicate.kind !== "numeric_compare") throw new TypeError("expected numeric rule");
    const predicateHit = (value: number) => evaluateRulePredicate(
      rule.predicate,
      selectEvidence(seed, AFTER_CUTOFF, [evidence(seed, "weather-support", { value })]).selectedEvidence,
    ).length;

    const withinTolerance = 0.5 - Number.EPSILON / 2; // 「0.4999…」型表示误差：按恰好等于阈值
    const justAbove = 0.5 + Number.EPSILON; // 容差内上方：≥ 同样命中
    const beyondBound = 0.5 - Number.EPSILON * 5; // 恰低于容差下界：不再视为相等
    const plainlyBelow = 0.4999; // 人类刻度上的低于阈值

    for (const value of [0.5, withinTolerance, justAbove]) {
      expect(predicateHit(value)).toBe(1);
      expect(factChanges(await revisionTransition(seed, 0, value, 0, 1), "revision")).toHaveLength(1);
    }
    for (const value of [beyondBound, plainlyBelow]) {
      expect(predicateHit(value)).toBe(0);
      expect(factChanges(await revisionTransition(seed, 0, value, 0, 1), "revision")).toEqual([]);
    }
  });

  it("rejects cross-period, unit/text and revision rollback false positives", async () => {
    const seed = reviewedSeed();

    const crossPeriod = await revisionTransition(seed, 11, 13, 0, 1, {
      afterObservedAt: "2026-09-09T10:00:00.000Z",
    });
    const changedUnit = await revisionTransition(seed, 11, 13, 0, 1, {
      afterUnit: "other-unit",
    });
    const textAfter = await revisionTransition(seed, 11, "revised", 0, 1);
    const rollback = await revisionTransition(seed, 11, 13, 1, 0);

    for (const result of [crossPeriod, changedUnit, textAfter, rollback]) {
      expect(factChanges(result, "revision")).toEqual([]);
    }
  });

  it("does not create a confidence trigger when either confidence result is unavailable", async () => {
    const base = reviewedSeed();
    const seed = {
      ...base,
      confidencePolicy: {
        ...base.confidencePolicy,
        reviewStatus: "pending" as const,
        active: false,
        lateFreshnessScore: null,
        sourceTierScores: { A: null, B: null, C: null },
      },
    };
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
      evidence(seed, "weather-support", { sourceTier: "B", value: 11 }),
    ]);
    const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
      evidence(seed, "weather-support", { sourceTier: "A", value: 11 }),
    ]);

    const result = await detectMaterialChanges(seed, before, after);

    expect(thesisTriggers(result)).not.toContainEqual(expect.objectContaining({ kind: "confidence" }));
  });

  it("fails closed when selection, evaluation identity or the snapshot chain is forged", async () => {
    const seed = reviewedSeed();
    const input = evidence(seed, "weather-support", { value: 11 });
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [input]);
    const validAfter = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [input]);
    const forgedSelection = {
      ...validAfter,
      selection: { ...validAfter.selection, selectedEvidence: [] },
    };
    const forgedEvaluation = {
      ...validAfter,
      evaluation: { ...validAfter.evaluation, target: "forged target" },
    };
    const brokenChain = { ...validAfter, previousStage: "watch" as const };

    for (const candidate of [forgedSelection, forgedEvaluation, brokenChain]) {
      const result = await detectMaterialChanges(seed, before, candidate);
      expect(result.status).toBe("unavailable");
      expect(result.changes).toEqual([]);
    }
  });

  it("fails closed instead of throwing for malformed canonical snapshot members", async () => {
    const seed = reviewedSeed();
    const input = evidence(seed, "weather-support", { value: 11 });
    const before = snapshot(seed, "watch", BEFORE_CUTOFF, [input]);
    const validAfter = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [input]);
    const sparseEvidence = new Array(1) as unknown as MaterialChangeSnapshot["selection"]["selectedEvidence"];
    const malformed = {
      ...validAfter,
      selection: { ...validAfter.selection, selectedEvidence: sparseEvidence },
    };

    await expect(detectMaterialChanges(seed, before, malformed)).resolves.toMatchObject({
      status: "unavailable",
      changes: [],
      reasons: [expect.stringContaining("无法安全重建")],
    });

    await expect(detectMaterialChanges(
      seed,
      before,
      { ...validAfter, selection: null } as unknown as MaterialChangeSnapshot,
    )).resolves.toMatchObject({
      status: "unavailable",
      afterCutoff: "",
      changes: [],
    });
  });

  it("keeps fact-change keys stable across input order and cutoff changes while retaining audit cutoffs", async () => {
    const seed = reviewedSeed();
    const beforeEvidence = evidence(seed, "weather-support", { value: 9 });
    const afterEvidence = evidence(seed, "weather-support", { value: 11 });
    const irrelevant = evidence(seed, "physical", { value: 0 });
    const firstBefore = snapshot(seed, "watch", BEFORE_CUTOFF, [irrelevant, beforeEvidence]);
    const firstAfter = snapshot(seed, firstBefore.evaluation.stage, AFTER_CUTOFF, [afterEvidence, irrelevant]);
    const secondBefore = snapshot(seed, "watch", AFTER_CUTOFF, [beforeEvidence, irrelevant]);
    const secondAfter = snapshot(
      seed,
      secondBefore.evaluation.stage,
      "2026-09-08T14:00:00.000Z",
      [irrelevant, afterEvidence],
    );

    const first = await detectMaterialChanges(seed, firstBefore, firstAfter);
    const repeated = await detectMaterialChanges(seed, firstBefore, firstAfter);
    const shifted = await detectMaterialChanges(seed, secondBefore, secondAfter);
    const firstThreshold = factChanges(first, "threshold")[0];
    const repeatedThreshold = factChanges(repeated, "threshold")[0];
    const shiftedThreshold = factChanges(shifted, "threshold")[0];

    expect(first).toEqual(repeated);
    expect(firstThreshold?.idempotencyKey).toBe(repeatedThreshold?.idempotencyKey);
    expect(firstThreshold?.idempotencyKey).toBe(shiftedThreshold?.idempotencyKey);
    expect(firstThreshold?.beforeCutoff).toBe(BEFORE_CUTOFF);
    expect(shiftedThreshold?.beforeCutoff).toBe(AFTER_CUTOFF);
  });

  it("produces a different thesis key when the same change replays across cutoffs", async () => {
    const seed = reviewedSeed();
    const thesisChange = async (beforeCutoff: string, afterCutoff: string) => {
      const before = snapshot(seed, "watch", beforeCutoff, [
        evidence(seed, "weather-refute", { value: 11 }),
      ]);
      const after = snapshot(seed, before.evaluation.stage, afterCutoff, [
        evidence(seed, "weather-support", { value: 11 }),
      ]);
      const result = await detectMaterialChanges(seed, before, after);
      const change = result.changes.find(({ changeType }) => changeType === "thesis");
      if (change?.changeType !== "thesis") throw new TypeError("expected one thesis change");
      return change;
    };

    const first = await thesisChange(BEFORE_CUTOFF, AFTER_CUTOFF);
    const replayed = await thesisChange(AFTER_CUTOFF, "2026-09-08T14:00:00.000Z");

    // 触发与前后状态完全相同，仅重放窗口（cutoff 对）不同：key 必须不同，
    // 使重放不会被旧评估的 change key 去重吞掉。
    expect(replayed.triggers).toEqual(first.triggers);
    expect(replayed.before).toEqual(first.before);
    expect(replayed.after).toEqual(first.after);
    expect(first.beforeCutoff).toBe(BEFORE_CUTOFF);
    expect(first.afterCutoff).toBe(AFTER_CUTOFF);
    expect(replayed.beforeCutoff).toBe(AFTER_CUTOFF);
    expect(replayed.afterCutoff).toBe("2026-09-08T14:00:00.000Z");
    expect(first.idempotencyKey).not.toBe(replayed.idempotencyKey);
  });

  it("keeps the thesis key stable when the same cutoff pair is re-evaluated", async () => {
    const seed = reviewedSeed();
    const build = () => {
      const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
        evidence(seed, "weather-refute", { value: 11 }),
      ]);
      const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
        evidence(seed, "weather-support", { value: 11 }),
      ]);
      return detectMaterialChanges(seed, before, after);
    };

    const first = await build();
    const repeated = await build();
    const firstThesis = first.changes.find(({ changeType }) => changeType === "thesis");
    const repeatedThesis = repeated.changes.find(({ changeType }) => changeType === "thesis");

    expect(firstThesis?.changeType === "thesis" ? firstThesis.idempotencyKey : null)
      .toBe(repeatedThesis?.changeType === "thesis" ? repeatedThesis.idempotencyKey : null);
  });

  it("changes the idempotency key when the methodology version changes", async () => {
    const firstSeed = reviewedSeed();
    const secondSeed = { ...firstSeed, methodologyVersion: "test-change-v2" };
    const first = await thresholdTransition(firstSeed, 9, 11);
    const second = await thresholdTransition(secondSeed, 9, 11);

    expect(factChanges(first, "threshold")[0]?.idempotencyKey)
      .not.toBe(factChanges(second, "threshold")[0]?.idempotencyKey);
  });

  it("excludes citation display changes from keys but includes changed fact values", async () => {
    const seed = reviewedSeed();
    const first = await thresholdTransition(seed, 9, 11);
    const citationOnly = await thresholdTransition(seed, 9, 11, {
      before: {
        citationUrl: "https://fixtures.invalid/revised-before-citation",
      },
      after: {
        citationUrl: "https://fixtures.invalid/revised-after-citation",
      },
    });
    const changedValue = await thresholdTransition(seed, 8, 11);

    expect(factChanges(first, "threshold")[0]?.idempotencyKey)
      .toBe(factChanges(citationOnly, "threshold")[0]?.idempotencyKey);
    expect(factChanges(first, "threshold")[0]?.idempotencyKey)
      .not.toBe(factChanges(changedValue, "threshold")[0]?.idempotencyKey);
  });

  it("returns deeply frozen, ordered, JSON-safe changes with unique keys", async () => {
    const seed = reviewedSeed();
    const result = await thresholdTransition(seed, 9, 11);
    const keys = result.changes.map(({ idempotencyKey }) => idempotencyKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.changes)).toBe(true);
    expect(result.changes.map(({ changeType }) => changeType)).toEqual(["thesis", "threshold"]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

async function confidenceChange(
  seed: ThesisSeed,
  beforeTier: "A" | "B" | "C",
  afterTier: "A" | "B" | "C",
) {
  const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
    evidence(seed, "weather-support", { sourceTier: beforeTier, value: 11 }),
  ]);
  const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
    evidence(seed, "weather-support", { sourceTier: afterTier, value: 11 }),
  ]);
  return detectMaterialChanges(seed, before, after);
}

async function thresholdTransition(
  seed: ThesisSeed,
  beforeValue: number,
  afterValue: number,
  overrides: {
    readonly before?: Partial<EvaluationEvidenceInput>;
    readonly after?: Partial<EvaluationEvidenceInput>;
  } = {},
) {
  const before = snapshot(seed, "watch", BEFORE_CUTOFF, [
    evidence(seed, "weather-support", { value: beforeValue, ...overrides.before }),
  ]);
  const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [
    evidence(seed, "weather-support", { value: afterValue, ...overrides.after }),
  ]);
  return detectMaterialChanges(seed, before, after);
}

async function revisionTransition(
  seed: ThesisSeed,
  beforeValue: number,
  afterValue: number | string,
  beforeRevision: number,
  afterRevision: number,
  options: { readonly afterObservedAt?: string; readonly afterUnit?: string } = {},
) {
  const beforeEvidence = evidence(seed, "weather-support", {
    evidenceId: `weather-before-r${beforeRevision}`,
    observationId: `weather-observation-r${beforeRevision}`,
    revision: beforeRevision,
    value: beforeValue,
    observedAt: "2026-09-08T10:00:00.000Z",
  });
  const afterEvidence = evidence(seed, "weather-support", {
    evidenceId: `weather-after-r${afterRevision}`,
    observationId: `weather-observation-r${afterRevision}`,
    revision: afterRevision,
    supersedesId: beforeEvidence.observationId,
    value: afterValue,
    unit: options.afterUnit ?? "test-unit",
    observedAt: options.afterObservedAt ?? beforeEvidence.observedAt,
  });
  const before = snapshot(seed, "watch", BEFORE_CUTOFF, [beforeEvidence]);
  const after = snapshot(seed, before.evaluation.stage, AFTER_CUTOFF, [afterEvidence]);
  return detectMaterialChanges(seed, before, after);
}

function thesisTriggers(result: Awaited<ReturnType<typeof detectMaterialChanges>>) {
  const change = result.changes.find(({ changeType }) => changeType === "thesis");
  return change?.changeType === "thesis" ? change.triggers : [];
}

function factChanges(
  result: Awaited<ReturnType<typeof detectMaterialChanges>>,
  type: "threshold" | "revision",
) {
  return result.changes.filter((change) => change.changeType === type);
}

function snapshot(
  seed: ThesisSeed,
  previousStage: MaterialChangeSnapshot["previousStage"],
  cutoff: string,
  inputs: readonly EvaluationEvidenceInput[],
): MaterialChangeSnapshot {
  const selection = selectEvidence(seed, cutoff, inputs);
  const stage = evaluateStageGates(seed, selection, { previousStage });
  return {
    previousStage,
    selection,
    evaluation: evaluateDirectionAndConfidence(seed, selection, stage),
  };
}

function reviewedSeed(
  options: { readonly sourceTierScores?: { readonly A: number; readonly B: number; readonly C: number } } = {},
): ThesisSeed {
  const selectors = [
    selector("weather-support", "regional_rainfall_southern_thailand_rubber_v1", "weather", "supports", 30),
    selector("weather-refute", "regional_rainfall_maritime_continent_palm_v1", "weather", "refutes", 30),
    selector("physical", "usda_psd_malaysia_palm_oil_production_1000mt", "physical", "supports", 20),
    selector("balance", "usda_psd_malaysia_palm_oil_ending_stocks_1000mt", "balance", "supports", 20),
    selector("market", "eia_europe_brent_spot_usd_per_bbl_daily", "market", "supports", 30),
  ];
  const supportRules = [
    numericRule("support-weather", "weather-support", "gt", 10),
    numericRule("support-physical", "physical", "gt", 10),
    numericRule("support-balance", "balance", "gt", 10),
    numericRule("support-market", "market", "gt", 10),
  ];
  const refuteRules = [numericRule("refute-weather", "weather-refute", "gt", 10)];
  const invalidationRules = [numericRule("invalidate-physical", "physical", "lt", 0)];
  const reliefRules = [numericRule("relief-weather", "weather-support", "lt", 0)];
  const allRules = [...supportRules, ...refuteRules, ...invalidationRules, ...reliefRules];

  return decodeThesisSeed({
    id: "TEST-CHANGE-01",
    slug: "test-material-change",
    title: "Test material change thesis",
    category: "agriculture",
    region: "test-region",
    marketScope: "test scoped market",
    methodologyVersion: "test-change-v1",
    regionDefinitionVersion: "test-region-v1",
    target: "test target",
    timeHorizon: "next test horizon",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "physical", "balance", "market"],
    indicatorSelectors: selectors,
    freshnessSlos: selectors.map(({ id }) => ({
      selectorId: id,
      maxAgeMinutes: 10_000,
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
      gate("easing", ["weather"], ["relief-weather"]),
    ],
    directionPolicy: {
      version: "test-direction-v1",
      reviewStatus: "approved",
      active: true,
      mappings: allRules.map(({ id }) => ({
        ruleId: id,
        direction: id.startsWith("support")
          ? "bullish"
          : id.startsWith("refute")
            ? "bearish"
            : "neutral",
      })),
    },
    confidencePolicy: {
      version: "test-confidence-v1",
      reviewStatus: "approved",
      active: true,
      lateFreshnessScore: 60,
      sourceTierScores: options.sourceTierScores ?? { A: 100, B: 60, C: 50 },
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
      productionEvaluation: true,
      publication: false,
      marketEvidenceReady: true,
      blockingGapIds: [],
    },
  });
}

function selector(
  id: string,
  indicatorId: EvaluationIndicatorId,
  layer: "weather" | "physical" | "balance" | "market",
  defaultStance: "supports" | "refutes",
  weight: number,
) {
  return {
    id,
    indicatorId,
    layer,
    defaultStance,
    weight,
    reviewStatus: "approved" as const,
    active: true,
    notes: "test-only reviewed selector",
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
  requiredLayers: readonly ("weather" | "physical" | "balance" | "market")[],
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
  if (matching === undefined) throw new TypeError(`unknown selector ${selectorId}`);
  return {
    evidenceId: `evidence-${selectorId}`,
    observationId: `observation-${selectorId}`,
    sourceRunId: `run-${selectorId}`,
    revision: 0,
    supersedesId: null,
    indicatorId: matching.indicatorId,
    sourceId: `source-${selectorId}`,
    layer: matching.layer,
    stance: matching.defaultStance,
    weight: matching.weight,
    observedAt: "2026-09-08T10:00:00.000Z",
    publishedAt: "2026-09-08T11:00:00.000Z",
    fetchedAt: "2026-09-08T11:30:00.000Z",
    value: 11,
    unit: "test-unit",
    quality: "verified",
    citationUrl: `https://fixtures.invalid/${selectorId}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "fresh",
    ...overrides,
  };
}
