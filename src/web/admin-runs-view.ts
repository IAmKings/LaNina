import type { AdminRunModel, AdminRunsPageModel } from "../domain/page-models";

export function hasAdminRuns(model: AdminRunsPageModel): boolean {
  return model.runs.length > 0;
}

export function adminRunStatusLabel(status: AdminRunModel["status"]): string {
  const labels: Record<AdminRunModel["status"], string> = {
    success: "成功",
    unchanged: "无变化",
    partial: "部分完成",
    failed: "失败",
  };
  return labels[status];
}

export function safeErrorCodeLabel(code: AdminRunModel["safeErrorCode"]): string {
  return code === null ? "无" : code;
}
