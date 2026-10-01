import { useEffect, useRef, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type { AdminRunsPageModel, PageLoadState } from "../domain/page-models";
import { isAbort } from "./is-abort";
import { adminRunStatusLabel, hasAdminRuns, safeErrorCodeLabel } from "./admin-runs-view";
import { adminRunsEndpoint } from "./cursor-allowlist";
import { formatShanghaiTime } from "./shanghai-time";

type AdminRunsState = PageLoadState<AdminRunsPageModel>;

interface TriggerState {
  readonly status: "editing" | "submitting" | "error" | "success";
  readonly message: string | null;
}

/** editor 及以上角色可以手动触发采集（服务端以 editor 权限再次验证）。 */
function mayTriggerCollection(roles: readonly string[]): boolean {
  return roles.includes("editor") || roles.includes("publisher");
}

export function AdminRunsPage() {
  const endpoint = adminRunsEndpoint(window.location.search);
  const [state, setState] = useState<AdminRunsState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [forceReparse, setForceReparse] = useState(false);
  const [trigger, setTrigger] = useState<TriggerState>({ status: "editing", message: null });
  /** 中断语义与每日判定页一致：卸载时中断在途请求，不向死页面写状态。 */
  const triggerAbortRef = useRef<AbortController | null>(null);

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
        if (isAbort(error, controller.signal)) return;
        setState({ status: "error", message: "后台运行记录暂时无法加载。" });
      });
    return () => controller.abort();
  }, [endpoint, reloadToken]);

  useEffect(() => () => triggerAbortRef.current?.abort(), []);

  if (state.status === "loading") {
    return <AdminRunsNotice heading="正在取得采集任务记录…" />;
  }
  if (state.status === "error") {
    return <AdminRunsNotice heading={state.message} error />;
  }

  const model = state.data;
  const mayTrigger = mayTriggerCollection(model.actor.roles);
  const busy = trigger.status === "submitting";
  const runsEmpty = !hasAdminRuns(model);

  /**
   * 手动触发一次来源采集：reason 进审计，幂等键由浏览器生成（UUID 满足服务端
   * [A-Za-z0-9][A-Za-z0-9._:-]{7,127} 约束）。成功后刷新运行列表；结果面板展示
   * 服务端返回的采集状态与观测写入/修订计数。
   */
  async function runManualCollection() {
    if (busy || sourceId === "" || reason.trim().length === 0) return;
    const controller = new AbortController();
    triggerAbortRef.current = controller;
    setTrigger({ status: "submitting", message: `正在触发 ${sourceId} 采集…` });
    try {
      const response = await fetch(
        `/api/admin/sources/${encodeURIComponent(sourceId)}/run`,
        {
          body: JSON.stringify({ reason: reason.trim(), force: forceReparse }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          method: "POST",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const code = await response.json()
          .then((body: unknown) => (body as { readonly error?: { readonly code?: unknown } }).error?.code)
          .then((code) => (typeof code === "string" && code.length <= 64 ? code : null))
          .catch(() => null);
        const detail = code === "SOURCE_CONFIGURATION"
          ? "来源不存在或未启用，请刷新页面后重新选择。"
          : code === "VALIDATION"
            ? "请求未通过服务端校验，请检查来源与原因。"
            : "手动采集暂时无法完成，请稍后重试。";
        setTrigger({ status: "error", message: detail });
        return;
      }
      const body = await response.json() as { readonly data?: { readonly run?: { readonly observationsInserted?: number; readonly observationsRevised?: number }; readonly status?: string; readonly replayed?: boolean } };
      const run = body.data?.run;
      setTrigger({
        status: "success",
        message: run === null || run === undefined
          ? "采集已触发。"
          : `采集完成（${body.data?.status ?? "completed"}${body.data?.replayed ? "，幂等重放" : ""}）：写入 ${run.observationsInserted ?? 0} 条、修订 ${run.observationsRevised ?? 0} 条。`,
      });
      setForceReparse(false);
      setReloadToken((token) => token + 1);
    } catch (error) {
      if (isAbort(error, controller.signal)) return;
      setTrigger({ status: "error", message: "手动采集暂时无法完成，请稍后重试。" });
    }
  }

  return (
    <div className="admin-page">
      <section className="information-hero" aria-labelledby="admin-runs-title">
        <p className="eyebrow">研究后台 · 采集</p>
        <h1 id="admin-runs-title">采集任务记录</h1>
        <p>显示受 Cloudflare Access 保护的来源运行状态、观测写入与修订计数；错误详情、快照与原始响应不会进入本页。</p>
        <p className="admin-actor">当前已验证成员：{model.actor.email} · 角色：{model.actor.roles.join("、")}</p>
      </section>

      {mayTrigger && model.runnableSources.length > 0 ? (
        <section className="content-section" aria-labelledby="admin-runs-trigger-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">手动采集</p>
              <h2 id="admin-runs-trigger-title">触发一次来源采集</h2>
            </div>
          </div>
          <p className="admin-daily-hint">
            立即按该来源的采集口径抓取一次最新数据（写入与修订走正常观测语义）。
            适用场景：上游页面已更新但月度调度未到、或需要验证来源连通性。
          </p>
          <div className="admin-lifecycle-actions">
            <label htmlFor="admin-runs-source">来源</label>
            <select
              disabled={busy}
              id="admin-runs-source"
              onChange={(event) => setSourceId(event.target.value)}
              value={sourceId}
            >
              <option value="">请选择来源…</option>
              {model.runnableSources.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <label htmlFor="admin-runs-trigger-reason">操作原因（写入审计）</label>
            <input
              disabled={busy}
              id="admin-runs-trigger-reason"
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              type="text"
              value={reason}
            />
            <label className="admin-confirmation">
              <input
                checked={forceReparse}
                disabled={busy}
                onChange={(event) => setForceReparse(event.target.checked)}
                type="checkbox"
              />
              <span>强制重新解析：忽略上游内容哈希，即使页面未变化也完整重跑解析与入库（解析器修复后补齐数据时勾选；日常采集无需勾选）。</span>
            </label>
            <button
              disabled={busy || sourceId === "" || reason.trim().length === 0}
              onClick={runManualCollection}
              type="button"
            >
              {trigger.status === "submitting" ? "正在触发…" : "触发采集"}
            </button>
            {trigger.message === null ? null : (
              <p
                className={trigger.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
                role={trigger.status === "error" ? "alert" : "status"}
              >
                {trigger.message}
              </p>
            )}
          </div>
        </section>
      ) : null}

      <section className="content-section" aria-labelledby="admin-runs-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">运行历史</p>
            <h2 id="admin-runs-list-title">最近采集任务</h2>
          </div>
          <span className="muted">每页最多 25 条</span>
        </div>
        {runsEmpty ? (
          <p className="admin-daily-hint">暂无采集任务记录；可在上方手动触发一次采集。</p>
        ) : (
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
                {model.runs.map((run) => (
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
        )}
        {state.data.nextCursor === null || runsEmpty ? null : (
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
      <p className="eyebrow">研究后台 · 采集</p>
      <h2>{heading}</h2>
      <p>手动采集由 editor 及以上角色触发；观测写入与审计仍由服务端全量校验。</p>
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
