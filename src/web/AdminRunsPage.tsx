import { useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type { AdminRunsPageModel, PageLoadState } from "../domain/page-models";
import { formatShanghaiTime } from "./overview-view";
import { adminRunStatusLabel, hasAdminRuns, safeErrorCodeLabel } from "./admin-runs-view";

type AdminRunsState = PageLoadState<AdminRunsPageModel>;

export function AdminRunsPage() {
  const cursor = new URLSearchParams(window.location.search).get("cursor");
  const endpoint = cursor === null ? "/api/admin/runs" : `/api/admin/runs?cursor=${encodeURIComponent(cursor)}`;
  const [state, setState] = useState<AdminRunsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Admin runs request failed");
        const body = await response.json() as unknown;
        if (!isAdminRunsEnvelope(body)) throw new Error("Admin runs response is malformed");
        setState({ status: "ready", data: body.data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "后台运行记录暂时无法加载。" });
      });
    return () => controller.abort();
  }, [endpoint]);

  if (state.status === "loading") {
    return <AdminRunsNotice heading="正在取得采集任务记录…" />;
  }
  if (state.status === "error") {
    return <AdminRunsNotice heading="后台运行记录暂时无法加载。" error />;
  }
  if (!hasAdminRuns(state.data)) {
    return <AdminRunsNotice heading="暂无可查看的采集任务记录。" />;
  }

  return (
    <div className="admin-page">
      <section className="information-hero" aria-labelledby="admin-runs-title">
        <p className="eyebrow">研究后台 · 只读</p>
        <h1 id="admin-runs-title">采集任务记录</h1>
        <p>显示受 Cloudflare Access 保护的来源运行状态、观测写入与修订计数；错误详情、快照与原始响应不会进入本页。</p>
        <p className="admin-actor">当前已验证成员：{state.data.actor.email} · 角色：{state.data.actor.roles.join("、")}</p>
      </section>
      <section className="content-section" aria-labelledby="admin-runs-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">运行历史</p>
            <h2 id="admin-runs-list-title">最近采集任务</h2>
          </div>
          <span className="muted">每页最多 25 条</span>
        </div>
        <div className="admin-runs-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">计划时间</th>
                <th scope="col">来源</th>
                <th scope="col">状态</th>
                <th scope="col">完成时间</th>
                <th scope="col">写入 / 修订</th>
                <th scope="col">安全错误码</th>
              </tr>
            </thead>
            <tbody>
              {state.data.runs.map((run) => (
                <tr key={run.id}>
                  <td><time dateTime={run.scheduledAt}>{formatShanghaiTime(run.scheduledAt)}</time></td>
                  <td><strong>{run.sourceName}</strong><br /><span className="muted">{run.sourceId}</span></td>
                  <td><span className={`admin-run-status ${run.status}`}>{adminRunStatusLabel(run.status)}</span></td>
                  <td>{formatShanghaiTime(run.finishedAt)}</td>
                  <td>{run.observationsInserted} / {run.observationsRevised}</td>
                  <td><code>{safeErrorCodeLabel(run.safeErrorCode)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.data.nextCursor === null ? null : (
          <p className="pagination-link">
            <a href={`/admin/runs?cursor=${encodeURIComponent(state.data.nextCursor)}`}>查看更早的运行记录</a>
          </p>
        )}
      </section>
    </div>
  );
}

function AdminRunsNotice({ heading, error = false }: { heading: string; error?: boolean }) {
  return (
    <section className={`notice-panel${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
      <p className="eyebrow">研究后台 · 只读</p>
      <h2>{heading}</h2>
      <p>本页不提供手动重跑、草稿编辑、发布、撤回或任何原始观测修改功能。</p>
      {error ? (
        <p className="notice-panel-action">
          Cloudflare Access 会话约 24 小时后过期，表现为本页显示受限投影（后台请求未携带 JWT）。
          <a href="/api/admin/runs">重新登录 Cloudflare Access</a>，完成登录后回到本页即可恢复。
        </p>
      ) : null}
    </section>
  );
}

function isAdminRunsEnvelope(value: unknown): value is ApiEnvelope<AdminRunsPageModel> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ApiEnvelope<AdminRunsPageModel>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
