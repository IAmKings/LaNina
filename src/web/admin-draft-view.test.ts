import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import {
  canSubmitLifecycle,
  draftComparisonRows,
  hasReviewableDraft,
  lifecycleActionLabel,
  lifecycleFailureMessage,
  lifecycleTargets,
  mayShowLifecycleControls,
} from "./admin-draft-view";

describe("admin draft review helpers", () => {
  it("compares the bounded Worker projection field by field", () => {
    const rows = draftComparisonRows(PAGE_MODEL_FIXTURES.adminDraft);

    expect(rows).toHaveLength(9);
    expect(rows).toContainEqual(expect.objectContaining({ field: "版本", published: "2", draft: "3", changed: true }));
    expect(rows).toContainEqual(expect.objectContaining({ field: "摘要", changed: true }));
    expect(JSON.stringify(rows)).not.toMatch(/calculation|evidence|observation|source_run|snapshot|audit/i);
  });

  it("keeps a known thesis without a draft distinct from a draft awaiting review", () => {
    const noDraft = { ...PAGE_MODEL_FIXTURES.adminDraft, draft: null };
    expect(hasReviewableDraft(PAGE_MODEL_FIXTURES.adminDraft)).toBe(true);
    expect(hasReviewableDraft(noDraft)).toBe(false);
    expect(draftComparisonRows(noDraft)).toEqual([]);
  });

  it("offers publisher affordances only and binds each lifecycle action to its reviewed version", () => {
    const targets = lifecycleTargets(PAGE_MODEL_FIXTURES.adminDraft);
    const viewer = {
      ...PAGE_MODEL_FIXTURES.adminDraft,
      actor: { email: "viewer@example.test", roles: ["viewer"] as const },
    };

    expect(mayShowLifecycleControls(PAGE_MODEL_FIXTURES.adminDraft)).toBe(true);
    expect(mayShowLifecycleControls(viewer)).toBe(false);
    expect(targets).toEqual([
      { action: "publish", versionId: "rubber-version-3", expectedVersion: 3 },
      { action: "withdraw", versionId: "rubber-version-2", expectedVersion: 2 },
    ]);
    expect(lifecycleActionLabel("publish")).toBe("发布草稿");
    expect(lifecycleActionLabel("withdraw")).toBe("撤回当前公开版本");
  });

  it("requires a target, a meaningful reason and explicit confirmation before enabling submission", () => {
    const [target] = lifecycleTargets(PAGE_MODEL_FIXTURES.adminDraft);
    expect(canSubmitLifecycle("", true, target!)).toBe(false);
    expect(canSubmitLifecycle("  ", true, target!)).toBe(false);
    expect(canSubmitLifecycle("完成审核", false, target!)).toBe(false);
    expect(canSubmitLifecycle("完成审核", true, target!)).toBe(true);
    expect(canSubmitLifecycle("完成审核", true, null)).toBe(false);
  });

  it("keeps lifecycle failure feedback bounded to safe HTTP categories", () => {
    expect(lifecycleFailureMessage(401)).toContain("没有发布权限");
    expect(lifecycleFailureMessage(403)).toContain("没有发布权限");
    expect(lifecycleFailureMessage(404)).toContain("目标版本已不存在");
    expect(lifecycleFailureMessage(409)).toContain("目标版本已变化");
    expect(lifecycleFailureMessage(500)).toBe("发布操作暂时无法完成，请稍后重试。");
  });
});
