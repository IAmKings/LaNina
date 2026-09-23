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
  emptyDailyPublishDraft,
  isAdminDailyEnvelope,
  parseTopChangeIds,
  shanghaiToday,
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
      { thesisId: "ENSO-CORE-01", thesisVersionId: "version-enso" },
      { thesisId: "RUBBER-TH-01", thesisVersionId: "version-rubber" },
    ],
    blockers: [],
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
    });
    expect(dailyPublishRequestBody(model(), draft()).expectedFreezeKey).toBeNull();
  });

  it("labels targets, blockers and status without deriving server facts", () => {
    expect(dailyTargetRows(model())).toEqual([
      { thesisId: "ENSO-CORE-01", thesisVersionId: "version-enso" },
      { thesisId: "RUBBER-TH-01", thesisVersionId: "version-rubber" },
    ]);
    expect(blockerLabel("VERSION_NOT_PUBLISHED:RUBBER-TH-01")).toBe("RUBBER-TH-01：最新版本尚未发布");
    expect(blockerLabel("UNKNOWN_THESIS:SUGAR-01")).toBe("SUGAR-01：不属于必需论点");
    expect(blockerLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(dailyPublishedLabel(model())).toBe("尚未发布");
    expect(dailyPublishedLabel(model({ published: true, publishedAt: "2026-09-10T23:00:00.000Z" })))
      .toMatch(/^已发布/);
    expect(dailyCutoffLabel(model())).toContain("2026");
  });

  it("maps only stable codes and status categories to operator feedback", () => {
    expect(dailyPublishFailureMessage(409, "GATES_FAILED")).toMatch(/门禁/);
    expect(dailyPublishFailureMessage(409, "TARGETS_UNAVAILABLE")).toMatch(/尚未全部具备/);
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
});
