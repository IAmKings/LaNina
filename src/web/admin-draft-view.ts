import type { AdminDraftPageModel, AdminDraftReviewVersionModel } from "../domain/page-models";
import type { ThesisPublicationAction } from "../domain/thesis-publication";

import { directionLabel, formatShanghaiTime, stageLabel } from "./overview-view";

export interface DraftComparisonRow {
  readonly field: string;
  readonly published: string;
  readonly draft: string;
  readonly changed: boolean;
}

export interface ThesisLifecycleTarget {
  readonly action: ThesisPublicationAction;
  readonly versionId: string;
  readonly expectedVersion: number;
}

/** Formats the Worker-owned review projection without deriving any research judgment in the browser. */
export function draftComparisonRows(model: AdminDraftPageModel): readonly DraftComparisonRow[] {
  if (model.draft === null) return [];
  const draftVersion = model.draft;
  const publishedVersion = model.published;
  return comparisonFields.map(({ field, format, select }) => {
    const published = publishedVersion === null ? "尚无当前已发布版本" : format(select(publishedVersion));
    const draft = format(select(draftVersion));
    return { field, published, draft, changed: publishedVersion === null || published !== draft };
  });
}

export function hasReviewableDraft(
  model: AdminDraftPageModel,
): model is AdminDraftPageModel & { readonly draft: AdminDraftReviewVersionModel } {
  return model.draft !== null;
}

/** Browser role checks only control the affordance; the Worker remains the authorization boundary. */
export function mayShowLifecycleControls(model: AdminDraftPageModel): boolean {
  return model.actor.roles.includes("publisher");
}

/** Uses the exact version identity returned by the authenticated review projection. */
export function lifecycleTargets(model: AdminDraftPageModel): readonly ThesisLifecycleTarget[] {
  const targets: ThesisLifecycleTarget[] = [];
  if (model.draft !== null) {
    targets.push({ action: "publish", versionId: model.draft.id, expectedVersion: model.draft.version });
  }
  if (model.published !== null) {
    targets.push({ action: "withdraw", versionId: model.published.id, expectedVersion: model.published.version });
  }
  return targets;
}

export function lifecycleActionLabel(action: ThesisPublicationAction): string {
  return action === "publish" ? "发布草稿" : "撤回当前公开版本";
}

export function canSubmitLifecycle(reason: string, confirmed: boolean, target: ThesisLifecycleTarget | null): boolean {
  return target !== null && confirmed && reason.trim().length > 0;
}

/** Converts only HTTP status categories to stable browser-safe feedback. */
export function lifecycleFailureMessage(status: number): string {
  if (status === 401 || status === 403) return "当前身份没有发布权限，请重新验证 Access 身份。";
  if (status === 404) return "目标版本已不存在，请刷新审核信息。";
  if (status === 409) return "目标版本已变化或当前不可执行，请刷新后重新审核。";
  return "发布操作暂时无法完成，请稍后重试。";
}

const comparisonFields: readonly {
  readonly field: string;
  readonly select: (version: AdminDraftReviewVersionModel) => string | number | null;
  readonly format: (value: string | number | null) => string;
}[] = [
  { field: "版本", select: (version) => version.version, format: String },
  { field: "方向", select: (version) => version.direction, format: (value) => directionLabel(value as AdminDraftReviewVersionModel["direction"]) },
  { field: "传导阶段", select: (version) => version.stage, format: (value) => stageLabel(value as AdminDraftReviewVersionModel["stage"]) },
  { field: "置信度", select: (version) => version.confidence, format: (value) => `${value}%` },
  { field: "摘要", select: (version) => version.summary, format: String },
  { field: "失效条件", select: (version) => version.invalidation, format: String },
  { field: "数据截止", select: (version) => version.basedOnCutoff, format: (value) => formatShanghaiTime(value as string) },
  { field: "创建时间", select: (version) => version.createdAt, format: (value) => formatShanghaiTime(value as string) },
  { field: "变更原因", select: (version) => version.changeReason, format: (value) => value === null ? "未填写" : String(value) },
];
