import { describe, expect, it, vi } from "vitest";

import {
  REQUIRED_DAILY_THESIS_IDS,
  type DailyBriefFreezeCommand,
  type DailyBriefResult,
} from "../domain/daily-brief";
import { handleRequest, type Env, type RequestHandlerDependencies } from "./index";
import type { DailyPublicationTargetResolution } from "./modules/daily-publication";

const CUTOFF = "2026-09-09T22:30:00.000Z";
const BRIEF_DATE = "2026-09-10";
const ANCHOR_GAP = "eu-route-market-unlicensed";

describe("administrative daily brief exemptions (路径①)", () => {
  it("publishes an acknowledged coverage-gap exemption into the freeze command", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand) => publishedResult(command));
    const response = await publish(
      { exemptions: [{ thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP }] },
      resolution({ exemptible: true }),
      freeze,
    );

    expect(response.status).toBe(200);
    expect(freeze).toHaveBeenCalledOnce();
    const command = freeze.mock.calls[0]![0];
    expect(command.targets.map((target) => target.thesisId)).toEqual(
      REQUIRED_DAILY_THESIS_IDS.filter((thesisId) => thesisId !== "SHIP-EU-01"),
    );
    expect(command.targets).toHaveLength(5);
    expect(command.exemptions).toEqual([{ thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP }]);
  });

  it("returns 409 and never freezes when the gap is not acknowledged", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand) => publishedResult(command));
    const response = await publish({ exemptions: [] }, resolution({ exemptible: true }), freeze);

    expect(response.status).toBe(409);
    await expect(errorCode(response)).resolves.toBe("TARGETS_UNAVAILABLE");
    expect(freeze).not.toHaveBeenCalled();
  });

  it("rejects a forged or unjustified exemption with 422 before freezing", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand) => publishedResult(command));

    const forgedGap = await publish(
      { exemptions: [{ thesisId: "SHIP-EU-01", gapId: "not-a-real-gap" }] },
      resolution({ exemptible: true }),
      freeze,
    );
    expect(forgedGap.status).toBe(422);
    await expect(errorCode(forgedGap)).resolves.toBe("EXEMPTION_INVALID");

    // SHIP-EU-01 does have an anchor, but ENSO-CORE-01 already has a published version.
    const alreadyPublished = await publish(
      { exemptions: [{ thesisId: "ENSO-CORE-01", gapId: "enso-independent-confirmation" }] },
      resolution({ exemptible: true }),
      freeze,
    );
    expect(alreadyPublished.status).toBe(422);
    await expect(errorCode(alreadyPublished)).resolves.toBe("EXEMPTION_INVALID");

    // A thesis with no exemptible coverage gap cannot be exempted by reusing another thesis' gap.
    const notExemptible = await publish(
      { exemptions: [{ thesisId: "ENSO-CORE-01", gapId: ANCHOR_GAP }] },
      resolution({ exemptible: true }),
      freeze,
    );
    expect(notExemptible.status).toBe(422);
    expect(freeze).not.toHaveBeenCalled();
  });

  it("rejects a malformed or duplicate exemption payload with 400", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand) => publishedResult(command));

    const duplicate = await publish(
      {
        exemptions: [
          { thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP },
          { thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP },
        ],
      },
      resolution({ exemptible: true }),
      freeze,
    );
    expect(duplicate.status).toBe(400);

    const unknownField = await publish(
      { exemptions: [{ thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP, note: "x" }] },
      resolution({ exemptible: true }),
      freeze,
    );
    expect(unknownField.status).toBe(400);
    expect(freeze).not.toHaveBeenCalled();
  });

  it("stays blocked when an exemption cannot cover every unresolved thesis", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand) => publishedResult(command));
    const database: DailyPublicationTargetResolution = {
      ...resolution({ exemptible: true }),
      blockers: ["TARGET_MISSING:SHIP-EU-01", "TARGET_MISSING:MAIZE-SA-01"],
      unresolvedTheses: ["SHIP-EU-01", "MAIZE-SA-01"],
    };

    const response = await publish(
      { exemptions: [{ thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP }] },
      database,
      freeze,
    );
    expect(response.status).toBe(409);
    expect(freeze).not.toHaveBeenCalled();
  });

  it("returns the failed gate codes and reasons with GATES_FAILED", async () => {
    const freeze = vi.fn(async (command: DailyBriefFreezeCommand): Promise<DailyBriefResult> => ({
      ...publishedResult(command),
      status: "delayed",
      publishedAt: null,
      publishedBy: null,
      gates: [
        { code: "PRIMARY_SOURCE_HEALTH", status: "passed", explanation: "通过", reasons: [] },
        { code: "FREEZE_COMPLETENESS", status: "passed", explanation: "通过", reasons: [] },
        {
          code: "CITATION_COMPLETENESS",
          status: "failed",
          explanation: "未通过",
          reasons: ["EVIDENCE_MISSING:PALM-SEA-01"],
        },
        {
          code: "HIGH_RISK_REVIEW",
          status: "failed",
          explanation: "未通过",
          reasons: ["UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01"],
        },
      ],
    }));

    const response = await publish(
      { exemptions: [{ thesisId: "SHIP-EU-01", gapId: ANCHOR_GAP }] },
      resolution({ exemptible: true }),
      freeze,
    );

    expect(response.status).toBe(409);
    const body = await response.json() as {
      readonly error: { readonly code: string; readonly details?: { readonly gates?: unknown } };
    };
    expect(body.error.code).toBe("GATES_FAILED");
    expect(body.error.details?.gates).toEqual([
      { code: "CITATION_COMPLETENESS", reasons: ["EVIDENCE_MISSING:PALM-SEA-01"] },
      { code: "HIGH_RISK_REVIEW", reasons: ["UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01"] },
    ]);
  });

  it("rejects a malformed version id with 400 instead of a misleading 404", async () => {
    const dependencies = {
      authorizeAdmin: async () => ({ email: "publisher@example.com", roles: ["publisher"] as const }),
    };
    const response = await handleRequest(
      new Request("https://example.test/api/admin/thesis-versions/%3Cafter%20ENSO%3E/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thesisId: "ENSO-CORE-01",
          beforeVersionId: "local-demo-version-enso",
          decision: "approved",
          reason: "占位符未被替换",
          confirm: true,
        }),
      }),
      {} as Env,
      dependencies,
    );

    expect(response.status).toBe(400);
    await expect(errorCode(response)).resolves.toBe("VALIDATION");
  });
});

async function publish(
  overrides: { readonly exemptions: readonly Record<string, unknown>[] },
  resolution: DailyPublicationTargetResolution,
  freeze: (command: DailyBriefFreezeCommand) => Promise<DailyBriefResult>,
): Promise<Response> {
  return handleRequest(
    new Request(`https://example.test/api/admin/daily/${BRIEF_DATE}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cutoff: CUTOFF,
        headline: "今日影响判定",
        summary: "五条论点已发布，一条论点显式豁免。",
        topChanges: [],
        reason: "四类门禁通过",
        expectedFreezeKey: null,
        confirm: true,
        exemptions: overrides.exemptions,
      }),
    }),
    {} as Env,
    dependencies(resolution, freeze),
  );
}

function dependencies(
  resolution: DailyPublicationTargetResolution,
  freeze: (command: DailyBriefFreezeCommand) => Promise<DailyBriefResult>,
): RequestHandlerDependencies {
  return {
    authorizeAdmin: async () => ({ email: "publisher@example.com", roles: ["publisher"] }),
    dailyPublicationTargets: async () => resolution,
    dailyBriefFreeze: async (command) => freeze(command),
    now: () => new Date("2026-09-09T23:00:00.000Z"),
  };
}

function resolution(options: { readonly exemptible: boolean }): DailyPublicationTargetResolution {
  const resolvableTargets = REQUIRED_DAILY_THESIS_IDS
    .filter((thesisId) => thesisId !== "SHIP-EU-01")
    .map((thesisId, index) => ({ thesisId, thesisVersionId: `version-${index + 1}` }));
  return {
    targets: null,
    blockers: ["TARGET_MISSING:SHIP-EU-01"],
    resolvableTargets,
    unresolvedTheses: ["SHIP-EU-01"],
    candidateTargets: resolvableTargets.map((target) => ({
      ...target,
      version: 2,
      status: "published" as const,
    })),
    exemptibleTargets: options.exemptible
      ? [{
        thesisId: "SHIP-EU-01",
        gapId: ANCHOR_GAP,
        gapDescription: "SCFI、FBX、Drewry 等欧线运价数据属商业授权来源，尚未接入。",
      }]
      : [],
  };
}

function publishedResult(command: DailyBriefFreezeCommand): DailyBriefResult {
  return {
    briefDate: BRIEF_DATE,
    status: "published",
    freezeKey: "daily-brief-freeze-v1:sha256:test",
    cutoff: command.cutoff,
    headline: command.headline,
    summary: command.summary,
    topChanges: [...command.topChanges],
    gates: [],
    sourceHealth: [],
    versions: [],
    exemptions: [...(command.exemptions ?? [])],
    publishedAt: "2026-09-09T23:00:00.000Z",
    publishedBy: "publisher@example.com",
    attemptId: "attempt-1",
  };
}

async function errorCode(response: Response): Promise<string | null> {
  const body = await response.json() as { readonly error?: { readonly code?: string } };
  return body.error?.code ?? null;
}
