import { describe, expect, it } from "vitest";

import type { AdminDailyPageModel } from "../domain/page-models";
import {
  blockerLabel,
  canSubmitDaily,
  dailyCutoffLabel,
  dailyPublishBlockReason,
  dailyPublishFailureMessage,
  dailyPublishRequestBody,
  dailyPublishedLabel,
  dailyTargetRows,
  dailyDraftTargets,
  dailyUncoveredBlockers,
  emptyDailyPublishDraft,
  gateLabel,
  gateReasonLabel,
  isAdminDailyEnvelope,
  parseTopChangeIds,
  reviewTriggerLabel,
  safeDailyPublishError,
  shanghaiToday,
  thesisChangeReviewRequestBody,
  thesisVersionPublishRequestBody,
} from "./admin-daily-view";

function model(overrides: Partial<AdminDailyPageModel> = {}): AdminDailyPageModel {
  return {
    actor: { email: "publisher@example.test", roles: ["publisher"] },
    briefDate: "2026-09-11",
    cutoff: "2026-09-10T22:30:00.000Z",
    published: false,
    publishedAt: null,
    currentFreezeKey: null,
    targets: [
      { thesisId: "ENSO-CORE-01", thesisVersionId: "version-enso", version: 2, status: "published" },
      { thesisId: "RUBBER-TH-01", thesisVersionId: "version-rubber", version: 2, status: "published" },
    ],
    blockers: [],
    exemptibleTargets: [],
    pendingReviews: [],
    ...overrides,
  };
}

function draft(overrides: Partial<ReturnType<typeof emptyDailyPublishDraft>> = {}) {
  return {
    ...emptyDailyPublishDraft(),
    headline: "今日影响判定",
    summary: "六条论点均有已发布版本，四类门禁通过。",
    reason: "四类门禁通过",
    confirmed: true,
    ...overrides,
  };
}

describe("admin daily publication view", () => {
  it("derives the Asia/Shanghai brief date regardless of the host time zone", () => {
    expect(shanghaiToday(new Date("2026-09-10T22:30:00.000Z"))).toBe("2026-09-11");
    expect(shanghaiToday(new Date("2026-09-10T15:59:00.000Z"))).toBe("2026-09-10");
  });

  it("blocks the form for viewers, blockers and already-published dates", () => {
    expect(dailyPublishBlockReason(model())).toBeNull();
    expect(dailyPublishBlockReason(model({ published: true, publishedAt: "2026-09-10T23:00:00.000Z" })))
      .toMatch(/不可替换/);
    expect(dailyPublishBlockReason(model({ blockers: ["TARGET_MISSING:SHIP-EU-01"] })))
      .toMatch(/尚未全部具备/);
    expect(dailyPublishBlockReason(model({ actor: { email: "viewer@example.test", roles: ["viewer"] } })))
      .toMatch(/没有发布权限/);
  });

  it("requires bounded copy, a reason and explicit confirmation before submitting", () => {
    expect(canSubmitDaily(draft(), model())).toBe(true);
    expect(canSubmitDaily(draft({ confirmed: false }), model())).toBe(false);
    expect(canSubmitDaily(draft({ headline: "   " }), model())).toBe(false);
    expect(canSubmitDaily(draft({ summary: "x".repeat(2_001) }), model())).toBe(false);
    expect(canSubmitDaily(draft({ reason: "" }), model())).toBe(false);
    expect(canSubmitDaily(draft({ topChanges: "a b c d" }), model())).toBe(false);
    expect(canSubmitDaily(draft({ topChanges: "same, same" }), model())).toBe(false);
    expect(canSubmitDaily(draft(), model({ blockers: ["VERSION_NOT_LATEST:MAIZE-SA-01"] }))).toBe(false);
  });

  it("parses change ids strictly and never invents free text", () => {
    expect(parseTopChangeIds("")).toEqual({ ids: [], error: null });
    expect(parseTopChangeIds(" change-1, change-2 ")).toEqual({ ids: ["change-1", "change-2"], error: null });
    expect(parseTopChangeIds("change-1，change-2").ids).toEqual(["change-1", "change-2"]);
    expect(parseTopChangeIds("a,b,c,d").error).toMatch(/最多/);
    expect(parseTopChangeIds("a,a").error).toMatch(/重复/);
    expect(parseTopChangeIds(`${"x".repeat(129)}`).error).toMatch(/过长/);
  });

  it("echoes the freeze key verbatim as the concurrency token", () => {
    const pending = model({ currentFreezeKey: "daily-brief-freeze-v1:sha256:pending" });
    expect(dailyPublishRequestBody(pending, draft({ topChanges: "change-1" }))).toEqual({
      cutoff: "2026-09-10T22:30:00.000Z",
      headline: "今日影响判定",
      summary: "六条论点均有已发布版本，四类门禁通过。",
      topChanges: ["change-1"],
      reason: "四类门禁通过",
      expectedFreezeKey: "daily-brief-freeze-v1:sha256:pending",
      confirm: true,
      exemptions: [],
    });
    expect(dailyPublishRequestBody(model(), draft()).expectedFreezeKey).toBeNull();
  });

  it("labels targets, blockers and status without deriving server facts", () => {
    expect(dailyTargetRows(model())).toEqual([
      { thesisId: "ENSO-CORE-01", thesisVersionId: "version-enso", version: 2, status: "published" },
      { thesisId: "RUBBER-TH-01", thesisVersionId: "version-rubber", version: 2, status: "published" },
    ]);
    expect(blockerLabel("VERSION_NOT_PUBLISHED:RUBBER-TH-01")).toBe("RUBBER-TH-01：最新版本尚未发布");
    expect(blockerLabel("UNKNOWN_THESIS:SUGAR-01")).toBe("SUGAR-01：不属于必需论点");
    expect(blockerLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(dailyPublishedLabel(model())).toBe("尚未发布");
    expect(dailyPublishedLabel(model({ published: true, publishedAt: "2026-09-10T23:00:00.000Z" })))
      .toMatch(/^已发布/);
    expect(dailyCutoffLabel(model())).toContain("2026");
  });

  it("publishes only draft cutoff versions with the required body", () => {
    const mixed = model({
      targets: [
        { thesisId: "ENSO-CORE-01", thesisVersionId: "version-enso", version: 1, status: "draft" },
        { thesisId: "RUBBER-TH-01", thesisVersionId: "version-rubber", version: 3, status: "published" },
        { thesisId: "PALM-SEA-01", thesisVersionId: "version-palm", version: 2, status: "draft" },
      ],
    });

    expect(dailyDraftTargets(mixed).map((target) => target.thesisId)).toEqual(["ENSO-CORE-01", "PALM-SEA-01"]);
    // 与 parseAdministrativeThesisPublicationBody 完全一致：无 body 的裸 POST 会被判 400。
    expect(thesisVersionPublishRequestBody(dailyDraftTargets(mixed)[1]!, " 研究审核通过 "))
      .toEqual({
        thesisId: "PALM-SEA-01",
        expectedVersion: 2,
        reason: "研究审核通过",
        confirm: true,
      });
  });

  it("maps only stable codes and status categories to operator feedback", () => {
    expect(dailyPublishFailureMessage(409, "GATES_FAILED")).toMatch(/门禁/);
    expect(dailyPublishFailureMessage(409, "TARGETS_UNAVAILABLE")).toMatch(/尚未全部具备/);
    expect(dailyPublishFailureMessage(409, "VERSION_CONFLICT")).toMatch(/并发令牌已过期/);
    expect(dailyPublishFailureMessage(409, "IMMUTABLE")).toMatch(/不可替换/);
    expect(dailyPublishFailureMessage(403, null)).toMatch(/没有发布权限/);
    expect(dailyPublishFailureMessage(422, "VALIDATION")).toMatch(/服务端校验/);
    expect(dailyPublishFailureMessage(503, null)).toMatch(/稍后重试/);
    expect(dailyPublishFailureMessage(409, "GATES_FAILED")).not.toMatch(/sqlite|select|d1/i);
  });

  it("accepts only a well-formed preflight envelope", () => {
    expect(isAdminDailyEnvelope({ data: model(), meta: { generatedAt: "2026-09-10T23:00:00.000Z" } })).toBe(true);
    expect(isAdminDailyEnvelope({ data: { briefDate: "2026-09-11" }, meta: {} })).toBe(false);
    expect(isAdminDailyEnvelope({ data: model() })).toBe(false);
    expect(isAdminDailyEnvelope(null)).toBe(false);
  });

  it("unblocks an acknowledged coverage gap and sends the exemption on submit", () => {
    const exempted = exemptibleModel();
    expect(dailyUncoveredBlockers(exempted)).toEqual([]);
    expect(dailyPublishBlockReason(exempted)).toBeNull();
    // 未勾选「已知悉覆盖缺口」时不得提交。
    expect(canSubmitDaily(draft(), exempted)).toBe(false);
    expect(canSubmitDaily(draft({ exemptionsConfirmed: true }), exempted)).toBe(true);
    expect(dailyPublishRequestBody(exempted, draft({ exemptionsConfirmed: true })).exemptions)
      .toEqual([{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }]);
  });

  it("keeps a blocker that an exemption cannot cover visible", () => {
    const blocked = model({
      blockers: ["TARGET_MISSING:SHIP-EU-01", "VERSION_NOT_LATEST:MAIZE-SA-01"],
      exemptibleTargets: [{
        thesisId: "SHIP-EU-01",
        gapId: "eu-route-market-unlicensed",
        gapDescription: "欧线运价数据未授权。",
      }],
    });
    expect(dailyUncoveredBlockers(blocked)).toEqual(["VERSION_NOT_LATEST:MAIZE-SA-01"]);
    expect(dailyPublishBlockReason(blocked)).toMatch(/其他论点/);
    expect(canSubmitDaily(draft({ exemptionsConfirmed: true }), blocked)).toBe(false);
  });

  it("maps an invalid exemption rejection to operator feedback", () => {
    expect(dailyPublishFailureMessage(422, "EXEMPTION_INVALID")).toMatch(/豁免/);
  });

  it("surfaces the failed gates and their reason codes", async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: "GATES_FAILED",
        message: "发布门禁未通过：HIGH_RISK_REVIEW",
        requestId: "request-1",
        details: {
          gates: [{
            code: "HIGH_RISK_REVIEW",
            reasons: ["UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01"],
          }],
        },
      },
    }), { status: 409, headers: { "content-type": "application/json" } });

    const error = await safeDailyPublishError(response);
    expect(error.code).toBe("GATES_FAILED");
    expect(error.gates).toEqual([{
      code: "HIGH_RISK_REVIEW",
      reasons: ["UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01"],
    }]);
    expect(gateLabel("HIGH_RISK_REVIEW")).toBe("高风险变化人工审核");
    expect(gateReasonLabel("UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01")).toMatch(/方向变化/);
    expect(gateReasonLabel("PRIMARY_SOURCE_STALE:noaa_cpc_roni")).toMatch(/过期/);
    expect(gateReasonLabel("EVIDENCE_MISSING:PALM-SEA-01")).toMatch(/证据/);
    expect(gateReasonLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("ignores malformed gate diagnostics instead of inventing text", async () => {
    const response = new Response(JSON.stringify({
      error: { code: "GATES_FAILED", message: "x", requestId: "r", details: { gates: "nope" } },
    }), { status: 409, headers: { "content-type": "application/json" } });
    expect((await safeDailyPublishError(response)).gates).toEqual([]);
  });

  it("surfaces a staged write failure instead of a concurrency conflict", async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: "DATABASE",
        message: "x",
        requestId: "r",
        details: { stage: "link:ENSO-CORE-01" },
      },
    }), { status: 503, headers: { "content-type": "application/json" } });

    const error = await safeDailyPublishError(response);
    expect(error.code).toBe("DATABASE");
    expect(error.stage).toBe("link:ENSO-CORE-01");
    expect(error.gates).toEqual([]);
    expect((await safeDailyPublishError(new Response(JSON.stringify({
      error: { code: "DATABASE", message: "x", requestId: "r", details: { stage: 5 } },
    }), { status: 503 }))).stage).toBeNull();
  });

  it("builds an exact high-risk review body from the preflight obligation", () => {
    const obligation = {
      thesisId: "ENSO-CORE-01",
      afterVersionId: "version-after",
      beforeVersionId: "version-before",
      triggers: ["DIRECTION_CHANGE", "STAGE_DELTA_3"],
    };
    expect(thesisChangeReviewRequestBody(obligation, " 转场已确认 ")).toEqual({
      thesisId: "ENSO-CORE-01",
      beforeVersionId: "version-before",
      decision: "approved",
      reason: "转场已确认",
      confirm: true,
    });
    expect(obligation.triggers.map(reviewTriggerLabel)).toEqual(["方向变化", "阶段跨 3 级"]);
    expect(reviewTriggerLabel("CONFIDENCE_DELTA_26")).toBe("置信度变化 26");
    expect(reviewTriggerLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

function exemptibleModel(): AdminDailyPageModel {
  return model({
    blockers: ["TARGET_MISSING:SHIP-EU-01"],
    targets: [],
    exemptibleTargets: [{
      thesisId: "SHIP-EU-01",
      gapId: "eu-route-market-unlicensed",
      gapDescription: "SCFI、FBX、Drewry 等欧线运价数据属商业授权来源，尚未接入。",
    }],
  });
}
