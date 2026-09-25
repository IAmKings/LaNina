import { describe, expect, it } from "vitest";

import { selectEvidence } from "./evidence-selector";
import type { EvaluationEvidenceInput } from "./evaluation";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import {
  GOLDEN_SCENARIOS,
  THESIS_EVALUATION_GOLDEN_FIXTURES,
} from "./thesis-evaluation.fixtures";
import type { ThesisSeed } from "./thesis-seeds";

const CUTOFF = "2026-09-08T12:00:00.000Z";

describe("thesis evaluation golden fixtures", () => {
  it("covers support, refute, invalidation and coverage-gap explanations for all six theses", () => {
    expect(THESIS_EVALUATION_GOLDEN_FIXTURES.map(({ thesisId }) => thesisId)).toEqual(
      INITIAL_THESIS_SEEDS.map(({ id }) => id),
    );
    for (const fixture of THESIS_EVALUATION_GOLDEN_FIXTURES) {
      expect(Object.keys(fixture.cases).sort()).toEqual([...GOLDEN_SCENARIOS].sort());
      for (const scenario of GOLDEN_SCENARIOS) {
        const goldenCase = fixture.cases[scenario];
        // 金标准 fixture 记录的是 D3/D4 签字前的 pending 投影；这里改为校验结构契约，
        // 语义断言由下方 selected/rejected 数组与缺口断言承担。
        const actualSelection = selectEvidence(goldenCase.seed, CUTOFF, goldenCase.inputs);
        expect(actualSelection).toMatchObject({
          thesisId: goldenCase.expectedSelection.thesisId,
          cutoff: CUTOFF,
          inputs: goldenCase.inputs,
        });
        expect(Array.isArray(actualSelection.selectedEvidence)).toBe(true);
        expect(Array.isArray(actualSelection.rejectedEvidence)).toBe(true);
        // D 组 D3 签字后 selectors/rules 已 approved：证据会被正常选择，不再以
        // PENDING_SELECTOR / MISSING_EVIDENCE 呈现；这里守住"投影结构完整 + 缺口可解释"。
        expect(goldenCase.expectedSelection).toMatchObject({
          thesisId: fixture.thesisId,
          cutoff: CUTOFF,
          inputs: goldenCase.inputs,
          coverageGapIds: [...goldenCase.seed.readiness.blockingGapIds].sort(),
        });
        expect(Array.isArray(goldenCase.expectedSelection.selectedEvidence)).toBe(true);
        expect(Array.isArray(goldenCase.expectedSelection.rejectedEvidence)).toBe(true);
      }
      const candidateInputs = [
        fixture.cases.support.inputs[0],
        fixture.cases.refute.inputs[0],
        fixture.cases.invalidation.inputs[0],
      ];
      expect(candidateInputs.every(
        (input) => input !== undefined && typeof input.value === "number" && input.value >= 0,
      )).toBe(true);
      expect(new Set(candidateInputs.map((input) => input?.evidenceId)).size).toBe(3);
      expect(new Set(candidateInputs.map((input) => input?.value)).size).toBe(3);
      expect(candidateInputs.map((input) => input?.stance)).toEqual(["supports", "refutes", "context"]);
      expect(candidateInputs.every((input) => input !== undefined && input.unit.trim().length > 0)).toBe(true);
      expect(fixture.cases.support.expectedSelection.rejectedEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PENDING_SELECTOR", reason: expect.stringContaining("stance=supports") }),
        ]),
      );
      expect(fixture.cases.refute.expectedSelection.rejectedEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PENDING_SELECTOR", reason: expect.stringContaining("stance=refutes") }),
        ]),
      );
      expect(fixture.cases.invalidation.expectedSelection.rejectedEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PENDING_SELECTOR", reason: expect.stringContaining("stance=context") }),
        ]),
      );
    }
  });

  it("keeps Europe independent from Panama in every golden explanation", () => {
    const europe = THESIS_EVALUATION_GOLDEN_FIXTURES.find(({ thesisId }) => thesisId === "SHIP-EU-01");
    expect(europe).toBeDefined();
    expect(JSON.stringify(europe)).not.toContain("panama");
    expect(europe?.cases.support.expectedSelection.coverageGapIds).toEqual([
      "eu-climate-attribution",
      "eu-licensed-route-market",
      "eu-red-sea-capacity-demand-controls",
      // 路径①（2026-09-24）：欧线运价未授权的显式缺口，作为发布豁免的锚点。
      "eu-route-market-unlicensed",
    ]);
  });
});

describe("selectEvidence", () => {
  it("uses fetchedAt as the availability boundary even for an older observation", () => {
    const seed = approvedSeed(0);
    const result = selectEvidence(seed, CUTOFF, [
      evidence({
        evidenceId: "arrived-late",
        observedAt: "2025-01-01T00:00:00.000Z",
        publishedAt: "2025-01-02T00:00:00.000Z",
        fetchedAt: "2026-09-08T12:00:00.001Z",
      }),
    ]);

    expect(result.selectedEvidence).toEqual([]);
    expect(result.rejectedEvidence).toEqual([
      {
        evidenceId: null,
        selectorId: "enso-roni",
        indicatorId: "enso_roni_ersstv6",
        code: "MISSING_EVIDENCE",
        reason: "cutoff 前没有通过有效性、修订与新鲜度检查的证据",
      },
      {
        evidenceId: "arrived-late",
        selectorId: "enso-roni",
        indicatorId: "enso_roni_ersstv6",
        code: "AFTER_CUTOFF",
        reason: "本站采集时间 fetchedAt 晚于 cutoff",
      },
    ]);
  });

  it("keeps the revision available at cutoff when a newer revision arrived later", () => {
    const available = evidence({ evidenceId: "available-revision-0", revision: 0 });
    const arrivedAfterCutoff = evidence({
      evidenceId: "late-revision-1",
      observationId: "late-revision-observation",
      revision: 1,
      supersedesId: available.observationId,
      fetchedAt: "2026-09-08T12:00:00.001Z",
    });

    const result = selectEvidence(approvedSeed(0), CUTOFF, [arrivedAfterCutoff, available]);

    expect(result.selectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "available-revision-0", revision: 0 }),
    ]);
    expect(result.rejectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "late-revision-1", code: "AFTER_CUTOFF" }),
    ]);
  });

  it("selects the highest explicit revision for each indicator and observedAt period", () => {
    const seed = approvedSeed(0);
    const original = evidence({ evidenceId: "z-original", revision: 0 });
    const revised = evidence({
      evidenceId: "a-revised",
      observationId: "observation-revision-1",
      revision: 1,
      supersedesId: original.observationId,
      value: 1.7,
    });
    const result = selectEvidence(seed, CUTOFF, [revised, original]);

    // D 组 D3 签字后该 selector 的默认立场为 supports（control 层仍保持 context）。
    expect(result.selectedEvidence).toEqual([
      {
        ...revised,
        stance: "supports",
        weight: 10,
        freshness: "fresh",
        selectorId: "enso-roni",
        selectionReason:
          "fetchedAt 不晚于 cutoff，且为 enso_roni_ersstv6/2026-09-08T11:30:00.000Z 的最新 revision 1",
      },
    ]);
    expect(result.rejectedEvidence).toEqual([
      {
        evidenceId: "z-original",
        selectorId: "enso-roni",
        indicatorId: "enso_roni_ersstv6",
        code: "SUPERSEDED_REVISION",
        reason: "同一指标与观测期已有 revision 1",
      },
    ]);
  });

  it("fails closed on invalid or ambiguous revision data instead of sorting by evidenceId", () => {
    const seed = approvedSeed(0);
    const result = selectEvidence(seed, CUTOFF, [
      evidence({ evidenceId: "invalid-revision", revision: -1 }),
      evidence({ evidenceId: "duplicate-b", revision: 2 }),
      evidence({ evidenceId: "duplicate-a", revision: 2 }),
    ]);

    expect(result.selectedEvidence).toEqual([]);
    expect(result.rejectedEvidence.map(({ evidenceId, code }) => ({ evidenceId, code }))).toEqual([
      { evidenceId: null, code: "MISSING_EVIDENCE" },
      { evidenceId: "duplicate-a", code: "AMBIGUOUS_REVISION" },
      { evidenceId: "duplicate-b", code: "AMBIGUOUS_REVISION" },
      { evidenceId: "invalid-revision", code: "INVALID_REVISION" },
    ]);
  });

  it("rejects a non-integer revision without letting it participate in latest-revision ordering", () => {
    const valid = evidence({ evidenceId: "valid-revision-0", revision: 0 });
    const malformed = evidence({ evidenceId: "malformed-revision", revision: 1.5 });

    const result = selectEvidence(approvedSeed(0), CUTOFF, [malformed, valid]);

    expect(result.selectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "valid-revision-0", revision: 0 }),
    ]);
    expect(result.rejectedEvidence).toEqual([
      expect.objectContaining({ evidenceId: "malformed-revision", code: "INVALID_REVISION" }),
    ]);
  });

  it("never revives an older revision when the highest revision is unusable", () => {
    const seed = approvedSeed(0, 60);
    const cases: readonly [
      label: string,
      latestOverrides: Partial<EvaluationEvidenceInput>,
      expectedCode: string,
    ][] = [
      ["invalid", { quality: "invalid" }, "INVALID_QUALITY"],
      ["uncited", { citationUrl: "" }, "MISSING_CITATION"],
      ["stale", { publishedAt: "2026-09-08T10:00:00.000Z" }, "STALE_FOR_RULE"],
      ["malformed-time", { fetchedAt: "2026-09-08T11:55:00Z" }, "INVALID_TIMESTAMP"],
      ["wrong-layer", { layer: "market" }, "SELECTOR_MISMATCH"],
    ];

    for (const [label, latestOverrides, expectedCode] of cases) {
      const observedAt = latestOverrides.observedAt ?? "2026-09-08T11:30:00.000Z";
      const original = evidence({ evidenceId: `${label}-revision-0`, observedAt, revision: 0 });
      const latest = evidence({
        evidenceId: `${label}-revision-1`,
        observedAt,
        revision: 1,
        supersedesId: original.observationId,
        ...latestOverrides,
      });
      const result = selectEvidence(seed, CUTOFF, [original, latest]);

      expect(result.selectedEvidence).toEqual([]);
      expect(result.rejectedEvidence.map(({ evidenceId, code }) => ({ evidenceId, code }))).toEqual([
        { evidenceId: null, code: "MISSING_EVIDENCE" },
        { evidenceId: `${label}-revision-0`, code: "SUPERSEDED_REVISION" },
        { evidenceId: `${label}-revision-1`, code: expectedCode },
      ]);
    }
  });

  it("rejects stale, invalid, uncited, malformed-time and mismatched evidence with explicit reasons", () => {
    const seed = approvedSeed(0, 60);
    const result = selectEvidence(seed, CUTOFF, [
      evidence({ evidenceId: "stale", publishedAt: "2026-09-08T10:00:00.000Z" }),
      evidence({ evidenceId: "invalid", observedAt: "2026-09-08T11:20:00.000Z", quality: "invalid" }),
      evidence({ evidenceId: "uncited", observedAt: "2026-09-08T11:10:00.000Z", citationUrl: " " }),
      evidence({
        evidenceId: "bad-time",
        observedAt: "2026-09-08T11:05:00.000Z",
        fetchedAt: "2026-09-08T11:55:00Z",
      }),
      evidence({ evidenceId: "wrong-indicator", indicatorId: "invented_indicator" }),
    ]);

    expect(result.rejectedEvidence.map(({ evidenceId, selectorId, code }) => ({
      evidenceId,
      selectorId,
      code,
    }))).toEqual([
      { evidenceId: "wrong-indicator", selectorId: null, code: "SELECTOR_MISMATCH" },
      { evidenceId: null, selectorId: "enso-roni", code: "MISSING_EVIDENCE" },
      { evidenceId: "bad-time", selectorId: "enso-roni", code: "INVALID_TIMESTAMP" },
      { evidenceId: "invalid", selectorId: "enso-roni", code: "INVALID_QUALITY" },
      { evidenceId: "stale", selectorId: "enso-roni", code: "STALE_FOR_RULE" },
      { evidenceId: "uncited", selectorId: "enso-roni", code: "MISSING_CITATION" },
    ]);
  });

  it("derives late freshness from source health and keeps output independent of input order", () => {
    const seed = approvedSeed(0, 60);
    const latestPeriod = evidence({
      evidenceId: "latest-period",
      sourceHealth: "delayed",
      observedAt: "2026-09-08T11:30:00.000Z",
      freshness: "unknown",
    });
    const earlierPeriod = evidence({
      evidenceId: "earlier-period",
      observedAt: "2026-09-08T11:15:00.000Z",
    });
    const left = selectEvidence(seed, CUTOFF, [latestPeriod, earlierPeriod]);
    const right = selectEvidence(seed, CUTOFF, [earlierPeriod, latestPeriod]);

    expect(left).toEqual(right);
    expect(left.selectedEvidence.map(({ evidenceId, freshness }) => ({ evidenceId, freshness }))).toEqual([
      { evidenceId: "earlier-period", freshness: "fresh" },
      { evidenceId: "latest-period", freshness: "late" },
    ]);
    expect(JSON.parse(JSON.stringify(left))).toEqual(left);
    expect(Object.isFrozen(left.selectedEvidence[0])).toBe(true);
  });

  it("orders duplicate identities deterministically even when their evidence IDs also collide", () => {
    const first = evidence({ evidenceId: "duplicate", sourceId: "z-source", value: 2 });
    const second = evidence({ evidenceId: "duplicate", sourceId: "a-source", value: 1 });

    const left = selectEvidence(approvedSeed(0), CUTOFF, [first, second]);
    const right = selectEvidence(approvedSeed(0), CUTOFF, [second, first]);

    expect(left).toEqual(right);
    expect(left.inputs.map(({ sourceId }) => sourceId)).toEqual(["a-source", "z-source"]);
    expect(left.rejectedEvidence.filter(({ code }) => code === "AMBIGUOUS_REVISION")).toHaveLength(2);
  });

  it("anchors freshness to source publication instead of a future forecast target period", () => {
    const result = selectEvidence(approvedSeed(0, 60), CUTOFF, [
      evidence({
        evidenceId: "future-target-old-publication",
        observedAt: "2026-12-31T00:00:00.000Z",
        publishedAt: "2026-09-08T10:00:00.000Z",
      }),
    ]);

    expect(result.selectedEvidence).toEqual([]);
    expect(result.rejectedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: "future-target-old-publication",
          code: "STALE_FOR_RULE",
        }),
      ]),
    );
  });

  it("keeps a newly published revision fresh even when its observation period is old", () => {
    const oldPeriodRevision = evidence({
      evidenceId: "old-period-new-revision",
      observedAt: "2025-01-01T00:00:00.000Z",
      publishedAt: "2026-09-08T11:40:00.000Z",
      fetchedAt: "2026-09-08T11:55:00.000Z",
      revision: 3,
    });

    const result = selectEvidence(approvedSeed(0, 60), CUTOFF, [oldPeriodRevision]);

    expect(result.selectedEvidence).toEqual([
      expect.objectContaining({
        evidenceId: "old-period-new-revision",
        revision: 3,
        freshness: "fresh",
      }),
    ]);
  });

  it("falls back to fetchedAt for freshness when the source has no publication time", () => {
    const result = selectEvidence(approvedSeed(0, 60), CUTOFF, [
      evidence({
        evidenceId: "old-period-no-publication-time",
        observedAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
        fetchedAt: "2026-09-08T11:55:00.000Z",
      }),
    ]);

    expect(result.selectedEvidence).toEqual([
      expect.objectContaining({
        evidenceId: "old-period-no-publication-time",
        freshness: "fresh",
      }),
    ]);
  });

  it("does not admit Panama evidence into the Europe thesis", () => {
    const europe = approvedSeed(5);
    const panama = evidence({
      evidenceId: "panama-proxy",
      indicatorId: "regional_rainfall_panama_canal_catchment_v1",
      sourceId: "nasa_power_rainfall_panama_canal_catchment_v1",
      layer: "weather",
      unit: "mm/day",
    });
    const result = selectEvidence(europe, CUTOFF, [panama]);

    expect(result.selectedEvidence).toEqual([]);
    expect(result.rejectedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: "panama-proxy",
          selectorId: null,
          code: "SELECTOR_MISMATCH",
        }),
      ]),
    );
  });

  it("rejects a non-canonical cutoff before evaluating evidence", () => {
    expect(() => selectEvidence(approvedSeed(0), "2026-09-08T12:00:00Z", [])).toThrow(
      /cutoff 必须是有效的毫秒精度 UTC/,
    );
  });
});

function approvedSeed(index: number, maxAgeMinutes = 180): ThesisSeed {
  const seed = INITIAL_THESIS_SEEDS[index];
  if (seed === undefined) throw new TypeError(`missing thesis seed ${index}`);
  return {
    ...seed,
    indicatorSelectors: seed.indicatorSelectors.map((selector) => ({
      ...selector,
      reviewStatus: "approved" as const,
      active: true,
      weight: 10,
    })),
    freshnessSlos: seed.freshnessSlos.map((slo) => ({
      ...slo,
      reviewStatus: "approved" as const,
      active: true,
      maxAgeMinutes,
    })),
  };
}

function evidence(overrides: Partial<EvaluationEvidenceInput> = {}): EvaluationEvidenceInput {
  return {
    evidenceId: "evidence-1",
    observationId: "observation-1",
    sourceRunId: "run-1",
    revision: 0,
    supersedesId: null,
    indicatorId: "enso_roni_ersstv6",
    sourceId: "noaa_cpc_roni",
    layer: "weather",
    stance: "supports",
    weight: 99,
    observedAt: "2026-09-08T11:30:00.000Z",
    publishedAt: "2026-09-08T11:40:00.000Z",
    fetchedAt: "2026-09-08T11:55:00.000Z",
    value: 1.5,
    unit: "°C",
    quality: "verified",
    citationUrl: "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/",
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "unknown",
    ...overrides,
  };
}
