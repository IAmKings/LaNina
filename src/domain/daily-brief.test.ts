import { describe, expect, it } from "vitest";
import {
  REQUIRED_DAILY_THESIS_IDS,
  dailyBriefFreezeKey,
  evaluateDailyBriefGates,
  shanghaiBriefDate,
} from "./daily-brief";
import type {
  DailyBriefFrozenVersionFact,
  DailyBriefGateFacts,
  DailyBriefVersionTarget,
} from "./daily-brief";

describe("daily brief gates", () => {
  it("freezes exactly six published latest versions when all four gates pass", () => {
    expect(evaluateDailyBriefGates(facts()).map(({ code, status, reasons }) => ({
      code, status, reasons,
    }))).toEqual([
      { code: "PRIMARY_SOURCE_HEALTH", status: "passed", reasons: [] },
      { code: "FREEZE_COMPLETENESS", status: "passed", reasons: [] },
      { code: "CITATION_COMPLETENESS", status: "passed", reasons: [] },
      { code: "HIGH_RISK_REVIEW", status: "passed", reasons: [] },
    ]);
  });

  it.each(["stale", "broken"] as const)("delays when the ENSO primary source is %s", (status) => {
    const input = facts();
    const result = evaluateDailyBriefGates({
      ...input,
      sourceHealth: input.sourceHealth.map((item) => item.sourceId === "noaa_cpc_roni"
        ? { ...item, status }
        : item),
    });
    expect(result[0]).toMatchObject({ status: "failed" });
    expect(result[0]?.reasons).toEqual([`PRIMARY_SOURCE_${status.toUpperCase()}:noaa_cpc_roni`]);
  });

  it("fails closed for missing, duplicate, cross-thesis and non-latest targets", () => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 0
      ? { ...item, isLatest: false, calculationThesisId: "RUBBER-TH-01" }
      : item);
    const targets = input.targets.map((item, index) => index === 1
      ? { ...item, thesisVersionId: input.targets[0]!.thesisVersionId }
      : item);
    const result = evaluateDailyBriefGates({ ...input, versions, targets });
    expect(result[1]).toMatchObject({ status: "failed" });
    expect(result[1]?.reasons).toEqual(expect.arrayContaining([
      "DUPLICATE_VERSION_TARGET",
      "CROSS_THESIS:ENSO-CORE-01",
      "VERSION_NOT_LATEST:ENSO-CORE-01",
    ]));
  });

  it("fails metadata gate for cutoff, method, rule or source snapshot drift", () => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 0
      ? { ...item, basedOnCutoff: "2026-09-09T22:29:59.999Z", methodologyVersion: null, ruleVersion: null }
      : item);
    const result = evaluateDailyBriefGates({ ...input, versions, sourceHealth: [] });
    expect(result[1]?.reasons).toEqual(expect.arrayContaining([
      "CUTOFF_MISMATCH:ENSO-CORE-01",
      "METHODOLOGY_VERSION_MISSING:ENSO-CORE-01",
      "RULE_VERSION_MISSING:ENSO-CORE-01",
      "SOURCE_HEALTH_SNAPSHOT_MISSING",
    ]));
  });

  it("fails citation gate for blank evidence citation", () => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 2
      ? { ...item, citations: ["https://source.example/fact", "  "] }
      : item);
    expect(evaluateDailyBriefGates({ ...input, versions })[2]).toMatchObject({
      status: "failed",
      reasons: ["CITATION_MISSING:PALM-SEA-01:1"],
    });
  });

  it("fails citation gate when a published thesis version has no evidence", () => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 1
      ? { ...item, citations: [] }
      : item);
    expect(evaluateDailyBriefGates({ ...input, versions })[2]).toMatchObject({
      status: "failed",
      reasons: ["EVIDENCE_MISSING:RUBBER-TH-01"],
    });
  });

  it.each([
    ["confidence 19 passes", { confidence: 69 }, true],
    ["confidence 20 requires review", { confidence: 70 }, false],
    ["confidence 21 requires review", { confidence: 71 }, false],
    ["one stage passes", { stage: "weather_realized" }, true],
    ["two stages require review", { stage: "physical_pressure" }, false],
    ["direction change requires review", { direction: "bearish" }, false],
  ] as const)("applies high-risk boundary: %s", (_label, change, passes) => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 0
      ? { ...item, ...change }
      : item) as DailyBriefFrozenVersionFact[];
    expect(evaluateDailyBriefGates({ ...input, versions })[3]?.status)
      .toBe(passes ? "passed" : "failed");
  });

  it("clears all derived high-risk triggers only with an exact approved transition review", () => {
    const input = facts();
    const versions = input.versions.map((item, index) => index === 0
      ? { ...item, direction: "bearish" as const, stage: "physical_pressure" as const, confidence: 75, transitionReviewed: true }
      : item);
    expect(evaluateDailyBriefGates({ ...input, versions })[3]).toMatchObject({ status: "passed" });
  });

  it("passes the completeness gate when a missing thesis is explicitly exempted", () => {
    const input = facts();
    const exemptedThesis = "SHIP-EU-01";
    const result = evaluateDailyBriefGates({
      ...input,
      targets: input.targets.filter((target) => target.thesisId !== exemptedThesis),
      versions: input.versions.filter((version) => version.thesisId !== exemptedThesis),
      exemptions: [{ thesisId: exemptedThesis, gapId: "eu-route-market-unlicensed" }],
    });
    expect(result[1]).toMatchObject({ status: "passed", reasons: [] });
  });

  it("fails closed when a thesis is both frozen and exempted, or when the day is short", () => {
    const input = facts();
    const bothFrozenAndExempted = evaluateDailyBriefGates({
      ...input,
      exemptions: [{ thesisId: "ENSO-CORE-01", gapId: "enso-independent-confirmation" }],
    });
    expect(bothFrozenAndExempted[1]?.reasons).toEqual([
      "EXEMPTION_CONFLICTS_TARGET:ENSO-CORE-01",
      "TARGET_COUNT_NOT_SIX",
    ]);

    const short = evaluateDailyBriefGates({
      ...input,
      targets: input.targets.slice(0, 5),
      versions: input.versions.slice(0, 5),
    });
    expect(short[1]?.reasons).toEqual(["TARGET_COUNT_NOT_SIX", "TARGET_MISSING:SHIP-EU-01"]);
  });
});

describe("daily brief freeze identity and time boundary", () => {
  it.each([
    ["2026-09-09T15:59:59.999Z", "2026-09-09"],
    ["2026-09-09T16:00:00.000Z", "2026-09-10"],
    ["2026-09-30T22:30:00.000Z", "2026-10-01"],
    ["2026-09-30T23:00:00.000Z", "2026-10-01"],
    ["2026-12-31T22:30:00.000Z", "2027-01-01"],
    ["2026-12-31T23:00:00.000Z", "2027-01-01"],
  ])("maps %s deterministically to Asia/Shanghai %s", (cutoff, date) => {
    expect(shanghaiBriefDate(cutoff)).toBe(date);
  });

  it("has a stable identity for the same semantic input regardless of source/target order", async () => {
    const input = facts();
    const material = {
      briefDate: "2026-09-10",
      cutoff: input.cutoff,
      targets: input.targets,
      headline: "今日影响判定",
      summary: "六论点冻结完成",
      topChanges: ["无重大变化"],
      versions: input.versions,
      sourceHealth: input.sourceHealth,
    };
    await expect(dailyBriefFreezeKey(material)).resolves.toBe(
      await dailyBriefFreezeKey({
        ...material,
        targets: [...material.targets].reverse(),
        versions: [...material.versions].reverse(),
        sourceHealth: [...material.sourceHealth].reverse(),
      }),
    );
  });
});

function facts(): DailyBriefGateFacts {
  const cutoff = "2026-09-09T22:30:00.000Z";
  const targets: DailyBriefVersionTarget[] = REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
    thesisId,
    thesisVersionId: `version-${index + 1}`,
  }));
  return {
    cutoff,
    targets,
    versions: targets.map((target, index) => ({
      thesisId: target.thesisId,
      thesisVersionId: target.thesisVersionId,
      version: index + 1,
      status: "published",
      isLatest: true,
      basedOnCutoff: cutoff,
      calculationThesisId: target.thesisId,
      calculationCutoff: cutoff,
      methodologyVersion: "evaluation-v1",
      ruleVersion: "thesis-draft-calculation-v1",
      citations: ["https://source.example/fact"],
      direction: "bullish",
      stage: "watch",
      confidence: 50,
      previousPublished: {
        thesisVersionId: `previous-${index + 1}`,
        direction: "bullish",
        stage: "watch",
        confidence: 50,
      },
      transitionReviewed: false,
    })),
    sourceHealth: [{
      sourceId: "noaa_cpc_roni",
      status: "healthy",
      checkedAt: cutoff,
      lastSuccessAt: "2026-09-09T21:30:00.000Z",
      consecutiveFailures: 0,
    }],
  };
}
