import { describe, expect, it } from "vitest";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import {
  buildThesisDraftStorageRecord,
  ThesisDraftValidationError,
} from "./thesis-draft";
import type { ThesisDraftEvidenceCopy } from "./thesis-draft";
import { approvedDraftSeed, makeDraftCandidate } from "./thesis-draft.test-support";
import { decodeThesisSeed } from "./thesis-seeds";

describe("buildThesisDraftStorageRecord", () => {
  it("rebuilds trusted evaluation and creates a complete frozen storage record", async () => {
    const candidate = makeDraftCandidate();
    const result = await buildThesisDraftStorageRecord(candidate);

    expect(result).toEqual({
      thesisId: "TEST-THESIS-01",
      status: "draft",
      direction: "bullish",
      stage: "weather_realized",
      confidence: 88,
      summary: candidate.summary,
      invalidation: candidate.invalidation,
      calculation: {
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId: "TEST-THESIS-01",
        methodologyVersion: "test-method-v1",
        regionDefinitionVersion: "test-region-v1",
        target: "test-target",
        marketScope: "test-market",
        timeHorizon: "1-3 months",
        cutoff: candidate.selection.cutoff,
        previousStage: "watch",
        selection: {
          selectedEvidence: [
            {
              evidenceId: "evidence-weather-support",
              selectorId: "weather-support",
              observationId: "observation-weather-support",
              sourceRunId: "run-weather-support",
              indicatorId: "enso_roni_ersstv6",
              sourceId: "source-weather-support",
              observedAt: "2026-09-08T11:30:00.000Z",
              revision: 0,
              stance: "supports",
              layer: "weather",
              weight: 60,
              summary: "weather-support 的已选证据摘要",
              citationUrl: "https://fixtures.invalid/weather-support",
              sortOrder: 0,
            },
            {
              evidenceId: "evidence-market-support",
              selectorId: "market-support",
              observationId: "observation-market-support",
              sourceRunId: "run-market-support",
              indicatorId: "eia_europe_brent_spot_usd_per_bbl_daily",
              sourceId: "source-market-support",
              observedAt: "2026-09-08T11:30:00.000Z",
              revision: 0,
              stance: "supports",
              layer: "market",
              weight: 40,
              summary: "market-support 的已选证据摘要",
              citationUrl: "https://fixtures.invalid/market-support",
              sortOrder: 1,
            },
          ],
          rejectedEvidence: expect.any(Array),
          coverageGapIds: [],
        },
        stage: candidate.stageResult,
        direction: candidate.evaluation.direction,
        confidence: candidate.evaluation.confidence,
      },
      basedOnCutoff: candidate.selection.cutoff,
      createdBy: "evaluation-job",
      createdAt: "2026-09-08T12:01:00.000Z",
      publishedBy: null,
      publishedAt: null,
      changeReason: null,
      draftKey: expect.stringMatching(/^thesis-draft-v1:sha256:[0-9a-f]{64}$/),
      evidence: [
        {
          observationId: "observation-weather-support",
          sourceRunId: "run-weather-support",
          stance: "supports",
          layer: "weather",
          weight: 60,
          summary: "weather-support 的已选证据摘要",
          citationUrl: "https://fixtures.invalid/weather-support",
          sortOrder: 0,
        },
        {
          observationId: "observation-market-support",
          sourceRunId: "run-market-support",
          stance: "supports",
          layer: "market",
          weight: 40,
          summary: "market-support 的已选证据摘要",
          citationUrl: "https://fixtures.invalid/market-support",
          sortOrder: 1,
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.calculation.stage)).toBe(true);
    expect(JSON.stringify(result.calculation)).not.toContain('"value"');
    expect(JSON.stringify(result.calculation)).not.toContain('"inputs"');
  });

  it("uses a deterministic semantic key while excluding actor and wall clock", async () => {
    const first = await buildThesisDraftStorageRecord(makeDraftCandidate());
    const same = await buildThesisDraftStorageRecord(makeDraftCandidate({
      createdBy: "another-job",
      createdAt: "2026-09-08T12:02:00.000Z",
    }));
    const laterCutoff = await buildThesisDraftStorageRecord(makeDraftCandidate({
      cutoff: "2026-09-08T12:30:00.000Z",
      createdAt: "2026-09-08T12:31:00.000Z",
    }));
    const revisedSummary = await buildThesisDraftStorageRecord(makeDraftCandidate({
      summary: "新的摘要",
    }));
    const revisedReason = await buildThesisDraftStorageRecord(makeDraftCandidate({
      changeReason: "仅修改版本变更原因",
    }));
    const revisedInvalidation = await buildThesisDraftStorageRecord(makeDraftCandidate({
      invalidation: "新的失效条件",
    }));
    const evidenceCopy = makeDraftCandidate();
    const revisedEvidenceCopy = await buildThesisDraftStorageRecord({
      ...evidenceCopy,
      evidence: evidenceCopy.evidence.map((item, index) => index === 0
        ? { ...item, summary: "新的证据摘要" }
        : item),
    });

    expect(same.draftKey).toBe(first.draftKey);
    expect(laterCutoff.draftKey).not.toBe(first.draftKey);
    expect(revisedSummary.draftKey).not.toBe(first.draftKey);
    expect(revisedReason.draftKey).not.toBe(first.draftKey);
    expect(revisedInvalidation.draftKey).not.toBe(first.draftKey);
    expect(revisedEvidenceCopy.draftKey).not.toBe(first.draftKey);
  });

  it("changes the key for evidence order, citation and reviewed selector weight", async () => {
    const candidate = makeDraftCandidate();
    const first = await buildThesisDraftStorageRecord(candidate);
    const reordered = await buildThesisDraftStorageRecord({
      ...candidate,
      evidence: [...candidate.evidence].reverse(),
    });
    const citationInputs = candidate.selection.inputs.map((item, index) => index === 0
      ? { ...item, citationUrl: "https://fixtures.invalid/revised-citation" }
      : item);
    const citation = await buildThesisDraftStorageRecord(makeDraftCandidate({ inputs: citationInputs }));
    const originalSeed = structuredClone(approvedDraftSeed());
    const rawSeed = {
      ...originalSeed,
      indicatorSelectors: originalSeed.indicatorSelectors.map((selector, index) => index === 0
        ? { ...selector, weight: 61 }
        : selector),
    };
    const weight = await buildThesisDraftStorageRecord(makeDraftCandidate({
      seed: decodeThesisSeed(rawSeed),
    }));

    expect(reordered.draftKey).not.toBe(first.draftKey);
    expect(citation.draftKey).not.toBe(first.draftKey);
    expect(weight.draftKey).not.toBe(first.draftKey);
    expect(weight.calculation.selection.selectedEvidence[0]?.weight).toBe(61);
  });

  it("accepts 500 summary characters and rejects 501", async () => {
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({ summary: "字".repeat(500) })))
      .resolves.toMatchObject({ summary: "字".repeat(500) });
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({ summary: "字".repeat(501) })))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects invalid UTC, blank copy and malformed evidence copies", async () => {
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({
      createdAt: "2026-09-08T12:01:00Z",
    }))).rejects.toThrow(/createdAt/);
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({ invalidation: "  " })))
      .rejects.toThrow(/失效条件/);
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({ summary: "  " })))
      .rejects.toThrow(/摘要/);
    await expect(buildThesisDraftStorageRecord({
      ...makeDraftCandidate(),
      evidence: [],
    })).rejects.toThrow(/一一对应/);
    await expect(buildThesisDraftStorageRecord({
      ...makeDraftCandidate(),
      changeReason: " ",
    })).rejects.toThrow(/变更原因/);
    const candidate = makeDraftCandidate();
    await expect(buildThesisDraftStorageRecord({
      ...candidate,
      evidence: [
        { ...candidate.evidence[0]!, privatePayload: "leak" } as unknown as ThesisDraftEvidenceCopy,
        ...candidate.evidence.slice(1),
      ],
    })).rejects.toThrow(/未知字段/);
    await expect(buildThesisDraftStorageRecord(
      null as unknown as ReturnType<typeof makeDraftCandidate>,
    )).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects empty selected evidence and manual-stage payloads", async () => {
    await expect(buildThesisDraftStorageRecord(makeDraftCandidate({ inputs: [] })))
      .rejects.toThrow(/不可用|至少需要一条/);
    const candidate = makeDraftCandidate();
    await expect(buildThesisDraftStorageRecord({
      ...candidate,
      stageResult: { ...candidate.stageResult, manualConfirmationApplied: true },
    })).rejects.toThrow(/阶段结果/);
  });

  it("rejects forged selection, stage and non-finite evaluation", async () => {
    const candidate = makeDraftCandidate();
    await expect(buildThesisDraftStorageRecord({
      ...candidate,
      selection: { ...candidate.selection, rejectedEvidence: [] },
    })).rejects.toThrow(/证据选择/);
    await expect(buildThesisDraftStorageRecord({
      ...candidate,
      stageResult: { ...candidate.stageResult, stage: "market_confirmed" },
    })).rejects.toThrow(/阶段结果/);
    await expect(buildThesisDraftStorageRecord({
      ...candidate,
      evaluation: {
        ...candidate.evaluation,
        confidence: { ...candidate.evaluation.confidence, finalScore: Number.NaN },
      },
    })).rejects.toThrow(/方向或置信度/);
  });

  it("fails closed for all pending production seeds", async () => {
    const candidate = makeDraftCandidate();
    for (const seed of INITIAL_THESIS_SEEDS) {
      await expect(buildThesisDraftStorageRecord({ ...candidate, seed }))
        .rejects.toBeInstanceOf(ThesisDraftValidationError);
    }
  });
});
